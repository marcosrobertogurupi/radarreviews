import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import axios from 'axios'
import { checkAlerts } from '../src/lib/alerts.js'

dotenv.config()

const supabaseUrl = process.env.SUPABASE_URL || ''
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const supabaseAdmin = createClient(supabaseUrl, supabaseKey)

async function testBoth() {
  console.log('--- Testando Alerta de Assinante e Alerta de Sistema ---')
  
  const tenantId = '9882e497-3b31-4d05-a67f-156225d22566'
  
  // 1. Alerta de Assinante (Evento Crítico)
  console.log('1. Disparando Alerta de Assinante...')
  const { data: reviews } = await supabaseAdmin
    .from('reviews')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('sentiment', 'critical')
    .limit(1)

  if (reviews && reviews.length > 0) {
    const review = reviews[0]
    await checkAlerts([review] as any, review.business_id, review.channel as any)
    console.log('✅ Alerta de assinante enviado.')
  }

  // 2. Alerta de Sistema (Saúde do Sistema - Falha de Conector)
  console.log('2. Disparando Alerta de Sistema (Falha de Conector)...')
  const systemWebhook = process.env.N8N_SYSTEM_ALERTS_WEBHOOK
  
  if (!systemWebhook) {
    console.error('❌ N8N_SYSTEM_ALERTS_WEBHOOK não configurado no .env')
  } else {
    // Buscar contatos reais do admin para o teste ser fiel
    const { data: sysSettings } = await supabaseAdmin
      .from('system_settings')
      .select('admin_whatsapp, admin_email')
      .eq('id', 'global')
      .single()

    const payload = {
      event: 'system_health_alert',
      status: 'FALHA',
      channel: 'GOOGLE_MAPS',
      business_name: 'Confort Suites Hotel Goiania',
      message: 'Falha na autenticação: Token expirado ou inválido.',
      timestamp: new Date().toISOString(),
      admin_url: 'https://reputei-admin.vercel.app/connectors',
      admin_whatsapp: sysSettings?.admin_whatsapp || '',
      admin_email: sysSettings?.admin_email || '',
      formatted_message: `⚠️ *ALERTA DE SAÚDE DO SISTEMA*\n\n🚨 *Falha Persistente:* O canal *GOOGLE MAPS* da empresa *Confort Suites Hotel Goiania* está fora do ar há mais de 4 horas.\n\n*Erro:* Falha na autenticação: Token expirado ou inválido.\n\nFavor verificar as credenciais ou logs de sincronização no painel admin.`
    }
    
    try {
      await axios.post(systemWebhook, payload)
      console.log('✅ Alerta de sistema enviado.')
    } catch (err) {
      console.error('❌ Erro ao enviar alerta de sistema:', err instanceof Error ? err.message : err)
    }
  }

  console.log('--- Testes finalizados! Verifique seus workflows no n8n. ---')
}

testBoth().catch(console.error)
