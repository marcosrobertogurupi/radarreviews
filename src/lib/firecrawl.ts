import axios from 'axios'
import { logger } from './logger.js'

export interface FirecrawlScrapeOptions {
  waitFor?: number
  timeout?: number
}

export interface FirecrawlScrapeResult {
  success: boolean
  html: string
  markdown?: string
  metadata?: Record<string, unknown>
}

/**
 * Obtém a chave de API do Firecrawl das variáveis de ambiente.
 */
export function getFirecrawlApiKey(): string | undefined {
  return process.env['FIRECRAWL_API_KEY']
}

/**
 * Verifica se o Firecrawl está ativado como 1ª opção de scraping para o canal especificado.
 * Por padrão, o Reclame Aqui usa Firecrawl como 1ª opção.
 * Expansível via variável de ambiente: FIRECRAWL_PRIMARY_CHANNELS="reclame_aqui,tripadvisor,trustpilot" ou FIRECRAWL_EXPAND_ALL=true
 */
export function isFirecrawlPrimary(channel: string): boolean {
  if (!getFirecrawlApiKey()) return false
  if (process.env['FIRECRAWL_EXPAND_ALL'] === 'true' || process.env['FIRECRAWL_EXPAND_ALL'] === '1') {
    return true
  }
  const configuredChannels = process.env['FIRECRAWL_PRIMARY_CHANNELS']
    ? process.env['FIRECRAWL_PRIMARY_CHANNELS'].split(',').map(c => c.trim().toLowerCase())
    : ['reclame_aqui']

  return configuredChannels.includes(channel.toLowerCase())
}

/**
 * Executa o scraping de uma URL utilizando a API do Firecrawl.
 * O Firecrawl executa a renderização JS em nuvem e contorna proteções de anti-bot (ex: Cloudflare).
 */
export async function scrapePageViaFirecrawl(
  url: string,
  options?: FirecrawlScrapeOptions
): Promise<FirecrawlScrapeResult> {
  const apiKey = getFirecrawlApiKey()
  if (!apiKey) {
    throw new Error('FIRECRAWL_API_KEY não está configurada nas variáveis de ambiente.')
  }

  logger.info('[firecrawl] Iniciando requisição de scraping', { url })

  try {
    const response = await axios.post(
      'https://api.firecrawl.dev/v1/scrape',
      {
        url,
        formats: ['html', 'markdown'],
        waitFor: options?.waitFor ?? 3000,
        timeout: options?.timeout ?? 30000,
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        timeout: (options?.timeout ?? 30000) + 5000,
      }
    )

    const data = response.data
    if (!data || data.success === false) {
      const errorMsg = data?.error ?? 'Resposta inválida da API Firecrawl'
      logger.warn('[firecrawl] Falha na resposta da API Firecrawl', { url, error: errorMsg })
      throw new Error(`Firecrawl API error: ${errorMsg}`)
    }

    const htmlData = data.data?.html ?? ''
    const markdownData = data.data?.markdown ?? ''
    const metadata = data.data?.metadata ?? {}

    logger.info('[firecrawl] Scraping concluído com sucesso', {
      url,
      htmlLength: htmlData.length,
      statusCode: metadata.statusCode,
    })

    return {
      success: true,
      html: htmlData,
      markdown: markdownData,
      metadata,
    }
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error)
    logger.error('[firecrawl] Erro ao chamar API do Firecrawl', { url, error: errMsg })
    throw error
  }
}
