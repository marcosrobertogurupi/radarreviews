import 'dotenv/config'
import { supabase } from '../src/lib/supabase.js'

async function chk() {
  const { data: revs, error } = await supabase.from('reviews').select('id, business_id, title').order('published_at', { ascending: false }).limit(5)
  if (error) console.error(error)
  console.log('Ultimos reviews:', revs)
}
chk()
