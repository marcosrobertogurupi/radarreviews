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

function setCors(req: http.IncomingMessage, res: http.ServerResponse, extraHeaders = 'Content-Type') {
  const originHeader = req.headers.origin
  const origin = Array.isArray(originHeader) ? originHeader[0] : (originHeader || '')
  // Whitelist de produção
  const allowed = [
    'https://reputei-portal.vercel.app',
    'https://admin-reputei.vercel.app',
    'https://reputei.vercel.app',
    'http://localhost:5173',
    'http://localhost:5174',
    'http://localhost:3000',
  ]
  const isAllowed = allowed.includes(origin) || 
                   origin.endsWith('.vercel.app') || 
                   origin.startsWith('http://localhost:')
  
  res.setHeader('Access-Control-Allow-Origin', isAllowed ? origin : allowed[0])
  res.setHeader('Access-Control-Allow-Headers', extraHeaders)
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS')
  res.setHeader('Vary', 'Origin')
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
    channels?: string[]
  }
  try { body = JSON.parse(raw) } catch {
    res.writeHead(400); res.end(JSON.stringify({ error: 'JSON inválido' })); return
  }

  const { email, password, businessName, channels = [] } = body
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

    const { data: tenant, error: tenantErr } = await supabaseAdmin
      .from('tenants')
      .insert({ name: businessName.trim(), slug, plan: 'trial' })
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

    // 5. Criar conectores para os canais selecionados
    if (channels.length > 0) {
      await supabaseAdmin.from('channel_connectors').insert(
        channels.map(ch => ({ business_id: biz.id, channel: ch, status: 'pending_auth' }))
      )
    }

    console.log(`[onboarding] Tenant criado: ${slug} (${tenant.id}) — usuário: ${email}`)
    res.writeHead(201, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true, tenantId: tenant.id, businessId: biz.id }))

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[onboarding] Erro:', msg)
    res.writeHead(500); res.end(JSON.stringify({ error: msg }))
  }
}

// ── Autenticação JWT ──────────────────────────────────────────────

