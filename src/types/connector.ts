// Tipos de conectores e jobs de sincronização
// Espelham as tabelas channel_connectors e sync_jobs do Supabase

import type { SourceChannel } from './review.js'

/** Status possíveis de um conector — espelha o enum connector_status do banco */
export type ConnectorStatus = 'active' | 'paused' | 'error' | 'pending_auth' | 'running'

/** Status possíveis de um job — espelha o enum job_status do banco */
export type JobStatus = 'pending' | 'running' | 'done' | 'failed'

/**
 * Conector de canal — espelha a tabela channel_connectors com join em monitored_businesses.
 * O scheduler busca conectores ativos e passa para a função run() de cada conector.
 */
export interface ChannelConnector {
  /** UUID do conector */
  id: string
  /** UUID da empresa monitorada */
  business_id: string
  /** UUID do tenant (herdado de monitored_businesses) */
  tenant_id: string
  /** Canal de origem */
  channel: SourceChannel
  /** Status atual do conector */
  status: ConnectorStatus
  /**
   * ID externo da entidade na plataforma.
   * Google Maps: place_id | TripAdvisor: location_id
   * Trustpilot: business_unit_id | Facebook: page_id
   * Reddit: não usado (busca por keywords)
   */
  external_id: string | null
  /**
   * UUID do segredo no Supabase Vault.
   * Usado para canais OAuth (Facebook, Instagram, Reddit).
   * Nunca armazena o token diretamente.
   */
  vault_secret_id: string | null
  /**
   * Configurações específicas do canal.
   * Exemplos:
   * - { "interval_minutes": 1440 }
   * - { "keywords": ["marca", "produto"], "subreddits": ["r/brasil"] }
   * - { "feedback_keywords": ["ruim", "ótimo"] }
   */
  config: Record<string, unknown>
  /** Timestamp da última sincronização bem-sucedida */
  last_sync_at: string | null
  /** Timestamp agendado para a próxima sincronização */
  next_sync_at: string | null
  /** Mensagem do último erro, se houver */
  error_message: string | null
  /** Contador de erros consecutivos para autocura */
  error_count: number
  /** Timestamp do primeiro erro consecutivo */
  first_error_at: string | null
  /** Timestamp de criação do conector */
  created_at: string
  /** Timestamp da última atualização */
  updated_at: string
}

/**
 * Resultado retornado por cada chamada a run(connector).
 * O scheduler usa esse resultado para atualizar sync_jobs e channel_connectors.
 */
export interface JobResult {
  /** Total de reviews recebidos da API */
  reviews_fetched: number
  /** Reviews que não existiam no banco (novos) */
  reviews_new: number
  /** Reviews que já existiam e foram atualizados */
  reviews_updated: number
  /** Mensagem de erro, se o job falhou */
  error?: string
  /** Tipo do erro para decidir estratégia de cura */
  error_type?: 'transient' | 'fatal'
  /** Sinaliza se é um erro que exige nova autenticação */
  is_auth_error?: boolean
}
