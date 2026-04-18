import 'dotenv/config'
import { supabase } from '../src/lib/supabase.js'

async function check() {
  const { data: tenant } = await supabase
    .from('tenants')
    .select('id, name')
    .ilike('name', '%Confort%')
    .single()

  if (!tenant) {
    console.log('Tenant não encontrado')
    return
  }

  console.log(`\n--- DADOS PARA: ${tenant.name} (${tenant.id}) ---`)

  // 1. Total de reviews
  const { count: total } = await supabase
    .from('reviews')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenant.id)

  // 2. Sentimentos
  const { data: sentiments } = await supabase
    .from('reviews')
    .select('sentiment')
    .eq('tenant_id', tenant.id)

  const counts = { positive: 0, neutral: 0, negative: 0, critical: 0, unanalyzed: 0 }
  sentiments?.forEach(r => counts[r.sentiment as keyof typeof counts]++)

  // 3. Score médio
  const { data: scores } = await supabase
    .from('reviews')
    .select('dissatisfaction_score')
    .eq('tenant_id', tenant.id)
    .not('dissatisfaction_score', 'is', null)

  const avgScore = scores?.length ? Math.round(scores.reduce((a, b) => a + b.dissatisfaction_score, 0) / scores.length) : 0

  // 4. Canais
  const { data: channels } = await supabase
    .from('reviews')
    .select('channel')
    .eq('tenant_id', tenant.id)
  
  const channelCounts: any = {}
  channels?.forEach(r => channelCounts[r.channel] = (channelCounts[r.channel] || 0) + 1)

  console.log(`Total: ${total}`)
  console.log('Sentimentos:', counts)
  console.log(`Taxa Negativa/Crítica: ${total ? Math.round(((counts.negative + counts.critical) / total) * 100) : 0}%`)
  console.log(`Score Médio: ${avgScore}`)
  console.log('Canais:', channelCounts)
}

check()
