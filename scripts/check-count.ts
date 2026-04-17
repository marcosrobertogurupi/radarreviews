import { supabase } from '../src/lib/supabase.js'

async function check() {
  const { count } = await supabase.from('reviews').select('*', { count: 'exact', head: true })
  console.log('Total real no banco:', count)
}
check()
