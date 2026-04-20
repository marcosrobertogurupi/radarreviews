import type { ChannelConnector, JobResult } from '../types/connector.js'
import { syncMetaSocial } from './facebook-instagram.js'

/**
 * Ponto de entrada para o scheduler sincronizar o Facebook (Polling Fallback)
 */
export async function run(connector: ChannelConnector): Promise<JobResult> {
  try {
    await syncMetaSocial(connector.business_id, 'facebook')
    return {
      reviews_fetched: 0, // A contagem real é feita no ingestReviews
      reviews_new: 0,
      reviews_updated: 0,
    }
  } catch (err) {
    return {
      reviews_fetched: 0,
      reviews_new: 0,
      reviews_updated: 0,
      error: err instanceof Error ? err.message : String(err)
    }
  }
}
