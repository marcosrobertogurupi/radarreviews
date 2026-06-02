// Servidor HTTP do Copilot — porta 3001
//
// POST /api/copilot
//   Headers: Authorization: Bearer <supabase-jwt>
//   Body:    { message: string, history?: { role: string, text: string }[] }
//   Response: { reply: string }
//
// O endpoint:
//   1. Valida o JWT do Supabase e obtém user_id
//   2. Busca tenant_id via tenant_users
//   3. Coleta contexto: resumo 30 dias, alertas ativos, reviews críticos recentes
//   4. Monta prompt de sistema com contexto + histórico
//   5. Chama Gemini Flash e retorna resposta

import 'dotenv/config'
import http from 'node:http'
import { createClient } from '@supabase/supabase-js'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { startScheduler } from '../scheduler/index.js'
import { tripadvisorSearchTask, tripadvisorReviewsTaskGet } from '../lib/dataforseo.js'
import { handleMetaAuthConnect, handleMetaAuthCallback, handleMetaWebhook } from './meta.js'
import { createAsaasCustomer, createAsaasSubscription, getAsaasSubscriptionPayments, getAsaasPixQrCode, getAsaasSubscription } from '../lib/asaas.js'
import { handleAsaasWebhook } from './asaas-webhook.js'
import { askClaude } from '../services/ai/claude.js'
import { sendDirectResponse } from '../services/ai/responder.js'
import { sendWhatsAppMessage } from '../services/whatsapp/uazapi.js'
import { notifyAdminChannels } from '../lib/notify.js'
import { decrypt, encrypt } from '../lib/crypto.js'
import { processMonthlyReport } from '../services/reports/pdf-generator.js'
import { handleWidgetRequest } from './widget.js'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { AuditoriaService } from '../services/auditoria.js'
import { handleSupportPortal } from './support.js'
import { handleSupportAdmin } from './supportAdmin.js'
import { handleProspectAdmin } from './prospectAdmin.js'
import { handleCommercialAdmin } from './commercialAdmin.js'
import { handlePartnerRoutes } from './partner.js'
import { handlePartnerAdminRoutes } from './partnerAdmin.js'
import { AI_CONFIG } from '../lib/ai-config.js'

// ── Clientes ────────────────────────────────────────────────────

const supabaseAdmin = createClient(
  process.env['SUPABASE_URL']!,
  process.env['SUPABASE_SERVICE_ROLE_KEY']!
)

function getGemini() {
  const key = process.env['GEMINI_API_KEY']
  if (!key) throw new Error('GEMINI_API_KEY não configurada.')
  return new GoogleGenerativeAI(key)
}

const PORT = parseInt(process.env['PORT'] ?? '3001', 10)

// ── CORS helper ──────────────────────────────────────────────────

export function setCors(req: http.IncomingMessage, res: http.ServerResponse, extraHeaders = 'Content-Type, Authorization') {
  const originHeader = req.headers.origin
  const origin = Array.isArray(originHeader) ? originHeader[0] : (originHeader || '')
  // Whitelist de produção
  const allowed = [
    // Domínios de produção
    'https://reputei.com.br',
    'https://www.reputei.com.br',
    'https://admin.reputei.com.br',
    'https://app.reputei.com.br',
    // Legado Vercel
    'https://reputei-portal.vercel.app',
    'https://admin-reputei.vercel.app',
    'https://reputei.vercel.app',
    'https://radarreviews.vercel.app',
    'https://radarreviews-spnb.vercel.app',
    'https://radar-views.vercel.app',
    // Dev local
    'http://localhost:5173',
    'http://localhost:5174',
    'http://localhost:3000',
  ]
  const isAllowed = allowed.includes(origin) || 
                   origin.endsWith('.vercel.app') || 
                   origin.startsWith('http://localhost:')
  
  res.setHeader('Access-Control-Allow-Origin', isAllowed ? origin : allowed[0])
  res.setHeader('Access-Control-Allow-Headers', extraHeaders + ', x-client-info, x-supabase-auth')
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, PATCH, DELETE, PUT, OPTIONS')
  res.setHeader('Access-Control-Allow-Credentials', 'true')
  res.setHeader('Vary', 'Origin')
}

async function readBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  let raw = ''
  for await (const chunk of req) raw += chunk
  if (!raw) return {}
  try {
    return JSON.parse(raw) as Record<string, unknown>
  } catch {
    throw new Error('JSON inválido')
  }
}

// ── Contexto por tenant (cache 5 min) ────────────────────────────

interface TenantContext {
  businessName: string
  total30d: number
  positive: number
  neutral: number
  negative: number
  critical: number
  avgScore: number
  pendingAlerts: number
  criticalReviews: Array<{ channel: string; summary: string; alert_reason?: string; body?: string }>
  fetchedAt: number
}

const contextCache = new Map<string, TenantContext>()
const CACHE_TTL_MS = 5 * 60 * 1000

async function getTenantContext(tenantId: string): Promise<TenantContext> {
  const cached = contextCache.get(tenantId)
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached

  const since30 = new Date(Date.now() - 30 * 86400_000).toISOString()
  const since7  = new Date(Date.now() -  7 * 86400_000).toISOString()

  const [bRes, rvRes, alRes, critRes] = await Promise.all([
    supabaseAdmin.from('monitored_businesses').select('name').eq('tenant_id', tenantId).limit(1).single(),
    supabaseAdmin.from('reviews').select('sentiment, dissatisfaction_score').eq('tenant_id', tenantId).gte('published_at', since30),
    supabaseAdmin.from('alert_rules').select('id').eq('tenant_id', tenantId).then(({ data: ruleRows }) => {
      const ruleIds = (ruleRows ?? []).map((r: Record<string, unknown>) => r['id'] as string)
      return supabaseAdmin.from('alert_events').select('id', { count: 'exact', head: true })
        .eq('notified', false)
        .gte('triggered_at', since7)
        .in('rule_id', ruleIds)
    }),
    supabaseAdmin.from('reviews')
      .select('channel, sentiment_summary, sentiment_result, body')
      .eq('tenant_id', tenantId)
      .in('sentiment', ['critical', 'negative'])
      .order('published_at', { ascending: false })
      .limit(5),
  ])

  const reviews = rvRes.data ?? []
  const counts  = { positive: 0, neutral: 0, negative: 0, critical: 0 }
  let scoreSum  = 0; let scoreCount = 0

  for (const r of reviews) {
    if (r.sentiment in counts) counts[r.sentiment as keyof typeof counts]++
    if (r.dissatisfaction_score != null) { scoreSum += r.dissatisfaction_score; scoreCount++ }
  }

  const ctx: TenantContext = {
    businessName:    (bRes.data as { name?: string } | null)?.name ?? 'sua empresa',
    total30d:        reviews.length,
    ...counts,
    avgScore:        scoreCount ? Math.round(scoreSum / scoreCount) : 0,
    pendingAlerts:   alRes.count ?? 0,
    criticalReviews: (critRes.data ?? []).map(r => {
      const ar = (r.sentiment_result as Record<string, unknown> | null)?.['alert_reason'] as string | undefined
      return {
        channel: r.channel as string,
        summary: (r.sentiment_summary as string | undefined) ?? '',
        ...(ar ? { alert_reason: ar } : {}),
        ...(r.body ? { body: r.body as string } : {}),
      }
    }),
    fetchedAt: Date.now(),
  }

  contextCache.set(tenantId, ctx)
  return ctx
}

// ── Monta system prompt ───────────────────────────────────────────

function buildSystemPrompt(ctx: TenantContext): string {
  const negRate = ctx.total30d > 0 ? Math.round(((ctx.negative + ctx.critical) / ctx.total30d) * 100) : 0
  const critSummaries = ctx.criticalReviews.length > 0
    ? ctx.criticalReviews.slice(0, 3).map(r =>
        `- [${r.channel}] ${r.summary || r.body?.slice(0, 120) || '(sem texto)'}${r.alert_reason ? ` → Ação: ${r.alert_reason}` : ''}`
      ).join('\n')
    : '- Nenhum review crítico recente.'

  return `Você é o Copiloto de Reputação da plataforma Reputei, um assistente especializado em gestão de reputação online.
Você fala português do Brasil, é empático, objetivo e focado em ações práticas.

## Contexto atual de ${ctx.businessName} (últimos 30 dias):
- Total de reviews coletados: ${ctx.total30d}
- Positivos: ${ctx.positive} | Neutros: ${ctx.neutral} | Negativos: ${ctx.negative} | Críticos: ${ctx.critical}
- Taxa de insatisfação: ${negRate}%
- Score médio de insatisfação: ${ctx.avgScore}/100 (0=ótimo, 100=furioso)
- Alertas pendentes esta semana: ${ctx.pendingAlerts}

## Reviews críticos/negativos recentes:
${critSummaries}

## Suas responsabilidades:
1. Responder perguntas sobre a reputação online da empresa usando o contexto acima
2. Sugerir respostas empáticas e profissionais para reviews específicos quando solicitado
3. Identificar padrões e tendências nos feedbacks
4. Recomendar ações concretas e priorizadas
5. Explicar o impacto de reviews negativos e como mitigá-los

## Regras:
- Sempre baseie suas respostas nos dados acima
- Seja objetivo: máximo 3-4 parágrafos por resposta
- Para sugestões de resposta: seja cordial, reconheça o problema, ofereça solução
- Quando não houver dados suficientes, diga claramente
- Nunca invente métricas ou dados que não estão no contexto
- Se perguntarem sobre recursos do sistema, explique brevemente e redirecione para ações práticas`
}

// ── Notificação admin: ver src/lib/notify.ts ─────────────────────

// ── Onboarding — cria tenant + usuário ───────────────────────────

function slugify(name: string): string {
  return name.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/, '')
    .slice(0, 50)
}

