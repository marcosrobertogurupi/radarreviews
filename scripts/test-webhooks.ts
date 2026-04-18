import 'dotenv/config'
import axios from 'axios'
import { logger } from '../src/lib/logger.js'

const SYSTEM_WEBHOOK = process.env.N8N_SYSTEM_ALERTS_WEBHOOK
const SUBSCRIBER_WEBHOOK = process.env.N8N_SUBSCRIBER_ALERTS_WEBHOOK

async function testWebhooks() {
  console.log('🚀 Iniciando teste de disparos de Webhook...\n')

  // 1. Teste Alerta ao Administrador
  if (SYSTEM_WEBHOOK) {
    console.log('📡 Testando Alerta ao ADM do Sistema...')
    const systemPayload = {
      event: 'system_health_alert',
      status: 'FALHA',
      channel: 'reclame_aqui',
      business_id: 'test-business-id',
      connector_id: 'test-connector-id',
      message: 'TESTE DE INTEGRAÇÃO: Falha simulada para validação do webhook do ADM.',
      is_auth_error: true,
      timestamp: new Date().toISOString(),
      admin_url: 'https://reputei-admin.vercel.app/connectors/test-connector-id',
      admin_whatsapp: '5563992420061',
      admin_email: 'marcosroberto_gurupi@hotmail.com'
    }

    try {
      await axios.post(SYSTEM_WEBHOOK, systemPayload, { timeout: 10000 })
      console.log('✅ Alerta ADM enviado com sucesso!\n')
    } catch (err) {
      console.error('❌ Falha ao enviar Alerta ADM:', err instanceof Error ? err.message : String(err), '\n')
    }
  } else {
    console.error('⚠️ N8N_SYSTEM_ALERTS_WEBHOOK não configurado no .env\n')
  }

  // 2. Teste Alerta ao Assinante
  if (SUBSCRIBER_WEBHOOK) {
    console.log('📡 Testando Alerta ao Assinante...')
    const subscriberPayload = {
      event_type: 'alert_triggered',
      rule_name: 'Alerta Crítico (Teste)',
      condition_type: 'critical_review',
      business_id: 'test-business-id',
      channel: 'google_maps',
      triggered_at: new Date().toISOString(),
      // Dados para o n8n saber para quem disparar (Contato do Assinante)
      subscriber_whatsapp: '5563992420061',
      subscriber_email: 'marcosroberto_gurupi@hotmail.com',
      // Contexto do review
      review: {
        external_id: 'test-review-id',
        channel: 'google_maps',
        rating: 1,
        author: 'Cliente de Teste',
        url: 'https://maps.google.com/test',
        published_at: new Date().toISOString(),
        body_preview: 'Péssimo atendimento, nunca mais volto! (TESTE DE WEBHOOK)',
      },
      sentiment_analysis: {
        sentiment: 'critical',
        dissatisfaction_score: 95,
        topics: ['atendimento', 'suporte_inexistente'],
        summary: 'Cliente extremamente insatisfeito com o atendimento.',
        alert_reason: 'Nota 1 com linguagem agressiva.',
        method: 'gemini',
      },
    }

    try {
      await axios.post(SUBSCRIBER_WEBHOOK, subscriberPayload, { timeout: 10000 })
      console.log('✅ Alerta Assinante enviado com sucesso!\n')
    } catch (err) {
      console.error('❌ Falha ao enviar Alerta Assinante:', err instanceof Error ? err.message : String(err), '\n')
    }
  } else {
    console.error('⚠️ N8N_SUBSCRIBER_ALERTS_WEBHOOK não configurado no .env\n')
  }

  console.log('🏁 Fim dos testes.')
}

testWebhooks().catch(err => {
  console.error('💥 Erro fatal no script de teste:', err)
  process.exit(1)
})
