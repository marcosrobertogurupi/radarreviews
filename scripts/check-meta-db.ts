import { createClient } from '@supabase/supabase-js'
import 'dotenv/config'

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function checkConnector() {
  const businessId = '1b61aa21-983d-493d-a1ae-cede69cc85c9'
  console.log(`🔎 Verificando conectores para o business_id: ${businessId}`)

  const { data, error } = await supabase
    .from('channel_connectors')
    .select('*')
    .eq('business_id', businessId)

  if (error) {
    console.error('❌ Erro ao buscar:', error)
    return
  }

  if (data && data.length > 0) {
    console.log('✅ Conectores encontrados:')
    data.forEach(c => {
      console.log(`- Canal: ${c.channel}, Status: ${c.status}, Page: ${c.fb_page_name || 'N/A'}`)
    })
  } else {
    console.log('❌ Nenhum conector encontrado para este ID.')
  }
}

checkConnector()
