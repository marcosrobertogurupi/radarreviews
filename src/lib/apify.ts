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

  console.log(`[Apify] Iniciando coleta para @${username}...`)

  try {
    // 1. Disparar o Actor (Instagram Scraper)
    // Usamos o endpoint "run-sync" que espera o robô terminar e já devolve o dataset
    const response = await axios.post(
      `https://api.apify.com/v2/acts/apify~instagram-scraper/run-sync-get-dataset-items?token=${APIFY_TOKEN}`,
      {
        usernames: [username],
        resultsType: 'comments',
        resultsLimit: limit,
        searchType: 'hashtag', // No caso de comentários, ele vai pelo username
        searchLimit: 1
      },
      { timeout: 300000 } // 5 minutos de timeout (robôs demoram)
    )

    const items = response.data as any[]
    console.log(`[Apify] Coletados ${items.length} itens para @${username}`)

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
