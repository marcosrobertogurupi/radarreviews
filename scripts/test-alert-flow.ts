import { supabase } from '../src/lib/supabase.js'
import { checkCriticalAlerts } from '../src/lib/critical-alerts-job.js'

async function runTest() {
  console.log('🚀 Iniciando teste de alerta crítico...')

  // 1. Garantir que o registro global de settings existe
  const { data: checkSettings } = await supabase.from('system_settings').select('*').eq('id', 'global')
  if (!checkSettings || checkSettings.length === 0) {
    console.log('📝 Criando registro global em system_settings...')
    await supabase.from('system_settings').insert({
      id: 'global',
      admin_whatsapp: '5563992420061',
      admin_email: 'marcos@reputei.com.br'
    }).then(() => console.log('✅ Global settings criadas.'));
  }
  const { data: settings } = await supabase.from('system_settings').select('*').eq('id', 'global').single()
  console.log('⚙️ Configurações Atuais:', settings)

  // 2. Buscar um tenant real
  const { data: tenant } = await supabase.from('tenants').select('id, name').limit(1).single()
  if (!tenant) {
    console.error('❌ Nenhum tenant encontrado para o teste.')
    return
  }

  // 3. Buscar um business desse tenant
  const { data: business } = await supabase.from('monitored_businesses').select('id').eq('tenant_id', tenant.id).limit(1).single()
  if (!business) {
    console.error('❌ Nenhum business encontrado para o teste.')
    return
  }

  console.log(`🏢 Usando Tenant: ${tenant.name} (${tenant.id})`)

  // 4. Inserir um review crítico "antigo"
  const pastDate = new Date()
  pastDate.setHours(pastDate.getHours() - 48)

  const { error: insError } = await supabase.from('reviews').insert({
    tenant_id: tenant.id,
    business_id: business.id,
    channel: 'google_maps',
    external_id: `test-id-${Date.now()}`,
    author_name: 'Marcos Teste Realtime',
    body: 'Este é um review de teste para validar o sistema de alertas em tempo real e n8n. O produto não chegou!',
    rating: 1,
    sentiment: 'critical',
    dissatisfaction_score: 95,
    published_at: pastDate.toISOString(),
    is_resolved: false,
    sentiment_summary: 'Reclamação grave sobre entrega.',
    sentiment_result: {
        alert_reason: 'Risco de processo judicial.',
        confidence: 0.99,
        method: 'gemini'
    }
  })

  if (insError) {
    console.error('❌ Erro ao inserir review de teste:', insError.message)
    return
  }

  console.log('✅ Review crítico de teste inserido com sucesso!')
  console.log('⏳ Aguardando 2 segundos para o Realtime processar no frontend...')
  await new Promise(r => setTimeout(r, 2000))

  // 5. Forçar a execução do Job de Alertas
  console.log('📡 Disparando Job de Alertas Críticos (Fluxo n8n)...')
  await checkCriticalAlerts()

  console.log('\n✨ Teste concluído!')
  console.log('👉 Verifique:')
  console.log('1. Seu Painel Admin (o review deve ter aparecido sozinho).')
  console.log('2. Seu WhatsApp/Email (se as variáveis do n8n e system_settings estiverem OK).')
}

runTest().catch(console.error)
