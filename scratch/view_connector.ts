import 'dotenv/config'
import { supabase } from '../src/lib/supabase.js'

async function run() {
  const { data: business } = await supabase
    .from('monitored_businesses')
    .select('id, name')
    .ilike('name', '%Imperador%')
  
  if (!business || business.length === 0) {
    console.log('Empresa não encontrada.')
    return
  }

  const bizId = business[0].id
  console.log('Empresa:', business[0])

  const { data: connectors } = await supabase
    .from('channel_connectors')
    .select('*')
    .eq('business_id', bizId)

  console.log('Conectores:')
  console.log(JSON.stringify(connectors, null, 2))
}

run()
