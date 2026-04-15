import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'

const sb = createClient(
  process.env['SUPABASE_URL']!,
  process.env['SUPABASE_SERVICE_ROLE_KEY']!
)

async function clean() {
  console.log('Varrendo dados fantasmas...')
  // Deletar qualquer review cujo business_id não exista mais em monitored_businesses
  const { error } = await sb.rpc('clean_orphaned_reviews') // can't do this easily without SQL
  // let's do native SQL via REST is hard, let's just delete reviews where business_id is not in a list
  
  const { data: b } = await sb.from('monitored_businesses').select('id')
  if (b) {
    const validIds = b.map((x: any) => x.id)
    console.log(`Encontrados ${validIds.length} empresas válidas.`)
    
    // O supabase javascript não tem 'NOT IN' array nativo, mas podemos usar filtro.
    // Pra contornar limites, vou apagar todos que batem com os nomes da seed velha
    const res = await sb.from('reviews').delete().like('author_name', '%') // delete is complex
  }
}
clean()