async function handleOnboarding(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  setCors(req, res)
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return }
  if (req.method !== 'POST')   { res.writeHead(405); res.end('Method not allowed'); return }

  let raw = ''
  for await (const chunk of req) raw += chunk

  let body: {
    email?: string; password?: string
    businessName?: string; category?: string; cnpj?: string
    channels?: string[]; plan?: string; billingMethod?: 'pix' | 'credit_card';
    periodicity?: 'monthly' | 'trimestral' | 'semestral' | 'anual';
    instagramUsername?: string; hashtags?: string;
  }
  try { body = JSON.parse(raw) } catch {
    res.writeHead(400); res.end(JSON.stringify({ error: 'JSON inválido' })); return
  }

  const { email, password, businessName, channels = [], plan: requestedPlan = 'trial', billingMethod = 'pix', periodicity = 'trimestral' } = body
  if (!email?.trim() || !password || !businessName?.trim()) {
    res.writeHead(400)
    res.end(JSON.stringify({ error: 'email, password e businessName são obrigatórios' }))
    return
  }

  try {
    // 1. Criar usuário Auth (email já confirmado)
    const { data: authData, error: authErr } = await supabaseAdmin.auth.admin.createUser({
      email: email.trim(), password, email_confirm: true,
    })
    if (authErr || !authData.user) {
      const msg = authErr?.message ?? 'Erro ao criar usuário'
      const status = msg.toLowerCase().includes('already') ? 409 : 500
      res.writeHead(status); res.end(JSON.stringify({ error: msg })); return
    }
    const userId = authData.user.id

    // 2. Criar tenant (slug único)
    let slug = slugify(businessName.trim())
    const { data: slugExists } = await supabaseAdmin
      .from('tenants').select('slug').eq('slug', slug).maybeSingle()
    if (slugExists) slug = `${slug}-${Math.random().toString(36).slice(2, 6)}`

    const { data: planData } = await supabaseAdmin
      .from('plans')
      .select('slug, max_channels, price_monthly')
      .eq('slug', requestedPlan ?? 'trial')
      .maybeSingle()
    const plan = planData?.slug ?? 'trial'
    const maxChannels = planData?.max_channels ?? 3
    if (channels.length > maxChannels) {
      res.writeHead(422)
      res.end(JSON.stringify({ error: `O plano ${plan} permite no máximo ${maxChannels} ${maxChannels !== 1 ? 'canais' : 'canal'}.` }))
      return
    }

    const trialEndsAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()

    const { data: tenant, error: tenantErr } = await supabaseAdmin
      .from('tenants')
      .insert({ name: businessName.trim(), slug, plan, plan_status: 'trial', trial_ends_at: trialEndsAt })
      .select('id').single()
    if (tenantErr || !tenant) throw new Error(tenantErr?.message ?? 'Erro ao criar tenant')

    // 3. Vincular usuário ao tenant como owner
    await supabaseAdmin.from('tenant_users').insert({
      tenant_id: tenant.id, user_id: userId, role: 'owner',
    })

    // 4. Criar empresa monitorada
    const bizInsert: Record<string, unknown> = {
      tenant_id: tenant.id, name: businessName.trim(),
    }
    if (body.category?.trim()) bizInsert['category'] = body.category.trim()
    if (body.cnpj?.trim())     bizInsert['cnpj']     = body.cnpj.replace(/\D/g, '').slice(0, 14)

    const { data: biz, error: bizErr } = await supabaseAdmin
      .from('monitored_businesses').insert(bizInsert).select('id').single()
    if (bizErr || !biz) throw new Error(bizErr?.message ?? 'Erro ao criar empresa')
    const bizId = biz.id

    // 4.5 Criar regras de alerta padrão
    await supabaseAdmin.from('alert_rules').insert([
      {
        tenant_id: tenant.id,
        business_id: bizId,
        name: 'Rating Baixo (Automático)',
        condition_type: 'rating_drop',
        threshold: 2,
        notify_email: true
      },
      {
        tenant_id: tenant.id,
        business_id: bizId,
        name: 'Sentimento Crítico (IA)',
        condition_type: 'negative_surge',
        notify_email: true
      }
    ])

    // 5. Criar conectores para os canais selecionados
    if (channels.length > 0) {
      const connectors = await Promise.all(channels.map(async (ch) => {
        const connData: any = { business_id: biz.id, channel: ch, status: 'active' }
        
        // Google Maps sempre precisa de place_id configurado pelo admin
        if (ch === 'google_maps') {
          connData.status = 'pending_config'
        }

        // Configuração Inteligente para Instagram
        if (ch === 'instagram') {
          connData.external_id = body.instagramUsername?.replace('@', '') || businessName.trim();
          connData.config = { 
            username: body.instagramUsername?.replace('@', ''),
            hashtags: body.hashtags || '',
            interval_minutes: 120 
          };
        }

        // Se for TripAdvisor, tentamos obter o url_path via DataForSEO
        if (ch === 'tripadvisor') {
          try {
            console.log(`[onboarding] Buscando TripAdvisor para: ${businessName} em ${body.category || ''}`)
            const searchRes = await tripadvisorSearchTask(businessName.trim(), body.category || '', tenant.id)
            if (searchRes.tasks?.[0]?.id) {
              const taskId = searchRes.tasks[0].id
              // Polling rápido de 10s para tentar pegar o url_path imediatamente
              let urlPath = ''
              for (let i = 0; i < 5; i++) {
                await new Promise(r => setTimeout(r, 2000))
                const taskResult = await tripadvisorReviewsTaskGet(taskId)
                const resultObj = taskResult.tasks?.[0]?.result?.[0]
                if (resultObj?.url_path) {
                  urlPath = resultObj.url_path
                  break
                }
              }
              if (urlPath) {
                connData.config = { url_path: urlPath, interval_minutes: 60 }
                console.log(`[onboarding] TripAdvisor url_path encontrado: ${urlPath}`)
              } else {
                connData.status = 'pending_config'
                console.warn(`[onboarding] TripAdvisor url_path não encontrado no tempo limite (taskId: ${taskId})`)
              }
            }
          } catch (e) {
            console.error(`[onboarding] Erro ao buscar TripAdvisor:`, e)
            connData.status = 'pending_config'
          }
        }
        
        return connData
      }))

      await supabaseAdmin.from('channel_connectors').insert(connectors)

      // Canais que sempre exigem verificação do admin
      const ALWAYS_NOTIFY = ['google_maps', 'tripadvisor']
      const channelsToNotify = connectors
        .map(c => c.channel as string)
        .filter(ch => ALWAYS_NOTIFY.includes(ch) || connectors.find(c => c.channel === ch)?.status === 'pending_config')

      if (channelsToNotify.length > 0) {
        notifyAdminChannels({
          businessName: businessName.trim(),
          email: email.trim(),
          plan,
          channels: channelsToNotify,
        }).catch((e: unknown) => console.error('[onboarding] Falha ao notificar admin:', e))
      }
    }

    // 6. Criar Assinatura no Asaas (Trial 7 dias)
    let asaasCustomerId = '';
    let asaasSubscriptionId = '';
    let invoiceUrl = '';

    try {
      const customer = await createAsaasCustomer({
        name: businessName.trim(),
        email: email.trim(),
        cpfCnpj: body.cnpj?.replace(/\D/g, '') || '',
      });
      asaasCustomerId = customer.id;

      const basePrice = planData?.price_monthly ?? 139;
      
      // Descontos por periodicidade (Trimestral: 5%, Semestral: 10%, Anual: 20%)
      const periodDiscounts: Record<string, number> = { monthly: 0, trimestral: 0.05, semestral: 0.10, anual: 0.20 };
      const periodDiscount = periodDiscounts[periodicity] || 0;
      
      // Desconto PIX (5% adicional sobre o valor já com desconto de período)
      const pixDiscountMult = billingMethod === 'pix' ? 0.95 : 1;
      
      const finalPrice = (basePrice * (1 - periodDiscount)) * pixDiscountMult;
      const trialEndsAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

      const subscription = await createAsaasSubscription({
        customerId: asaasCustomerId,
        billingType: billingMethod === 'pix' ? 'PIX' : 'CREDIT_CARD',
        value: Number(finalPrice.toFixed(2)),
        nextDueDate: trialEndsAt.split('T')[0]!, // 7 dias a partir de hoje
        cycle: periodicity === 'anual' ? 'ANNUALLY' : 
               periodicity === 'semestral' ? 'SEMIANNUALLY' : 
               periodicity === 'trimestral' ? 'QUARTERLY' : 'MONTHLY',
        description: `Plano ${plan.toUpperCase()} - Reputei SaaS (${periodicity})`,
        externalReference: tenant.id
      });
      asaasSubscriptionId = subscription.id;
      invoiceUrl = subscription.invoiceUrl;

      // Atualizar tenant com IDs do Asaas e Trial
      await supabaseAdmin
        .from('tenants')
        .update({
          asaas_customer_id: asaasCustomerId,
          asaas_subscription_id: asaasSubscriptionId,
          trial_ends_at: trialEndsAt,
          subscription_status: 'trial',
          billing_method: billingMethod
        })
        .eq('id', tenant.id);

    } catch (paymentErr) {
      console.error('[onboarding] Erro ao processar pagamento Asaas:', paymentErr);
      // Continuamos o onboarding mas avisamos que o pagamento falhou
    }

    console.log(`[onboarding] Tenant criado: ${slug} (${tenant.id}) — usuário: ${email}`)
    res.writeHead(201, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ 
      ok: true, 
      tenantId: tenant.id, 
      businessId: biz.id,
      invoiceUrl: invoiceUrl // Link para o cliente ver a fatura/configurar pagamento
    }))

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[onboarding] Erro:', msg)
    res.writeHead(500); res.end(JSON.stringify({ error: msg }))
  }
}

// ── Autenticação JWT ──────────────────────────────────────────────

