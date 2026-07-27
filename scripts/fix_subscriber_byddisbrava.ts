import { supabase } from '../src/lib/supabase.js'
import { runSubscriberMonitorJob } from '../src/services/subscriber-monitor.js'

async function main() {
  console.log('=== FIX & BACKFILL PARA ASSINANTE BYD DISBRAVA ===\n')

  const tenantId = '97567770-b487-40e4-b3f7-4b49cc178f78'
  const email = 'byddisbrava@hotmail.com'

  // 1. Atualizar admin_email no tenant
  console.log(`1. Definindo admin_email = ${email} para tenant ${tenantId}...`)
  const { error: tUpdateErr } = await supabase
    .from('tenants')
    .update({ admin_email: email })
    .eq('id', tenantId)

  if (tUpdateErr) {
    console.error('❌ Erro ao atualizar tenant:', tUpdateErr.message)
  } else {
    console.log('✅ admin_email atualizado com sucesso!')
  }

  // 2. Zerar / Corrigir os alert_events que foram marcados erroneamente como notified=true
  console.log('\n2. Resetando status notified=false dos alertas da BYD Disbrava...')
  const { data: bizs } = await supabase
    .from('monitored_businesses')
    .select('id')
    .eq('tenant_id', tenantId)

  const bizIds = (bizs ?? []).map(b => b.id)

  if (bizIds.length > 0) {
    const { error: resetErr } = await supabase
      .from('alert_events')
      .update({ notified: false })
      .in('business_id', bizIds)

    if (resetErr) {
      console.error('❌ Erro ao resetar alert_events:', resetErr.message)
    } else {
      console.log('✅ Alertas da BYD Disbrava marcados novamente como PENDENTES (notified=false)!')
    }
  }

  // 3. Executar o Agente de Monitoramento de Assinantes
  console.log('\n3. Executando Agente de Monitoramento de Assinantes (runSubscriberMonitorJob)...')
  const result = await runSubscriberMonitorJob()
  console.log('✅ Resultado da execução do Agente:', result)

  // 4. Verificação final do review crítico (yhtMqStuadkBJP77)
  const extId = 'yhtMqStuadkBJP77'
  const { data: events } = await supabase
    .from('alert_events')
    .select('*')

  const matched = events?.filter(e => JSON.stringify(e.detail).includes(extId))
  console.log(`\n4. Verificação do Alerta do Review [${extId}]:`)
  if (matched && matched.length > 0) {
    console.log(`✅ ALERTA ENCONTRADO! ID: ${matched[0].id} | Notified (Pendente=false/Resolvido=true): ${matched[0].notified}`)
    console.log('   Detalhamento:', {
      rule_id: matched[0].rule_id,
      channel: matched[0].channel,
      triggered_at: matched[0].triggered_at,
      urgency: matched[0].detail?.urgency_level,
      reason: matched[0].detail?.alert_reason
    })
  } else {
    console.error('❌ Alerta ainda não foi gerado!')
  }
}

main().catch(console.error)
