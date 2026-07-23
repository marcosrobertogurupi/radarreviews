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

  console.log(`[Apify] Passo 1: Buscando posts recentes de @${username}...`)

  try {
    // 1. Pegar os últimos posts usando a URL direta do perfil
    const profileUrl = `https://www.instagram.com/${username.replace('@', '')}/`
    const postsResponse = await axios.post(
      `https://api.apify.com/v2/acts/apify~instagram-scraper/run-sync-get-dataset-items?token=${token}&timeout=${DEFAULT_TIMEOUT_SECS}&memory=${DEFAULT_MEMORY_MB}`,
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

    // 2. Pegar comentários desses posts usando o robô ESPECIALIZADO em comentários
    const commentsResponse = await axios.post(
      `https://api.apify.com/v2/acts/apify~instagram-comment-scraper/run-sync-get-dataset-items?token=${token}&timeout=${DEFAULT_TIMEOUT_SECS}&memory=${DEFAULT_MEMORY_MB}`,
      {
        directUrls: postUrls,
        resultsLimit: limit
      },
      { timeout: (DEFAULT_TIMEOUT_SECS + 30) * 1000 }
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
        estimated_cost_brl: 0.15 
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
 *
 * Actor padrão: viralanalyzer/reclameaqui-scraper
 * Docs: https://apify.com/viralanalyzer/reclameaqui-scraper
 *
 * Input esperado pelo actor:
 *   companies: string[]   — slugs das empresas (ex: ["nubank", "itau"])
 *   maxComplaints: number  — máximo por empresa (default 20, max 100)
 *   includeCompanyStats: boolean — inclui score, response rate, etc.
 *   statusFilter?: string  — "all" | "Respondida" | "Não respondida" | etc.
 *
 * Output do actor (por item):
 *   complaint_id, company_slug, title, description, status, category,
 *   created_at, updated_at, author, city, state, rating, is_resolved,
 *   company_response, response_time_hours, views, url, company_score, etc.
 */
export async function fetchReclameAquiComplaints(companySlug: string, limit = 20, ctx?: ApifyContext, actorId?: string): Promise<any[]> {
  const token = getApifyToken()
  if (!token) throw new Error('APIFY_TOKEN não configurado')

  // Actor correto da comunidade Apify — o anterior 'apify~reclame-aqui-scraper' não existe (404)
  // A API do Apify requer o separador '~' em vez de '/' para resolver o ator.
  const rawActor = actorId || 'viralanalyzer~reclameaqui-scraper'
  const actor = rawActor.replace('/', '~')

  try {
    const raTimeoutSecs = 300 // 5 minutos para o Reclame Aqui superar Cloudflare
    const raMemoryMb = 1024   // 1GB de RAM é necessário para o Chrome no container da Apify

    const response = await axios.post(
      `https://api.apify.com/v2/acts/${actor}/run-sync-get-dataset-items?token=${token}&timeout=${raTimeoutSecs}&memory=${raMemoryMb}`,
      {
        companies: [companySlug],
        maxComplaints: Math.min(limit, 100), // API limita em 100
        includeCompanyStats: false, // Não precisamos de stats — só reclamações
        statusFilter: 'all',
      },
      { timeout: (raTimeoutSecs + 30) * 1000 }
    )

    const items = response.data as any[]
    
    // Verificar se a Apify retornou um objeto de diagnóstico (ex: soft-deadline ou erro de proxy)
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
        estimated_cost_brl: 0.25 
      })
    }

    // Mapear output do actor viralanalyzer para o formato que o conector espera
    return items.map(item => ({
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
  options: { filterByDatePeriod?: string; sortBy?: 'recency' | 'relevancy' } = {}
): Promise<any[]> {
  const token = getApifyToken()
  if (!token) throw new Error('APIFY_TOKEN não configurado nas variáveis de ambiente')
  const sanitizedDomain = domain.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0]

  const actorId = 'pear_fight~trustpilot-scraper'
  const timeoutSecs = 180 // Máximo 3 minutos para Trustpilot
  
  console.log(`[Apify] Chamando scraper para ${domain}...`)

  let runId = ''
  try {
    console.log(`[Apify] Iniciando execução do robô para ${domain}...`)
    const runResponse = await axios.post(
      `https://api.apify.com/v2/acts/${actorId}/runs?token=${token}&timeout=${timeoutSecs}&memory=1024`,
      { 
        companyUrls: [
          `https://www.trustpilot.com/review/${sanitizedDomain}`
        ],
        maxReviews: limit
      }
    )

    runId = runResponse.data.data.id
    const datasetId = runResponse.data.data.defaultDatasetId
    console.log(`[Apify] Robô iniciado (RunID: ${runId}). Aguardando conclusão...`)

    // Polling rigoroso (máximo 4 minutos no total para dar margem ao timeout da Apify)
    let finished = false
    let attempts = 0
    const maxAttempts = 48 // 48 * 5s = 240s (4 min)
    
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
      // Tenta abortar o robô que ficou travado para economizar créditos
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
        estimated_cost_brl: 0.10
      })
    }

    return items
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
          links: [{ rel: 'self', href: item.reviewUrl || item.url || `https://www.trustpilot.com/review/${sanitizedDomain}` }]
        }
      })
  } catch (error: any) {
    if (runId && !error.message?.includes('abortado')) {
      // Em caso de qualquer erro inesperado, tenta abortar para garantir
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
  try {
    const response = await axios.post(
      `https://api.apify.com/v2/acts/apify~facebook-reviews-scraper/run-sync-get-dataset-items?token=${token}&timeout=${DEFAULT_TIMEOUT_SECS}&memory=${DEFAULT_MEMORY_MB}`,
      { startUrls: [{ url: pageUrl }], maxResults: limit },
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
      `https://api.apify.com/v2/acts/apify~instagram-mention-scraper/run-sync-get-dataset-items?token=${token}&timeout=${DEFAULT_TIMEOUT_SECS}&memory=${DEFAULT_MEMORY_MB}`,
      { usernames: [cleanUsername], limit },
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
      `https://api.apify.com/v2/acts/apify~instagram-hashtag-scraper/run-sync-get-dataset-items?token=${token}&timeout=${DEFAULT_TIMEOUT_SECS}&memory=${DEFAULT_MEMORY_MB}`,
      { hashtags: [tag], resultsLimit: limit },
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
