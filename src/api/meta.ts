import http from 'node:http'
import { createClient } from '@supabase/supabase-js'
import { encrypt } from '../lib/crypto.js'
import { processMetaWebhookEvent } from '../services/meta/webhook-processor.js'

const supabaseAdmin = createClient(
  process.env['SUPABASE_URL']!,
  process.env['SUPABASE_SERVICE_ROLE_KEY']!
)

/**
 * 1. Inicia o OAuth do Facebook
 */
export async function handleMetaAuthConnect(req: http.IncomingMessage, res: http.ServerResponse) {
  const url = new URL(req.url!, `http://${req.headers.host}`)
  const tenant_id = url.searchParams.get('tenant_id')
  const business_id = url.searchParams.get('business_id')

  if (!tenant_id || !business_id) {
    res.writeHead(400); res.end(JSON.stringify({ error: 'tenant_id e business_id obrigatórios' })); return
  }

  const state = Buffer.from(JSON.stringify({
    tenant_id,
    business_id,
    nonce: Math.random().toString(36).substring(7)
  })).toString('base64')

  const scopes = [
    'pages_show_list',
    'pages_read_engagement',
    'pages_manage_metadata',
    'instagram_basic',
    'instagram_manage_comments',
  ].join(',')

  const authUrl = new URL('https://www.facebook.com/v19.0/dialog/oauth')
  authUrl.searchParams.set('client_id', process.env['META_APP_ID']!)
  authUrl.searchParams.set('redirect_uri', `${process.env['REPUTEI_API_BASE_URL']}/api/auth/meta/callback`)
  authUrl.searchParams.set('scope', scopes)
  authUrl.searchParams.set('state', state)
  authUrl.searchParams.set('response_type', 'code')

  res.writeHead(302, { 'Location': authUrl.toString() })
  res.end()
}

/**
 * 2. Callback do OAuth do Facebook
 */
export async function handleMetaAuthCallback(req: http.IncomingMessage, res: http.ServerResponse) {
  const url = new URL(req.url!, `http://${req.headers.host}`)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const error = url.searchParams.get('error')

  const adminUrl = process.env['ADMIN_URL'] || 'https://radarreviews.vercel.app'

  if (error || !code || !state) {
    res.writeHead(302, { 'Location': `${adminUrl}/settings/connectors?error=meta_denied` })
    res.end(); return
  }

  try {
    const stateData = JSON.parse(Buffer.from(state, 'base64').toString())
    const { tenant_id, business_id } = stateData

    // PASSO 1: Trocar code por short-lived token
    const shortToken = await exchangeCodeForToken(code)

    // PASSO 2: Converter para long-lived user token (~60 dias)
    const longToken = await exchangeForLongLivedToken(shortToken)

    // PASSO 3: Buscar Page Access Token
    console.log('[MetaAuth] Iniciando busca de páginas para o business_id:', business_id)
    const pages = await fetchUserPages(longToken)
    if (pages.length === 0) throw new Error('Nenhuma página encontrada')

    const mainPage = pages[0] // Por enquanto pegamos a primeira

    // PASSO 4: Buscar Instagram Business Account
    const igAccount = await fetchInstagramAccount(mainPage.id, mainPage.access_token)

    // PASSO 5: CRIPTOGRAFIA RIGOROSA e salvar no banco
    const encryptedPageToken = encrypt(mainPage.access_token)
    const encryptedUserToken = encrypt(longToken)

    const expiresAt = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString()

    // Atualizar conector Facebook
    console.log('[MetaAuth] Salvando conector Facebook para:', business_id)
    const { error: fbError } = await supabaseAdmin.from('channel_connectors').upsert({
      business_id,
      channel: 'facebook',
      status: 'active',
      external_id: mainPage.id,
      config: { 
        page_name: mainPage.name,
        page_token_enc: encryptedPageToken,
        user_token_enc: encryptedUserToken,
        oauth_expires_at: expiresAt
      }
    }, { onConflict: 'business_id,channel' })

    if (fbError) {
      console.error('[MetaAuth] Erro ao salvar Facebook:', fbError)
      throw new Error(`Erro DB Facebook: ${fbError.message}`)
    }
    console.log('[MetaAuth] Conector Facebook salvo com sucesso!')

    // Se tiver Instagram, atualizar também
    if (igAccount) {
      console.log('[MetaAuth] Salvando conector Instagram...')
      const { error: igError } = await supabaseAdmin.from('channel_connectors').upsert({
        business_id,
        channel: 'instagram',
        status: 'active',
        external_id: igAccount.id,
        config: { 
          username: igAccount.username,
          fb_page_id: mainPage.id,
          page_token_enc: encryptedPageToken,
          oauth_expires_at: expiresAt
        }
      }, { onConflict: 'business_id,channel' })

      if (igError) {
        console.error('[MetaAuth] Erro ao salvar Instagram:', igError)
      } else {
        console.log('[MetaAuth] Conector Instagram salvo com sucesso!')
      }
    }

    // PASSO 6: Subscrever Webhook na página
    await subscribePageToWebhook(mainPage.id, mainPage.access_token)

    res.writeHead(302, { 'Location': `${adminUrl}/settings/connectors?success=meta_connected` })
    res.end()

  } catch (err) {
    console.error('[MetaAuth] Erro no callback:', err)
    res.writeHead(302, { 'Location': `${adminUrl}/settings/connectors?error=meta_failed` })
    res.end()
  }
}