// [APPSEC] C3 — Validação segura de token via Auth GoTrue
export async function getAuthUser(authHeader: string | undefined): Promise<{ userId: string; tenantId: string; perfil: string; nome: string; email: string } | null> {
  if (!authHeader?.startsWith('Bearer ')) return null
  const token = authHeader.slice(7)
  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token)
  if (error || !user) return null

  // O tenant_id em app_metadata tem prioridade por ser imutável
  const appTenantId = user.app_metadata?.tenant_id


  // Buscar perfil e dados do usuário na tabela public.usuarios
  const { data: userData } = await supabaseAdmin
    .from('usuarios')
    .select('nome, email, perfil')
    .eq('id', user.id)
    .single()

  const { data: tu } = await supabaseAdmin
    .from('tenant_users')
    .select('tenant_id')
    .eq('user_id', user.id)
    .single()

  // Se for admin/operador pode não ter tenant_id fixo
  const tenantId = (tu as { tenant_id: string })?.tenant_id || ''

  // Fallback para E2E tests: se não tem na tabela usuarios, mas tem tenant_id, assume como assinante
  if (!userData && !tenantId) return null
  
  // Preferir app_metadata, depois fallback para a tabela tenant_users
  const finalTenantId = appTenantId || tenantId || ''

  return { 
    userId: user.id, 
    tenantId, 
    perfil: userData?.perfil || 'assinante', 
    nome: userData?.nome || user.email?.split('@')[0] || 'Usuário',
    email: userData?.email || user.email || ''
  }
}

/**
 * Middleware simplificado para checar permissão
 */
function checkPermission(userPerfil: string, allowedPerfis: string[]): boolean {
  if (userPerfil === 'admin') return true // Superusuário
  return allowedPerfis.includes(userPerfil)
}

// [APPSEC] C2 — Helper para injeção segura de tenant_id em todas as queries
export function tenantQuery(table: string, tenantId: string) {
  return supabaseAdmin.from(table).eq('tenant_id', tenantId);
}

// [APPSEC] C5 — Helper para checar status da assinatura no back-end
export async function checkTenantStatus(tenantId: string): Promise<boolean> {
  if (!tenantId) return false;
  const { data: t } = await supabaseAdmin.from('tenants').select('is_active, subscription_status, trial_ends_at').eq('id', tenantId).single();
  if (!t || !t.is_active || ['suspended', 'cancelled'].includes(t.subscription_status)) return false;
  if (t.subscription_status === 'trial' && t.trial_ends_at && new Date(t.trial_ends_at) < new Date()) return false;
  return true;
}

// [APPSEC] C7 — In-memory Rate Limiting para rotas de custo (WhatsApp, Copilot)
const rateLimits = new Map<string, { count: number, resetAt: number }>();
export function checkRateLimit(key: string, maxReqs: number, windowMs: number): boolean {
  const now = Date.now();
  let entry = rateLimits.get(key);
  if (!entry || now > entry.resetAt) {
    entry = { count: 1, resetAt: now + windowMs };
    rateLimits.set(key, entry);
    return true;
  }
  if (entry.count >= maxReqs) return false;
  entry.count++;
  return true;
}

// ── Handler principal ─────────────────────────────────────────────

async function handleCopilot(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  setCors(req, res, 'Content-Type, Authorization')
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return }
  if (req.method !== 'POST')   { res.writeHead(405); res.end('Method not allowed'); return }

  // Ler body
  let body = ''
  for await (const chunk of req) body += chunk
  let parsed: { message?: string; history?: Array<{ role: string; text: string }> }
  try { parsed = JSON.parse(body) } catch { res.writeHead(400); res.end(JSON.stringify({ error: 'JSON inválido' })); return }

  const { message, history = [] } = parsed
  if (!message?.trim()) { res.writeHead(400); res.end(JSON.stringify({ error: 'Campo message é obrigatório' })); return }

  // Auth
  const auth = await getAuthUser(req.headers.authorization)
  if (!auth) {
    res.writeHead(401)
    res.end(JSON.stringify({ error: 'Não autenticado. Faça login novamente.' }))
    return
  }

  // [APPSEC] C5 e C7 — Verificação de assinatura e de Rate Limit
  if (!(await checkTenantStatus(auth.tenantId))) {
    res.writeHead(402); res.end(JSON.stringify({ error: 'Assinatura suspensa ou trial expirado.' })); return;
  }
  if (!checkRateLimit(`copilot:${auth.tenantId}`, 30, 60000)) {
    res.writeHead(429); res.end(JSON.stringify({ error: 'Muitas requisições (Rate limit exceeded).' })); return;
  }

  try {
    const ctx = await getTenantContext(auth.tenantId)
    const systemPrompt = buildSystemPrompt(ctx)
    let reply = ''

    // Tentar Claude primeiro (conforme solicitado pelo usuário)
    try {
      reply = await askClaude(systemPrompt, message, history)
      console.log(`[copilot] Resposta gerada via Claude para tenant ${auth.tenantId}`)
    } catch (claudeErr) {
      console.warn('[copilot] Claude falhou ou sem chave. Usando Gemini como fallback.', claudeErr)
      
      const genAI = getGemini()
      const model = genAI.getGenerativeModel({
        model: AI_CONFIG.model,
        generationConfig: { temperature: 0.7, maxOutputTokens: 1024 },
        systemInstruction: systemPrompt,
      })

      const chatHistory = history.map(h => ({
        role: h.role === 'user' ? 'user' : 'model',
        parts: [{ text: h.text }],
      }))

      const chat = model.startChat({ history: chatHistory })
      const result = await chat.sendMessage(message)
      reply = result.response.text().trim()
      console.log(`[copilot] Resposta gerada via Gemini fallback para tenant ${auth.tenantId}`)
    }

    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ reply }))

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[copilot] Erro:', msg)
    res.writeHead(500)
    res.end(JSON.stringify({ error: `Erro ao processar: ${msg}` }))
  }
}

// ── Atualizar credenciais de um tenant ───────────────────────────

async function handleUpdateCredentials(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  setCors(req, res, 'Content-Type, Authorization')
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return }
  if (req.method !== 'POST')   { res.writeHead(405); res.end('Method not allowed'); return }

  let raw = ''
  for await (const chunk of req) raw += chunk

  let body: { tenantId?: string; email?: string; password?: string }
  try { body = JSON.parse(raw) } catch {
    res.writeHead(400); res.end(JSON.stringify({ error: 'JSON inválido' })); return
  }

  const { tenantId, email, password } = body
  if (!tenantId || (!email && !password)) {
    res.writeHead(400)
    res.end(JSON.stringify({ error: 'tenantId e ao menos email ou password são obrigatórios' }))
    return
  }

  try {
    // Buscar user_id do tenant
    const { data: tu, error: tuErr } = await supabaseAdmin
      .from('tenant_users')
      .select('user_id')
      .eq('tenant_id', tenantId)
      .single()

    if (tuErr || !tu) {
      res.writeHead(404); res.end(JSON.stringify({ error: 'Tenant sem usuário vinculado' })); return
    }

    const updates: { email?: string; password?: string } = {}
    if (email?.trim()) updates.email = email.trim()
    if (password)      updates.password = password

    const { error } = await supabaseAdmin.auth.admin.updateUserById(tu.user_id, updates)
    if (error) {
      const status = error.message.toLowerCase().includes('already') ? 409 : 500
      res.writeHead(status); res.end(JSON.stringify({ error: error.message })); return
    }

    console.log(`[credentials] Tenant ${tenantId} atualizado — user ${tu.user_id}`)
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true }))

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[credentials] Erro:', msg)
    res.writeHead(500); res.end(JSON.stringify({ error: msg }))
  }
}

// ── Planos: endpoint público ─────────────────────────────────────

async function handleGetPlans(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  setCors(req, res)
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return }
  if (req.method !== 'GET') { res.writeHead(405); res.end(); return }

  const { data, error } = await supabaseAdmin
    .from('plans')
    .select('*, plan_benefits(id, description, sort_order)')
    .eq('is_active', true)
    .eq('is_public', true)
    .order('sort_order')

  if (error) { res.writeHead(500); res.end(JSON.stringify({ error: error.message })); return }

  const result = (data ?? []).map((p: any) => ({
    id: p.id, slug: p.slug, name: p.name, description: p.description,
    price_monthly: p.price_monthly, max_channels: p.max_channels,
    color: p.color, is_popular: p.is_popular, sort_order: p.sort_order,
    benefits: (p.plan_benefits ?? [])
      .sort((a: any, b: any) => a.sort_order - b.sort_order)
      .map((b: any) => b.description),
  }))

  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(result))
}

// ── Planos: CRUD admin ───────────────────────────────────────────

async function handleAdminPlans(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  setCors(req, res, 'Content-Type, Authorization')
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return }

  const auth = await getAuthUser(req.headers.authorization)
  if (!auth || auth.perfil !== 'admin') {
    res.writeHead(403); res.end(JSON.stringify({ error: 'Apenas administradores.' })); return
  }

  const url = req.url ?? ''
  const planId = url.split('/api/admin/plans/')[1]?.split('/')[0] || null

  // GET /api/admin/plans — todos os planos (inclusive inativos)
  if (req.method === 'GET') {
    const { data, error } = await supabaseAdmin
      .from('plans')
      .select('*, plan_benefits(id, description, sort_order)')
      .order('sort_order')

    if (error) { res.writeHead(500); res.end(JSON.stringify({ error: error.message })); return }

    const result = (data ?? []).map((p: any) => ({
      id: p.id, slug: p.slug, name: p.name, description: p.description,
      price_monthly: p.price_monthly, max_channels: p.max_channels,
      color: p.color, is_active: p.is_active, is_public: p.is_public,
      is_popular: p.is_popular, sort_order: p.sort_order,
      benefits: (p.plan_benefits ?? [])
        .sort((a: any, b: any) => a.sort_order - b.sort_order)
        .map((b: any) => b.description),
    }))

    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(result))
    return
  }

  // POST /api/admin/plans — criar novo plano
  if (req.method === 'POST' && !planId) {
    const body = await readBody(req) as any
    const { benefits = [], ...planData } = body

    const { data: newPlan, error } = await supabaseAdmin
      .from('plans').insert(planData).select('id').single()

    if (error || !newPlan) { res.writeHead(500); res.end(JSON.stringify({ error: error?.message })); return }

    if ((benefits as string[]).length > 0) {
      await supabaseAdmin.from('plan_benefits').insert(
        (benefits as string[]).map((desc, i) => ({ plan_id: newPlan.id, description: desc, sort_order: i + 1 }))
      )
    }

    res.writeHead(201, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true, id: newPlan.id }))
    return
  }

  // PATCH /api/admin/plans/:id — atualizar plano + benefícios
  if (req.method === 'PATCH' && planId) {
    const body = await readBody(req) as any
    const { benefits, ...planData } = body

    if (Object.keys(planData).length > 0) {
      const { error } = await supabaseAdmin.from('plans').update(planData).eq('id', planId)
      if (error) { res.writeHead(500); res.end(JSON.stringify({ error: error.message })); return }
    }

    if (Array.isArray(benefits)) {
      await supabaseAdmin.from('plan_benefits').delete().eq('plan_id', planId)
      if (benefits.length > 0) {
        await supabaseAdmin.from('plan_benefits').insert(
          (benefits as string[]).map((desc, i) => ({ plan_id: planId, description: desc, sort_order: i + 1 }))
        )
      }
    }

    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true }))
    return
  }

  // DELETE /api/admin/plans/:id
  if (req.method === 'DELETE' && planId) {
    const { error } = await supabaseAdmin.from('plans').delete().eq('id', planId)
    if (error) { res.writeHead(500); res.end(JSON.stringify({ error: error.message })); return }
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true }))
    return
  }

  res.writeHead(404); res.end(JSON.stringify({ error: 'Rota não encontrada' }))
}

