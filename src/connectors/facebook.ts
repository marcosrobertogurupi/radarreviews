import { logger } from '../lib/logger.js'
import { ingestReviews } from '../lib/ingest.js'
import { fetchFacebookReviews } from '../lib/apify.js'
import type { ChannelConnector, JobResult } from '../types/connector.js'
import { syncMetaSocial } from './facebook-instagram.js'
import type { NormalizedReview } from '../types/review.js'

/**
 * Ponto de entrada para o scheduler sincronizar o Facebook (Polling Fallback)
 */
export async function run(connector: ChannelConnector): Promise<JobResult> {
  const result: JobResult = {
    reviews_fetched: 0,
    reviews_new: 0,
    reviews_updated: 0,
  }

  const pageUrl = connector.external_id // Esperamos o URL da página aqui para a Apify

  try {
    // --- ESTRATÉGIA PRINCIPAL: APIFY (Não exige Login/Token) ---
    try {
      if (process.env['APIFY_TOKEN'] && pageUrl && pageUrl.startsWith('http')) {
        logger.info(`[facebook] Tentando coleta via Apify (Principal)`, { connector_id: connector.id, pageUrl })
        const apifyReviews = await fetchFacebookReviews(pageUrl, 20)
        
        if (apifyReviews.length > 0) {
          const normalized: NormalizedReview[] = apifyReviews.map(item => ({
            tenant_id: (connector as any).monitored_businesses?.tenant_id || '',
            business_id: connector.business_id,
            connector_id: connector.id,
            channel: 'facebook',
            external_id: item.id,
            body: item.text,
            rating: item.stars,
            author_name: item.author,
            published_at: new Date(item.publishedAt).toISOString(),
            url: item.url,
            sentiment: 'unanalyzed',
            raw_data: item
          }))

          const ingest = await ingestReviews(normalized, 'facebook', connector.id, connector.business_id)
          
          return {
            reviews_fetched: apifyReviews.length,
            reviews_new: ingest.reviews_new,
            reviews_updated: ingest.reviews_updated
          }
        }
      }
    } catch (apifyError) {
      logger.warn(`[facebook] Falha na Apify, tentando fallback para API Oficial...`, { 
        error: apifyError instanceof Error ? apifyError.message : String(apifyError) 
      })
    }

    // --- ESTRATÉGIA SECUNDÁRIA (FALLBACK): API OFICIAL (Graph API) ---
    logger.info(`[facebook] Iniciando sincronização via Graph API (Fallback)`, { business_id: connector.business_id })
    await syncMetaSocial(connector.business_id, 'facebook')
    
    return result
  } catch (err) {
    return {
      reviews_fetched: 0,
      reviews_new: 0,
      reviews_updated: 0,
      error: err instanceof Error ? err.message : String(err)
    }
  }
}
