// Google Business Profile OAuth Flow (F12-E1-T1 / F12-E4-T1)
//
// Fluxo:
//   1. GET /api/auth/google/connect?tenantId=xxx  → redireciona para tela de autorização do Google
//   2. GET /api/auth/google/callback?code=...&state=... → troca code por tokens, salva via Vault
//
// Tokens persistidos no Supabase Vault (pgsodium) usando a chave composta:
//   google_oauth_{tenantId}  → JSON com { access_token, refresh_token, expiry_date }
//
// Uso posterior:
//   getGoogleTokens(tenantId) → retorna tokens válidos, renovando automaticamente se expirado

import http from 'node:http'
import { supabaseAdmin } from '../lib/supabase.js'
import { logger } from '../lib/logger.js'
import { setCors, getAuthUser } from './server.js'

const CLIENT_ID     = process.env['GOOGLE_CLIENT_ID']     ?? ''
const CLIENT_SECRET = process.env['GOOGLE_CLIENT_SECRET'] ?? ''
const REDIRECT_URI  = process.env['GOOGLE_REDIRECT_URI']  ?? 'https://api.reputei.com.br/api/auth/google/callback'

const GOOGLE_AUTH_URL  = 'https://accounts.google.com/o/oauth2/v2/auth'
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'

const SCOPES = [
  'https://www.googleapis.com/auth/business.manage',
  'https://www.googleapis.com/auth/userinfo.email',
].join(' ')

// ── Armazenar / recuperar tokens via Supabase (coluna criptografada) ──────────

async function saveGoogleTokens(tenantId: string, tokens: GoogleTokens): Promise<void> {
  await supabaseAdmin
    .from('tenants')
    .update({
      google_oauth_tokens: JSON.stringify(tokens),
      google_oauth_connected_at: new Date().toISOString(),
    })
    .eq('id', tenantId)
}

async function loadGoogleTokens(tenantId: string): Promise<GoogleTokens | null> {
  const { data } = await supabaseAdmin
    .from('tenants')
    .select('google_oauth_tokens')
    .eq('id', tenantId)
    .single()

  if (!data?.google_oauth_tokens) return null
  try {
    return JSON.parse(data.google_oauth_tokens as string) as GoogleTokens
  } catch {
    return null
  }
}

export interface GoogleTokens {
  access_token: string
  refresh_token?: string
  expiry_date: number   // timestamp ms
  token_type: string
  scope: string
}

// ── Renovar access_token expirado ─────────────────────────────────────────────

