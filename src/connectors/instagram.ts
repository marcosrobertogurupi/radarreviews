import type { ChannelConnector, JobResult } from '../types/connector.js'
import { syncMetaSocial } from './facebook-instagram.js'
import { runSocialListening } from '../services/social/social-listening.js'
import { supabase } from '../lib/supabase.js'

/**
 * Ponto de entrada para o scheduler sincronizar o Instagram
 */
export async function run(connector: ChannelConnector): Promise<JobResult> {
  try {
    // 1. Sincronização padrão (Meta API / Polling)
    await syncMetaSocial(connector.business_id, 'instagram')

    // 2. Social Listening (Apify - Menções e Hashtags)
    // Precisamos buscar o tenant_id para o Social Listening
    const { data: fullConnector } = await supabase
      .from('channel_connectors')
      .select('*, monitored_businesses(tenant_id)')
      .eq('id', connector.id)
      .single()

    const slResult = await runSocialListening(fullConnector)

    return {
      reviews_fetched: slResult.fetched,
      reviews_new: slResult.fetched,
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