/**
 * 3. Endpoint de Webhook (GET para verificação, POST para eventos)
 */
export async function handleMetaWebhook(req: http.IncomingMessage, res: http.ServerResponse) {
  const url = new URL(req.url!, `http://${req.headers.host}`)

  if (req.method === 'GET') {
    const mode = url.searchParams.get('hub.mode')
    const token = url.searchParams.get('hub.verify_token')
    const challenge = url.searchParams.get('hub.challenge')

    if (mode === 'subscribe' && token === process.env['META_WEBHOOK_VERIFY_TOKEN']) {
      res.writeHead(200); res.end(challenge); return
    }
    res.writeHead(403); res.end('Forbidden'); return
  }

  if (req.method === 'POST') {
    let raw = ''
    for await (const chunk of req) raw += chunk
    
    // Responder 200 OK imediatamente para o Facebook
    res.writeHead(200); res.end('EVENT_RECEIVED')

    // Processar em background
    try {
      const body = JSON.parse(raw)
      if (body.object === 'page' || body.object === 'instagram') {
        for (const entry of body.entry || []) {
          for (const change of entry.changes || []) {
            processMetaWebhookEvent(entry.id, change).catch(e => console.error('[MetaWebhook] Erro:', e))
          }
        }
      }
    } catch (e) {
      console.error('[MetaWebhook] JSON inválido:', e)
    }
    return
  }
}

// ── Funções Auxiliares ──────────────────────────────────────────

async function exchangeCodeForToken(code: string): Promise<string> {
  const url = new URL('https://graph.facebook.com/v19.0/oauth/access_token')
  url.searchParams.set('client_id', process.env['META_APP_ID']!)
  url.searchParams.set('client_secret', process.env['META_APP_SECRET']!)
  url.searchParams.set('redirect_uri', `${process.env['REPUTEI_API_BASE_URL']}/api/auth/meta/callback`)
  url.searchParams.set('code', code)

  const res = await fetch(url.toString())
  const data: any = await res.json()
  if (!data.access_token) throw new Error(data.error?.message || 'Falha no short-lived token')
  return data.access_token
}

async function exchangeForLongLivedToken(shortToken: string): Promise<string> {
  const url = new URL('https://graph.facebook.com/v19.0/oauth/access_token')
  url.searchParams.set('grant_type', 'fb_exchange_token')
  url.searchParams.set('client_id', process.env['META_APP_ID']!)
  url.searchParams.set('client_secret', process.env['META_APP_SECRET']!)
  url.searchParams.set('fb_exchange_token', shortToken)

  const res = await fetch(url.toString())
  const data: any = await res.json()
  if (!data.access_token) throw new Error('Falha no long-lived token')
  return data.access_token
}

async function fetchUserPages(userToken: string): Promise<any[]> {
  const url = `https://graph.facebook.com/v20.0/me/accounts?access_token=${userToken}&fields=id,name,access_token`
  console.log('[MetaAuth] Chamando me/accounts...')
  const res = await fetch(url)
  const data: any = await res.json()
  console.log('[MetaAuth] Resposta me/accounts:', JSON.stringify(data, null, 2))
  return data.data || []
}

async function fetchInstagramAccount(pageId: string, pageToken: string): Promise<any | null> {
  const url = `https://graph.facebook.com/v19.0/${pageId}?fields=instagram_business_account{id,username}&access_token=${pageToken}`
  const res = await fetch(url)
  const data: any = await res.json()
  return data.instagram_business_account || null
}

async function subscribePageToWebhook(pageId: string, pageToken: string): Promise<void> {
  const url = `https://graph.facebook.com/v19.0/${pageId}/subscribed_apps`
  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      subscribed_fields: ['feed', 'mention'],
      access_token: pageToken,
    })
  })
}
