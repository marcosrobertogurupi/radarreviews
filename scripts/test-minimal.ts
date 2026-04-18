import 'dotenv/config'
import axios from 'axios'

const SUBSCRIBER_WEBHOOK = 'https://webhook.netservice.net.br/webhook/reputei-alertaassinante'

async function testMinimal() {
  console.log('📡 Testando Alerta ao Assinante (MINIMAL)...')
  const payload = {
    test: true,
    message: 'Teste minimalista para verificar conectividade do webhook de assinante.'
  }

  try {
    const res = await axios.post(SUBSCRIBER_WEBHOOK, payload, { timeout: 10000 })
    console.log('✅ Resposta:', res.status, res.data)
  } catch (err) {
    console.error('❌ Erro:', err instanceof Error ? err.message : String(err))
    if (axios.isAxiosError(err) && err.response) {
      console.error('Detalles error:', err.response.data)
    }
  }
}

testMinimal()
