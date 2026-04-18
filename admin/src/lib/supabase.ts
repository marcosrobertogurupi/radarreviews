/// <reference types="vite/client" />
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || ''
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY || ''

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ ERRO: Variáveis de ambiente do Supabase não encontradas no Vercel!')
  console.info('Por favor, adicione VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY nas Settings do Vercel.')
}

export const supabase = createClient(supabaseUrl || 'https://placeholder.supabase.co', supabaseKey || 'placeholder')

// ──────────────────────────────────────────────────────────────
// Tipos de dados vindos do Supabase
// ──────────────────────────────────────────────────────────────

export type SentimentType = 'positive' | 'neutral' | 'negative' | 'critical' | 'unanalyzed'

export type SourceChannel =
  | 'google_maps' | 'facebook' | 'instagram' | 'reclame_aqui'
  | 'consumidor_gov' | 'tripadvisor' | 'trustpilot' | 'reddit'

export interface Review {
  id: string
  tenant_id: string
  business_id: string
  connector_id: string
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
  sentiment_suggestion?: string
  sentiment_result?: {
    sentiment: SentimentType
    dissatisfaction_score: number
    confidence: number
    topics: string[]
    summary: string
    alert_reason?: string
    action_suggestion?: string
    method: 'gemini' | 'heuristic' | 'rating_only'
  }
  published_at: string
  // created_at pode não existir na tabela reviews (depende do schema real do banco)
  // usar published_at para ordenação de reviews
  monitored_businesses?: {
    name: string
  }
}

export interface AlertEvent {
  id: string
  rule_id: string
  business_id: string
  channel: SourceChannel
  triggered_at: string  // é 'triggered_at', não 'created_at'
  notified: boolean
  detail: {
    condition_type: string
    review_external_id: string
    review_channel: string
    review_rating?: number
    review_sentiment: string
    review_dissatisfaction_score?: number
    review_body_preview?: string
    review_author?: string
    review_url?: string
    review_published_at?: string
    triggered_by_rule: string
    sentiment_score?: number
    sentiment_topics?: string[]
    sentiment_summary?: string
    alert_reason?: string
    analysis_method?: string
  }
  alert_rules?: {
    name: string
    condition_type: string
  }
  monitored_businesses?: {
    name: string
  }
}

export interface Connector {
  id: string
  business_id: string
  channel: SourceChannel
  status: 'active' | 'paused' | 'error' | 'pending'
  external_id?: string
  last_sync_at?: string
  next_sync_at?: string
  error_message?: string
  error_count?: number
  first_error_at?: string
  is_auth_error?: boolean
  is_healing?: boolean
  last_healing_at?: string
  config: Record<string, unknown>
  created_at: string
  updated_at?: string
  monitored_businesses?: {
    name: string
    cnpj?: string
  }
}

export interface Business {
  id: string
  tenant_id: string
  name: string
  cnpj?: string
  website?: string
  created_at: string
}
export interface SyncJob {
  id: string
  connector_id: string
  status: 'pending' | 'running' | 'done' | 'failed'
  started_at: string
  finished_at?: string
  reviews_fetched: number
  reviews_new: number
  reviews_updated: number
  error_detail?: {
    message: string
    [key: string]: any
  }
}
