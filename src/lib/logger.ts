// Logger estruturado para o Radar de Reviews
// Saída em JSON para facilitar indexação em ferramentas de monitoramento.
// Convenção: comentários e mensagens em português (time brasileiro).

type LogLevel = 'info' | 'warn' | 'error' | 'debug'

interface LogEntry {
  timestamp: string
  level: LogLevel
  message: string
  [key: string]: unknown
}

/**
 * Formata e imprime uma entrada de log em JSON.
 * Em produção, use uma ferramenta como Datadog, Logtail ou similar
 * para coletar os logs da saída padrão.
 */
function log(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...meta,
  }

  const output = JSON.stringify(entry)

  if (level === 'error') {
    console.error(output)
  } else if (level === 'warn') {
    console.warn(output)
  } else {
    console.log(output)
  }
}

/**
 * Logger estruturado singleton.
 * Uso:
 *   import { logger } from '../lib/logger'
 *   logger.info('Job iniciado', { connector_id: '...' })
 *   logger.error('Falha na API', { error, connector_id: '...' })
 */
export const logger = {
  /** Informações operacionais normais */
  info: (message: string, meta?: Record<string, unknown>) => log('info', message, meta),

  /** Avisos que não interrompem o fluxo mas merecem atenção */
  warn: (message: string, meta?: Record<string, unknown>) => log('warn', message, meta),

  /** Erros que interrompem ou degradam o fluxo */
  error: (message: string, meta?: Record<string, unknown>) => {
    // Serializar objetos Error corretamente
    if (meta?.['error'] instanceof Error) {
      const err = meta['error'] as Error
      meta = {
        ...meta,
        error: {
          message: err.message,
          name: err.name,
          stack: err.stack,
        },
      }
    }
    log('error', message, meta)
  },

  /** Informações de depuração — só ativas quando NODE_ENV=development */
  debug: (message: string, meta?: Record<string, unknown>) => {
    if (process.env['NODE_ENV'] === 'development') {
      log('debug', message, meta)
    }
  },
}
