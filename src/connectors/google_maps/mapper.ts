import { subDays, subWeeks, subMonths, subYears, formatISO } from 'date-fns'
import type { RawGoogleReview } from './types.js'
import type { NormalizedReview } from '../../types/review.js'
import type { ChannelConnector } from '../../types/connector.js'

export function mapReviewToNormalized(
  raw: RawGoogleReview,
  connector: ChannelConnector
): NormalizedReview {
  const published_at = parseRelativeDate(raw.date_text)

  return {
    tenant_id: connector.tenant_id,
    business_id: connector.business_id,
    connector_id: connector.id,
    channel: 'google_maps',
    external_id: raw.id,
    published_at: published_at || raw.scraped_at,
    body: raw.text || '',
    author_name: raw.author,
    rating: raw.rating !== null ? raw.rating : undefined,
    sentiment: 'unanalyzed',
    url: `https://www.google.com/maps/place/?q=place_id:${raw.place_id}`,
    upvotes: raw.upvotes || 0,
    raw_data: raw as unknown as Record<string, unknown>
  }
}

/**
 * Converte strings de data relativa do Google Maps (PT-BR e EN) para ISO string aproximada.
 * Ex: "há 2 dias", "há 1 semana", "a month ago"
 */
function parseRelativeDate(dateText: string): string | null {
  if (!dateText) return null
  const text = dateText.toLowerCase().trim()
  const now = new Date()

  // Padrões PT-BR
  const ptPatterns: [RegExp, (n: number) => Date][] = [
    [/(\d+)\s*segundo/, (n) => now],
    [/(\d+)\s*minuto/, (n) => now],
    [/(\d+)\s*hora/, (n) => now],
    [/(\d+)\s*dia/, (n) => subDays(now, n)],
    [/(\d+)\s*semana/, (n) => subWeeks(now, n)],
    [/(\d+)\s*m[eê]s/, (n) => subMonths(now, n)],
    [/(\d+)\s*ano/, (n) => subYears(now, n)],
    [/uma?\s*semana/, (n) => subWeeks(now, 1)],
    [/um?\s*m[eê]s/, (n) => subMonths(now, 1)],
    [/um?\s*ano/, (n) => subYears(now, 1)],
    [/ontem/, (n) => subDays(now, 1)],
  ]

  // Padrões EN
  const enPatterns: [RegExp, (n: number) => Date][] = [
    [/(\d+)\s*second/, (n) => now],
    [/(\d+)\s*minute/, (n) => now],
    [/(\d+)\s*hour/, (n) => now],
    [/(\d+)\s*day/, (n) => subDays(now, n)],
    [/(\d+)\s*week/, (n) => subWeeks(now, n)],
    [/(\d+)\s*month/, (n) => subMonths(now, n)],
    [/(\d+)\s*year/, (n) => subYears(now, n)],
    [/a\s*week ago/, (n) => subWeeks(now, 1)],
    [/a\s*month ago/, (n) => subMonths(now, 1)],
    [/a\s*year ago/, (n) => subYears(now, 1)],
    [/yesterday/, (n) => subDays(now, 1)],
  ]

  const allPatterns = [...ptPatterns, ...enPatterns]

  for (const [pattern, subtractor] of allPatterns) {
    const match = text.match(pattern)
    if (match) {
      const n = parseInt(match[1] || '1', 10)
      return formatISO(subtractor(n))
    }
  }

  return null
}

/**
 * Calcula a diferença em dias aproximada a partir do texto de data do Google.
 */
export function getDaysDiff(dateText: string): number {
  const text = dateText.toLowerCase().trim()
  
  const patterns: [RegExp, number][] = [
    [/(\d+)\s*dia/, 1],
    [/(\d+)\s*day/, 1],
    [/(\d+)\s*semana/, 7],
    [/(\d+)\s*week/, 7],
    [/(\d+)\s*m[eê]s/, 30],
    [/(\d+)\s*month/, 30],
    [/(\d+)\s*ano/, 365],
    [/(\d+)\s*year/, 365],
    [/uma?\s*semana/, 7],
    [/a\s*week/, 7],
    [/um?\s*m[eê]s/, 30],
    [/a\s*month/, 30],
    [/um?\s*ano/, 365],
    [/a\s*year/, 365],
  ]

  for (const [pattern, multiplier] of patterns) {
    const match = text.match(pattern)
    if (match) {
      return parseInt(match[1] || '1', 10) * multiplier
    }
  }

  return 0
}
