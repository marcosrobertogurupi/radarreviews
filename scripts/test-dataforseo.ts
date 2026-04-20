import 'dotenv/config'
import { tripadvisorSearchTask, tripadvisorReviewsTaskGet, tripadvisorReviewsTaskPost } from '../src/lib/dataforseo.js'

async function testDataForSEO() {
  console.log('📡 Testando integração DataForSEO (TripAdvisor)...')

  try {
    // 1. Teste de Busca (Onboarding)
    console.log('\n--- Teste 1: Busca de Hotel (Onboarding) ---')
    const hotel = "Hotel Fasano"
    const city = "Rio de Janeiro"
    const searchRes = await tripadvisorSearchTask(hotel, city, "test_onboarding")
    console.log('✅ Task submetida:', searchRes.tasks?.[0]?.id)
    
    const taskId = searchRes.tasks?.[0]?.id
    if (taskId) {
      console.log('⏳ Aguardando resultado da busca (20s)...')
      await new Promise(r => setTimeout(r, 20000))
      
      const getRes = await tripadvisorReviewsTaskGet(taskId)
      const item = getRes.tasks?.[0]?.result?.[0]
      if (item?.url_path) {
        console.log('✅ URL Path encontrado:', item.url_path)
        console.log('✅ Location ID:', item.location_id)
        
        // 2. Teste de Reviews
        console.log('\n--- Teste 2: Coleta de Reviews ---')
        const reviewTask = await tripadvisorReviewsTaskPost(item.url_path, "test_reviews")
        const reviewTaskId = reviewTask.tasks?.[0]?.id
        console.log('✅ Task de reviews submetida:', reviewTaskId)
        
        if (reviewTaskId) {
          console.log('⏳ Aguardando reviews (15s)...')
          await new Promise(r => setTimeout(r, 15000))
          
          const reviewsRes = await tripadvisorReviewsTaskGet(reviewTaskId)
          const reviews = reviewsRes.tasks?.[0]?.result?.[0]?.items ?? []
          console.log(`✅ Foram encontrados ${reviews.length} reviews críticos.`)
          if (reviews.length > 0) {
            console.log('Primeiro review:', {
              id: reviews[0].review_id,
              rating: reviews[0].rating?.value,
              text: reviews[0].text?.slice(0, 100) + '...'
            })
          }
        }
      } else {
        console.log('⚠️ Nenhum hotel encontrado ou task ainda em fila.')
      }
    }

  } catch (err) {
    console.error('❌ Erro no teste:', err instanceof Error ? err.message : String(err))
  }
}

testDataForSEO()