// ── Deletar tenant e usuário auth ────────────────────────────────

async function handleDeleteTenant(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  setCors(req, res, 'Content-Type, Authorization')
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return }
  if (req.method !== 'DELETE')  { res.writeHead(405); res.end('Method not allowed'); return }

  // Extrai tenantId da URL: /api/admin/tenant/:id
  const tenantId = req.url?.split('/api/admin/tenant/')[1]?.split('?')[0]
  if (!tenantId) { res.writeHead(400); res.end(JSON.stringify({ error: 'tenantId obrigatório' })); return }

  // RBAC: Apenas admin pode excluir
  const auth = await getAuthUser(req.headers.authorization)
  if (!auth || auth.perfil !== 'admin') {
    res.writeHead(403); res.end(JSON.stringify({ error: 'Apenas administradores podem excluir assinantes.' })); return
  }

  try {
    // 1. Buscar user_id antes de deletar
    const { data: tu } = await supabaseAdmin
      .from('tenant_users')
      .select('user_id')
      .eq('tenant_id', tenantId)
      .single()

    // 2. Deletar tenant (cascata apaga tenant_users, businesses, reviews, etc.)
    const { error: delErr } = await supabaseAdmin
      .from('tenants')
      .delete()
      .eq('id', tenantId)

    if (delErr) {
      res.writeHead(500); res.end(JSON.stringify({ error: delErr.message })); return
    }

    // 3. Deletar usuário auth (ignora erro se já não existir)
    if (tu?.user_id) {
      await supabaseAdmin.auth.admin.deleteUser(tu.user_id)
      console.log(`[delete-tenant] Auth user ${tu.user_id} deletado`)
    }

    // LOG DE AUDITORIA
    const auth = await getAuthUser(req.headers.authorization)
    if (auth) {
      await AuditoriaService.registrarAcaoAdmin(
        { id: auth.userId, nome: auth.nome, email: auth.email, perfil: auth.perfil }, 
        'EXCLUIR_ASSINANTE', 
        `Assinante ${tenantId} removido do sistema`,
        req.socket.remoteAddress,
        { tipo: 'assinante', id: tenantId }
      )
    }

    console.log(`[delete-tenant] Tenant ${tenantId} deletado`)
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true }))

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[delete-tenant] Erro:', msg)
    res.writeHead(500); res.end(JSON.stringify({ error: msg }))
  }
}

// ── Deletar conector e dados vinculados ──────────────────────────
// Usa service role key para contornar RLS que bloqueia o anon key

async function handleDeleteConnector(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  setCors(req, res, 'Content-Type')
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return }
  if (req.method !== 'DELETE')  { res.writeHead(405); res.end('Method not allowed'); return }

  const connectorId = req.url?.split('/api/admin/connector/')[1]?.split('?')[0]
  if (!connectorId) { res.writeHead(400); res.end(JSON.stringify({ error: 'connectorId obrigatório' })); return }

  try {
    // Deletar filhos em sequência (evita conflito de FK entre eles)
    await supabaseAdmin.from('system_notifications').delete().eq('connector_id', connectorId)
    await supabaseAdmin.from('sync_jobs').delete().eq('connector_id', connectorId)
    await supabaseAdmin.from('reviews').delete().eq('connector_id', connectorId)

    // Deletar o conector
    const { error } = await supabaseAdmin.from('channel_connectors').delete().eq('id', connectorId)
    if (error) { res.writeHead(500); res.end(JSON.stringify({ error: error.message })); return }

    console.log(`[delete-connector] Conector ${connectorId} deletado`)
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true }))

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[delete-connector] Erro:', msg)
    res.writeHead(500); res.end(JSON.stringify({ error: msg }))
  }
}

// ── Novos endpoints de admin ───────────────────────────────────────

async function handleCreateConnector(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  setCors(req, res)
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return }
  try {
    const body = await readBody(req) as {
      business_id: string
      channel: string
      external_id: string
      config?: Record<string, unknown>
    }
    const { data, error } = await supabaseAdmin
      .from('channel_connectors')
      .insert({
        business_id: body.business_id,
        channel: body.channel,
        external_id: body.external_id,
        status: 'active',
        config: body.config ?? { interval_minutes: 60 },
      })
      .select()
      .single()
    if (error) {
      res.writeHead(400, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: error.message }))
      return
    }
    res.writeHead(201, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(data))
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    res.writeHead(500); res.end(JSON.stringify({ error: msg }))
  }
}

async function handleUpdateConnectorConfig(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  setCors(req, res)
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return }
  try {
    const connectorId = req.url?.split('/api/admin/connector/')[1]?.split('/config')[0]
    const body = await readBody(req) as {
      config: Record<string, unknown>
      external_id: string
      status: string
    }
    const { error } = await supabaseAdmin
      .from('channel_connectors')
      .update({
        config: body.config,
        external_id: body.external_id,
        status: body.status ?? 'active',
      })
      .eq('id', connectorId)
    if (error) {
      res.writeHead(400, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: error.message }))
      return
    }
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true }))
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    res.writeHead(500); res.end(JSON.stringify({ error: msg }))
  }
}

async function handleForceSync(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  setCors(req, res)
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return }
  
  const connectorId = req.url?.split('/api/admin/connector/')[1]?.split('/force-sync')[0]
  if (!connectorId) {
    res.writeHead(400); res.end(JSON.stringify({ error: 'connectorId obrigatório' })); return
  }

  try {
    // 1. Verificar se já sincronizou nos últimos 10 minutos para evitar gasto de créditos
    const { data: conn } = await supabaseAdmin
      .from('channel_connectors')
      .select('last_sync_at')
      .eq('id', connectorId)
      .single()

    if (conn?.last_sync_at) {
      const lastSync = new Date(conn.last_sync_at).getTime()
      const tenMinutesAgo = Date.now() - 10 * 60_000
      
      if (lastSync > tenMinutesAgo) {
        res.writeHead(429, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ 
          error: 'Busca recente detectada. Aguarde alguns minutos para forçar novamente e economizar créditos.' 
        }))
        return
      }
    }

    // 2. Se passou na trava, agenda para o próximo ciclo do scheduler
    const { error } = await supabaseAdmin
      .from('channel_connectors')
      .update({ next_sync_at: new Date().toISOString(), status: 'active' })
      .eq('id', connectorId)

    if (error) {
      res.writeHead(400, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: error.message }))
      return
    }

    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true }))
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    res.writeHead(500); res.end(JSON.stringify({ error: msg }))
  }
}

async function handleUpdateTenant(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  setCors(req, res, 'Content-Type, Authorization')
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return }
  try {
    const tenantId = req.url?.split('/api/admin/tenant/')[1]?.split('?')[0]
    const body = await readBody(req) as {
      name?: string
      slug?: string
      plan?: string
      admin_whatsapp?: string | null
      admin_email?: string | null
      critical_alert_hours?: number | null
      business_name?: string
      business_cnpj?: string
      business_category?: string
      whatsapp_token?: string
      whatsapp_base_url?: string
      whatsapp_limit_monthly?: number
      plan_status?: string
      trial_ends_at?: string | null
    }

    const auth = await getAuthUser(req.headers.authorization)
    const isChangingPlan = body.plan !== undefined || body.plan_status !== undefined || body.trial_ends_at !== undefined
    
    if (isChangingPlan && (!auth || auth.perfil !== 'admin')) {
      res.writeHead(403); res.end(JSON.stringify({ error: 'Apenas administradores podem alterar planos ou datas de teste.' })); return
    }

    // Atualizar tenant
    if (body.name || body.plan || body.slug || body.admin_whatsapp !== undefined || body.admin_email !== undefined || body.critical_alert_hours !== undefined) {
      const { error } = await supabaseAdmin
        .from('tenants')
        .update({
          ...(body.name  ? { name: body.name }   : {}),
          ...(body.slug  ? { slug: body.slug }   : {}),
          ...(body.plan  ? { plan: body.plan }   : {}),
          ...(body.admin_whatsapp !== undefined ? { admin_whatsapp: body.admin_whatsapp } : {}),
          ...(body.admin_email !== undefined ? { admin_email: body.admin_email } : {}),
          ...(body.critical_alert_hours !== undefined ? { critical_alert_hours: body.critical_alert_hours } : {}),
          ...(body.whatsapp_token !== undefined ? { whatsapp_token_enc: body.whatsapp_token ? encrypt(body.whatsapp_token) : null } : {}),
          ...(body.whatsapp_base_url !== undefined ? { whatsapp_base_url: body.whatsapp_base_url } : {}),
          ...(body.whatsapp_limit_monthly !== undefined ? { whatsapp_limit_monthly: body.whatsapp_limit_monthly } : {}),
          ...(body.plan_status !== undefined ? { plan_status: body.plan_status } : {}),
          ...(body.trial_ends_at !== undefined ? { trial_ends_at: body.trial_ends_at } : {}),
        })
        .eq('id', tenantId)
      if (error) {
        if (error.code === '23505' || error.message.includes('duplicate key')) {
          res.writeHead(409, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'Assinante já cadastrado! O identificador (slug) desta empresa já consta no nosso sistema.' }))
          return
        }
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: error.message }))
        return
      }

      // LOG DE AUDITORIA
      if (auth) {
        await AuditoriaService.registrarAcaoAdmin(
          { id: auth.userId, nome: auth.nome, email: auth.email, perfil: auth.perfil },
          'ALTERAR_ASSINANTE',
          `Dados do assinante ${tenantId} atualizados. Alterações: ${Object.keys(body).join(', ')}`,
          req.socket.remoteAddress,
          { tipo: 'assinante', id: tenantId! }
        )
      }
    }

    // Atualizar business associada (se campos fornecidos)
    if (body.business_name || body.business_cnpj !== undefined || body.business_category) {
      const updates: Record<string, unknown> = {}
      if (body.business_name)     updates['name']     = body.business_name
      if (body.business_cnpj !== undefined) updates['cnpj'] = body.business_cnpj
      if (body.business_category) updates['category'] = body.business_category

      // O frontend atualizava apenas a PRIMEIRA empresa. 
      // Para manter comportamento, pegamos a primeira e atualizamos.
      const { data: businesses } = await supabaseAdmin
        .from('monitored_businesses')
        .select('id')
        .eq('tenant_id', tenantId)
        .limit(1)

      if (businesses && businesses.length > 0) {
        const { error } = await supabaseAdmin
          .from('monitored_businesses')
          .update(updates)
          .eq('id', businesses[0]!.id)
        if (error) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: error.message }))
          return
        }
      }
    }

    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true }))
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    res.writeHead(500); res.end(JSON.stringify({ error: msg }))
  }
}

