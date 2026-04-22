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

    console.log(`[Apify] Passo 2: Buscando comentários em ${postUrls.length} posts...`)

    // 2. Pegar comentários desses posts
    const commentsResponse = await axios.post(
      `https://api.apify.com/v2/acts/apify~instagram-scraper/run-sync-get-dataset-items?token=${APIFY_TOKEN}`,
      {
        directUrls: postUrls,
        resultsType: 'comments',
        resultsLimit: limit
      },
      { timeout: 240000 }
    )

    const items = commentsResponse.data as any[]
    console.log(`[Apify] Coletados ${items.length} comentários para @${username}`)

    return items.map(item => ({
      id: item.id,
      text: item.text,
      ownerUsername: item.ownerUsername,
      timestamp: item.timestamp,
      shortCode: item.shortCode,
      url: `https://www.instagram.com/reels/${item.shortCode}/`
    }))

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[Apify] Erro ao coletar @${username}:`, msg)
    throw err
  }
}