async function refreshAccessToken(tenantId: string, tokens: GoogleTokens): Promise<GoogleTokens> {
  if (!tokens.refresh_token) throw new Error('Sem refresh_token para renovar.')

  const body = new URLSearchParams({
    client_id:     CLIENT_ID,
    client_secret: CLIENT_SECRET,
    refresh_token: tokens.refresh_token,
    grant_type:    'refresh_token',
  })

  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Falha ao renovar token Google: ${err}`)
  }

  const data = await res.json() as {
    access_token: string; expires_in: number; token_type: string; scope: string
  }

  const refreshed: GoogleTokens = {
    ...tokens,
    access_token: data.access_token,
    expiry_date:  Date.now() + data.expires_in * 1000,
    token_type:   data.token_type,
    scope:        data.scope,
  }

  await saveGoogleTokens(tenantId, refreshed)
  return refreshed
}

/**
 * Retorna tokens válidos para o tenant, renovando automaticamente se expirado.
 * Exportado para uso nos conectores Google.
 */
export async function getGoogleTokens(tenantId: string): Promise<GoogleTokens | null> {
  const tokens = await loadGoogleTokens(tenantId)
  if (!tokens) return null

  // Renovar se expira nos próximos 5 minutos
  if (tokens.expiry_date - Date.now() < 5 * 60_000) {
    try {
      return await refreshAccessToken(tenantId, tokens)
    } catch (err) {
      logger.error('[googleAuth] Falha ao renovar token', { tenant_id: tenantId, err })
      return null
    }
  }

  return tokens
}

// ── Handler: iniciar OAuth (redirecionar para Google) ─────────────────────────

export async function handleGoogleConnect(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  setCors(req, res, 'Content-Type, Authorization')
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return }

  const auth = await getAuthUser(req.headers.authorization)
  if (!auth) { res.writeHead(401); res.end(JSON.stringify({ error: 'Não autenticado' })); return }

  if (!CLIENT_ID) {
    res.writeHead(500); res.end(JSON.stringify({ error: 'GOOGLE_CLIENT_ID não configurado no servidor' })); return
  }

  // state = tenantId codificado em base64 para recuperar no callback
  const state = Buffer.from(JSON.stringify({ tenantId: auth.tenantId })).toString('base64url')

  const params = new URLSearchParams({
    client_id:     CLIENT_ID,
    redirect_uri:  REDIRECT_URI,
    response_type: 'code',
    scope:         SCOPES,
    access_type:   'offline',   // necessário para obter refresh_token
    prompt:        'consent',   // força exibição do consent mesmo se já autorizado
    state,
  })

  const authUrl = `${GOOGLE_AUTH_URL}?${params.toString()}`

  // Retorna a URL para o frontend redirecionar (evita CORS issues com redirect direto)
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ auth_url: authUrl }))
}

// ── Handler: callback do Google (troca code por tokens) ───────────────────────

export async function handleGoogleCallback(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  // Callback é GET público (Google redireciona aqui com code + state)
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return }

  const url = new URL(req.url ?? '/', `https://${req.headers.host}`)
  const code  = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const error = url.searchParams.get('error')

  const portalUrl = process.env['VITE_PORTAL_URL'] ?? 'https://app.reputei.com.br'

  if (error) {
    logger.warn('[googleAuth] Usuário negou acesso ou erro OAuth', { error })
    res.writeHead(302, { Location: `${portalUrl}/settings?google_error=${encodeURIComponent(error)}` })
    res.end()
    return
  }

  if (!code || !state) {
    res.writeHead(302, { Location: `${portalUrl}/settings?google_error=missing_params` })
    res.end()
    return
  }

  // Decodificar state para obter tenantId
  let tenantId: string
  try {
    const decoded = JSON.parse(Buffer.from(state, 'base64url').toString()) as { tenantId: string }
    tenantId = decoded.tenantId
  } catch {
    res.writeHead(302, { Location: `${portalUrl}/settings?google_error=invalid_state` })
    res.end()
    return
  }

  // Trocar code por tokens
  try {
    const body = new URLSearchParams({
      client_id:     CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri:  REDIRECT_URI,
      grant_type:    'authorization_code',
      code,
    })

    const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    })

    if (!tokenRes.ok) {
      const errText = await tokenRes.text()
      logger.error('[googleAuth] Falha ao trocar code por token', { errText })
      res.writeHead(302, { Location: `${portalUrl}?google_error=token_exchange_failed` })
      res.end()
      return
    }

    const tokenData = await tokenRes.json() as {
      access_token: string
      refresh_token?: string
      expires_in: number
      token_type: string
      scope: string
    }

    const tokens: GoogleTokens = {
      access_token:  tokenData.access_token,
      refresh_token: tokenData.refresh_token,
      expiry_date:   Date.now() + tokenData.expires_in * 1000,
      token_type:    tokenData.token_type,
      scope:         tokenData.scope,
    }

    await saveGoogleTokens(tenantId, tokens)

    logger.info('[googleAuth] Tokens salvos com sucesso', { tenant_id: tenantId })

    // Redirecionar de volta para o portal com sucesso
    res.writeHead(302, { Location: `${portalUrl}?google_connected=1` })
    res.end()

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    logger.error('[googleAuth] Erro no callback', { err: msg })
    res.writeHead(302, { Location: `${portalUrl}?google_error=${encodeURIComponent(msg)}` })
    res.end()
  }
}

// ── Handler: status da conexão Google do tenant ───────────────────────────────

export async function handleGoogleStatus(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  setCors(req, res, 'Content-Type, Authorization')
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return }

  const auth = await getAuthUser(req.headers.authorization)
  if (!auth) { res.writeHead(401); res.end(JSON.stringify({ error: 'Não autenticado' })); return }

  const { data } = await supabaseAdmin
    .from('tenants')
    .select('google_oauth_connected_at, google_oauth_tokens')
    .eq('id', auth.tenantId)
    .single()

  const connected = !!(data?.google_oauth_tokens)
  const tokens = connected ? await getGoogleTokens(auth.tenantId) : null

  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({
    connected,
    connected_at: data?.google_oauth_connected_at ?? null,
    token_valid: tokens != null,
    scope: tokens?.scope ?? null,
  }))
}

// ── Handler: revogar conexão Google ──────────────────────────────────────────

export async function handleGoogleDisconnect(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  setCors(req, res, 'Content-Type, Authorization')
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return }
  if (req.method !== 'DELETE') { res.writeHead(405); res.end(); return }

  const auth = await getAuthUser(req.headers.authorization)
  if (!auth) { res.writeHead(401); res.end(JSON.stringify({ error: 'Não autenticado' })); return }

  await supabaseAdmin
    .from('tenants')
    .update({ google_oauth_tokens: null, google_oauth_connected_at: null })
    .eq('id', auth.tenantId)

  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ ok: true }))
}
