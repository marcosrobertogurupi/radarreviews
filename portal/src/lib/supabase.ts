/// <reference types="vite/client" />
import { createClient } from '@supabase/supabase-js'

const supabaseUrl  = import.meta.env.VITE_SUPABASE_URL  as string | undefined
const supabaseKey  = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

if (!supabaseUrl || !supabaseKey) {
  document.body.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:center;height:100vh;background:#070b14;color:#f0f4ff;font-family:Inter,sans-serif;flex-direction:column;gap:12px">
      <strong style="font-size:18px">Erro de configuração</strong>
      <p style="color:#8892aa;font-size:14px">Variáveis de ambiente VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY não definidas.</p>
    </div>`
  throw new Error('Missing Supabase env vars: VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY')
}

// Usa anon key — RLS garante isolamento automático por tenant autenticado
export const supabase = createClient(supabaseUrl, supabaseKey, {
  realtime: {
    params: {
      eventsPerSecond: 10,
    },
  },
})

// ──────────────────────────────────────────────────────────────
// Tipos de dados
// ──────────────────────────────────────────────────────────────

export type SentimentType = 'positive' | 'neutral' | 'negative' | 'critical' | 'unanalyzed'

export type SourceChannel =
  | 'google_maps' | 'facebook' | 'instagram' | 'reclame_aqui'
  | 'consumidor_gov' | 'tripadvisor' | 'trustpilot' | 'reddit'

export interface Review {
  id: string
  tenant_id: string
  business_id: string
  channel: SourceChannel
  external_id: string
  rating?: number
  title?: string
  body?: string
  author_name?: string
  url?: string
  sentiment: SentimentType
  dissatisfaction_score?: number
  sentiment_topics?: string[]
  sentiment_summary?: string
  sentiment_result?: {
    sentiment: SentimentType
    dissatisfaction_score: number
    confidence: number
    topics: string[]
    summary: string
    alert_reason?: string
    method: 'gemini' | 'heuristic' | 'rating_only'
  }
  published_at: string
  monitored_businesses?: { name: string }
}

export interface AlertEvent {
  id: string
  rule_id: string
  business_id: string
  channel?: SourceChannel
  triggered_at: string
  notified: boolean
  detail: {
    condition_type?: string
    review_body_preview?: string
    review_author?: string
    review_url?: string
    review_sentiment?: string
    review_dissatisfaction_score?: number
    sentiment_summary?: string
    alert_reason?: string
    triggered_by_rule?: string
  }
  alert_rules?: { name: string; condition_type: string }
  monitored_businesses?: { name: string }
}

export interface Business {
  id: string
  tenant_id: string
  name: string
  cnpj?: string
}

export interface DailyStat {
  date: string
  total_reviews: number
  positive_count: number
  neutral_count: number
  negative_count: number
  unanalyzed_count: number
  avg_rating?: number
}
