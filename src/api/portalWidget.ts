import http from 'node:http'
import { supabaseAdmin } from '../lib/supabase.js'
import { getAuthUser, setCors } from './server.js'

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

/**
 * Endpoint para obter / inicializar o Widget de um Tenant
 * GET /api/portal/widget
 */
export async function handleGetPortalWidget(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  setCors(req, res, 'Content-Type, Authorization')
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return }
  if (req.method !== 'GET')     { res.writeHead(405); res.end(JSON.stringify({ error: 'method_not_allowed' })); return }

  const authHeader = req.headers.authorization
  if (!authHeader) {
    res.writeHead(401, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'missing_token', message: 'Cabeçalho Authorization ausente' }))
    return
  }

  const auth = await getAuthUser(authHeader)
  if (!auth) {
    res.writeHead(401, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'invalid_token', message: 'Token inválido ou expirado' }))
    return
  }

  if (!auth.tenantId) {
    res.writeHead(403, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'no_tenant_association', message: 'Usuário autenticado sem tenant associado' }))
    return
  }

  try {
    // 1. Buscar tenant com token e config via service role (bypassa RLS)
    const { data: tenant, error: tErr } = await supabaseAdmin
      .from('tenants')
      .select('id, name, widget_token, widget_config')
      .eq('id', auth.tenantId)
      .maybeSingle()

    if (tErr || !tenant) {
      res.writeHead(404, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'tenant_not_found', message: 'Tenant não encontrado' }))
      return
    }

    let token = tenant.widget_token
    let config = tenant.widget_config || { theme: 'light', limit: 5, show_score: true, show_channel: true }

    // 2. Se widget_token for nulo, gera um automaticamente via service role
    if (!token) {
      token = crypto.randomUUID()
      const { error: updateErr } = await supabaseAdmin
        .from('tenants')
        .update({ widget_token: token, widget_config: config })
        .eq('id', auth.tenantId)

      if (updateErr) {
        console.error('[portal-widget] Erro ao auto-gerar token:', updateErr.message)
      }
    }

    // 3. Obter URL pública da API para montar o embed snippet
    const publicApiUrl = (process.env.PUBLIC_API_URL || process.env.VITE_API_URL || 'https://api-production-24e1.up.railway.app').replace(/\/+$/, '')
    const embed_snippet = `<div id="reputei-widget" data-token="${token}"></div>\n<script src="${publicApiUrl}/widget.js" async></script>`

    // 4. Buscar reviews de amostra para pré-visualização no portal
    const { data: reviews } = await supabaseAdmin
      .from('reviews')
      .select('id, author_name, body, rating, published_at, channel, sentiment')
      .eq('tenant_id', auth.tenantId)
      .in('sentiment', ['positive'])
      .order('published_at', { ascending: false })
      .limit(10)

    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({
      ok: true,
      tenantId: tenant.id,
      business_name: tenant.name,
      widget_token: token,
      widget_config: config,
      embed_snippet,
      sample_reviews: reviews || []
    }))
  } catch (err: any) {
    console.error('[portal-widget] Erro GET:', err?.stack || err)
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'internal_error', message: err?.message || 'Erro ao carregar widget' }))
    }
  }
}

/**
 * Endpoint para rotacionar/gerar novo Token do Widget
 * POST /api/portal/widget/rotate
 */
export async function handleRotatePortalWidgetToken(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  setCors(req, res, 'Content-Type, Authorization')
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return }
  if (req.method !== 'POST')    { res.writeHead(405); res.end('Method not allowed'); return }

  const auth = await getAuthUser(req.headers.authorization)
  if (!auth || !auth.tenantId) {
    res.writeHead(401); res.end(JSON.stringify({ error: 'Não autorizado' })); return
  }

  try {
    const newToken = crypto.randomUUID()
    const { error } = await supabaseAdmin
      .from('tenants')
      .update({ widget_token: newToken })
      .eq('id', auth.tenantId)

    if (error) throw error

    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true, widget_token: newToken }))
  } catch (err: any) {
    console.error('[portal-widget] Erro ao rotacionar token:', err)
    res.writeHead(500); res.end(JSON.stringify({ error: err?.message || 'Erro ao gerar novo token' }))
  }
}

/**
 * Endpoint para atualizar configurações do Widget
 * PUT /api/portal/widget/config
 */
export async function handleUpdatePortalWidgetConfig(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  setCors(req, res, 'Content-Type, Authorization')
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return }
  if (req.method !== 'PUT')     { res.writeHead(405); res.end('Method not allowed'); return }

  const auth = await getAuthUser(req.headers.authorization)
  if (!auth || !auth.tenantId) {
    res.writeHead(401); res.end(JSON.stringify({ error: 'Não autorizado' })); return
  }

  try {
    const body = await readBody(req)
    const newConfig = {
      theme: body['theme'] === 'dark' ? 'dark' : 'light',
      limit: typeof body['limit'] === 'number' ? Math.max(1, Math.min(20, body['limit'])) : 5,
      show_score: body['show_score'] !== false,
      show_channel: body['show_channel'] !== false
    }

    const { error } = await supabaseAdmin
      .from('tenants')
      .update({ widget_config: newConfig })
      .eq('id', auth.tenantId)

    if (error) throw error

    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true, widget_config: newConfig }))
  } catch (err: any) {
    console.error('[portal-widget] Erro ao atualizar config:', err)
    res.writeHead(500); res.end(JSON.stringify({ error: err?.message || 'Erro ao atualizar configuração' }))
  }
}