async function handleToggleTenantActive(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  setCors(req, res, 'Content-Type, Authorization')
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return }
  try {
    const tenantId = req.url?.split('/api/admin/tenant/')[1]?.split('/active')[0]
    const body = await readBody(req) as { is_active: boolean }

    await Promise.all([
      supabaseAdmin.from('tenants').update({ is_active: body.is_active }).eq('id', tenantId),
      supabaseAdmin.from('monitored_businesses').update({ is_active: body.is_active }).eq('tenant_id', tenantId),
    ])

    const authUser = await getAuthUser(req.headers.authorization)
    if (authUser) {
      await AuditoriaService.registrarAcaoAdmin(
        { id: authUser.userId, nome: authUser.nome, email: authUser.email, perfil: authUser.perfil },
        body.is_active ? 'ATIVAR_ASSINANTE' : 'DESATIVAR_ASSINANTE',
        `Assinante ${tenantId} ${body.is_active ? 'ativado' : 'desativado'}`,
        req.socket.remoteAddress,
        { tipo: 'assinante', id: tenantId! }
      )
    }

    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true }))
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    res.writeHead(500); res.end(JSON.stringify({ error: msg }))
  }
}


async function handleGenerateReport(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  try {
    const auth = await getAuthUser(req.headers.authorization)
    if (!auth) { res.writeHead(401).end(JSON.stringify({ error: 'Não autorizado' })); return }

    const body = await readBody(req)
    const { tenantId, monthYear, startDate, endDate } = body as { tenantId: string; monthYear: string; startDate?: string; endDate?: string }

    if (!tenantId || (!monthYear && (!startDate || !endDate))) {
      res.writeHead(400).end(JSON.stringify({ error: 'tenantId e período (mês ou datas) são obrigatórios' }))
      return
    }

    const url = await processMonthlyReport(tenantId, monthYear, startDate, endDate)
    if (url) {
      res.writeHead(200).end(JSON.stringify({ ok: true, pdfUrl: url }))
    } else {
      res.writeHead(404).end(JSON.stringify({ error: 'Nenhum dado encontrado para gerar o relatório neste período.' }))
    }
  } catch (err: any) {
    console.error('[api-reports] Erro:', err)
    try {
      await supabaseAdmin.from('system_notifications').insert({
        type: 'error',
        message: `ERRO RELATÓRIO: ${err.message || 'Erro desconhecido'} | Stack: ${err.stack?.substring(0, 500)}`,
        status: 'error'
      })
    } catch (e) {}
    res.writeHead(500).end(JSON.stringify({ error: 'Erro interno ao gerar relatório' }))
  }
}

async function handleAnalyzeReview(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  setCors(req, res, 'Content-Type, Authorization')
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return }
  if (req.method !== 'POST')   { res.writeHead(405); res.end('Method not allowed'); return }

  const reviewId = req.url?.split('/api/reviews/')[1]?.split('/analyze')[0]
  if (!reviewId) { res.writeHead(400); res.end(JSON.stringify({ error: 'reviewId obrigatório' })); return }

  const auth = await getAuthUser(req.headers.authorization)
  if (!auth) { res.writeHead(401); res.end(JSON.stringify({ error: 'Não autenticado' })); return }

  try {
    const { data: review, error: getErr } = await supabaseAdmin
      .from('reviews')
      .select('*, monitored_businesses(tenant_id)')
      .eq('id', reviewId)
      .single()

    if (getErr || !review) {
      res.writeHead(404); res.end(JSON.stringify({ error: 'Review não encontrado' })); return
    }

    if (!['admin', 'operador'].includes(auth.perfil)) {
      if (review.monitored_businesses?.tenant_id !== auth.tenantId) {
        res.writeHead(403); res.end(JSON.stringify({ error: 'Sem permissão para analisar este review' })); return
      }
    }

    // Import dinâmico para evitar problemas de ciclo/load
    const { analyzeSentiment } = await import('../lib/sentiment.js')
    
    // Preparar objeto para análise (forçar estado unanalyzed)
    const reviewToAnalyze = { ...review, sentiment: 'unanalyzed' }
    const result = await analyzeSentiment(reviewToAnalyze)

    const { error: updErr } = await supabaseAdmin
      .from('reviews')
      .update({
        sentiment: result.sentiment,
        dissatisfaction_score: result.dissatisfaction_score,
        sentiment_topics: result.topics,
        sentiment_summary: result.summary,
        sentiment_suggestion: result.action_suggestion,
        sentiment_result: result
      })
      .eq('id', reviewId)

    if (updErr) throw updErr

    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true, result }))

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[analyze-review] Erro:', msg)
    res.writeHead(500); res.end(JSON.stringify({ error: msg }))
  }
}

async function handleRespondReview(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  setCors(req, res, 'Content-Type, Authorization')
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return }
  if (req.method !== 'POST')   { res.writeHead(405); res.end('Method not allowed'); return }

  const reviewId = req.url?.split('/api/reviews/')[1]?.split('/respond')[0]
  if (!reviewId) { res.writeHead(400); res.end(JSON.stringify({ error: 'reviewId obrigatório' })); return }

  const auth = await getAuthUser(req.headers.authorization)
  if (!auth) { res.writeHead(401); res.end(JSON.stringify({ error: 'Não autenticado' })); return }

  try {
    const body = await readBody(req) as { message: string }
    if (!body.message?.trim()) {
      res.writeHead(400); res.end(JSON.stringify({ error: 'Mensagem de resposta é obrigatória' })); return
    }

    const result = await sendDirectResponse(reviewId, body.message, auth.userId)
    
    if (result.success) {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true }))
    } else {
      res.writeHead(400, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: result.error }))
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    res.writeHead(500); res.end(JSON.stringify({ error: msg }))
  }
}

// ── Checkout de Assinatura ────────────────────────────────────────

async function handleSubscriptionCheckout(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  setCors(req, res, 'Content-Type, Authorization')
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return }

  const auth = await getAuthUser(req.headers.authorization)
  if (!auth || !auth.tenantId) {
    res.writeHead(401); res.end(JSON.stringify({ error: 'Não autenticado' })); return
  }

  let body: {
    plan?: string
    billingMethod?: 'pix' | 'credit_card'
    periodicity?: 'monthly' | 'trimestral' | 'semestral' | 'anual'
  }
  try {
    let raw = ''
    for await (const chunk of req) raw += chunk
    body = JSON.parse(raw)
  } catch {
    res.writeHead(400); res.end(JSON.stringify({ error: 'JSON inválido' })); return
  }

  const { plan = 'completo', billingMethod = 'pix', periodicity = 'trimestral' } = body

  try {
    // 1. Buscar dados do tenant
    const { data: tenant, error: tErr } = await supabaseAdmin
      .from('tenants')
      .select('id, name, asaas_customer_id, asaas_subscription_id, admin_email')
      .eq('id', auth.tenantId)
      .single()

    if (tErr || !tenant) {
      res.writeHead(404); res.end(JSON.stringify({ error: 'Tenant não encontrado' })); return
    }

    // 2. Buscar preço do plano
    const { data: planData } = await supabaseAdmin
      .from('plans')
      .select('slug, price_monthly')
      .eq('slug', plan)
      .maybeSingle()

    const basePrice = planData?.price_monthly ?? 139

    // Descontos por periodicidade
    const periodDiscounts: Record<string, number> = { monthly: 0, trimestral: 0.05, semestral: 0.10, anual: 0.20 }
    const periodDiscount = periodDiscounts[periodicity] || 0
    const pixDiscountMult = billingMethod === 'pix' ? 0.95 : 1
    const finalPrice = Number((basePrice * (1 - periodDiscount) * pixDiscountMult).toFixed(2))

    // 3. Criar ou reusar customer no Asaas
    let customerId = tenant.asaas_customer_id
    if (!customerId) {
      const { data: userData } = await supabaseAdmin
        .from('tenant_users')
        .select('user_id')
        .eq('tenant_id', auth.tenantId)
        .single()

      const userEmail = tenant.admin_email || auth.email || ''
      const customer = await createAsaasCustomer({
        name: tenant.name,
        email: userEmail,
        cpfCnpj: '', // Será preenchido pelo checkout do Asaas
      })
      customerId = customer.id

      await supabaseAdmin
        .from('tenants')
        .update({ asaas_customer_id: customerId })
        .eq('id', auth.tenantId)
    }

    // 4. Se já tem assinatura ativa, retornar dados dela
    if (tenant.asaas_subscription_id) {
      const existingSub = await getAsaasSubscription(tenant.asaas_subscription_id)
      if (existingSub && existingSub.status === 'ACTIVE') {
        // Buscar cobranças pendentes para gerar PIX/link
        const payments = await getAsaasSubscriptionPayments(tenant.asaas_subscription_id)
        const pendingPayment = payments?.data?.find((p: any) => p.status === 'PENDING')

        let pixData = null
        if (pendingPayment && billingMethod === 'pix') {
          pixData = await getAsaasPixQrCode(pendingPayment.id)
        }

        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({
          ok: true,
          subscriptionId: tenant.asaas_subscription_id,
          status: existingSub.status,
          invoiceUrl: pendingPayment?.invoiceUrl || null,
          pixQrCode: pixData?.encodedImage || null,
          pixCopyPaste: pixData?.payload || null,
        }))
        return
      }
    }

    // 5. Criar nova assinatura
    const nextDueDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]!

    const subscription = await createAsaasSubscription({
      customerId,
      billingType: billingMethod === 'pix' ? 'PIX' : 'CREDIT_CARD',
      value: finalPrice,
      nextDueDate,
      cycle: periodicity === 'anual' ? 'ANNUALLY' :
             periodicity === 'semestral' ? 'SEMIANNUALLY' :
             periodicity === 'trimestral' ? 'QUARTERLY' : 'MONTHLY',
      description: `Plano ${plan.toUpperCase()} - Reputei (${periodicity})`,
      externalReference: auth.tenantId,
    })

    // 6. Salvar no banco
    await supabaseAdmin
      .from('tenants')
      .update({
        asaas_subscription_id: subscription.id,
        plan: plan,
        billing_method: billingMethod,
        subscription_status: 'trial',
      })
      .eq('id', auth.tenantId)

    // 7. Retornar dados do checkout
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({
      ok: true,
      subscriptionId: subscription.id,
      invoiceUrl: subscription.invoiceUrl || null,
      status: 'CREATED',
    }))

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[checkout] Erro:', msg)
    res.writeHead(500); res.end(JSON.stringify({ error: msg }))
  }
}

