import axios from 'axios'
import { logApiUsage } from './usage.js'

const getApifyToken = () => process.env['APIFY_TOKEN']

// Limites globais para evitar consumo excessivo de créditos
const DEFAULT_TIMEOUT_SECS = 180 // 3 minutos
const DEFAULT_MEMORY_MB = 256    // 256MB é suficiente para scrapers simples

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

export interface ActorSafetyLimit {
  maxItems: number
  costPerItem: number // USD por item extraído
}

/**
 * Normaliza o ID de um actor da Apify para sempre usar o separador `~` em vez de `/`.
 * A API V2 da Apify exige o til para resolver atores da comunidade.
 * Exemplo: "viralanalyzer/reclameaqui-scraper" -> "viralanalyzer~reclameaqui-scraper"
 */
export function normalizeActorId(actorId: string): string {
  if (!actorId || typeof actorId !== 'string') return actorId
  const trimmed = actorId.trim()
  if (trimmed.includes('/')) {
    return trimmed.replace('/', '~')
  }
  return trimmed
}

/**
 * Tabela centralizada de limites de segurança e custos estimados por canal/actor.
 */
export const ACTOR_SAFETY_LIMITS: Record<string, ActorSafetyLimit> = {
  reclame_aqui:       { maxItems: 10, costPerItem: 0.05 },    // $50.00 / 1.000 itens ($0,05/item)
  trustpilot:         { maxItems: 15, costPerItem: 0.0015 },  // $1.50 / 1.000 itens ($0,0015/item)
  google_maps:        { maxItems: 50, costPerItem: 0.003 },   // $3.00 / 1.000 itens ($0,003/item)
  tripadvisor:        { maxItems: 50, costPerItem: 0.003 },   // $3.00 / 1.000 itens ($0,003/item)
  instagram_comments: { maxItems: 50, costPerItem: 0.0026 },  // $2.60 / 1.000 itens
  facebook_reviews:   { maxItems: 20, costPerItem: 0.005 },
  instagram_mentions: { maxItems: 20, costPerItem: 0.005 },
  instagram_hashtags: { maxItems: 20, costPerItem: 0.005 },
}

/**
 * Guard-Rail de Custo: calcula e restringe o limite de itens solicitados
 * para evitar estourar orçamentos e cotas de API.
 */
export function calculateAndClampLimit(
  channel: string,
  requestedLimit: number
): { safeLimit: number; estimatedCostUsd: number } {
  const envMaxCost = process.env['APIFY_MAX_COST_PER_RUN']
  const maxCostPerRunUsd = envMaxCost && !isNaN(Number(envMaxCost)) ? Number(envMaxCost) : 0.50

  const config = ACTOR_SAFETY_LIMITS[channel] ?? { maxItems: 20, costPerItem: 0.01 }
  
  let safeLimit = Math.min(Math.max(1, requestedLimit), config.maxItems)
  let estimatedCostUsd = safeLimit * config.costPerItem

  if (estimatedCostUsd > maxCostPerRunUsd) {
    const budgetLimit = Math.max(1, Math.floor((maxCostPerRunUsd + 1e-7) / config.costPerItem))
    safeLimit = Math.min(safeLimit, budgetLimit)
    estimatedCostUsd = safeLimit * config.costPerItem
    console.warn(
      `[Apify Guard-Rail] Limite reduzido por teto orçamentário (${channel}): ` +
      `solicitado=${requestedLimit}, ajustado=${safeLimit}, custo estimado=USD $${estimatedCostUsd.toFixed(4)} ` +
      `(teto=USD $${maxCostPerRunUsd.toFixed(2)})`
    )
  } else {
    console.log(
      `[Apify Guard-Rail] Canal '${channel}': limite solicitado=${requestedLimit}, safeLimit=${safeLimit}, ` +
      `custo estimado=USD $${estimatedCostUsd.toFixed(4)}`
    )
  }

  return { safeLimit, estimatedCostUsd }
}

/**
 * Aborta uma execução na Apify para parar cobrança
 */
async function abortRun(runId: string) {
  const token = getApifyToken()
  if (!token) return
  try {
    await axios.post(`https://api.apify.com/v2/actor-runs/${runId}/abort?token=${token}`)
    console.log(`[Apify] Execução ${runId} abortada com sucesso (Timeout/Segurança).`)
  } catch (err) {
    console.error(`[Apify] Falha ao abortar execução ${runId}:`, err)
  }
}

/**
 * Chama a Apify para coletar comentários recentes de um perfil do Instagram
 */
