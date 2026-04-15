import 'dotenv/config'
import { supabase } from '../src/lib/supabase.js'

async function run() {
  console.log('Deletando review hotel ok...')
  await supabase.from('reviews').delete().like('body', '%Hotel ok%')
  console.log('Deletado com sucesso!')
}

run()
