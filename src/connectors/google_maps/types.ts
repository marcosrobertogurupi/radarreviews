export interface GoogleMapsConfig {
  mode: 'scraping' | 'api'
  place_id: string
  max_reviews?: number        // default: 50
  since_days?: number         // default: 90 (reviews dos últimos 90 dias)
  delay_between_scrolls_ms?: number  // default: 1500
  use_scraper?: boolean       // Para controle fino no index.ts
}

export interface RawGoogleReview {
  id: string
  author: string
  rating: number | null
  date_text: string           // Ex: "há 2 dias", "há 1 semana"
  text: string
  place_id: string
  scraped_at: string          // ISO 8601
  upvotes?: number
}
