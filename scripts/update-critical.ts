import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'

const sb = createClient(
  process.env['SUPABASE_URL']!,
  process.env['SUPABASE_SERVICE_ROLE_KEY']!
)

const criticalIds = ['ra-001', 'ra-003', 'cg-001', 'fb-001']

const { data, error } = await sb
  .from('reviews')
  .update({ sentiment: 'critical' })
  .in('external_id', criticalIds)
  .select('external_id, sentiment, dissatisfaction_score')

if (error) {
  console.error('Erro:', error.message)
} else {
  console.log(`✅ ${data?.length} reviews atualizados para critical:`)
  for (const r of data ?? []) {
    console.log(`   - ${r.external_id}: ${r.sentiment} (score ${r.dissatisfaction_score})`)
  }
}

const { data: all } = await sb.from('reviews').select('sentiment')
const dist: Record<string, number> = {}
for (const r of all ?? []) dist[r.sentiment] = (dist[r.sentiment] || 0) + 1
console.log('\n📊 Distribuição final:')
for (const [s, n] of Object.entries(dist).sort()) {
  const e = s === 'critical' ? '🚨' : s === 'negative' ? '🔴' : s === 'neutral' ? '🟡' : '🟢'
  console.log(`   ${e} ${s}: ${n}`)
}

// Atualizar alertas para usar review_sentiment critical
const { data: alerts, error: ae } = await sb
  .from('alert_events')
  .select('id, detail')

if (!ae && alerts) {
  for (const alert of alerts) {
    if (criticalIds.includes(alert.detail?.review_external_id)) {
      await sb.from('alert_events').update({
        detail: { ...alert.detail, review_sentiment: 'critical' }
      }).eq('id', alert.id)
    }
  }
  console.log(`\n✅ ${alerts.filter(a => criticalIds.includes(a.detail?.review_external_id)).length} alertas atualizados`)
}

console.log('\n🎉 Dados finalizados! Atualize o painel em http://localhost:5173')
