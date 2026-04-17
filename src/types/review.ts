// Tipos centrais do Radar de Reviews
// Todos os conectores devem produzir objetos NormalizedReview

/** Canais de coleta suportados — espelha o enum source_channel do banco */
export type SourceChannel =
  | 'google_maps'
  | 'facebook'
  | 'instagram'
  | 'reclame_aqui'
  | 'consumidor_gov'
  | 'tripadvisor'
  | 'trustpilot'
  | 'reddit'

/** Análise de sentimento de um review */
export type SentimentType = 'positive' | 'neutral' | 'negative' | 'critical' | 'unanalyzed'

/** Tópicos de problema detectados pela IA */
export type SentimentTopic =
  | 'atendimento'
  | 'produto'
  | 'cobrança'
  | 'entrega'
  | 'app_plataforma'
  | 'cancelamento'
  | 'dados_privados'
  | 'reembolso'
  | 'prazo'
  | 'suporte_inexistente'
  | 'cancelamento_nao_efetivado'
  | 'elogio'
  | 'outro'

/**
 * Resultado completo da análise de sentimento retornado pela IA.
 * Persistido em `reviews.sentiment_result` (jsonb).
 */
export interface SentimentResult {
  /** Classificação principal */
  sentiment: SentimentType
  /** Score de insatisfação: 0 (feliz) a 100 (furioso) */
  dissatisfaction_score: number
  /** Confiança da análise: 0.0 a 1.0 */
  confidence: number
  /** Tópicos detectados no review */
  topics: SentimentTopic[]
  /** Resumo executivo em 1 frase para o dashboard */
  summary: string
  /** Motivo do alerta — preenchido quando negative ou critical */
  alert_reason?: string
  /** Método de análise: 'gemini' | 'heuristic' | 'rating_only' */
  method: 'gemini' | 'heuristic' | 'rating_only'
}

/**
 * Modelo normalizado de review — saída de todo conector.
 * Mapeia diretamente para a tabela `reviews` no Supabase.
 */
export interface NormalizedReview {
  /** UUID do tenant (cliente SaaS) */
  tenant_id: string
  /** UUID da empresa monitorada */
  business_id: string
  /** UUID do conector que originou o review */
  connector_id: string
  /** Canal de origem */
  channel: SourceChannel
  /** ID original na plataforma — obrigatório, forma chave única com channel */
  external_id: string
  /** Nota de 0 a 5 — undefined para canais sem nota (Reddit, Consumidor.gov) */
  rating?: number
  /** Título do review — undefined se ausente */
  title?: string
  /** Corpo/texto do review — undefined se ausente */
  body?: string
  /** Nome do autor */
  author_name?: string
  /** ID do autor na plataforma externa */
  author_external_id?: string
  /** URL do review na plataforma */
  url?: string
  /** Código de idioma — padrão 'pt' */
  language?: string
  /** Tags para categorização */
  tags?: string[]
  /** Upvotes / votos positivos (Reddit, TripAdvisor) */
  upvotes?: number
  /** Quantidade de comentários (Reddit) */
  comment_count?: number
  /** Reclamação resolvida? (Reclame Aqui, Consumidor.gov) */
  is_resolved?: boolean
  /** Tempo de resposta em dias (Reclame Aqui, Consumidor.gov) */
  response_time_days?: number
  /** Sentimento — padrão 'unanalyzed' até ser processado pela IA */
  sentiment: SentimentType
  /** Score de insatisfação: 0 a 100 (preenchido após análise) */
  dissatisfaction_score?: number
  /** Tópicos detectados pela IA */
  sentiment_topics?: SentimentTopic[]
  /** Resumo gerado pela IA para o dashboard */
  sentiment_summary?: string
  /** Payload completo da análise (para auditoria e reprocessamento) */
  sentiment_result?: SentimentResult
  /** Data de publicação na plataforma — ISO 8601 obrigatório */
  published_at: string
  /** Payload bruto da API — nunca modificar, permite reprocessamento */
  raw_data: Record<string, unknown>
}
