import axios from 'axios'

async function run() {
  const urls = [
    'https://webhook.netservice.net.br/webhook/reputei-alertaadmsystem',
    'https://webhook.netservice.net.br/webhook/reputei-system-health',
    'https://webhook.netservice.net.br/webhook/reputei-escalation'
  ]

  for (const url of urls) {
    console.log(`\nTesting URL: ${url}`)
    try {
      const resp = await axios.post(url, {
        test: true,
        message: 'Teste de ping para verificar se o endpoint existe no n8n'
      }, { timeout: 10000 })
      console.log(`Status: ${resp.status}`)
      console.log(`Response:`, JSON.stringify(resp.data))
    } catch (err: any) {
      console.log(`Error: ${err.message}`)
      if (err.response) {
        console.log(`Status: ${err.response.status}`)
        console.log(`Data:`, JSON.stringify(err.response.data))
      }
    }
  }
}

run()
