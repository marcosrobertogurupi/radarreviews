import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import axios from 'axios'

dotenv.config()

const supabaseUrl = process.env.SUPABASE_URL || ''
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const supabaseAdmin = createClient(supabaseUrl, supabaseKey)

async function testSystemHealth() {
  console.log('--- Testando APENAS Alerta de Saúde do Sistema ---')
  
  const systemWebhook = process.env.N8N_SYSTEM_ALERTS_WEBHOOK
  
  if (!systemWebhook) {
    console.error('❌ N8N_SYSTEM_ALERTS_WEBHOOK não configurado no .env')
    return
  }

  // Buscar contatos reais do admin na tabela global
  const { data: sysSettings } = await supabaseAdmin
    .from('system_settings')
    .select('admin_whatsapp, admin_email')
    .eq('id', 'global')
    .single()

  console.log('Dados do Admin encontrados:', sysSettings)

  const payload = {
    event: 'system_health_alert',
    status: 'FALHA',
    channel: 'INSTAGRAM',
    business_name: 'Hotel Lago da Palma (TESTE)',
    message: 'Token de acesso expirado. Re-autenticação necessária.',
    timestamp: new Date().toISOString(),
    admin_url: 'https://reputei-admin.vercel.app/connectors',
    // Estes são os campos que estavam faltando:
    admin_whatsapp: sysSettings?.admin_whatsapp || '',
    admin_email: sysSettings?.admin_email || '',
    formatted_message: `⚠️ *ALERTA DE SAÚDE DO SISTEMA*\n\n🚨 *Falha Persistente:* O canal *INSTAGRAM* da empresa *Hotel Lago da Palma* está fora do ar há mais de 4 horas.\n\n*Erro:* Token de acesso expirado. Re-autenticação necessária.\n\nFavor verificar as credenciais no painel admin.`
  }
  
  console.log('Enviando payload para:', systemWebhook)
  
  try {
    const resp = await axios.post(systemWebhook, payload)
    console.log('✅ Alerta de sistema enviado com sucesso!')
    console.log('Resposta do n8n:', resp.status)
  } catch (err) {
    console.error('❌ Erro ao enviar alerta de sistema:', err instanceof Error ? err.message : err)
  }

  console.log('--- Fim do Teste ---')
}

testSystemHealth().catch(console.error)
