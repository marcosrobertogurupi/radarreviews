import type { SourceChannel, SentimentType } from './supabase'

// ──────────────────────────────────────────────────────────────
// Utilitários de formatação e exibição
// ──────────────────────────────────────────────────────────────

export const CHANNEL_LABELS: Record<SourceChannel, string> = {
  google_maps: 'Google Maps',
  facebook: 'Facebook',
  instagram: 'Instagram',
  reclame_aqui: 'Reclame Aqui',
  consumidor_gov: 'Consumidor.gov',
  tripadvisor: 'TripAdvisor',
  trustpilot: 'Trustpilot',
  reddit: 'Reddit',
}

export const CHANNEL_ICONS: Record<SourceChannel, string> = {
  google_maps: '🗺️',
  facebook: '📘',
  instagram: '📸',
  reclame_aqui: '📣',
  consumidor_gov: '🏛️',
  tripadvisor: '✈️',
  trustpilot: '⭐',
  reddit: '🔴',
}

export const SENTIMENT_LABELS: Record<SentimentType, string> = {
  positive: 'Positivo',
  neutral: 'Neutro',
  negative: 'Negativo',
  critical: 'Crítico',
  unanalyzed: 'Não analisado',
}

export const SENTIMENT_COLORS: Record<SentimentType, string> = {
  positive: '#10b981',
  neutral: '#f59e0b',
  negative: '#ef4444',
  critical: '#dc2626',
  unanalyzed: '#6b7280',
}

export const SENTIMENT_BG: Record<SentimentType, string> = {
  positive: 'rgba(16,185,129,0.15)',
  neutral: 'rgba(245,158,11,0.15)',
  negative: 'rgba(239,68,68,0.15)',
  critical: 'rgba(220,38,38,0.2)',
  unanalyzed: 'rgba(107,114,128,0.15)',
}

export const TOPIC_LABELS: Record<string, string> = {
  atendimento: 'Atendimento',
  produto: 'Produto',
  cobrança: 'Cobrança',
  entrega: 'Entrega',
  app_plataforma: 'App / Plataforma',
  cancelamento: 'Cancelamento',
  dados_privados: 'Dados Privados',
  reembolso: 'Reembolso',
  elogio: 'Elogio',
  outro: 'Outro',
}

export function formatDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function timeAgo(iso: string): string {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (seconds < 60) return 'agora mesmo'
  if (seconds < 3600) return `${Math.floor(seconds / 60)}min atrás`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h atrás`
  return `${Math.floor(seconds / 86400)}d atrás`
}

export function scoreToEmoji(score: number): string {
  if (score >= 81) return '🚨'
  if (score >= 56) return '🔴'
  if (score >= 31) return '🟡'
  return '🟢'
}

export function ratingStars(rating: number): string {
  return '★'.repeat(Math.round(rating)) + '☆'.repeat(5 - Math.round(rating))
}
