import 'dotenv/config'
import axios from 'axios'

async function debugCasperJson() {
  const token = process.env['APIFY_TOKEN']
  if (!token) return

  const actorId = 'casper11515~trustpilot-reviews-scraper'
  const domain = 'superprof.com.br'

  try {
    console.log(`[Debug] Buscando o último dataset do robô ${actorId}...`)
    
    // Pegar a última execução bem-sucedida
    const runs = await axios.get(`https://api.apify.com/v2/acts/${actorId}/runs?token=${token}&limit=1&desc=1`)
    const lastRun = runs.data.data.items[0]
    const datasetId = lastRun.defaultDatasetId

    console.log(`[Debug] Dataset encontrado: ${datasetId}. Lendo o primeiro item...`)
    const itemsResponse = await axios.get(`https://api.apify.com/v2/datasets/${datasetId}/items?token=${token}&limit=1`)
    
    console.log('\n=== ESTRUTURA DO REVIEW (CASPER) ===')
    console.log(JSON.stringify(itemsResponse.data[0], null, 2))
    console.log('====================================\n')

  } catch (err: any) {
    console.error('Erro no debug:', err.message)
  }
}

debugCasperJson()
