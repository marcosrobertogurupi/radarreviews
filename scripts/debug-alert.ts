import 'dotenv/config'
import { supabase } from '../src/lib/supabase.js'
import { checkAlerts } from '../src/lib/alerts.js'
import type { NormalizedReview } from '../src/types/review.js'

async function debug() {
  console.log('🔍 Buscando a review problemática...')
  const { data: reviews } = await supabase
    .from('reviews')
    .select('*')
    .like('body', '%Absurdo! Serviço horrível%')

  if (!reviews || reviews.length === 0) {
    console.log('❌ Review não encontrada no banco.')
    return
  }

  const r = reviews[0]
  console.log('✅ Review encontrada:', { id: r.id, score: r.dissatisfaction_score, sentiment: r.sentiment, business: r.business_id })

  console.log('\n🔍 Buscando regras associadas para o Business:', r.business_id)
  const { data: rules } = await supabase
    .from('alert_rules')
    .select('*')
    .eq('business_id', r.business_id)
  
  if (!rules || rules.length === 0) {
    console.log('❌ Nenhuma regra de alerta encontrada para esta empresa.')
  } else {
    console.log(`✅ Foram encontradas ${rules.length} regras:`)
    rules.forEach(rule => {
      console.log(`  - ID: ${rule.id} | Tipo: ${rule.condition_type} | Canal: ${rule.channel} | Ativa: ${rule.is_active} | Threshold: ${rule.threshold}`)
      
      let passScore = false;
      if (rule.condition_type === 'critical_review') {
        passScore = (r.dissatisfaction_score ?? 0) >= (rule.threshold ?? 81);
        console.log(`    -> Avaliação critical_review: (Score=${r.dissatisfaction_score}) >= (Threshold=${rule.threshold}) ? = ${passScore}`)
      }
      if (rule.condition_type === 'negative_surge') {
        passScore = r.sentiment === 'negative' || r.sentiment === 'critical'
        console.log(`    -> Avaliação negative_surge: (Sentiment=${r.sentiment}) negative/critical ? = ${passScore}`)
      }
    })
  }

  console.log('\n🔍 Verificando se já existe um evento na tabela alert_events associado a este review...')
  const { data: events } = await supabase
    .from('alert_events')
    .select('*')
    .contains('detail', { review_external_id: r.external_id })
  
  if (events && events.length > 0) {
    console.log(`✅ Já existe(m) ${events.length} evento(s) de alerta para este review no banco!`)
    console.log(` Status notified (resolvido??): ${events[0].notified}`)
  } else {
    console.log('❌ Nenhum evento de alerta encontrado no banco para este review.')
  }
}

debug().catch(console.error)
