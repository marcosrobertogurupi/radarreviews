// API do Funil de Geração de Reviews (F12-E3-T3)
//
// Rotas (portal do assinante — requer JWT):
//   GET  /api/review-funnel/campaigns              → listar campanhas do tenant
//   POST /api/review-funnel/campaigns              → criar campanha
//   PATCH /api/review-funnel/campaigns/:id         → atualizar campanha
//   POST /api/review-funnel/campaigns/:id/qr-codes → gerar QR code / link curto
//   GET  /api/review-funnel/campaigns/:id/stats    → métricas de conversão
//
// Rotas públicas (landing de triagem — sem JWT):
//   GET  /api/funnel/:shortCode                    → dados da campanha para a landing
//   POST /api/funnel/:shortCode/submit             → registrar resposta de satisfação

import http from 'node:http'
import crypto from 'node:crypto'
import { supabaseAdmin } from '../lib/supabase.js'
import { setCors, getAuthUser } from './server.js'

async function readBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  let raw = ''
  for await (const chunk of req) raw += chunk
  if (!raw) return {}
  try { return JSON.parse(raw) as Record<string, unknown> } catch { throw new Error('JSON inválido') }
}

function generateShortCode(length = 6): string {
  return crypto.randomBytes(length).toString('base64url').slice(0, length)
}

// ── Rotas autenticadas (portal do assinante) ──────────────────────────────────

export async function handleReviewFunnelPortal(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  auth: { tenantId: string }
): Promise<void> {
  setCors(req, res, 'Content-Type, Authorization')
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return }

  const url = req.url ?? ''
  const campaignMatch = url.match(/^\/api\/review-funnel\/campaigns\/([^/]+)/)
  const campaignId = campaignMatch?.[1]

  // GET /api/review-funnel/campaigns
  if (req.method === 'GET' && !campaignId) {
    const { data, error } = await supabaseAdmin
      .from('review_campaigns')
      .select('*, review_qr_codes(id, short_code, label, scans)')
      .eq('tenant_id', auth.tenantId)
      .order('created_at', { ascending: false })

    if (error) { res.writeHead(500); res.end(JSON.stringify({ error: error.message })); return }
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(data ?? []))
    return
  }

  // POST /api/review-funnel/campaigns
  if (req.method === 'POST' && !campaignId && !url.includes('/qr-codes')) {
    const body = await readBody(req) as {
      business_id?: string; name?: string; review_url?: string
      landing_title?: string; landing_logo_url?: string
      satisfaction_threshold?: number; create_ticket_on_negative?: boolean
    }

    if (!body.business_id || !body.name || !body.review_url) {
      res.writeHead(400); res.end(JSON.stringify({ error: 'business_id, name e review_url são obrigatórios' })); return
    }

    const { data, error } = await supabaseAdmin
      .from('review_campaigns')
      .insert({
        tenant_id: auth.tenantId,
        business_id: body.business_id,
        name: body.name,
        review_url: body.review_url,
        landing_title: body.landing_title ?? 'Como foi sua experiência?',
        landing_logo_url: body.landing_logo_url ?? null,
        satisfaction_threshold: body.satisfaction_threshold ?? 4,
        create_ticket_on_negative: body.create_ticket_on_negative ?? true,
      })
      .select()
      .single()

    if (error) { res.writeHead(400); res.end(JSON.stringify({ error: error.message })); return }
    res.writeHead(201, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(data))
    return
  }

  // PATCH /api/review-funnel/campaigns/:id
  if (req.method === 'PATCH' && campaignId && !url.includes('/qr-codes') && !url.includes('/stats')) {
    const body = await readBody(req)
    const allowed = ['name','review_url','landing_title','landing_logo_url',
                     'satisfaction_threshold','create_ticket_on_negative','status']
    const updates: Record<string, unknown> = {}
    for (const k of allowed) if (k in body) updates[k] = body[k]

    const { error } = await supabaseAdmin
      .from('review_campaigns')
      .update(updates)
      .eq('id', campaignId)
      .eq('tenant_id', auth.tenantId)

    if (error) { res.writeHead(400); res.end(JSON.stringify({ error: error.message })); return }
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true }))
    return
  }

  // POST /api/review-funnel/campaigns/:id/qr-codes
  if (req.method === 'POST' && campaignId && url.endsWith('/qr-codes')) {
    const body = await readBody(req) as { label?: string }

    // Gerar short_code único
    let shortCode = generateShortCode()
    for (let i = 0; i < 5; i++) {
      const { data: existing } = await supabaseAdmin
        .from('review_qr_codes')
        .select('id')
        .eq('short_code', shortCode)
        .maybeSingle()
      if (!existing) break
      shortCode = generateShortCode()
    }

    const { data, error } = await supabaseAdmin
      .from('review_qr_codes')
      .insert({
        tenant_id: auth.tenantId,
        campaign_id: campaignId,
        short_code: shortCode,
        label: body.label ?? null,
      })
      .select()
      .single()

    if (error) { res.writeHead(400); res.end(JSON.stringify({ error: error.message })); return }
    res.writeHead(201, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(data))
    return
  }

  // GET /api/review-funnel/campaigns/:id/stats
  if (req.method === 'GET' && campaignId && url.endsWith('/stats')) {
    const [requestsRes, qrRes] = await Promise.all([
      supabaseAdmin
        .from('review_requests')
        .select('outcome, satisfaction')
        .eq('campaign_id', campaignId),
      supabaseAdmin
        .from('review_qr_codes')
        .select('scans, label, short_code')
        .eq('campaign_id', campaignId),
    ])

    const requests = requestsRes.data ?? []
    const total = requests.length
    const redirected = requests.filter(r => r.outcome === 'redirected_to_review').length
    const tickets = requests.filter(r => r.outcome === 'ticket_created').length
    const abandoned = requests.filter(r => r.outcome === 'abandoned').length
    const avgSatisfaction = total > 0
      ? requests.reduce((a, r) => a + (r.satisfaction ?? 0), 0) / total
      : null

    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({
      total_entries: total,
      redirected_to_review: redirected,
      tickets_created: tickets,
      abandoned,
      conversion_rate: total > 0 ? Math.round((redirected / total) * 100) : 0,
      avg_satisfaction: avgSatisfaction ? Number(avgSatisfaction.toFixed(2)) : null,
      qr_codes: qrRes.data ?? [],
    }))
    return
  }

  res.writeHead(404); res.end(JSON.stringify({ error: 'Rota não encontrada' }))
}

