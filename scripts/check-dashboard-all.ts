import 'dotenv/config'
import { supabase } from '../src/lib/supabase.js'

async function check() {
  console.log(`\n--- DADOS PARA TODOS OS ASSINANTES ---`)

  // 1. Total de reviews
  const { count: total } = await supabase
    .from('reviews')
    .select('id', { count: 'exact', head: true })

  // 2. Sentimentos
  const { data: sentiments } = await supabase
    .from('reviews')
    .select('sentiment')

  const counts = { positive: 0, neutral: 0, negative: 0, critical: 0, unanalyzed: 0 }
  sentiments?.forEach(r => counts[r.sentiment as keyof typeof counts]++)

  // 3. Score médio
  const { data: scores } = await supabase
    .from('reviews')
    .select('dissatisfaction_score')
    .not('dissatisfaction_score', 'is', null)

  const avgScore = scores?.length ? Math.round(scores.reduce((a, b) => a + b.dissatisfaction_score, 0) / scores.length) : 0

  console.log(`Total: ${total}`)
  console.log('Sentimentos:', counts)
  console.log(`Taxa Negativa/Crítica: ${total ? Math.round(((counts.negative + counts.critical) / total) * 100) : 0}%`)
  console.log(`Score Médio: ${avgScore}`)
}

check()
