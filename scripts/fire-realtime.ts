import { supabase } from '../src/lib/supabase.js'

async function run() {
  const newReview = {
    tenant_id: '9ff0a58c-131d-4633-ae65-a377d933cf26',
    business_id: '99e097c3-f16f-40d5-b6a3-453a75291c58',
    external_id: 'mock-realtime-' + Date.now(),
    channel: 'google_maps',
    rating: 5,
    author_name: 'Testador Realtime',
    body: 'Este é um review de teste para validar o Realtime sem refresh!',
    sentiment: 'positive',
    dissatisfaction_score: 0,
    sentiment_summary: 'Teste de atualização em tempo real bem sucedido.',
    published_at: new Date().toISOString()
  }

  console.log('🚀 Inserindo novo review...')
  const { error } = await supabase.from('reviews').insert([newReview])
  
  if (error) {
    console.error('❌ Erro ao inserir:', error.message)
  } else {
    console.log('✅ Review inserido! Verifique o Dashboard.')
  }
}

run()
