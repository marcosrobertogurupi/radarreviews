import 'dotenv/config'
import { supabase } from '../src/lib/supabase.js'
import { analyzeSentiment } from '../src/lib/sentiment.js'
import { logger } from '../src/lib/logger.js'

async function reanalyze(reviewId: string) {
  logger.info(`Reanalisando review: ${reviewId}`)

  // 1. Buscar review
  const { data: review, error: fetchError } = await supabase
    .from('reviews')
    .select('*')
    .eq('id', reviewId)
    .single()

  if (fetchError || !review) {
    logger.error('Review não encontrado ou erro na busca:', fetchError)
    return
  }

  // 2. Forçar reanálise (ignorando campos existentes)
  // @ts-ignore
  review.sentiment = 'unanalyzed'
  
  const result = await analyzeSentiment(review as any)

  // 3. Atualizar no banco
  const { error: updateError } = await supabase
    .from('reviews')
    .update({
      sentiment: result.sentiment,
      dissatisfaction_score: result.dissatisfaction_score,
      sentiment_topics: result.topics,
      sentiment_summary: result.summary,
      sentiment_suggestion: result.action_suggestion,
      sentiment_result: result
    })
    .eq('id', reviewId)

  if (updateError) {
    logger.error('Erro ao atualizar review:', updateError)
  } else {
    logger.info('Review reanalisado e atualizado com sucesso!')
    console.log('\n--- NOVO RESULTADO ---')
    console.log(JSON.stringify({
      sentiment: result.sentiment,
      summary: result.summary,
      suggestion: result.action_suggestion
    }, null, 2))
  }
}

const id = '792a6bd9-3fb2-449c-be63-c729284e624a'
reanalyze(id)
