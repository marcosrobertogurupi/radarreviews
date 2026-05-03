import axios from 'axios'
import { logApiUsage } from './usage.js'

const getApifyToken = () => process.env['APIFY_TOKEN']

export interface ApifyContext {
  tenant_id: string
  connector_id?: string
}

export interface ApifyInstagramComment {
  id: string
  text: string
  ownerUsername: string
  timestamp: string
  shortCode: string // ID do post original
  url: string
}

/**
 * Chama a Apify para coletar comentários recentes de um perfil do Instagram
 */
export async function fetchInstagramComments(username: string, limit = 50, ctx?: ApifyContext): Promise<ApifyInstagramComment[]> {
  const token = getApifyToken()
  if (!token) throw new Error('APIFY_TOKEN não configurado')

  console.log(`[Apify] Passo 1: Buscando posts recentes de @${username}...`)

  try {
    // 1. Pegar os últimos posts usando a URL direta do perfil
    const profileUrl = `https://www.instagram.com/${username.replace('@', '')}/`
    const postsResponse = await axios.post(
      `https://api.apify.com/v2/acts/apify~instagram-scraper/run-sync-get-dataset-items?token=${token}`,
      {
        directUrls: [profileUrl],
        resultsType: 'posts',
        resultsLimit: 5,
        addParentPost: true
      },
      { timeout: 120000 }
    )

    const posts = postsResponse.data as any[]
    const postUrls = posts.map(p => p.url).filter(Boolean)

    if (postUrls.length === 0) {
      console.log(`[Apify] Nenhum post encontrado para @${username}`)
      return []
    }

    console.log(`[Apify] Passo 2: Buscando comentários em ${postUrls.length} posts usando robô especializado...`)

    // 2. Pegar comentários desses posts usando o robô ESPECIALIZADO em comentários
    const commentsResponse = await axios.post(
      `https://api.apify.com/v2/acts/apify~instagram-comment-scraper/run-sync-get-dataset-items?token=${token}`,
      {
        directUrls: postUrls,
        resultsLimit: limit
      },
      { timeout: 240000 }
    )

    const items = (commentsResponse.data as any[]).filter(item => !item.error && !item.requestErrorMessages)
    
    // Log de consumo
    if (ctx?.tenant_id) {
      await logApiUsage({
        tenant_id: ctx.tenant_id,
        connector_id: ctx.connector_id,
        service_name: 'apify',
        operation_type: 'instagram-comments',
        units_consumed: items.length,
        estimated_cost_brl: 0.15 // Estimativa baseada em tempo de execução
      })
    }

    console.log(`[Apify] Coletados ${items.length} comentários válidos para @${username}`)
    
    return items.map(item => {
      const id = item.id || item.commentId || item.pk || `ig_fallback_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
      return {
        id: String(id),
        text: item.text || item.text_content || item.body || item.caption || '',
        ownerUsername: item.ownerUsername || item.owner?.username || item.user?.username || 'instagram_user',
        timestamp: item.timestamp || item.createdAt || new Date().toISOString(),
        shortCode: item.shortCode,
        url: item.url || (item.shortCode ? `https://www.instagram.com/reels/${item.shortCode}/` : undefined)
      }
    })
  } catch (err: any) {
    if (err.response?.data) {
      console.error(`[Apify] Detalhes do erro Instagram:`, JSON.stringify(err.response.data))
    }
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[Apify] Erro ao coletar @${username}:`, msg)
    throw err
  }
}

/**
 * Coleta reclamações do Reclame Aqui via Apify
 */
export async function fetchReclameAquiComplaints(companySlug: string, limit = 20, ctx?: ApifyContext): Promise<any[]> {
  const token = getApifyToken()
  if (!token) throw new Error('APIFY_TOKEN não configurado')

  try {
    const response = await axios.post(
      `https://api.apify.com/v2/acts/apify~reclame-aqui-scraper/run-sync-get-dataset-items?token=${token}`,
      { companySlug, maxItems: limit, scrapeDetailedComplaints: true },
      { timeout: 300000 }
    )

    const items = response.data as any[]
    
    if (ctx?.tenant_id) {
      await logApiUsage({
        tenant_id: ctx.tenant_id,
        connector_id: ctx.connector_id,
        service_name: 'apify',
        operation_type: 'reclame-aqui',
        units_consumed: items.length,
        estimated_cost_brl: 0.25 // Scraping do RA é mais custoso
      })
    }

    return items.map(item => ({
      id: item.id || item.complaintId,
      title: item.title,
      description: item.description || item.text,
      status: item.status,
      author: item.authorName || item.author,
      date: item.datetime || item.date || item.createdAt,
      url: item.url
    }))
  } catch (err: any) {
    if (err.response?.data) {
      console.error(`[Apify] Detalhes do erro ReclameAqui:`, JSON.stringify(err.response.data))
    }
    throw err
  }
}

/**
 * Coleta reviews do Trustpilot via Apify
 */