export async function fetchInstagramComments(username: string, limit = 50, ctx?: ApifyContext): Promise<ApifyInstagramComment[]> {
  const token = getApifyToken()
  if (!token) throw new Error('APIFY_TOKEN não configurado')

  const { safeLimit, estimatedCostUsd } = calculateAndClampLimit('instagram_comments', limit)

  console.log(`[Apify] Passo 1: Buscando posts recentes de @${username}...`)

  try {
    const profileUrl = `https://www.instagram.com/${username.replace('@', '')}/`
    const actor1 = normalizeActorId('apify/instagram-scraper')
    const postsResponse = await axios.post(
      `https://api.apify.com/v2/acts/${actor1}/run-sync-get-dataset-items?token=${token}&timeout=${DEFAULT_TIMEOUT_SECS}&memory=${DEFAULT_MEMORY_MB}`,
      {
        directUrls: [profileUrl],
        resultsType: 'posts',
        resultsLimit: 5,
        addParentPost: true
      },
      { timeout: (DEFAULT_TIMEOUT_SECS + 30) * 1000 }
    )

    const posts = postsResponse.data as any[]
    const postUrls = posts.map(p => p.url).filter(Boolean)

    if (postUrls.length === 0) {
      console.log(`[Apify] Nenhum post encontrado para @${username}`)
      return []
    }

    console.log(`[Apify] Passo 2: Buscando comentários em ${postUrls.length} posts usando robô especializado...`)

    const actor2 = normalizeActorId('apify/instagram-comment-scraper')
    const commentsResponse = await axios.post(
      `https://api.apify.com/v2/acts/${actor2}/run-sync-get-dataset-items?token=${token}&timeout=${DEFAULT_TIMEOUT_SECS}&memory=${DEFAULT_MEMORY_MB}`,
      {
        directUrls: postUrls,
        resultsLimit: safeLimit
      },
      { timeout: (DEFAULT_TIMEOUT_SECS + 30) * 1000 }
    )

    const items = (commentsResponse.data as any[]).filter(item => !item.error && !item.requestErrorMessages)
    
    if (ctx?.tenant_id) {
      await logApiUsage({
        tenant_id: ctx.tenant_id,
        connector_id: ctx.connector_id,
        service_name: 'apify',
        operation_type: 'instagram-comments',
        units_consumed: items.length,
        estimated_cost_brl: estimatedCostUsd * 5.5
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
export async function fetchReclameAquiComplaints(
  companySlug: string,
  limit = 20,
  ctx?: ApifyContext,
  actorId?: string,
  options?: { since?: string | Date }
): Promise<any[]> {
  const token = getApifyToken()
  if (!token) throw new Error('APIFY_TOKEN não configurado')

  const rawActor = actorId || 'viralanalyzer~reclameaqui-scraper'
  const actor = normalizeActorId(rawActor)

  const { safeLimit, estimatedCostUsd } = calculateAndClampLimit('reclame_aqui', limit)

  try {
    const raTimeoutSecs = 300 // 5 minutos para o Reclame Aqui superar Cloudflare
    const raMemoryMb = 1024   // 1GB de RAM é necessário para o Chrome no container da Apify

    const response = await axios.post(
      `https://api.apify.com/v2/acts/${actor}/run-sync-get-dataset-items?token=${token}&timeout=${raTimeoutSecs}&memory=${raMemoryMb}`,
      {
        companies: [companySlug],
        limit: safeLimit,
        maxResults: safeLimit,
        maxComplaints: safeLimit,
        includeCompanyStats: false,
        statusFilter: 'all',
      },
      { timeout: (raTimeoutSecs + 30) * 1000 }
    )

    const items = response.data as any[]
    
    const diagnostic = items.find(item => item && item.setup_status === 'DIAGNOSTIC_GUIDE')
    if (diagnostic) {
      throw new Error(`Apify retornou erro de diagnostico: ${diagnostic.message || 'soft-deadline ou erro de proxy do Reclame Aqui'}`)
    }
    
    if (ctx?.tenant_id) {
      await logApiUsage({
        tenant_id: ctx.tenant_id,
        connector_id: ctx.connector_id,
        service_name: 'apify',
        operation_type: 'reclame-aqui',
        units_consumed: items.length,
        estimated_cost_brl: estimatedCostUsd * 5.5
      })
    }

    const mapped = items.map(item => ({
      id: item.complaint_id || item.id || item.complaintId,
      title: item.title,
      description: item.description || item.text || item.company_response,
      status: item.status,
      author: item.author || item.authorName,
      date: item.created_at || item.datetime || item.date || item.createdAt,
      url: item.url,
      isResolved: item.is_resolved ?? (item.status === 'Resolvida'),
      rating: item.rating,
    }))

    // Incremental filtering: se options.since for fornecido, descartar itens mais antigos
    if (options?.since) {
      const sinceTime = new Date(options.since).getTime()
      if (!isNaN(sinceTime)) {
        return mapped.filter(item => {
          if (!item.date) return true
          const itemTime = new Date(item.date).getTime()
          return isNaN(itemTime) || itemTime >= sinceTime
        })
      }
    }

    return mapped
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
export async function fetchTrustpilotReviews(
  domain: string, 
  limit = 20, 
  ctx?: ApifyContext,
  options: { filterByDatePeriod?: string; sortBy?: 'recency' | 'relevancy'; since?: string | Date } = {}
): Promise<any[]> {
  const token = getApifyToken()
  if (!token) throw new Error('APIFY_TOKEN não configurado nas variáveis de ambiente')

  const sanitizedDomain = (domain || '').trim().includes('/review/')
    ? (domain || '').trim().split('/review/')[1]?.split('?')[0]?.split('#')[0] || domain
    : domain
  const firstPart = sanitizedDomain.replace(/^https?:\/\//i, '').replace(/^www\./i, '').split('/')[0]
  const cleanDomain = (firstPart || '').trim()

  const rawActorId = 'pear_fight~trustpilot-scraper'
  const actorId = normalizeActorId(rawActorId)
  const timeoutSecs = 180

  const { safeLimit, estimatedCostUsd } = calculateAndClampLimit('trustpilot', limit)

  console.log(`[Apify] Chamando scraper para ${cleanDomain}...`)

  let runId = ''
  try {
    console.log(`[Apify] Iniciando execução do robô para ${cleanDomain}...`)
    const runResponse = await axios.post(
      `https://api.apify.com/v2/acts/${actorId}/runs?token=${token}&timeout=${timeoutSecs}&memory=1024`,
      { 
        companyUrls: [
          `https://www.trustpilot.com/review/${cleanDomain}`
        ],
        maxReviews: safeLimit,
        limit: safeLimit,
        maxResults: safeLimit
      }
    )

    runId = runResponse.data.data.id
    const datasetId = runResponse.data.data.defaultDatasetId
    console.log(`[Apify] Robô iniciado (RunID: ${runId}). Aguardando conclusão...`)

    let finished = false
    let attempts = 0
    const maxAttempts = 48 // 240s
    
    while (!finished && attempts < maxAttempts) {
      await new Promise(r => setTimeout(r, 5000))
      const statusCheck = await axios.get(`https://api.apify.com/v2/actor-runs/${runId}?token=${token}`)
      const status = statusCheck.data.data.status
      
      if (status === 'SUCCEEDED') {
        finished = true
      } else if (status === 'FAILED' || status === 'ABORTED' || status === 'TIMED-OUT') {
        throw new Error(`O robô falhou com status: ${status}`)
      }
      attempts++
    }

    if (!finished) {
      await abortRun(runId)
      throw new Error('O robô demorou muito para responder e foi abortado por segurança.')
    }

    console.log(`[Apify] Robô finalizado! Buscando dados do dataset ${datasetId}...`)
    const itemsResponse = await axios.get(`https://api.apify.com/v2/datasets/${datasetId}/items?token=${token}`)
    const items = itemsResponse.data as any[]

    if (ctx?.tenant_id) {
      await logApiUsage({
        tenant_id: ctx.tenant_id,
        connector_id: ctx.connector_id,
        service_name: 'apify',
        operation_type: 'trustpilot',
        units_consumed: items.length,
        estimated_cost_brl: estimatedCostUsd * 5.5
      })
    }

    const mapped = items
      .filter(item => item && item.type === 'review')
      .map(item => {
        let dateStr = item.date || item.reviewDate || item.createdAt || item.publishedDate || new Date().toISOString()
        try {
          const d = new Date(dateStr)
          if (isNaN(d.getTime())) dateStr = new Date().toISOString()
          else dateStr = d.toISOString()
        } catch {
          dateStr = new Date().toISOString()
        }

        const reviewId = item.reviewUrl ? item.reviewUrl.split('/').pop() : undefined

        return {
          id: reviewId || item.reviewId || item.id || `tp_${Math.random().toString(36).slice(2, 9)}`,
          stars: item.rating || item.reviewRatingScore || item.stars || 5,
          title: item.title || item.reviewTitle || '',
          text: item.text || item.reviewDescription || item.content || item.body || '',
          createdAt: dateStr,
          consumer: { 
            id: item.reviewerId || item.userId || item.consumerId || 'anon', 
            displayName: item.author || item.reviewer || item.userName || item.authorName || 'Cliente Trustpilot' 
          },
          links: [{ rel: 'self', href: item.reviewUrl || item.url || `https://www.trustpilot.com/review/${cleanDomain}` }]
        }
      })

    // Incremental filtering by options.since
    if (options?.since) {
      const sinceTime = new Date(options.since).getTime()
      if (!isNaN(sinceTime)) {
        return mapped.filter(item => {
          const itemTime = new Date(item.createdAt).getTime()
          return isNaN(itemTime) || itemTime >= sinceTime
        })
      }
    }

    return mapped
  } catch (error: any) {
    if (runId && !error.message?.includes('abortado')) {
      await abortRun(runId).catch(() => {})
    }
    if (error.response?.data) {
      console.error(`[Apify] Detalhes do erro Trustpilot:`, JSON.stringify(error.response.data))
    }
    throw error
  }
}

/**
 * Coleta reviews de páginas do Facebook via Apify
 */
export async function fetchFacebookReviews(pageUrl: string, limit = 20, ctx?: ApifyContext): Promise<any[]> {
  const token = getApifyToken()
  if (!token) throw new Error('APIFY_TOKEN não configurado')

  const actor = normalizeActorId('apify/facebook-reviews-scraper')
  const { safeLimit, estimatedCostUsd } = calculateAndClampLimit('facebook_reviews', limit)

  try {
    const response = await axios.post(
      `https://api.apify.com/v2/acts/${actor}/run-sync-get-dataset-items?token=${token}&timeout=${DEFAULT_TIMEOUT_SECS}&memory=${DEFAULT_MEMORY_MB}`,
      { startUrls: [{ url: pageUrl }], maxResults: safeLimit, limit: safeLimit },
      { timeout: (DEFAULT_TIMEOUT_SECS + 30) * 1000 }
    )
    const items = response.data as any[]
    if (ctx?.tenant_id) {
      await logApiUsage({
        tenant_id: ctx.tenant_id,
        connector_id: ctx.connector_id,
        service_name: 'apify',
        operation_type: 'facebook-reviews',
        units_consumed: items.length,
        estimated_cost_brl: estimatedCostUsd * 5.5
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
  const actor = normalizeActorId('apify/instagram-mention-scraper')
  const { safeLimit, estimatedCostUsd } = calculateAndClampLimit('instagram_mentions', limit)

  try {
    const response = await axios.post(
      `https://api.apify.com/v2/acts/${actor}/run-sync-get-dataset-items?token=${token}&timeout=${DEFAULT_TIMEOUT_SECS}&memory=${DEFAULT_MEMORY_MB}`,
      { usernames: [cleanUsername], limit: safeLimit },
      { timeout: (DEFAULT_TIMEOUT_SECS + 30) * 1000 }
    )
    const items = response.data as any[]
    if (ctx?.tenant_id) {
      await logApiUsage({
        tenant_id: ctx.tenant_id,
        connector_id: ctx.connector_id,
        service_name: 'apify',
        operation_type: 'instagram-mentions',
        units_consumed: items.length,
        estimated_cost_brl: estimatedCostUsd * 5.5
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
  const actor = normalizeActorId('apify/instagram-hashtag-scraper')
  const { safeLimit, estimatedCostUsd } = calculateAndClampLimit('instagram_hashtags', limit)

  try {
    const response = await axios.post(
      `https://api.apify.com/v2/acts/${actor}/run-sync-get-dataset-items?token=${token}&timeout=${DEFAULT_TIMEOUT_SECS}&memory=${DEFAULT_MEMORY_MB}`,
      { hashtags: [tag], resultsLimit: safeLimit, limit: safeLimit },
      { timeout: (DEFAULT_TIMEOUT_SECS + 30) * 1000 }
    )
    const items = response.data as any[]
    if (ctx?.tenant_id) {
      await logApiUsage({
        tenant_id: ctx.tenant_id,
        connector_id: ctx.connector_id,
        service_name: 'apify',
        operation_type: 'instagram-hashtags',
        units_consumed: items.length,
        estimated_cost_brl: estimatedCostUsd * 5.5
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

/**
 * Coleta reviews do Google Maps via Apify Actor com ordenação por mais recentes e corte por data
 */
export async function fetchGoogleMapsReviewsApify(
  placeId: string,
  limit = 50,
  lastSyncAt?: string | null,
  ctx?: ApifyContext,
  jobType: 'backfill' | 'incremental' = 'incremental'
): Promise<any[]> {
  const token = getApifyToken()
  if (!token) throw new Error('APIFY_TOKEN não configurado')

  const actor = normalizeActorId('compass~google-maps-reviews-scraper')
  
  // Data de corte para sync incremental (YYYY-MM-DD)
  const reviewsStartDate = lastSyncAt ? new Date(lastSyncAt).toISOString().split('T')[0] : undefined

  // Importar dinamicamente para evitar ciclo
  const { checkTenantScrapeQuota, recordApifyUsage } = await import('./apify-quota.js')

  if (ctx?.tenant_id) {
    const quota = await checkTenantScrapeQuota(ctx.tenant_id, 'google_maps', limit, jobType)
    if (!quota.allowed) {
      throw new Error(`[Apify Bloqueio de Cota] ${quota.reason || 'Cota mensal de reviews atingida'}`)
    }
    limit = quota.safeLimit
  }

  const { safeLimit, estimatedCostUsd } = calculateAndClampLimit('google_maps', limit)

  try {
    const response = await axios.post(
      `https://api.apify.com/v2/acts/${actor}/run-sync-get-dataset-items?token=${token}&timeout=${DEFAULT_TIMEOUT_SECS}&memory=${DEFAULT_MEMORY_MB}`,
      {
        startUrls: [{ url: `https://www.google.com/maps/place/?q=place_id:${placeId}` }],
        maxReviews: safeLimit,
        limit: safeLimit,
        sort: 'newest', // ⚠️ Obrigatório: ordena por mais recentes no Google Maps
        ...(reviewsStartDate ? { reviewsStartDate } : {})
      },
      { timeout: (DEFAULT_TIMEOUT_SECS + 30) * 1000 }
    )

    const items = (response.data as any[]).filter(i => i && !i.error)

    if (ctx?.tenant_id) {
      await recordApifyUsage(ctx.tenant_id, ctx.connector_id, 'google_maps', items.length, estimatedCostUsd)
    }

    return items
  } catch (err: any) {
    if (err.response?.data) {
      console.error(`[Apify] Detalhes do erro Google Maps:`, JSON.stringify(err.response.data))
    }
    throw err
  }
}

/**
 * Coleta reviews do TripAdvisor via Apify Actor com ordenação por mais recentes e corte por data
 */
export async function fetchTripAdvisorReviewsApify(
  listingUrlOrLocationId: string,
  limit = 50,
  lastSyncAt?: string | null,
  ctx?: ApifyContext,
  jobType: 'backfill' | 'incremental' = 'incremental'
): Promise<any[]> {
  const token = getApifyToken()
  if (!token) throw new Error('APIFY_TOKEN não configurado')

  const actor = normalizeActorId('compass~tripadvisor-scraper')

  let url = listingUrlOrLocationId
  if (!url.startsWith('http')) {
    const locationId = listingUrlOrLocationId.replace(/\D/g, '')
    url = `https://www.tripadvisor.com/LocationPhotoDirectLink-g1-d${locationId}-Reviews.html`
  }

  const reviewsStartDate = lastSyncAt ? new Date(lastSyncAt).toISOString().split('T')[0] : undefined

  const { checkTenantScrapeQuota, recordApifyUsage } = await import('./apify-quota.js')

  if (ctx?.tenant_id) {
    const quota = await checkTenantScrapeQuota(ctx.tenant_id, 'tripadvisor', limit, jobType)
    if (!quota.allowed) {
      throw new Error(`[Apify Bloqueio de Cota] ${quota.reason || 'Cota mensal de reviews atingida'}`)
    }
    limit = quota.safeLimit
  }

  const { safeLimit, estimatedCostUsd } = calculateAndClampLimit('tripadvisor', limit)

  try {
    const response = await axios.post(
      `https://api.apify.com/v2/acts/${actor}/run-sync-get-dataset-items?token=${token}&timeout=${DEFAULT_TIMEOUT_SECS}&memory=${DEFAULT_MEMORY_MB}`,
      {
        startUrls: [{ url }],
        maxReviews: safeLimit,
        limit: safeLimit,
        sort: 'newest', // ⚠️ Obrigatório: ordena por mais recentes no TripAdvisor
        ...(reviewsStartDate ? { reviewsStartDate } : {})
      },
      { timeout: (DEFAULT_TIMEOUT_SECS + 30) * 1000 }
    )

    const items = (response.data as any[]).filter(i => i && !i.error)

    if (ctx?.tenant_id) {
      await recordApifyUsage(ctx.tenant_id, ctx.connector_id, 'tripadvisor', items.length, estimatedCostUsd)
    }

    return items
  } catch (err: any) {
    if (err.response?.data) {
      console.error(`[Apify] Detalhes do erro TripAdvisor:`, JSON.stringify(err.response.data))
    }
    throw err
  }
}

