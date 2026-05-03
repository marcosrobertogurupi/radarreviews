import 'dotenv/config'
import axios from 'axios'

async function testSaswave() {
  const token = process.env['APIFY_TOKEN']
  if (!token) {
    console.error('Erro: APIFY_TOKEN não encontrado no .env')
    return
  }

  const actorId = 'saswave~trustpilot-company-infos'
  const input = {
    domains: ["www.google.com", "www.youtube.com"],
    str_domains: "www.google.com,www.youtube.com,apple.com"
  }

  console.log(`[Teste] Iniciando robô ${actorId}...`)

  try {
    const runResponse = await axios.post(
      `https://api.apify.com/v2/acts/${actorId}/runs?token=${token}`,
      input
    )

    const runId = runResponse.data.data.id
    console.log(`[Teste] Robô iniciado! RunID: ${runId}. Aguardando conclusão...`)

    let finished = false
    while (!finished) {
      await new Promise(r => setTimeout(r, 5000))
      const statusCheck = await axios.get(`https://api.apify.com/v2/actor-runs/${runId}?token=${token}`)
      const status = statusCheck.data.data.status
      console.log(`[Status] ${status}...`)
      if (status === 'SUCCEEDED') finished = true
      if (['FAILED', 'ABORTED', 'TIMED-OUT'].includes(status)) {
        throw new Error(`Robô falhou com status: ${status}`)
      }
    }

    const datasetId = (await axios.get(`https://api.apify.com/v2/actor-runs/${runId}?token=${token}`)).data.data.defaultDatasetId
    const itemsResponse = await axios.get(`https://api.apify.com/v2/datasets/${datasetId}/items?token=${token}`)
    
    console.log('\n=== RESULTADO DO TESTE ===')
    console.log(JSON.stringify(itemsResponse.data, null, 2))
    console.log('==========================\n')

  } catch (err: any) {
    console.error('Erro no teste:', err.response?.data || err.message)
  }
}

testSaswave()