export async function fetchTrustpilotReviews(domain: string, limit = 20, ctx?: ApifyContext): Promise<any[]> {
  const token = getApifyToken()
  if (!token) throw new Error('APIFY_TOKEN não configurado nas variáveis de ambiente')
  const sanitizedDomain = domain.replace(/^https?:\/\//, '').split('/')[0]
  const startUrl = `https://www.trustpilot.com/review/${sanitizedDomain}`

  const actorId = 'casper11515~trustpilot-reviews-scraper'
  const apiUrl = `https://api.apify.com/v2/acts/${actorId}/run-sync-get-dataset-items?token=${token}`
  
  console.log(`[Apify] Chamando scraper para ${domain}...`)
  console.log(`[Apify] URL: https://api.apify.com/v2/acts/${actorId}/run-sync-get-dataset-items?token=...`)

  try {
    const response = await axios.post(
      apiUrl,
      { companyWebsite: sanitizedDomain, maxReviews: limit },
      { timeout: 300000 }
    )
    const items = response.data as any[]
    if (ctx?.tenant_id) {
      await logApiUsage({
        tenant_id: ctx.tenant_id,
        connector_id: ctx.connector_id,
        service_name: 'apify',
        operation_type: 'trustpilot',
        units_consumed: items.length,
        estimated_cost_brl: 0.10
      })
    }
    return items.map(item => ({
      id: item.id || item.reviewId,
      stars: item.rating || item.stars,
      title: item.title,
      text: item.text || item.content,
      createdAt: item.createdAt || item.date || item.publishedDate,
      consumer: { id: item.userId || item.consumerId, displayName: item.userName || item.authorName || item.author },
      links: [{ rel: 'self', href: item.url || startUrl }]
    }))
  } catch (err: any) {
    if (err.response?.data) {
      console.error(`[Apify] Detalhes do erro Trustpilot:`, JSON.stringify(err.response.data))
    }
    throw err
  }
}

/**
 * Coleta reviews de páginas do Facebook via Apify
 */
export async function fetchFacebookReviews(pageUrl: string, limit = 20, ctx?: ApifyContext): Promise<any[]> {
  const token = getApifyToken()
  if (!token) throw new Error('APIFY_TOKEN não configurado')
  try {
    const response = await axios.post(
      `https://api.apify.com/v2/acts/apify~facebook-reviews-scraper/run-sync-get-dataset-items?token=${token}`,
      { startUrls: [{ url: pageUrl }], maxResults: limit },
      { timeout: 300000 }
    )
    const items = response.data as any[]
    if (ctx?.tenant_id) {
      await logApiUsage({
        tenant_id: ctx.tenant_id,
        connector_id: ctx.connector_id,
        service_name: 'apify',
        operation_type: 'facebook-reviews',
        units_consumed: items.length,
        estimated_cost_brl: 0.10
      })
    }
    return items.map(item => ({
      id: item.reviewId || item.id,
      stars: item.rating || item.score,
      text: item.text || item.content,
      publishedAt: item.date || item.timestamp,
      author: item.authorName || item.user?.name || 'Usuário do Facebook',
      url: item.url || pageUrl
    }))
  } catch (err: any) {
    if (err.response?.data) {
      console.error(`[Apify] Detalhes do erro Facebook:`, JSON.stringify(err.response.data))
    }
    throw err
  }
}

/**
 * Coleta menções de um perfil no Instagram (@)
 */
export async function fetchInstagramMentions(username: string, limit = 20, ctx?: ApifyContext): Promise<any[]> {
  const token = getApifyToken()
  if (!token) throw new Error('APIFY_TOKEN não configurado')
  const cleanUsername = username.replace('@', '')
  try {
    const response = await axios.post(
      `https://api.apify.com/v2/acts/apify~instagram-mention-scraper/run-sync-get-dataset-items?token=${token}`,
      { usernames: [cleanUsername], limit },
      { timeout: 300000 }
    )
    const items = response.data as any[]
    if (ctx?.tenant_id) {
      await logApiUsage({
        tenant_id: ctx.tenant_id,
        connector_id: ctx.connector_id,
        service_name: 'apify',
        operation_type: 'instagram-mentions',
        units_consumed: items.length,
        estimated_cost_brl: 0.10
      })
    }
    return items.map(item => ({
      id: item.id || item.pk,
      text: item.caption?.text || item.text || '',
      author: item.owner?.username || item.username || 'instagram_user',
      timestamp: item.taken_at || item.timestamp || new Date().toISOString(),
      url: item.url || (item.shortCode ? `https://www.instagram.com/p/${item.shortCode}/` : '')
    }))
  } catch (err) {
    return []
  }
}

/**
 * Coleta posts/comentários de uma Hashtag no Instagram (#)
 */
export async function fetchInstagramHashtags(hashtag: string, limit = 20, ctx?: ApifyContext): Promise<any[]> {
  const token = getApifyToken()
  if (!token) throw new Error('APIFY_TOKEN não configurado')
  const tag = hashtag.replace('#', '')
  try {
    const response = await axios.post(
      `https://api.apify.com/v2/acts/apify~instagram-hashtag-scraper/run-sync-get-dataset-items?token=${token}`,
      { hashtags: [tag], resultsLimit: limit },
      { timeout: 300000 }
    )
    const items = response.data as any[]
    if (ctx?.tenant_id) {
      await logApiUsage({
        tenant_id: ctx.tenant_id,
        connector_id: ctx.connector_id,
        service_name: 'apify',
        operation_type: 'instagram-hashtags',
        units_consumed: items.length,
        estimated_cost_brl: 0.10
      })
    }
    return items.map(item => ({
      id: item.id || item.pk,
      text: item.caption || item.text || '',
      author: item.ownerUsername || item.username || 'instagram_user',
      timestamp: item.timestamp || new Date().toISOString(),
      url: item.url || (item.shortCode ? `https://www.instagram.com/p/${item.shortCode}/` : '')
    }))
  } catch (err) {
    return []
  }
}
