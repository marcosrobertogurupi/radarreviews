import axios from 'axios'
import { supabase } from '../../lib/supabase.js'
import { logger } from '../../lib/logger.js'

/**
 * Busca estatísticas atualizadas de concorrentes no Google Maps
 */
export async function updateCompetitorStats(): Promise<void> {
  const apiKey = process.env['GOOGLE_MAPS_API_KEY']
  if (!apiKey) {
    logger.warn('[benchmarking] GOOGLE_MAPS_API_KEY não configurada.')
    return
  }

  try {
    const { data: competitors } = await supabase
      .from('competitor_businesses')
      .select('id, place_id, name')

    if (!competitors || competitors.length === 0) return

    for (const comp of competitors) {
      try {
        // Usando Places API (New) para pegar Rating e Review Count
        const url = `https://places.googleapis.com/v1/places/${comp.place_id}`
        const res = await axios.get(url, {
          headers: {
            'X-Goog-Api-Key': apiKey,
            'X-Goog-FieldMask': 'rating,userRatingCount'
          }
        })

        const { rating, userRatingCount } = res.data

        // Salvar estatísticas no cache (por enquanto usamos um JSON na tabela de concorrentes ou uma tabela nova)
        // Decidi adicionar colunas via migração rápida ou usar uma tabela de histórico se necessário.
        // Como o tempo é curto, vou salvar na própria tabela competitor_businesses (preciso adicionar as colunas)
        
        await supabase
          .from('competitor_businesses')
          .update({
            last_stats: {
              rating: rating || 0,
              review_count: userRatingCount || 0,
              updated_at: new Date().toISOString()
            }
          })
          .eq('id', comp.id)

        logger.info(`[benchmarking] Stats atualizadas para concorrente: ${comp.name}`)
      } catch (err) {
        logger.error(`[benchmarking] Erro ao buscar stats para ${comp.name}:`, { error: err })
      }
    }
  } catch (err) {
    logger.error('[benchmarking] Erro geral:', { error: err })
  }
}