// ── Status da assinatura ──────────────────────────────────────────

async function handleSubscriptionStatus(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  setCors(req, res, 'Content-Type, Authorization')
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return }

  const auth = await getAuthUser(req.headers.authorization)
  if (!auth || !auth.tenantId) {
    res.writeHead(401); res.end(JSON.stringify({ error: 'Não autenticado' })); return
  }

  try {
    const { data: tenant } = await supabaseAdmin
      .from('tenants')
      .select('plan, plan_status, subscription_status, billing_method, trial_ends_at, asaas_subscription_id')
      .eq('id', auth.tenantId)
      .single()

    if (!tenant) {
      res.writeHead(404); res.end(JSON.stringify({ error: 'Tenant não encontrado' })); return
    }

    // Se tem assinatura no Asaas, buscar status atualizado
    let asaasStatus = null
    if (tenant.asaas_subscription_id) {
      asaasStatus = await getAsaasSubscription(tenant.asaas_subscription_id)
    }

    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({
      plan: tenant.plan,
      planStatus: tenant.plan_status,
      subscriptionStatus: tenant.subscription_status,
      billingMethod: tenant.billing_method,
      trialEndsAt: tenant.trial_ends_at,
      hasSubscription: !!tenant.asaas_subscription_id,
      asaasStatus: asaasStatus?.status || null,
    }))

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    res.writeHead(500); res.end(JSON.stringify({ error: msg }))
  }
}

