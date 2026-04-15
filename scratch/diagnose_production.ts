import { supabase } from '../src/lib/supabase.js'

async function run() {
  console.log('--- DIAGNÓSTICO DE DADOS ---')

  // 1. Verificar Business "Hotel Ideal Araguaina"
  const { data: businesses, error: bError } = await supabase
    .from('monitored_businesses')
    .select('id, name')
    .ilike('name', '%Hotel Ideal Araguaina%')

  if (bError) {
    console.error('Erro ao buscar business:', bError.message)
    return
  }

  if (!businesses || businesses.length === 0) {
    console.warn('Business não encontrado.')
  } else {
    const biz = businesses[0]
    console.log(`Encontrado: ${biz.name} (ID: ${biz.id})`)

    const { data: reviews, error: rError } = await supabase
      .from('reviews')
      .select('channel, id, external_id, rating')
      .eq('business_id', biz.id)

    if (rError) {
      console.error('Erro ao buscar reviews:', rError.message)
    } else {
      const counts = (reviews || []).reduce((acc: any, r: any) => {
        acc[r.channel] = (acc[r.channel] || 0) + 1
        return acc
      }, {})
      console.log('Contagem de Reviews no Banco:', counts)
      console.log('Total no Banco:', reviews?.length)

      // Verificar possível duplicata ou canais específicos
      const samples = reviews?.slice(0, 5)
      console.log('Exemplos de Reviews:', samples)
    }
  }

  // 2. Verificar Status dos Conectores Reddit e Reclame Aqui
  console.log('\n--- STATUS DOS CONECTORES ---')
  const { data: connectors, error: cError } = await supabase
    .from('channel_connectors')
    .select('channel, status, error_message, last_sync_at')
    .in('channel', ['reddit', 'reclame_aqui'])

  if (cError) {
    console.error('Erro ao buscar conectores:', cError.message)
  } else {
    console.table(connectors)
  }
}

run().catch(console.error)
