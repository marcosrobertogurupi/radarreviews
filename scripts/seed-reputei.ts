import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'

const sb = createClient(
  process.env['SUPABASE_URL']!,
  process.env['SUPABASE_SERVICE_ROLE_KEY']!
)

// Defina as empresas reais que quer monitorar para teste 
const REAIS = [
  {
    tenantName: 'Nubank Holding',
    name: 'Nubank',
    cnpj: '18236120000158',
    category: 'Finanças',
    connectors: [
      { channel: 'reclame_aqui', external_id: 'nubank' }
    ] // external_id geralmente é o slug no RA
  },
  {
    tenantName: 'Localiza Rent a Car',
    name: 'Localiza',
    cnpj: '16670085000155',
    category: 'Locação',
    connectors: [
      { channel: 'reclame_aqui', external_id: 'localiza-rent-a-car' },
    ]
  }
]

async function seedReais() {
  console.log('🏢 Cadastrando empresas REAIS para teste de alto volume...\n')

  for (const emp of REAIS) {
    // 1. Criar Tenant
    const slug = emp.name.toLowerCase().replace(/ /g, '-')
    let { data: t } = await sb.from('tenants').select('id').eq('slug', slug).single()
    
    if (!t) {
      const res = await sb.from('tenants').insert({
        name: emp.tenantName,
        slug: slug,
        plan: 'enterprise',
        is_active: true
      }).select('id').single()
      if (res.error) throw res.error
      t = res.data
    }
    console.log(`✅ Tenant: ${emp.tenantName} (${t.id})`)

    // 2. Criar Business
    let { data: b } = await sb.from('monitored_businesses').select('id').eq('cnpj', emp.cnpj).single()
    if (!b) {
      const res = await sb.from('monitored_businesses').insert({
        tenant_id: t.id,
        name: emp.name,
        cnpj: emp.cnpj,
        category: emp.category,
        is_active: true
      }).select('id').single()
      if (res.error) throw res.error
      b = res.data
    }
    console.log(`   └─ Business: ${emp.name}`)

    // 3. Criar Conectores reais (status 'active' para que os jobs comecem a buscar neles)
    for (const config of emp.connectors) {
      let { data: c } = await sb.from('channel_connectors')
        .select('id').eq('business_id', b.id).eq('channel', config.channel).single()
      
      if (!c) {
        const res = await sb.from('channel_connectors').insert({
          business_id: b.id,
          channel: config.channel,
          status: 'active',
          external_id: config.external_id,
          config: {} // sem config extra inicial
        }).select('id').single()
        if (res.error) throw res.error
        console.log(`      └─ Conector criado: ${config.channel} (${config.external_id})`)
      } else {
        console.log(`      └─ Conector existente: ${config.channel}`)
      }
    }
    
    // 4. Criar a regra de alerta para IA (Reclame Aqui)
    const { data: existingRule } = await sb.from('alert_rules')
      .select('id').eq('business_id', b.id).eq('channel', 'reclame_aqui').limit(1)

    if (!existingRule?.[0]) {
      const { error: ruleErr } = await sb.from('alert_rules').insert({
        tenant_id: t.id,
        business_id: b.id,
        name: `Review Crítico — IA (${emp.name})`,
        condition_type: 'critical_review',
        threshold: 70, // 70+ no score ativa o alerta
        is_active: true,
        channel: 'reclame_aqui',
        notify_webhook: null,
        notify_email: false,
      })
      if (ruleErr) console.log('       ⚠️ Erro ao criar regra:', ruleErr.message)
      else console.log('      └─ Regra de Alerta de IA criada!')
    }
    
    console.log('')
  }

  console.log('🎉 Setup finalizado! Agora conecte as automações de ingestão.')
  console.log('Para iniciar as coletas, basta rodar seu job/N8N para a tabela channel_connectors!')
}

seedReais().catch(console.error)