// ── Servidor ──────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  const url = req.url ?? '/'
  const origin = req.headers.origin || 'N/A'
  console.log(`[api] ${req.method} ${url} (Origin: ${origin})`)

  // Log de depuração no banco para ver o que está chegando em produção
  if (url.startsWith('/api/')) {
    try {
      await supabaseAdmin.from('system_notifications').insert({
        type: 'debug',
        message: `API Request: ${req.method} ${url} | Origin: ${origin}`,
        status: 'info'
      })
    } catch (e) {
      console.error('Erro ao logar no banco:', e)
    }
  }

  setCors(req, res)
  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    res.end()
    return
  }

  if (url === '/' || url === '/health') {
    res.writeHead(200); res.end(JSON.stringify({ ok: true, ts: new Date().toISOString(), version: '2026-04-30-v1' })); return
  }

  if (url.startsWith('/api/copilot')) {
    handleCopilot(req, res).catch(err => {
      console.error('[copilot] Erro não tratado:', err)
      if (!res.headersSent) { res.writeHead(500); res.end(JSON.stringify({ error: 'Erro interno' })) }
    })
    return
  }

  if (url.startsWith('/api/reviews/') && url.endsWith('/respond')) {
    handleRespondReview(req, res).catch(err => {
      console.error('[respond-review] Erro não tratado:', err)
      if (!res.headersSent) { res.writeHead(500); res.end(JSON.stringify({ error: 'Erro interno' })) }
    })
    return
  }

  if (url.startsWith('/api/reviews/') && url.endsWith('/analyze')) {
    handleAnalyzeReview(req, res).catch(err => {
      console.error('[analyze-review] Erro não tratado:', err)
      if (!res.headersSent) { res.writeHead(500); res.end(JSON.stringify({ error: 'Erro interno' })) }
    })
    return
  }

  if (url === '/api/whatsapp/send' && req.method === 'POST') {
    handleSendWhatsApp(req, res).catch(err => {
      console.error('[whatsapp-send] Erro não tratado:', err)
      if (!res.headersSent) { res.writeHead(500); res.end(JSON.stringify({ error: 'Erro interno' })) }
    })
    return
  }

  if (url.startsWith('/api/widget/')) {
    handleWidgetRequest(req, res).catch(err => {
      console.error('[widget] Erro não tratado:', err)
      if (!res.headersSent) { res.writeHead(500); res.end(JSON.stringify({ error: 'Erro interno' })) }
    })
    return
  }

  if (url === '/api/plans') {
    handleGetPlans(req, res).catch(err => {
      console.error('[plans] Erro:', err)
      if (!res.headersSent) { res.writeHead(500); res.end(JSON.stringify({ error: 'Erro interno' })) }
    })
    return
  }

  // Webhook do Asaas (público — autenticação via token no header)
  if (url === '/api/webhooks/asaas') {
    handleAsaasWebhook(req, res).catch(err => {
      console.error('[asaas-webhook] Erro não tratado:', err)
      if (!res.headersSent) { res.writeHead(200); res.end(JSON.stringify({ ok: true })) }
    })
    return
  }

  // Checkout / status de assinatura para o portal do assinante
  if (url === '/api/subscription/checkout' && req.method === 'POST') {
    handleSubscriptionCheckout(req, res).catch(err => {
      console.error('[checkout] Erro:', err)
      if (!res.headersSent) { res.writeHead(500); res.end(JSON.stringify({ error: 'Erro interno' })) }
    })
    return
  }

  // Rotas de Parceiros
  if (url.startsWith('/api/partner/')) {
    handlePartnerRoutes(req, res).catch(err => {
      console.error('[partner] Erro:', err)
      if (!res.headersSent) { res.writeHead(500); res.end(JSON.stringify({ error: 'Erro interno' })) }
    })
    return
  }

  // Rotas de Admin para Parceiros
  if (url.startsWith('/api/admin/partners') || url.startsWith('/api/admin/commissions')) {
    handlePartnerAdminRoutes(req, res).catch(err => {
      console.error('[partner-admin] Erro:', err)
      if (!res.headersSent) { res.writeHead(500); res.end(JSON.stringify({ error: 'Erro interno' })) }
    })
    return
  }

  if (url === '/api/subscription/status' && req.method === 'GET') {
    handleSubscriptionStatus(req, res).catch(err => {
      console.error('[subscription-status] Erro:', err)
      if (!res.headersSent) { res.writeHead(500); res.end(JSON.stringify({ error: 'Erro interno' })) }
    })
    return
  }

  if (url.startsWith('/api/admin/plans')) {
    handleAdminPlans(req, res).catch(err => {
      console.error('[admin-plans] Erro:', err)
      if (!res.headersSent) { res.writeHead(500); res.end(JSON.stringify({ error: 'Erro interno' })) }
    })
    return
  }

  if (url.startsWith('/api/onboarding')) {
    handleOnboarding(req, res).catch(err => {
      console.error('[onboarding] Erro não tratado:', err)
      if (!res.headersSent) { res.writeHead(500); res.end(JSON.stringify({ error: 'Erro interno' })) }
    })
    return
  }

  if (url === '/api/reports/generate' && req.method === 'POST') {
    handleGenerateReport(req, res).catch(err => {
      console.error('[reports-gen] Erro:', err)
      if (!res.headersSent) { res.writeHead(500); res.end(JSON.stringify({ error: 'Erro interno' })) }
    })
    return
  }

  if (url.startsWith('/api/admin/credentials')) {
    handleUpdateCredentials(req, res).catch(err => {
      console.error('[credentials] Erro não tratado:', err)
      if (!res.headersSent) { res.writeHead(500); res.end(JSON.stringify({ error: 'Erro interno' })) }
    })
    return
  }

  if (url.startsWith('/api/admin/tenant/')) {
    const method = req.method
    if (method === 'PATCH' && url.match(/^\/api\/admin\/tenant\/[^/]+\/active$/)) {
      handleToggleTenantActive(req, res).catch(err => {
        console.error('[tenant-active] Erro não tratado:', err)
        if (!res.headersSent) { res.writeHead(500); res.end(JSON.stringify({ error: 'Erro interno' })) }
      })
      return
    }
    if (method === 'PATCH' && url.match(/^\/api\/admin\/tenant\/[^/]+$/)) {
      // RBAC: Operador pode editar dados básicos, mas apenas admin altera plano (lógica simplificada aqui ou no handler)
      handleUpdateTenant(req, res).catch(err => {
        console.error('[update-tenant] Erro não tratado:', err)
        if (!res.headersSent) { res.writeHead(500); res.end(JSON.stringify({ error: 'Erro interno' })) }
      })
      return
    }
    if (method === 'DELETE') {
      handleDeleteTenant(req, res).catch(err => {
        console.error('[delete-tenant] Erro não tratado:', err)
        if (!res.headersSent) { res.writeHead(500); res.end(JSON.stringify({ error: 'Erro interno' })) }
      })
      return
    }
    if (method === 'OPTIONS') {
      setCors(req, res, 'Content-Type, Authorization')
      res.writeHead(204)
      res.end()
      return
    }
  }

  if (url.startsWith('/api/admin/connector')) {
    const method = req.method
    if (method === 'POST' && url === '/api/admin/connector') {
      handleCreateConnector(req, res).catch(err => {
        console.error('[create-connector] Erro não tratado:', err)
        if (!res.headersSent) { res.writeHead(500); res.end(JSON.stringify({ error: 'Erro interno' })) }
      })
      return
    }
    if (method === 'PATCH' && url.match(/^\/api\/admin\/connector\/[^/]+\/config$/)) {
      handleUpdateConnectorConfig(req, res).catch(err => {
        console.error('[update-connector] Erro não tratado:', err)
        if (!res.headersSent) { res.writeHead(500); res.end(JSON.stringify({ error: 'Erro interno' })) }
      })
      return
    }
    if (method === 'PATCH' && url.match(/^\/api\/admin\/connector\/[^/]+\/force-sync$/)) {
      handleForceSync(req, res).catch(err => {
        console.error('[force-sync] Erro não tratado:', err)
        if (!res.headersSent) { res.writeHead(500); res.end(JSON.stringify({ error: 'Erro interno' })) }
      })
      return
    }
    if (method === 'DELETE' && url.startsWith('/api/admin/connector/')) {
      handleDeleteConnector(req, res).catch(err => {
        console.error('[delete-connector] Erro não tratado:', err)
        if (!res.headersSent) { res.writeHead(500); res.end(JSON.stringify({ error: 'Erro interno' })) }
      })
      return
    }
    // Para OPTIONS no CORS
    if (method === 'OPTIONS') {
      setCors(req, res)
      res.writeHead(204)
      res.end()
      return
    }
  }

  if (url.startsWith('/api/auth/meta/connect')) {
    handleMetaAuthConnect(req, res).catch(err => {
      console.error('[meta-connect] Erro:', err)
      if (!res.headersSent) { res.writeHead(500); res.end(JSON.stringify({ error: 'Erro interno' })) }
    })
    return
  }

  if (url.startsWith('/api/auth/meta/callback')) {
    handleMetaAuthCallback(req, res).catch(err => {
      console.error('[meta-callback] Erro:', err)
      if (!res.headersSent) { res.writeHead(500); res.end(JSON.stringify({ error: 'Erro interno' })) }
    })
    return
  }

  if (url === '/api/auth/login' && req.method === 'POST') {
    handleLogin(req, res).catch(err => {
      console.error('[auth-login] Erro:', err)
      if (!res.headersSent) { res.writeHead(500); res.end(JSON.stringify({ error: 'Erro interno' })) }
    })
    return
  }

  if (url === '/api/whatsapp/send') {
    if (req.method === 'OPTIONS') {
      setCors(req, res)
      res.writeHead(204)
      res.end()
      return
    }
    if (req.method === 'POST') {
      handleSendWhatsApp(req, res).catch(err => {
        console.error('[whatsapp-send] Erro:', err)
        if (!res.headersSent) { res.writeHead(500); res.end(JSON.stringify({ error: 'Erro interno no servidor de WhatsApp' })) }
      })
      return
    }
  }

  if (url === '/api/admin/relatorios/auditoria' && req.method === 'GET') {
    handleGetAuditLogs(req, res).catch(err => {
      console.error('[audit-logs] Erro:', err)
      if (!res.headersSent) { res.writeHead(500); res.end(JSON.stringify({ error: 'Erro interno' })) }
    })
    return
  }

  async function handleLogin(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    setCors(req, res)
  const body = await readBody(req) as { email?: string; password?: string }
  const { email, password } = body
  
  if (!email || !password) {
    res.writeHead(400); res.end(JSON.stringify({ error: 'Email e senha obrigatórios' })); return
  }

  const { data, error } = await supabaseAdmin.auth.signInWithPassword({ email, password })
  
  if (error || !data.user) {
    await AuditoriaService.registrar({
      usuario_nome: 'Desconhecido',
      usuario_email: email,
      usuario_perfil: 'desconhecido',
      operacao: 'LOGIN_FALHA',
      descricao: `Tentativa de login falhou para o email ${email}`,
      ip_origem: req.socket.remoteAddress
    })
    res.writeHead(401); res.end(JSON.stringify({ error: 'Credenciais inválidas' })); return
  }

  const { data: userData } = await supabaseAdmin.from('usuarios').select('*').eq('id', data.user.id).single()
  
  if (userData) {
    await AuditoriaService.registrarAcaoAdmin(
      userData,
      'LOGIN',
      `Usuário realizou login com sucesso`,
      req.socket.remoteAddress
    )
  }

    res.end(JSON.stringify({ 
      user: userData,
      session: data.session
    }))
  }

  async function handleSendWhatsApp(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    setCors(req, res)
    const auth = await getAuthUser(req.headers.authorization)
    if (!auth) {
      res.writeHead(401); res.end(JSON.stringify({ error: 'Não autorizado' })); return
    }

    // [APPSEC] C5 e C7 — Rate Limiting e Checagem de Assinatura
    if (!(await checkTenantStatus(auth.tenantId))) {
      res.writeHead(402); res.end(JSON.stringify({ error: 'Assinatura suspensa.' })); return;
    }
    if (!checkRateLimit(`whatsapp:${auth.tenantId}`, 20, 60000)) {
      res.writeHead(429); res.end(JSON.stringify({ error: 'Limite de envios excedido por minuto.' })); return;
    }

    const body = await readBody(req) as { number?: string; text?: string; tenantId?: string }
    const { number, text, tenantId } = body

    if (!number || !text || !tenantId) {
      res.writeHead(400); res.end(JSON.stringify({ error: 'Dados insuficientes (number, text, tenantId)' })); return
    }

    // Buscar dados do tenant (token e base url)
    const { data: tenant, error: tError } = await supabaseAdmin
      .from('tenants')
      .select('whatsapp_token_enc, whatsapp_base_url, whatsapp_limit_monthly, whatsapp_sent_this_month')
      .eq('id', tenantId)
      .single()

    if (tError || !tenant) {
      res.writeHead(404); res.end(JSON.stringify({ error: 'Assinante não encontrado' })); return
    }

    if (!tenant.whatsapp_token_enc) {
      res.writeHead(400); res.end(JSON.stringify({ error: 'WhatsApp não configurado para este assinante' })); return
    }

    // Verificar limite
    if (tenant.whatsapp_sent_this_month >= tenant.whatsapp_limit_monthly) {
      res.writeHead(403); res.end(JSON.stringify({ error: 'Limite mensal de disparos atingido' })); return
    }

    try {
      const token = decrypt(tenant.whatsapp_token_enc)
      const baseUrl = tenant.whatsapp_base_url || 'https://api.uazapi.com'

      const result = await sendWhatsAppMessage({
        baseUrl,
        token,
        number,
        text
      })

      if (!result.success) {
        throw new Error(result.error || 'Erro desconhecido na UAZAPI')
      }

      // Incrementar contador
      await supabaseAdmin.rpc('increment_whatsapp_sent', { t_id: tenantId })

      res.writeHead(200); res.end(JSON.stringify({ success: true }))
    } catch (err: any) {
      console.error('[whatsapp-send] Falha UAZAPI:', err.message)
      res.writeHead(500); res.end(JSON.stringify({ error: `Falha no envio: ${err.message}` }))
    }
  }

  async function handleGetAuditLogs(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    setCors(req, res, 'Content-Type, Authorization')
    const auth = await getAuthUser(req.headers.authorization)
    if (!auth || !['admin', 'operador'].includes(auth.perfil)) {
      res.writeHead(403); res.end(JSON.stringify({ error: 'Não autorizado' })); return
    }

    const qs = new URL(req.url!, `http://localhost`).searchParams
    const from      = qs.get('from')
    const to        = qs.get('to')
    const usuario   = qs.get('usuario')
    const operacao  = qs.get('operacao')
    const status    = qs.get('status')
    const limit     = Math.min(parseInt(qs.get('limit') ?? '200'), 500)

    let query = supabaseAdmin
      .from('auditoria')
      .select('*')
      .order('data_hora', { ascending: false })
      .limit(limit)

    if (from)     query = query.gte('data_hora', from)
    if (to)       query = query.lte('data_hora', to + 'T23:59:59Z')
    if (usuario)  query = query.ilike('usuario_email', `%${usuario}%`)
    if (operacao) query = query.eq('operacao', operacao)
    if (status)   query = query.eq('status', status)

    const { data, error } = await query

    if (error) {
      res.writeHead(500); res.end(JSON.stringify({ error: error.message })); return
    }

    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(data))
  }

  if (url.startsWith('/api/admin/support')) {
    const auth = await getAuthUser(req.headers.authorization)
    if (!auth || !['admin', 'operador'].includes(auth.perfil)) {
      res.writeHead(403); res.end(JSON.stringify({ error: 'Não autorizado' })); return
    }
    handleSupportAdmin(req, res, auth).catch(err => {
      console.error('[support-admin-api] Erro:', err)
      if (!res.headersSent) { res.writeHead(500); res.end(JSON.stringify({ error: 'Erro interno' })) }
    })
    return
  }

  if (url.startsWith('/api/admin/prospects')) {
    const auth = await getAuthUser(req.headers.authorization)
    if (!auth || !['admin', 'operador'].includes(auth.perfil)) {
      res.writeHead(403); res.end(JSON.stringify({ error: 'Não autorizado' })); return
    }
    handleProspectAdmin(req, res, auth).catch(err => {
      console.error('[prospect-admin-api] Erro:', err)
      if (!res.headersSent) { res.writeHead(500); res.end(JSON.stringify({ error: 'Erro interno' })) }
    })
    return
  }

  if (url.startsWith('/api/admin/commercial')) {
    const auth = await getAuthUser(req.headers.authorization)
    if (!auth || !['admin', 'operador'].includes(auth.perfil)) {
      res.writeHead(403); res.end(JSON.stringify({ error: 'Não autorizado' })); return
    }
    handleCommercialAdmin(req, res, auth).catch(err => {
      console.error('[commercial-admin-api] Erro:', err)
      if (!res.headersSent) { res.writeHead(500); res.end(JSON.stringify({ error: 'Erro interno' })) }
    })
    return
  }

  if (url.startsWith('/api/auth/meta') || url.startsWith('/api/webhooks/meta')) {
    handleMetaWebhook(req, res).catch(err => {
      console.error('[meta-webhook] Erro:', err)
      if (!res.headersSent) { res.writeHead(500); res.end(JSON.stringify({ error: 'Erro interno' })) }
    })
    return
  }

  if (url.startsWith('/static/')) {
    const fileName = url.split('/static/')[1] ?? ''
    const __dirname = path.dirname(fileURLToPath(import.meta.url))
    const filePath = path.join(__dirname, 'static', fileName)
    ;(async () => {
      try {
        const content = await fs.readFile(filePath)
        const ext = path.extname(fileName)
        const contentType = ext === '.js' ? 'application/javascript' : 'text/plain'
        res.writeHead(200, { 'Content-Type': contentType, 'Access-Control-Allow-Origin': '*' })
        res.end(content)
      } catch {
        res.writeHead(404); res.end('Not found')
      }
    })()
    return
  }

  if (url.startsWith('/api/support')) {
    const auth = await getAuthUser(req.headers.authorization)
    if (!auth) {
      res.writeHead(401); res.end(JSON.stringify({ error: 'Não autorizado' })); return
    }
    handleSupportPortal(req, res, auth).catch(err => {
      console.error('[support-api] Erro:', err)
      if (!res.headersSent) { res.writeHead(500); res.end(JSON.stringify({ error: 'Erro interno' })) }
    })
    return
  }

  res.writeHead(404); res.end('Not found')
})

