import 'dotenv/config'
import { supabase } from '../src/lib/supabase.js'

async function fix() {
  // Set notified = false for that specific review alert
  const external_id = 'd70765d2-4731-4fe9-bbaa-2acdb016936e' // The ID from earlier
  
  // Update query where detail->review_external_id = external_id
  const { data: events } = await supabase
    .from('alert_events')
    .select('id, notified')
  
  if (events) {
    for (const e of events) {
      await supabase.from('alert_events').update({ notified: false }).eq('id', e.id)
    }
  }
  console.log('Todos os alertas foram marcados como Pendentes (notified = false)!')
}

fix()
