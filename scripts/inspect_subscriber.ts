import { supabase } from '../src/lib/supabase.js'

async function checkAlertForReview1() {
  const extId = 'yhtMqStuadkBJP77'
  const { data: events } = await supabase
    .from('alert_events')
    .select('*')

  const matched = events?.filter(e => JSON.stringify(e.detail).includes(extId))
  console.log(`Alert events matching ext_id ${extId}:`, matched)
}

checkAlertForReview1().catch(console.error)