// ── Rotas públicas (landing de triagem) ───────────────────────────────────────

export async function handlePublicFunnel(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  setCors(req, res, 'Content-Type')
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return }

  const url = req.url ?? ''
  const shortCodeMatch = url.match(/^\/api\/funnel\/([^/]+)/)
  const shortCode = shortCodeMatch?.[1]

  if (!shortCode) { res.writeHead(400); res.end(JSON.stringify({ error: 'shortCode inválido' })); return }

  // GET /api/funnel/:shortCode — dados da campanha para renderizar a landing
  if (req.method === 'GET' && !url.endsWith('/submit')) {
    const { data: qr, error } = await supabaseAdmin
      .from('review_qr_codes')
      .select('id, campaign_id, review_campaigns(landing_title, landing_logo_url, satisfaction_threshold, status)')
      .eq('short_code', shortCode)
      .maybeSingle()

    if (error || !qr) { res.writeHead(404); res.end(JSON.stringify({ error: 'Campanha não encontrada' })); return }

    const campaign = (qr as any).review_campaigns
    if (campaign?.status !== 'active') {
      res.writeHead(410); res.end(JSON.stringify({ error: 'Campanha inativa' })); return
    }

    // Incrementar contador de scans via SELECT + UPDATE (sem RPC extra)
    const { data: qrCurrent } = await supabaseAdmin
      .from('review_qr_codes').select('scans').eq('id', qr.id).single()
    await supabaseAdmin
      .from('review_qr_codes')
      .update({ scans: (qrCurrent?.scans ?? 0) + 1 })
      .eq('id', qr.id)

    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({
      short_code: shortCode,
      qr_code_id: qr.id,
      campaign_id: qr.campaign_id,
      landing_title: campaign.landing_title,
      landing_logo_url: campaign.landing_logo_url,
      satisfaction_threshold: campaign.satisfaction_threshold,
    }))
    return
  }

  // POST /api/funnel/:shortCode/submit — registrar nota + triagem
  if (req.method === 'POST' && url.endsWith('/submit')) {
    const body = await readBody(req) as { satisfaction?: number; campaign_id?: string; qr_code_id?: string }

    const { satisfaction, campaign_id, qr_code_id } = body
    if (!satisfaction || satisfaction < 1 || satisfaction > 5 || !campaign_id) {
      res.writeHead(400); res.end(JSON.stringify({ error: 'satisfaction (1-5) e campaign_id são obrigatórios' })); return
    }

    const { data: campaign } = await supabaseAdmin
      .from('review_campaigns')
      .select('tenant_id, business_id, review_url, satisfaction_threshold, create_ticket_on_negative')
      .eq('id', campaign_id)
      .eq('status', 'active')
      .maybeSingle()

    if (!campaign) { res.writeHead(404); res.end(JSON.stringify({ error: 'Campanha não encontrada' })); return }

    const isPositive = satisfaction >= campaign.satisfaction_threshold
    let outcome: 'redirected_to_review' | 'ticket_created' = 'redirected_to_review'
    let ticketId: string | null = null

    if (!isPositive && campaign.create_ticket_on_negative) {
      outcome = 'ticket_created'
      // Criar ticket de suporte para capturar insatisfação privadamente
      const { data: ticket } = await supabaseAdmin
        .from('support_tickets')
        .insert({
          tenant_id: campaign.tenant_id,
          business_id: campaign.business_id,
          source: 'review_funnel',
          subject: `Feedback negativo via funil de review (nota ${satisfaction}/5)`,
          status: 'open',
          priority: satisfaction <= 2 ? 'high' : 'medium',
          body: `Cliente avaliou sua experiência com nota ${satisfaction}/5 no funil de geração de reviews. Contato não iniciado pelo cliente — ação proativa recomendada.`,
        })
        .select('id')
        .single()
      ticketId = ticket?.id ?? null
    }

    // IP anonimizado via hash
    const rawIp = req.socket.remoteAddress ?? ''
    const ipHash = crypto.createHash('sha256').update(rawIp).digest('hex').slice(0, 16)

    await supabaseAdmin.from('review_requests').insert({
      tenant_id: campaign.tenant_id,
      campaign_id,
      qr_code_id: qr_code_id ?? null,
      satisfaction,
      outcome,
      ticket_id: ticketId,
      ip_hash: ipHash,
    })

    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({
      outcome,
      redirect_url: isPositive ? campaign.review_url : null,
    }))
    return
  }

  res.writeHead(404); res.end(JSON.stringify({ error: 'Rota não encontrada' }))
}
