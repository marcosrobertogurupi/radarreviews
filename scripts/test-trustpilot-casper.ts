import 'dotenv/config'
import axios from 'axios'

async function testCasperAsync() {
  const token = process.env['APIFY_TOKEN']
  if (!token) {
    console.error('Erro: APIFY_TOKEN não encontrado no .env')
    return
  }

  const actorId = 'casper11515~trustpilot-reviews-scraper'
  const domain = 'superprof.com.br'
  const limit = 5

  console.log(`[Teste] Iniciando robô ${actorId} para ${domain}...`)

  try {
    // 1. Iniciar execução
    const runResponse = await axios.post(
      `https://api.apify.com/v2/acts/${actorId}/runs?token=${token}`,
      { 
        companyWebsite: domain, 
        endAtPageNumber: 1, // apenas 1 página (~20 reviews)
        filterByDatePeriod: 'last3months',
        sortBy: 'recency'
      }
    )

    const runId = runResponse.data.data.id
    const datasetId = runResponse.data.data.defaultDatasetId
    console.log(`[Teste] Robô iniciado! RunID: ${runId}. Aguardando conclusão...`)

    // 2. Polling de status
    let finished = false
    let attempts = 0
    while (!finished && attempts < 20) {
      await new Promise(r => setTimeout(r, 5000))
      const statusCheck = await axios.get(`https://api.apify.com/v2/actor-runs/${runId}?token=${token}`)
      const status = statusCheck.data.data.status
      console.log(`[Status] ${status}...`)
      if (status === 'SUCCEEDED') {
        finished = true
      } else if (['FAILED', 'ABORTED', 'TIMED-OUT'].includes(status)) {
        throw new Error(`Robô falhou com status: ${status}`)
      }
      attempts++
    }

    if (!finished) {
      console.log('[Teste] O robô está demorando, mas vamos tentar ler o que ele já coletou...')
    }

    // 3. Buscar dados
    console.log(`[Teste] Buscando dados do dataset ${datasetId}...`)
    const itemsResponse = await axios.get(`https://api.apify.com/v2/datasets/${datasetId}/items?token=${token}`)
    const items = itemsResponse.data as any[]
    
    console.log('\n=== REVIEWS ENCONTRADOS ===')
    if (items.length === 0) {
      console.log('Nenhum review retornado.')
    } else {
      items.forEach((item, i) => {
        console.log(`${i+1}. [${item.rating || item.stars} estrelas] ${item.userName || item.authorName}: "${(item.text || item.content || '').substring(0, 100)}..."`)
      })
    }
    console.log('===========================\n')

  } catch (err: any) {
    console.error('Erro no teste:', err.response?.data || err.message)
  }
}

testCasperAsync()
