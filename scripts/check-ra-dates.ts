import { createClient } from '@supabase/supabase-js'
import 'dotenv/config'

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

async function checkRaDates() {
  console.log('📅 Verificando datas brutas do Reclame Aqui...')
  
  const { data: reviews, error } = await supabase
    .from('reviews')
    .select('id, published_at, raw_data')
    .eq('channel', 'reclame_aqui')
    .order('published_at', { ascending: false })
    .limit(5)

  if (error) {
    console.error('❌ Erro:', error)
    return
  }

  reviews.forEach(r => {
    console.log(`--- Review ${r.id} ---`)
    console.log(`Data no DB (published_at): ${r.published_at}`)
    console.log(`Data de Coleta (created_at): ${r.created_at}`)
    console.log(`Data Bruta (raw_data.date): ${r.raw_data?.date}`)
    console.log(`Título: ${r.raw_data?.title}`)
  })
}

checkRaDates()
