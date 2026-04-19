import { createClient } from '@supabase/supabase-js'
import 'dotenv/config'

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

async function forceDeleteConnector() {
  const id = '1343c078-5c17-4d2e-ae1a-5b450b6ab6a3' // O conector da Unimed que falhou
  console.log(`🧨 Tentando deletar conector ${id} diretamente...`)
  
  const { error } = await supabase
    .from('channel_connectors')
    .delete()
    .eq('id', id)
  
  if (error) {
    console.error('❌ Erro ao deletar:', error)
  } else {
    console.log('✅ Deletado com sucesso!')
  }
}

forceDeleteConnector()
