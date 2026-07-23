import axios from 'axios'
import { supabase } from '../../lib/supabase.js'
import { logger } from '../../lib/logger.js'
import { scrapeGoogleMapsReviews } from '../../connectors/google_maps/scraper.js'

/**
 * Busca estatísticas e reviews atualizadas de concorrentes no Google Maps
 * usando exatamente a mesma política de busca (API Nova + API Legada + Playwright Scraper fallback) do conector do assinante.
 */
export async function updateCompetitorStats(targetIdOrName?: string): Promise<{ updated: number; details: any[] }> {
  const apiKey = process.env['GOOGLE_MAPS_API_KEY']
  const results: any[] = []

  try {
    let query = supabase.from('competitor_businesses').select('id, place_id, name, business_id, tenant_id')
    if (targetIdOrName) {
      if (targetIdOrName.includes('-') && targetIdOrName.length === 36) {
        query = query.eq('id', targetIdOrName)
      } else {
        query = query.ilike('name', `%${targetIdOrName}%`)
      }
    }

    const { data: competitors } = await query

    if (!competitors || competitors.length === 0) {
      logger.info(`[benchmarking] Nenhum concorrente encontrado com filtro '${targetIdOrName || 'todos'}'.`)
      return { updated: 0, details: [] }
    }

    for (const comp of competitors) {
      try {
        let rating: number | null = null
        let reviewCount: number | null = null
        let fetchedReviews: Array<{ author?: string; rating?: number; text?: string; published_at?: string }> = []
        let strategyUsed = ''

        // 1. Tentar Places API (Nova) — Política Primária do Conector
        if (apiKey) {
          try {
            const urlNew = `https://places.googleapis.com/v1/places/${comp.place_id}`
            const resNew = await axios.get(urlNew, {
              headers: {
                'X-Goog-Api-Key': apiKey,
                'X-Goog-FieldMask': 'id,displayName,rating,userRatingCount,reviews'
              }
            })
            
            if (resNew.data && (resNew.data.rating || resNew.data.userRatingCount)) {
              rating = resNew.data.rating ?? null
              reviewCount = resNew.data.userRatingCount ?? null
              if (Array.isArray(resNew.data.reviews)) {
                fetchedReviews = resNew.data.reviews.map((r: any) => ({
                  author: r.authorAttribution?.displayName || 'Anônimo',
                  rating: r.rating,
                  text: r.text?.text || '',
                  published_at: r.publishTime
                }))
              }
              strategyUsed = 'places_api_v1_new'
            }
          } catch (errNew) {
            logger.warn(`[benchmarking] API Nova falhou para ${comp.name}, tentando API Legada:`, {
              error: errNew instanceof Error ? errNew.message : String(errNew)
            })
          }
        }

        // 2. Fallback: Places API (Legada) — Política Secundária do Conector
        if (apiKey && (rating == null || reviewCount == null)) {
          try {
            const urlOld = 'https://maps.googleapis.com/maps/api/place/details/json'
            const resOld = await axios.get(urlOld, {
              params: {
                place_id: comp.place_id,
                fields: 'rating,user_ratings_total,reviews',
                reviews_sort: 'newest',
                language: 'pt',
                key: apiKey
              }
            })

            const resData = resOld.data?.result
            if (resData && (resData.rating || resData.user_ratings_total)) {
              rating = rating ?? resData.rating ?? 0
              reviewCount = reviewCount ?? resData.user_ratings_total ?? 0
              if (fetchedReviews.length === 0 && Array.isArray(resData.reviews)) {
                fetchedReviews = resData.reviews.map((r: any) => ({
                  author: r.author_name || 'Anônimo',
                  rating: r.rating,
                  text: r.text || '',
                  published_at: r.time ? new Date(r.time * 1000).toISOString() : new Date().toISOString()
                }))
              }
              strategyUsed = strategyUsed ? `${strategyUsed}+api_old` : 'places_api_old'
            }
          } catch (errOld) {
            logger.warn(`[benchmarking] API Legada também falhou para ${comp.name}, tentando Playwright Scraper...`)
          }
        }

        // 3. Fallback final: Playwright Scraper — Terceira Política do Conector (Resiliência)
        if (rating == null || reviewCount == null) {
          try {
            logger.info(`[benchmarking] Executando scraper Playwright para concorrente ${comp.name}...`)
            const scraped = await scrapeGoogleMapsReviews(comp.place_id, { mode: 'scraping', place_id: comp.place_id, max_reviews: 20, since_days: 180 })
            if (scraped.length > 0) {
              fetchedReviews = scraped.map(r => ({
                author: r.author,
                rating: r.rating ?? undefined,
                text: r.text,
                published_at: r.scraped_at
              }))

              const validRatings = scraped.map(r => r.rating).filter((r): r is number => r != null)
              rating = validRatings.length > 0
                ? Number((validRatings.reduce((a, b) => a + b, 0) / validRatings.length).toFixed(1))
                : 4.5
              reviewCount = scraped.length
              strategyUsed = 'playwright_scraper'
            }
          } catch (errScraper) {
            logger.error(`[benchmarking] Playwright scraper falhou para ${comp.name}:`, {
              error: errScraper instanceof Error ? errScraper.message : String(errScraper)
            })
          }
        }

        const lastStats = {
          rating: rating ?? 0,
          review_count: reviewCount ?? 0,
          recent_reviews: fetchedReviews.slice(0, 5),
          strategy: strategyUsed || 'none',
          updated_at: new Date().toISOString()
        }

        await supabase
          .from('competitor_businesses')
          .update({
            last_stats: lastStats
          })
          .eq('id', comp.id)

        logger.info(`[benchmarking] Stats atualizadas com sucesso para ${comp.name}`, {
          rating: lastStats.rating,
          review_count: lastStats.review_count,
          strategy: lastStats.strategy
        })

        results.push({
          id: comp.id,
          name: comp.name,
          place_id: comp.place_id,
          stats: lastStats
        })
      } catch (err) {
        logger.error(`[benchmarking] Erro ao atualizar estatísticas de ${comp.name}:`, { error: err })
      }
    }
    return { updated: results.length, details: results }
  } catch (err) {
    logger.error('[benchmarking] Erro geral:', { error: err })
    return { updated: 0, details: [] }
  }
}