async function getAuthUser(authHeader: string | undefined): Promise<{ userId: string; tenantId: string } | null> {
  if (!authHeader?.startsWith('Bearer ')) return null
  const token = authHeader.slice(7)
  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token)
  if (error || !user) return null

  const { data: tu } = await supabaseAdmin
    .from('tenant_users')
    .select('tenant_id')
    .eq('user_id', user.id)
    .single()

  if (!tu) return null
  return { userId: user.id, tenantId: (tu as { tenant_id: string }).tenant_id }
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

  try {
    const ctx    = await getTenantContext(auth.tenantId)
    const genAI  = getGemini()
    const model  = genAI.getGenerativeModel({
      model: 'models/gemini-2.0-flash-exp',
      generationConfig: { temperature: 0.7, maxOutputTokens: 1024 },
      systemInstruction: buildSystemPrompt(ctx),
    })

    // Montar histórico para multi-turn
    const chatHistory = history.map(h => ({
      role: h.role === 'user' ? 'user' : 'model',
      parts: [{ text: h.text }],
    }))

    const chat  = model.startChat({ history: chatHistory })
    const result = await chat.sendMessage(message)
    const reply  = result.response.text().trim()

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
  setCors(req, res)
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

// ── Servidor ──────────────────────────────────────────────────────

const server = http.createServer((req, res) => {
  const url = req.url ?? '/'

  if (url === '/health') {
    res.writeHead(200); res.end(JSON.stringify({ ok: true, ts: new Date().toISOString() })); return
  }

  if (url.startsWith('/api/copilot')) {
    handleCopilot(req, res).catch(err => {
      console.error('[copilot] Erro não tratado:', err)
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

  if (url.startsWith('/api/admin/credentials')) {
    handleUpdateCredentials(req, res).catch(err => {
      console.error('[credentials] Erro não tratado:', err)
      if (!res.headersSent) { res.writeHead(500); res.end(JSON.stringify({ error: 'Erro interno' })) }
    })
    return
  }

  res.writeHead(404); res.end('Not found')
})

// ── Escalada de alertas críticos → n8n ───────────────────────────

async function sendEscalationWebhook(payload: Record<string, unknown>): Promise<void> {
  const webhookUrl = process.env['N8N_WEBHOOK_URL']
  if (!webhookUrl) {
    console.warn('[escalation] N8N_WEBHOOK_URL não configurada — pulando envio')
    return
  }
  const resp = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!resp.ok) throw new Error(`n8n respondeu ${resp.status}: ${await resp.text()}`)
}

async function checkEscalations(): Promise<void> {
  try {
    // Busca tenants com configuração de escalada
    const { data: tenants } = await supabaseAdmin
      .from('tenants')
      .select('id, name, admin_whatsapp, admin_email, critical_alert_hours')
      .not('critical_alert_hours', 'is', null)
      .eq('is_active', true)

    if (!tenants?.length) return

    for (const tenant of tenants) {
      const hours = (tenant as { critical_alert_hours: number }).critical_alert_hours
      const cutoff = new Date(Date.now() - hours * 3600_000).toISOString()

      // Busca regras do tenant
      const { data: ruleRows } = await supabaseAdmin
        .from('alert_rules')
        .select('id')
        .eq('tenant_id', tenant.id)

      const ruleIds = (ruleRows ?? []).map((r: Record<string, unknown>) => r['id'] as string)
      if (!ruleIds.length) continue

      // Busca eventos críticos não escalados mais antigos que o threshold
      const { data: events } = await supabaseAdmin
        .from('alert_events')
        .select('id, rule_id, triggered_at, detail')
        .in('rule_id', ruleIds)
        .is('escalated_at', null)
        .lte('triggered_at', cutoff)
        .order('triggered_at', { ascending: true })
        .limit(10)

      if (!events?.length) continue

      console.log(`[escalation] Tenant ${tenant.name}: ${events.length} evento(s) para escalar`)

      for (const event of events) {
        const detail = (event.detail ?? {}) as Record<string, unknown>
        try {
          await sendEscalationWebhook({
            tenant_id:             tenant.id,
            tenant_name:           tenant.name,
            admin_whatsapp:        (tenant as { admin_whatsapp?: string }).admin_whatsapp ?? null,
            admin_email:           (tenant as { admin_email?: string }).admin_email ?? null,
            event_id:              event.id,
            triggered_at:          event.triggered_at,
            review_author:         detail['review_author'] ?? null,
            review_body_preview:   detail['review_body_preview'] ?? null,
            review_published_at:   detail['review_published_at'] ?? null,
            review_channel:        detail['review_channel'] ?? null,
            review_rating:         detail['review_rating'] ?? null,
            review_url:            detail['review_url'] ?? null,
            alert_reason:          detail['alert_reason'] ?? null,
            sentiment_summary:     detail['sentiment_summary'] ?? null,
            condition_type:        detail['condition_type'] ?? null,
            hours_without_action:  hours,
          })

          // Marcar como escalado
          await supabaseAdmin
            .from('alert_events')
            .update({ escalated_at: new Date().toISOString() })
            .eq('id', event.id)

          console.log(`[escalation] Evento ${event.id} escalado com sucesso`)
        } catch (err) {
          console.error(`[escalation] Falha ao escalar evento ${event.id}:`, err instanceof Error ? err.message : err)
        }
      }
    }
  } catch (err) {
    console.error('[escalation] Erro geral:', err instanceof Error ? err.message : err)
  }
}

// Rodar a cada 15 minutos
const ESCALATION_INTERVAL_MS = 15 * 60 * 1000

server.listen(PORT, () => {
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
    checkEscalations()
    setInterval(checkEscalations, ESCALATION_INTERVAL_MS)
  }, 60_000)
})

export {}
