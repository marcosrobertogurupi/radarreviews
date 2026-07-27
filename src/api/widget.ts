import http from 'node:http'
import { supabaseAdmin } from '../lib/supabase.js'

/**
 * Endpoint público para o Widget de Reviews
 * GET /api/widget/:token
 */
export async function handleWidgetRequest(req: http.IncomingMessage, res: http.ServerResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') {
    res.writeHead(204); res.end(); return
  }

  const token = req.url?.split('/api/widget/')[1]?.split('?')[0]

  if (!token) {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'Token obrigatório' }))
    return
  }

  try {
    // 1. Validar token e buscar tenant
    const { data: tenant, error: tError } = await supabaseAdmin
      .from('tenants')
      .select('id, name, widget_config')
      .eq('widget_token', token)
      .single()

    if (tError || !tenant) {
      res.writeHead(404, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Widget não encontrado ou desativado' }))
      return
    }

    const config = tenant.widget_config || { limit: 5, theme: 'light', show_score: true, show_channel: true }

    // 2. Buscar reviews positivos para o widget
    const { data: reviews, error: rError } = await supabaseAdmin
      .from('reviews')
      .select('id, author_name, body, rating, published_at, channel, sentiment')
      .eq('tenant_id', tenant.id)
      .eq('sentiment', 'positive')
      .order('published_at', { ascending: false })
      .limit(config.limit || 5)

    if (rError) throw rError

    // 3. Retornar JSON
    res.writeHead(200, { 
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    })
    res.end(JSON.stringify({
      business_name: tenant.name,
      config,
      reviews: reviews || []
    }))

  } catch (err) {
    console.error('[widget] Erro:', err)
    res.writeHead(500, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'Erro interno ao carregar widget' }))
  }
}
