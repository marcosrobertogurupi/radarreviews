import axios from 'axios'

const APIFY_TOKEN = process.env['APIFY_TOKEN']

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
export async function fetchInstagramComments(username: string, limit = 50): Promise<ApifyInstagramComment[]> {
  if (!APIFY_TOKEN) throw new Error('APIFY_TOKEN não configurado')

  console.log(`[Apify] Passo 1: Buscando posts recentes de @${username}...`)

  try {
    // 1. Pegar os últimos posts usando a URL direta do perfil
    const profileUrl = `https://www.instagram.com/${username.replace('@', '')}/`
    const postsResponse = await axios.post(
      `https://api.apify.com/v2/acts/apify~instagram-scraper/run-sync-get-dataset-items?token=${APIFY_TOKEN}`,
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
      `https://api.apify.com/v2/acts/apify~instagram-comment-scraper/run-sync-get-dataset-items?token=${APIFY_TOKEN}`,
      {
        directUrls: postUrls,
        resultsLimit: limit
      },
      { timeout: 240000 }
    )

    const items = (commentsResponse.data as any[]).filter(item => !item.error && !item.requestErrorMessages)
    console.log(`[Apify] Coletados ${items.length} comentários válidos para @${username}`)

    if (items.length > 0) {
      console.log('[Apify] DEBUG - Estrutura do primeiro comentário real:', JSON.stringify(items[0], null, 2))
    }

    return items.map(item => {
      // Garantir que temos um ID (external_id). Tentar vários campos da Apify.
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

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[Apify] Erro ao coletar @${username}:`, msg)
    throw err
  }
}
