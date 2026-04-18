import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'

const sb = createClient(
  process.env['SUPABASE_URL']!,
  process.env['SUPABASE_SERVICE_ROLE_KEY']!
)

const NEW_WEBHOOK = 'https://webhook.netservice.net.br/webhook/reputei-alertaassinante'

async function updateWebhooks() {
  console.log('🔍 Buscando regras de alerta...')
  
  const { data: rules, error } = await sb
    .from('alert_rules')
    .select('id, name, notify_webhook')
  
  if (error) {
    console.error('❌ Erro ao buscar regras:', error.message)
    return
  }

  if (!rules || rules.length === 0) {
    console.log('ℹ️ Nenhuma regra encontrada para atualizar.')
    return
  }

  console.log(`Found ${rules.length} rules. Updating...`)

  for (const rule of rules) {
    console.log(`Updating rule: ${rule.name} (${rule.id})`)
    const { error: updateError } = await sb
      .from('alert_rules')
      .update({ notify_webhook: NEW_WEBHOOK })
      .eq('id', rule.id)
    
    if (updateError) {
      console.error(`  ❌ Erro ao atualizar regra ${rule.id}:`, updateError.message)
    } else {
      console.log(`  ✅ Sucesso!`)
    }
  }

  console.log('\n✨ Todas as regras foram atualizadas com o novo webhook.')
}

updateWebhooks().catch(console.error)