// ── Escalada de alertas críticos → n8n ───────────────────────────

async function sendEscalationWebhook(payload: Record<string, unknown>): Promise<void> {
  const webhookUrl = process.env['N8N_SYSTEM_ALERTS_WEBHOOK'] || process.env['N8N_WEBHOOK_URL']
  if (!webhookUrl) {
    console.warn('[escalation] N8N_SYSTEM_ALERTS_WEBHOOK não configurada — pulando envio')
    return
  }
  const resp = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!resp.ok) throw new Error(`n8n respondeu ${resp.status}: ${await resp.text()}`)
}

async function checkConnectorsHealth(): Promise<void> {
  try {
    const FOUR_HOURS_MS = 4 * 3600_000
    const cutoff = new Date(Date.now() - FOUR_HOURS_MS).toISOString()

    // Busca conectores em erro há mais de 4 horas
    const { data: connectors, error } = await supabaseAdmin
      .from('channel_connectors')
      .select('id, channel, business_id, error_message, first_error_at')
      .eq('status', 'error')
      .lte('first_error_at', cutoff)

    if (!connectors?.length) return

    console.log(`[health-check] ${connectors.length} conectores com falha persistente encontrados`)

    // Buscar contatos globais do admin do sistema
    const { data: sysSettings } = await supabaseAdmin
      .from('system_settings')
      .select('admin_whatsapp, admin_email')
      .eq('id', 'global')
      .single()

    for (const conn of connectors) {
      // Evitar notificar repetidamente o mesmo erro se já existe uma notificação pendente
      const { data: existing } = await supabaseAdmin
        .from('system_notifications')
        .select('id')
        .eq('connector_id', conn.id)
        .eq('status', 'pendente')
        .single()

      if (existing) continue

      // Notificar usando o serviço de notificações do sistema
      const { data: biz } = await supabaseAdmin
        .from('monitored_businesses')
        .select('name, tenant_id')
        .eq('id', conn.business_id)
        .single()

      const payload = {
        event: 'system_health_alert',
        status: 'FALHA',
        channel: conn.channel,
        business_name: biz?.name || 'Desconhecido',
        message: conn.error_message || 'Erro desconhecido na sincronização',
        timestamp: new Date().toISOString(),
        admin_url: `https://reputei-admin.vercel.app/connectors`,
        // Contatos para o n8n saber para onde enviar
        admin_whatsapp: sysSettings?.admin_whatsapp || '',
        admin_email: sysSettings?.admin_email || '',
        formatted_message: `⚠️ *ALERTA DE SAÚDE DO SISTEMA*\n\n🚨 *Falha Persistente:* O canal *${conn.channel.toUpperCase()}* da empresa *${biz?.name || 'N/A'}* está fora do ar há mais de 4 horas.\n\n*Erro:* ${conn.error_message || 'Sem detalhes'}\n\nFavor verificar as credenciais ou logs de sincronização no painel admin.`
      }

      await sendEscalationWebhook(payload)
      
      // Registrar no banco para controle do dashboard admin
      await supabaseAdmin.from('system_notifications').insert({
        tenant_id: biz?.tenant_id,
        business_id: conn.business_id,
        connector_id: conn.id,
        channel: conn.channel,
        type: 'sync_error',
        message: conn.error_message,
        status: 'pendente'
      })
    }
  } catch (err) {
    console.error('[health-check] Erro:', err instanceof Error ? err.message : err)
  }
}

async function processProspectFollowups(): Promise<void> {
  try {
    const { data: pendingFollowups, error } = await supabaseAdmin
      .from('prospect_followup_queue')
      .select('*, prospect_leads(*)')
      .eq('status', 'pending')
      .lte('scheduled_at', new Date().toISOString())

    if (error || !pendingFollowups?.length) return

    console.log(`[prospect-worker] Processando ${pendingFollowups.length} follow-ups agendados`)

    for (const item of pendingFollowups) {
      const lead = item.prospect_leads
      if (!lead || ['responded', 'converted', 'failed'].includes(lead.status)) {
        await supabaseAdmin
          .from('prospect_followup_queue')
          .update({ status: 'canceled' })
          .eq('id', item.id)
        continue
      }

      const { data: template } = await supabaseAdmin
        .from('prospect_templates')
        .select('*')
        .eq('campaign_id', lead.campaign_id)
        .eq('segment_id', lead.segment_id)
        .eq('channel', item.channel === 'whatsapp' ? (item.step === 3 ? 'whatsapp_retomada' : 'whatsapp') : 'email')
        .single()

      if (!template) {
        await supabaseAdmin
          .from('prospect_followup_queue')
          .update({ status: 'failed', error_message: 'Template não localizado' })
          .eq('id', item.id)
        continue
      }

      let bodyText = template.body
      const vars = lead.variables || {}
      const varMap: Record<string, string> = {
        '[EMPRESA]': lead.company_name,
        '[NOME]': lead.contact_name || 'Gestor',
        '[SEU_NOME]': 'Consultor Reputei',
        '[SEU_CONTATO]': 'contato@reputei.com.br',
        '[NOTA_GOOGLE]': vars.nota_google ? String(vars.nota_google) : 'N/A',
        '[QTD_RECLAMACOES]': vars.qtd_reclamacoes ? String(vars.qtd_reclamacoes) : '0'
      }

      for (const [token, value] of Object.entries(varMap)) {
        bodyText = bodyText.replaceAll(token, value)
      }

      let success = false
      let responseBody = ''

      if (item.channel === 'whatsapp') {
        const uazapiToken = process.env['UAZAPI_TOKEN']
        const baseUrl = process.env['UAZAPI_BASE_URL'] ?? 'https://netservice.uazapi.com'

        if (!lead.phone || !uazapiToken) {
          responseBody = 'Simulação: Envio manual (UAZAPI não configurada)'
          success = true
        } else {
          const res = await sendWhatsAppMessage({
            baseUrl,
            token: uazapiToken,
            number: lead.phone,
            text: bodyText
          })
          success = res.success
          responseBody = res.success ? 'WhatsApp follow-up enviado' : (res.error || 'Erro UAZAPI')
        }
      } else {
        success = true
        responseBody = `Simulação: E-mail follow-up enviado para ${lead.email}`
      }

      await supabaseAdmin.from('prospect_dispatch_logs').insert({
        lead_id: lead.id,
        channel: item.channel,
        step: item.step,
        status: success ? 'success' : 'failed',
        response_body: responseBody
      })

      await supabaseAdmin
        .from('prospect_followup_queue')
        .update({
          status: success ? 'sent' : 'failed',
          sent_at: success ? new Date().toISOString() : null,
          error_message: success ? null : responseBody
        })
        .eq('id', item.id)

      if (success && item.step === 2) {
        const scheduledAt = new Date(Date.now() + 120 * 3600 * 1000).toISOString()
        await supabaseAdmin.from('prospect_followup_queue').insert({
          lead_id: lead.id,
          channel: 'whatsapp',
          step: 3,
          scheduled_at: scheduledAt,
          status: 'pending'
        })
      }
    }
  } catch (err: any) {
    console.error('[prospect-worker] Erro no worker:', err.message)
  }
}

// Rodar a cada 15 minutos
const ESCALATION_INTERVAL_MS = 15 * 60 * 1000
const PROSPECT_INTERVAL_MS = 5 * 60 * 1000

if (process.env.NODE_ENV !== 'test') {
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`[api] Servidor Copilot rodando em http://localhost:${PORT}`)
    console.log(`[api] Gemini API Key: ${process.env['GEMINI_API_KEY'] ? 'configurada ✓' : 'AUSENTE ✗'}`)
    console.log(`[api] Supabase URL:   ${process.env['SUPABASE_URL'] ? 'configurada ✓' : 'AUSENTE ✗'}`)
    console.log(`[api] n8n Webhook:    ${process.env['N8N_WEBHOOK_URL'] ? 'configurada ✓' : 'não configurada'}`)

    // Iniciar o scheduler de coleta de reviews no mesmo processo
    startScheduler().catch(err => {
      console.error('[scheduler] Falha ao iniciar:', err)
    })

    // Primeira verificação após 1 min de warm-up, depois a cada 15 min
    setTimeout(() => {
      checkConnectorsHealth()
      setInterval(checkConnectorsHealth, ESCALATION_INTERVAL_MS)
    }, 60_000)

    // Worker de prospecção rodando a cada 5 minutos
    setTimeout(() => {
      processProspectFollowups()
      setInterval(processProspectFollowups, PROSPECT_INTERVAL_MS)
    }, 10_000)
  })
}

export {}
