// Conector Reclame Aqui — Scraping via Playwright (headless Chromium)
// Documentação: https://www.reclameaqui.com.br
//
// IMPORTANTE: O Reclame Aqui bloqueia qualquer acesso sem User-Agent de browser real.
// Por isso, este conector usa o Playwright para controlar um Chromium headless real,
// que supera as proteções do Cloudflare e renderiza o JavaScript do Next.js.
//
// Estratégia de extração:
//   1. Navegar para /empresa/{slug}/lista-reclamacoes/
//   2. Extrair o JSON embutido em window.__NEXT_DATA__ (injeta dados via SSR do Next.js)
//   3. Se o __NEXT_DATA__ não tiver os dados, fazer scraping via seletores do DOM
//   4. Paginar via query string ?pagina=N até não houver mais resultados
//
// Variável de ambiente necessária: nenhuma (o slug fica em connector.external_id)
// O slug é o identificador da empresa no URL: /empresa/{slug}/lista-reclamacoes/
//
// Recursos:
//   - playwright-stealth: minimiza fingerprinting para evitar bloqueios
//   - Timeout configurável em connector.config.timeout_ms (padrão: 30000)
//   - Máximo de páginas configurável em connector.config.max_pages (padrão: 5)
//
// external_id ← complaint.id (ou hash do título + data se ID não estiver disponível)

import 'dotenv/config'
import { createHash } from 'node:crypto'
import { chromium } from 'playwright-core'
import { z } from 'zod'
import * as cheerio from 'cheerio'
import { ingestReviews } from '../lib/ingest.js'
import { fetchReclameAquiComplaints } from '../lib/apify.js'
import { getFirecrawlApiKey, scrapePageViaFirecrawl } from '../lib/firecrawl.js'
import { logger } from '../lib/logger.js'
import { closeBrowserSafely } from '../lib/browser.js'
import type { ChannelConnector, JobResult } from '../types/connector.js'
import type { NormalizedReview } from '../types/review.js'


// -----------------------------------------------------------------------------
// Constantes
// -----------------------------------------------------------------------------

const CHANNEL = 'reclame_aqui' as const
const BASE_URL = 'https://www.reclameaqui.com.br'
// User-Agent de Chrome real para evitar fingerprinting
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
const DEFAULT_TIMEOUT_MS = 30_000
const DEFAULT_MAX_PAGES = 5

// Seletores CSS da lista de reclamações (Next.js 13 app router)
// Estes seletores são baseados na estrutura atual do Reclame Aqui (2024-2025)
const SELECTORS = {
  // Container de cada item de reclamação na lista
  listItem: '[class*="ComplainStatus"]',
  // Título da reclamação (dentro do item)
  title: 'h4, [class*="title"], [class*="Title"]',
  // Data de criação
  date: 'time, [class*="date"], [class*="Date"], [class*="data"]',
  // Status (Resolvido, Em andamento, etc.)
  status: '[class*="status"], [class*="Status"], [class*="badge"], [class*="Badge"]',
  // Nome do autor
  author: '[class*="author"], [class*="Author"], [class*="user"], [class*="User"]',
  // Link para a reclamação completa
  link: 'a[href*="/reclamacao/"]',
}

// -----------------------------------------------------------------------------
// Schemas Zod para os dados extraídos
// -----------------------------------------------------------------------------

const ReclameAquiComplaintSchema = z.object({
  id: z.string().optional(),
  slug: z.string().optional(),
  title: z.string().min(1),
  description: z.string().optional(),
  status: z.string().optional(),
  author: z.string().optional(),
  date: z.string().optional(),
  url: z.string().optional(),
  // Dados numéricos do __NEXT_DATA__ quando disponíveis
  score: z.number().optional(),
  isResolved: z.boolean().optional(),
  // Rating derivado do status (para normalização)
  rating: z.number().min(1).max(5).optional(),
})

type ReclameAquiComplaint = z.infer<typeof ReclameAquiComplaintSchema>

// -----------------------------------------------------------------------------
// Função principal
// -----------------------------------------------------------------------------

async function runPlaywrightScraper(
  connector: ChannelConnector,
  slug: string,
  sanitizedSlug: string,
  timeoutMs: number,
  maxPages: number,
  scrapeStartedAt: number,
  MAX_SCRAPE_MS: number
): Promise<JobResult> {
  const result: JobResult = {
    reviews_fetched: 0,
    reviews_new: 0,
    reviews_updated: 0,
  }

  logger.info(`[${CHANNEL}] Iniciando scraping local (Principal)`, {
    connector_id: connector.id,
    slug,
    max_pages: maxPages,
  })

  let browser = null
  try {
    try {
      browser = await chromium.launch({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--disable-blink-features=AutomationControlled',
        ],
      })
    } catch (launchErr) {
      const msg = launchErr instanceof Error ? launchErr.message : String(launchErr)

      // EAGAIN / ENOMEM = pressão de recursos no container — erro transiente
      // que se resolve sozinho quando um slot de memória/processo libera.
      // Retornar imediatamente como transiente em vez de cair no fallback Apify
      // (que gasta créditos desnecessariamente e também pode falhar).
      const isResourceExhaustion = msg.includes('EAGAIN') || msg.includes('ENOMEM')
      if (isResourceExhaustion) {
        result.error = `Chromium launch falhou (recurso temporariamente indisponível): ${msg}`
        result.error_type = 'transient'
        logger.warn(`[${CHANNEL}] Chromium launch EAGAIN/ENOMEM — erro transiente, será retentado no próximo ciclo`, {
          connector_id: connector.id,
          slug,
          error: msg,
        })
        return result
      }

      const isMissingBinary =
        msg.includes("Executable doesn't exist") || msg.includes('ENOENT') || msg.includes('chrome-headless-shell')
      if (isMissingBinary) {
        result.error = `Playwright binary ausente (container desatualizado). Redeploy necessário. Detalhes: ${msg}`
        result.error_type = 'fatal'
        logger.error(`[${CHANNEL}] Playwright binary ausente — redeploy do container necessário`, {
          connector_id: connector.id,
          slug,
          error: msg,
        })
        return result
      }
      throw launchErr
    }

    const context = await browser.newContext({
      userAgent: USER_AGENT,
      locale: 'pt-BR',
      timezoneId: 'America/Sao_Paulo',
      viewport: { width: 1366, height: 768 },
    })

    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined })
    })

    const page = await context.newPage()
    page.setDefaultTimeout(timeoutMs)
    page.setDefaultNavigationTimeout(timeoutMs * 2)

    const allComplaints: ReclameAquiComplaint[] = []
    const urlsToTry = [
      `${BASE_URL}/empresa/${sanitizedSlug}/lista-reclamacoes/?pagina=1`,
      `${BASE_URL}/empresa/${sanitizedSlug}/`,
    ]

    for (let urlIdx = 0; urlIdx < urlsToTry.length; urlIdx++) {
      const isMainPage = urlIdx > 0
      const maxPagesThisSource = isMainPage ? 1 : maxPages

      for (let pageNum = 1; pageNum <= maxPagesThisSource; pageNum++) {
        if (Date.now() - scrapeStartedAt > MAX_SCRAPE_MS) {
          logger.warn(`[${CHANNEL}] Deadline interno (8min) atingido na paginação — seguindo com o que já foi coletado`, {
            connector_id: connector.id, coletadas: allComplaints.length,
          })
          break
        }
        const url = isMainPage
          ? urlsToTry[urlIdx]!
          : `${BASE_URL}/empresa/${sanitizedSlug}/lista-reclamacoes/?pagina=${pageNum}`

        logger.info(`[${CHANNEL}] Navegando`, { connector_id: connector.id, url })

        try {
          let gotoError: Error | null = null
          try {
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs * 2 })
          } catch (firstErr) {
            const errMsg = firstErr instanceof Error ? firstErr.message : String(firstErr)
            const isAborted = errMsg.includes('ERR_ABORTED') || errMsg.includes('net::ERR')
            if (isAborted) {
              logger.warn(`[${CHANNEL}] ERR_ABORTED na 1ª tentativa, aguardando 6s e tentando com waitUntil:load`, { url })
              await page.waitForTimeout(6000)
              try {
                await page.goto(url, { waitUntil: 'load', timeout: timeoutMs * 3 })
              } catch (retryErr) {
                gotoError = retryErr instanceof Error ? retryErr : new Error(String(retryErr))
              }
            } else {
              gotoError = firstErr instanceof Error ? firstErr : new Error(String(firstErr))
            }
          }

          if (gotoError) {
            const errMsg = gotoError.message
            if (pageNum === 1 && urlIdx === urlsToTry.length - 1) throw gotoError
            logger.warn(`[${CHANNEL}] Pulando URL após falha persistente`, { url, error: errMsg })
            break
          }

          await page.waitForTimeout(4000)

          const finalUrl = page.url()
          if (finalUrl !== url) {
            logger.info(`[${CHANNEL}] Redirecionado para`, { finalUrl })
          }

          const nextDataComplaints = await extractFromNextData(page, sanitizedSlug)

          if (nextDataComplaints.length > 0) {
            logger.info(`[${CHANNEL}] __NEXT_DATA__ extraiu ${nextDataComplaints.length}`, { url })
            allComplaints.push(...nextDataComplaints)
            if (nextDataComplaints.length < 10) {
              break
            }
            continue
          }

          const domComplaints = await extractFromDom(page, sanitizedSlug)

          if (domComplaints.length > 0) {
            logger.info(`[${CHANNEL}] DOM extraiu ${domComplaints.length}`, { url })
            allComplaints.push(...domComplaints)
            if (domComplaints.length < 5) break
            continue
          }

          logger.info(`[${CHANNEL}] Nenhuma reclamação na URL`, { url })
          break

        } catch (pageError) {
          logger.warn(`[${CHANNEL}] Erro ao processar`, {
            url,
            error: pageError instanceof Error ? pageError.message : String(pageError),
          })
          if (pageNum === 1 && urlIdx === urlsToTry.length - 1) throw pageError
        }
      }

      if (allComplaints.length > 0) break
    }

    result.reviews_fetched = allComplaints.length

    if (allComplaints.length === 0) {
      logger.info(`[${CHANNEL}] Nenhuma reclamação encontrada para ${sanitizedSlug}`)
      return result
    }

    const fetchBody = (connector.config['fetch_body'] as boolean) ?? true
    if (fetchBody) {
      const mainCompanyUrl = `${BASE_URL}/empresa/${sanitizedSlug}/`
      const toFetch = allComplaints.filter(c => c.url && c.url.startsWith('http') && c.url !== mainCompanyUrl)
      const MAX_BODY_FETCH = (connector.config['max_body_fetch'] as number) ?? 30
      const limitedToFetch = toFetch.slice(0, MAX_BODY_FETCH)

      if (limitedToFetch.length > 0) {
        logger.info(`[${CHANNEL}] Buscando corpo detalhado de ${limitedToFetch.length} reclamações para evitar texto cortado`)
        for (const complaint of limitedToFetch) {
          if (Date.now() - scrapeStartedAt > MAX_SCRAPE_MS) {
            logger.warn(`[${CHANNEL}] Deadline interno (8min) atingido na busca de corpo — seguindo para ingestão`, {
              connector_id: connector.id,
            })
            break
          }

          let detailContext = null
          try {
            detailContext = await browser.newContext({
              userAgent: USER_AGENT,
              locale: 'pt-BR',
              timezoneId: 'America/Sao_Paulo',
              viewport: { width: 1366, height: 768 },
              extraHTTPHeaders: {
                'accept-language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
                'sec-ch-ua': '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
                'sec-ch-ua-mobile': '?0',
                'sec-ch-ua-platform': '"Windows"',
              },
            })

            await detailContext.addInitScript(() => {
              Object.defineProperty(navigator, 'webdriver', { get: () => undefined })
            })

            const detailPage = await detailContext.newPage()
            detailPage.setDefaultTimeout(timeoutMs)

            await detailPage.goto(complaint.url!, { waitUntil: 'domcontentloaded', timeout: timeoutMs })
            await detailPage.waitForTimeout(2500)

            let title = await detailPage.title()
            if (title.toLowerCase().includes('moment') || title.toLowerCase().includes('verificação')) {
              await detailPage.waitForTimeout(4000)
              title = await detailPage.title()
            }

            const pageData = await detailPage.evaluate(() => {
              const nextEl = document.getElementById('__NEXT_DATA__')
              let nextBody: string | null = null
              let nextDate: string | null = null
              if (nextEl) {
                try {
                  const data = JSON.parse(nextEl.textContent ?? '')
                  const pp = data?.props?.pageProps
                  const c = pp?.complaint ?? pp?.initialData?.complaint ?? pp?.initialData?.complaintData ?? pp?.initialState?.complaint
                  if (c && (c.description || c.text)) {
                    nextBody = String(c.description ?? c.text ?? '')
                    nextDate = String(c.created ?? c.createdDate ?? c.date ?? c.data ?? c.createdAt ?? c.legacyComplaint?.created ?? c.legacyComplaint?.createdDate ?? '')
                  }
                } catch { }
              }

              const selectors = [
                '[data-testid="complaint-description"]',
                '[class*="description"]',
                '[class*="Description"]',
                '[class*="complaint-description"]',
                'p[class*="text"]',
                '.complain-body'
              ]

              let bodyText: string | null = null
              for (const sel of selectors) {
                const el = document.querySelector(sel)
                if (el && (el.textContent?.trim().length ?? 0) > 50) {
                  bodyText = el.textContent!.trim()
                  break
                }
              }

              let timeVal = document.querySelector('time[datetime]')?.getAttribute('datetime') ?? null
              if (!timeVal) {
                const allEls = Array.from(document.querySelectorAll('span, p, div, time, small'))
                for (const el of allEls) {
                  const txt = el.textContent?.trim() ?? ''
                  if (/(\d{2}\/\d{2}\/\d{2,4})|(há\s+\d+)/i.test(txt) && txt.length < 60) {
                    timeVal = el.getAttribute('datetime') ?? txt
                    break
                  }
                }
              }

              return {
                body: bodyText ?? nextBody,
                date: timeVal ?? nextDate,
              }
            })

            if (pageData.body && pageData.body.length > (complaint.description?.length ?? 0)) {
              complaint.description = pageData.body
            }
            if (pageData.date && !complaint.date) {
              complaint.date = pageData.date
            }
          } catch (err) {
            logger.warn(`[${CHANNEL}] Erro ao buscar detalhe da reclamação: ${complaint.url}`, { error: err })
          } finally {
            if (detailContext) {
              await detailContext.close().catch(() => {})
            }
          }

          await new Promise(r => setTimeout(r, 1000))
        }
      }
    }

    const normalized = allComplaints.map(c => normalize(c, connector))
    const ingest = await ingestReviews(
      normalized,
      CHANNEL,
      connector.id,
      connector.business_id
    )

    result.reviews_new = ingest.reviews_new
    result.reviews_updated = ingest.reviews_updated

    logger.info(`[${CHANNEL}] Job concluído`, {
      connector_id: connector.id,
      slug: sanitizedSlug,
      reviews_fetched: result.reviews_fetched,
      reviews_new: ingest.reviews_new,
    })
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error)
    result.error = errMsg
    const isTransient = errMsg.includes('ERR_ABORTED') || errMsg.includes('net::ERR') ||
      errMsg.includes('timeout') || errMsg.includes('Timeout') ||
      errMsg.includes('EAGAIN') || errMsg.includes('ENOMEM')
    result.error_type = isTransient ? 'transient' : 'fatal'
    logger.error(`[${CHANNEL}] Erro crítico no conector Playwright ${connector.id}`, {
      error,
      connector_id: connector.id,
      error_type: result.error_type,
    })
    throw error
  } finally {
    await closeBrowserSafely(browser)
  }

  return result
}

async function runApifyCollector(
  actorId: string | undefined,
  connector: ChannelConnector,
  slug: string
): Promise<JobResult> {
  logger.info(`[${CHANNEL}] Tentando coleta via Apify (Fallback 2 / Terciário)`, { connector_id: connector.id, slug, actorId })
  const ctx = { tenant_id: connector.tenant_id, connector_id: connector.id }
  const options = { since: connector.last_sync_at ?? undefined }
  const apifyComplaints = await fetchReclameAquiComplaints(slug, 20, ctx, actorId, options)
  
  if (apifyComplaints.length > 0) {
    const normalized = apifyComplaints.map(c => normalize(c, connector))
    const ingest = await ingestReviews(normalized, CHANNEL, connector.id, connector.business_id)
    
    return {
      reviews_fetched: apifyComplaints.length,
      reviews_new: ingest.reviews_new,
      reviews_updated: ingest.reviews_updated
    }
  }

  return {
    reviews_fetched: 0,
    reviews_new: 0,
    reviews_updated: 0
  }
}

export async function runFirecrawlCollector(
  connector: ChannelConnector,
  slug: string,
  sanitizedSlug: string
): Promise<JobResult> {
  logger.info(`[${CHANNEL}] Tentando coleta via Firecrawl (Fallback 1 / Secundário)`, {
    connector_id: connector.id,
    slug,
  })

  const targetUrl = `${BASE_URL}/empresa/${sanitizedSlug}/lista-reclamacoes/?pagina=1`
  
  let firecrawlResult
  try {
    firecrawlResult = await scrapePageViaFirecrawl(targetUrl, {
      waitFor: 3000,
      timeout: 30000,
    })
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err)
    logger.warn(`[${CHANNEL}] Chamada ao Firecrawl lançou exceção: ${errMsg}`, { connector_id: connector.id })
    return {
      reviews_fetched: 0,
      reviews_new: 0,
      reviews_updated: 0,
      error: `Firecrawl: ${errMsg}`,
      error_type: 'transient',
    }
  }

  if (!firecrawlResult.html || firecrawlResult.html.length === 0) {
    logger.warn(`[${CHANNEL}] Firecrawl retornou HTML vazio`, { connector_id: connector.id })
    return {
      reviews_fetched: 0,
      reviews_new: 0,
      reviews_updated: 0,
      error: 'Firecrawl: HTML vazio retornado',
      error_type: 'transient',
    }
  }

  // 1. Tentar extrair via __NEXT_DATA__ presente no HTML
  let complaints: ReclameAquiComplaint[] = []
  const nextDataMatch = firecrawlResult.html.match(/<script\s+id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i)
  if (nextDataMatch && nextDataMatch[1]) {
    complaints = parseNextDataJson(nextDataMatch[1], sanitizedSlug)
    if (complaints.length > 0) {
      logger.info(`[${CHANNEL}] Firecrawl: extraiu ${complaints.length} reclamações via __NEXT_DATA__`)
    }
  }

  // 2. Se __NEXT_DATA__ falhar ou vier vazio, tenta extração DOM via Cheerio
  if (complaints.length === 0) {
    complaints = parseDomFromHtmlString(firecrawlResult.html, sanitizedSlug)
    if (complaints.length > 0) {
      logger.info(`[${CHANNEL}] Firecrawl: extraiu ${complaints.length} reclamações via DOM HTML`)
    }
  }

  if (complaints.length === 0) {
    logger.warn(`[${CHANNEL}] Firecrawl: nenhuma reclamação encontrada na página HTML para ${sanitizedSlug}`)
    return {
      reviews_fetched: 0,
      reviews_new: 0,
      reviews_updated: 0,
    }
  }

  const normalized = complaints.map(c => normalize(c, connector))
  const ingest = await ingestReviews(normalized, CHANNEL, connector.id, connector.business_id)

  return {
    reviews_fetched: complaints.length,
    reviews_new: ingest.reviews_new,
    reviews_updated: ingest.reviews_updated,
  }
}

export async function run(connector: ChannelConnector): Promise<JobResult> {
  const result: JobResult = {
    reviews_fetched: 0,
    reviews_new: 0,
    reviews_updated: 0,
  }

  if (!connector.external_id) {
    result.error = `Conector ${connector.id} não tem external_id configurado (slug da empresa obrigatório).`
    return result
  }

  const slug = connector.external_id
  const timeoutMs = (connector.config['timeout_ms'] as number) ?? DEFAULT_TIMEOUT_MS
  const maxPages = (connector.config['max_pages'] as number) ?? DEFAULT_MAX_PAGES
  const sanitizedSlug = slug.trim().toLowerCase().replace(/\s+/g, '-')

  const scrapeStartedAt = Date.now()
  const MAX_SCRAPE_MS = 8 * 60_000

  // Quantas vezes consecutivas este conector já falhou?
  const previousErrorCount = (connector.error_count as number | null) ?? 0

  // 1. Tentar Playwright (Principal)
  let playwrightResult: JobResult | null = null
  let playwrightError: string | null = null

  try {
    playwrightResult = await runPlaywrightScraper(
      connector,
      slug,
      sanitizedSlug,
      timeoutMs,
      maxPages,
      scrapeStartedAt,
      MAX_SCRAPE_MS
    )
  } catch (playwrightErr: any) {
    playwrightError = playwrightErr instanceof Error ? playwrightErr.message : String(playwrightErr)
  }

  // Se o Playwright retornou resultado sem erro, usar direto
  if (playwrightResult && !playwrightResult.error) {
    return playwrightResult
  }

  // Unificar a mensagem de erro
  const pwMsg = playwrightError ?? playwrightResult?.error ?? 'Erro desconhecido no Playwright'
  const isResourceExhaustion = pwMsg.includes('EAGAIN') || pwMsg.includes('ENOMEM')
  const isTransientPw = isResourceExhaustion ||
    pwMsg.includes('ERR_ABORTED') || pwMsg.includes('net::ERR') ||
    pwMsg.includes('timeout') || pwMsg.includes('Timeout')

  // Se é o primeiro erro transiente (EAGAIN/ENOMEM) e NÃO há falhas anteriores,
  // retornar como transiente para dar ao Playwright uma chance no próximo ciclo.
  if (isTransientPw && previousErrorCount === 0) {
    logger.warn(
      `[${CHANNEL}] Playwright falhou com erro transiente (1ª vez) — será retentado no próximo ciclo`,
      { error: pwMsg, connector_id: connector.id }
    )
    result.error = pwMsg
    result.error_type = 'transient'
    return result
  }

  // 2. Fallback 1: Firecrawl (Secundário - se FIRECRAWL_API_KEY estiver configurada)
  const firecrawlApiKey = getFirecrawlApiKey()
  if (firecrawlApiKey) {
    logger.warn(
      `[${CHANNEL}] Playwright falhou (${pwMsg}). Ativando fallback Firecrawl...`,
      { connector_id: connector.id, previousErrorCount }
    )
    try {
      const firecrawlRes = await runFirecrawlCollector(connector, slug, sanitizedSlug)
      if (!firecrawlRes.error) {
        return firecrawlRes
      }
      logger.warn(`[${CHANNEL}] Fallback Firecrawl não retornou dados/teve erro: ${firecrawlRes.error}`)
    } catch (fcErr: unknown) {
      const fcMsg = fcErr instanceof Error ? fcErr.message : String(fcErr)
      logger.warn(`[${CHANNEL}] Exceção ao executar fallback Firecrawl: ${fcMsg}`)
    }
  } else {
    logger.info(`[${CHANNEL}] FIRECRAWL_API_KEY não configurada. Pulando fallback Firecrawl.`)
  }

  // 3. Fallback 2: Apify (Terciário / Último recurso - se APIFY_TOKEN estiver configurado)
  if (isTransientPw) {
    logger.warn(
      `[${CHANNEL}] Playwright e Firecrawl indisponíveis. Ativando fallback Apify`,
      { error: pwMsg, connector_id: connector.id, previousErrorCount }
    )
  } else {
    logger.warn(
      `[${CHANNEL}] Playwright falhou com erro não-transiente. Tentando Apify como fallback final...`,
      { error: pwMsg }
    )
  }

  const actorId = process.env['APIFY_RECLAME_AQUI_ACTOR_ID']
  const token = process.env['APIFY_TOKEN']
  if (!token) {
    logger.warn(`[${CHANNEL}] APIFY_TOKEN não configurado, abortando fallback Apify`)
    result.error = pwMsg
    result.error_type = isTransientPw ? 'transient' : 'fatal'
    return result
  }

  try {
    return await runApifyCollector(actorId, connector, slug)
  } catch (apifyErr: any) {
    logger.error(
      `[${CHANNEL}] Todos os scrapers (Playwright, Firecrawl e Apify) falharam`,
      { error: apifyErr.message }
    )
    result.error = `Playwright: ${pwMsg}. Apify: ${apifyErr.message}`
    result.error_type = 'fatal'
    return result
  }
}

// -----------------------------------------------------------------------------
// Estratégia 1: Extração via __NEXT_DATA__
// O Next.js injeta dados SSR neste objeto — estrutura mais estável que o DOM
// -----------------------------------------------------------------------------

async function extractFromNextData(page: import('playwright-core').Page, companySlug: string): Promise<ReclameAquiComplaint[]> {
  try {
    const nextDataJson = await page.evaluate(() => {
      const el = document.getElementById('__NEXT_DATA__')
      return el ? el.textContent : null
    })

    if (!nextDataJson) return []
    return parseNextDataJson(nextDataJson, companySlug)
  } catch {
    return []
  }
}

/**
 * Extrai e parseia reclamações a partir do JSON de __NEXT_DATA__.
 */
export function parseNextDataJson(nextDataJson: string, companySlug: string): ReclameAquiComplaint[] {
  try {
    const nextData = JSON.parse(nextDataJson)
    const pageProps = nextData?.props?.pageProps

    if (pageProps && typeof pageProps === 'object') {
      logger.info(`[reclame_aqui] __NEXT_DATA__ pageProps keys: ${Object.keys(pageProps).join(', ')}`)
    }

    const dehydrated = pageProps?.dehydratedState?.queries
    const dehydratedComplaints = Array.isArray(dehydrated)
      ? dehydrated.flatMap((q: Record<string, unknown>) => {
          const data = (q['state'] as Record<string, unknown>)?.['data'] as Record<string, unknown> | undefined
          return Array.isArray(data?.['complaints']) ? data['complaints'] as unknown[] :
                 Array.isArray(data?.['data'])       ? data['data']       as unknown[] : []
        })
      : []

    const complaintsRaw =
      pageProps?.complaints?.LAST ??
      pageProps?.complaints ??
      pageProps?.initialData?.complaintList?.complaints ??
      pageProps?.initialData?.complaints ??
      pageProps?.data?.complaints ??
      pageProps?.company?.complaints ??
      pageProps?.companyData?.complaints ??
      (dehydratedComplaints.length > 0 ? dehydratedComplaints : null) ??
      null

    if (!complaintsRaw || !Array.isArray(complaintsRaw)) {
      logger.info(`[reclame_aqui] __NEXT_DATA__ não contém complaints em nenhum caminho conhecido`)
      return []
    }

    return complaintsRaw
      .map((c: Record<string, unknown>) => {
        const urlRaw = String(c['complaintUrl'] ?? c['url'] ?? '')
        let url = ''
        if (urlRaw.startsWith('http')) {
          url = urlRaw
        } else if (urlRaw.length > 0) {
          const cleanPath = urlRaw.startsWith('/') ? urlRaw.slice(1) : urlRaw
          if (cleanPath.includes('/')) {
            url = `https://www.reclameaqui.com.br/${cleanPath}`
          } else {
            url = `https://www.reclameaqui.com.br/${companySlug}/${cleanPath}`
          }
        } else if (c['id']) {
          url = `https://www.reclameaqui.com.br/${companySlug}/reclamacao_${c['id']}`
        } else {
          url = `https://www.reclameaqui.com.br/empresa/${companySlug}/`
        }

        if (!url.endsWith('/')) url += '/'

        if (url.includes('/empresa/') && !url.includes(`/empresa/${companySlug}/`)) return null

        const dateVal = String(
          c['created'] ??
          c['createdDate'] ??
          c['date'] ??
          c['data'] ??
          c['createdAt'] ??
          (c['legacyComplaint'] as Record<string, unknown> | undefined)?.['created'] ??
          (c['legacyComplaint'] as Record<string, unknown> | undefined)?.['createdDate'] ??
          ''
        )

        const parsed = ReclameAquiComplaintSchema.safeParse({
          id: String(c['id'] ?? c['_id'] ?? ''),
          title: String(c['title'] ?? c['titulo'] ?? ''),
          description: String(c['description'] ?? c['descricao'] ?? c['text'] ?? ''),
          status: String(c['status'] ?? ''),
          author: String(c['demanderName'] ?? c['author'] ?? c['nome'] ?? ''),
          date: dateVal,
          url,
          isResolved: Boolean(c['evaluated'] ?? false),
        })
        return parsed.success ? parsed.data : null
      })
      .filter((c): c is ReclameAquiComplaint => c !== null && c.title.length > 0)
  } catch {
    return []
  }
}

/**
 * Extrai reclamações a partir de uma string HTML utilizando Cheerio.
 */
export function parseDomFromHtmlString(html: string, companySlug: string): ReclameAquiComplaint[] {
  try {
    const $ = cheerio.load(html)
    const complaints: ReclameAquiComplaint[] = []
    const links = $('a[href*="/reclamacao/"]').toArray()

    for (const link of links) {
      const $link = $(link)
      const href = $link.attr('href') || ''
      if (!href) continue

      const inCompanyContext =
        href.includes(`/empresa/${companySlug}/`) ||
        $link.closest('[class*="complain-list"], [class*="ComplainList"], main, [role="main"]').length > 0
      const inSidebar =
        $link.closest('aside, [class*="sidebar"], [class*="Sidebar"], [class*="related"], [class*="Related"], [class*="suggest"], [class*="Suggest"]').length > 0

      if (!inCompanyContext || inSidebar) continue

      const $container =
        $link.closest('li, article, div[class*="item"], div[class*="Item"]').length > 0
          ? $link.closest('li, article, div[class*="item"], div[class*="Item"]')
          : $link

      const titleText =
        $container.find('h4, h3, [class*="title"], [class*="Title"]').first().text().trim() || $link.text().trim()
      const statusText = $container.find('[class*="status"], [class*="Status"], [class*="badge"]').first().text().trim()

      let dateStr = ''
      const $dateEl = $container.find('time, [class*="date"], [class*="Date"]').first()
      if ($dateEl.length > 0) {
        dateStr = $dateEl.attr('datetime') || $dateEl.text().trim()
      } else {
        $container.find('span, p, div, small, time').each((_, el) => {
          const txt = $(el).text().trim()
          if (/(\d{2}\/\d{2}\/\d{2,4})|(há\s+\d+)|(há\s+pouco)/i.test(txt) && txt.length < 60) {
            dateStr = $(el).attr('datetime') || txt
            return false
          }
        })
      }

      const fullUrl = href.startsWith('http')
        ? href
        : `https://www.reclameaqui.com.br${href.startsWith('/') ? '' : '/'}${href}`

      const urlParts = href.split('/').filter(Boolean)
      const lastPart = urlParts[urlParts.length - 1] || ''
      const idMatch = lastPart.match(/-([A-Z0-9]+)$/i)
      const id = idMatch ? idMatch[1] : lastPart

      if (titleText.length > 0) {
        const parsed = ReclameAquiComplaintSchema.safeParse({
          id,
          title: titleText,
          date: dateStr,
          status: statusText,
          url: fullUrl,
        })
        if (parsed.success) {
          complaints.push(parsed.data)
        }
      }
    }

    return complaints
  } catch {
    return []
  }
}

// -----------------------------------------------------------------------------
// Estratégia 2: Extração via DOM (fallback)
// -----------------------------------------------------------------------------

async function extractFromDom(page: import('playwright-core').Page, companySlug: string): Promise<ReclameAquiComplaint[]> {
  try {
    // Esperar a lista de reclamações aparecer
    const listExists = await page.locator('a[href*="/reclamacao/"]').count()
    if (listExists === 0) return []

    const complaints = await page.evaluate((args: { baseUrl: string; slug: string }) => {
      const { slug } = args
      const links = Array.from(document.querySelectorAll('a[href*="/reclamacao/"]'))

      return links
        // Filtra apenas reclamações do container principal da lista desta empresa
        // Exclui links de sidebar, empresas sugeridas e seções relacionadas
        .filter(link => {
          const href = (link as HTMLAnchorElement).href
          // O link deve pertencer ao contexto desta empresa:
          // formato /empresa/{slug}/reclamacao/... ou conter o slug no path
          const inCompanyContext = href.includes(`/empresa/${slug}/`) ||
            !!link.closest('[class*="complain-list"], [class*="ComplainList"], main, [role="main"]')
          const inSidebar = !!link.closest('aside, [class*="sidebar"], [class*="Sidebar"], [class*="related"], [class*="Related"], [class*="suggest"], [class*="Suggest"]')
          return inCompanyContext && !inSidebar
        })
        .map(link => {
          const container = link.closest('li, article, div[class*="item"], div[class*="Item"]') ?? link

          const titleEl = container.querySelector('h4, h3, [class*="title"], [class*="Title"]')
          const statusEl = container.querySelector('[class*="status"], [class*="Status"], [class*="badge"]')

          let dateStr = ''
          const dateEl = container.querySelector('time, [class*="date"], [class*="Date"]')
          if (dateEl) {
            dateStr = dateEl.getAttribute('datetime') ?? dateEl.textContent?.trim() ?? ''
          } else {
            const children = Array.from(container.querySelectorAll('span, p, div, small, time'))
            for (const child of children) {
              const text = child.textContent?.trim() ?? ''
              if (/(\d{2}\/\d{2}\/\d{2,4})|(há\s+\d+)|(há\s+pouco)/i.test(text) && text.length < 60) {
                dateStr = child.getAttribute('datetime') ?? text
                break
              }
            }
          }

          const href = (link as HTMLAnchorElement).href
          // Extrair o ID/slug da URL: /reclamacao/empresa/titulo-XXXXXXXX/
          const urlParts = href.split('/')
          const lastPart = urlParts[urlParts.length - 2] ?? ''
          const idMatch = lastPart.match(/-([A-Z0-9]+)$/)
          const id = idMatch ? idMatch[1] : lastPart

          return {
            id,
            title: titleEl?.textContent?.trim() ?? '',
            date: dateStr,
            status: statusEl?.textContent?.trim() ?? '',
            url: href,
          }
        }).filter(c => c.title.length > 0)
    }, { baseUrl: BASE_URL, slug: companySlug })

    return complaints
      .map(c => {
        const parsed = ReclameAquiComplaintSchema.safeParse({
          ...c,
          author: undefined,
        })
        return parsed.success ? parsed.data : null
      })
      .filter((c): c is ReclameAquiComplaint => c !== null)
  } catch {
    return []
  }
}

// -----------------------------------------------------------------------------
// Normalização
// -----------------------------------------------------------------------------

function normalize(raw: ReclameAquiComplaint, connector: ChannelConnector): NormalizedReview {
  // Gerar external_id: usar o ID da reclamação ou um hash determinístico
  const external_id = raw.id && raw.id.length > 0
    ? raw.id
    : createHash('sha256')
        .update(`${connector.business_id}:${raw.title}:${raw.date ?? ''}`)
        .digest('hex')
        .slice(0, 16)

  // Inferir rating a partir do status (Reclame Aqui não tem rating numérico)
  // Resolvido = 4, Em andamento = 3, Não resolvido / sem retorno = 2
  let rating: number | undefined
  if (raw.isResolved === true) {
    rating = 4
  } else if (raw.status) {
    const s = raw.status.toLowerCase()
    if (s.includes('resolvido') || s.includes('avaliado'))        rating = 4
    else if (s.includes('andamento') || s.includes('respondido')) rating = 3
    else if (s.includes('não resolvido') || s.includes('arquivado')) rating = 2
  }

  // Tentar extrair subdomínio (www, green, hugme) do raw_url se disponível
  let subdomain = 'www'
  if (raw.url && raw.url.includes('.reclameaqui.com.br')) {
    try {
      const u = new URL(raw.url)
      subdomain = u.hostname.split('.')[0] || 'www'
    } catch { /* segue com www */ }
  }

  const review: NormalizedReview = {
    tenant_id: connector.tenant_id,
    business_id: connector.business_id,
    connector_id: connector.id,
    channel: CHANNEL,
    external_id,
    published_at: (raw.date ? parseDate(raw.date) : null) ?? new Date().toISOString(),
    body: raw.description ?? raw.title,
    title: raw.title,
    sentiment: 'unanalyzed',
    tags: ['reclame_aqui', raw.status ?? 'sem_status'].filter(Boolean),
    // URL Robusta: usa o subdomínio detectado e o slug da empresa
    url: raw.url && raw.url.startsWith('http') 
      ? raw.url 
      : `https://${subdomain}.reclameaqui.com.br/${connector.external_id}/${raw.url || raw.id}/`,
    raw_data: raw as unknown as Record<string, unknown>,
  }

  // Enriquecer tags com sinais de urgência detectados no texto
  // Estes tags são consumidos por buildReclameAquiExtra() no motor de sentimento
  const fullText = [raw.title, raw.description ?? ''].join(' ')
  const extraTags: string[] = []

  if (/r\$\s*\d|cobr(aram|ança|ado)|d[eé]bito|estorno|reembolso|\d+,\d{2}/i.test(fullText)) {
    extraTags.push('financeiro')
  }
  if (/procon|juizado|judicial|processo|anatel|bacen|banco central|senacon/i.test(fullText)) {
    extraTags.push('ameaca_legal')
  }
  if (/n[aã]o (foi |)respondid|sem retorno|n[aã]o (me |)atend|ignorad|sem resposta/i.test(fullText)) {
    extraTags.push('sem_retorno')
  }

  if (extraTags.length > 0) {
    review.tags = [...(review.tags ?? []), ...extraTags]
  }

  if (rating !== undefined)  review.rating = rating
  if (raw.author)            review.author_name = raw.author
  if (raw.score !== undefined) review.upvotes = Math.round(raw.score)

  return review
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function parseDate(dateStr: string): string | null {
  if (!dateStr || dateStr.trim() === '') return null
  const s = dateStr.toLowerCase().trim()

  // 1. ISO 8601 (ex: "2026-07-16T14:39:56.000Z")
  try {
    const d = new Date(dateStr)
    if (!isNaN(d.getTime()) && d.getFullYear() > 2000 && dateStr.includes('T')) return d.toISOString()
  } catch { /* continua */ }

  // 2. Formato brasileiro com hora: "17/04/2024 às 15:30" ou "17/04/24 15:30"
  const brDateTime = dateStr.match(/(\d{2})\/(\d{2})\/(\d{2,4})[^\d]*(\d{2}):(\d{2})/)
  if (brDateTime) {
    const [, day, month, yearStr, hour, min] = brDateTime
    const year = yearStr!.length === 2 ? `20${yearStr}` : yearStr!
    const d = new Date(`${year}-${month}-${day}T${hour}:${min}:00-03:00`)
    if (!isNaN(d.getTime())) return d.toISOString()
  }

  // 3. Formato brasileiro simples: "17/04/2024" ou "17/04/24"
  const brMatch = dateStr.match(/(\d{2})\/(\d{2})\/(\d{2,4})/)
  if (brMatch) {
    const [, day, month, yearStr] = brMatch
    const year = yearStr!.length === 2 ? `20${yearStr}` : yearStr!
    const d = new Date(`${year}-${month}-${day}T12:00:00-03:00`)
    if (!isNaN(d.getTime())) return d.toISOString()
  }

  // 4. Datas relativas: "há 2 dias", "há 3 horas", "há 1 minuto" (em qualquer parte do texto)
  if (s.includes('há')) {
    const now = new Date()
    const match = s.match(/há\s+(\d+)\s+(dia|hora|minuto|mês|ano)s?/)
    if (match) {
      const value = parseInt(match[1]!, 10)
      const unit = match[2]!
      if (unit.startsWith('dia')) now.setDate(now.getDate() - value)
      else if (unit.startsWith('hora')) now.setHours(now.getHours() - value)
      else if (unit.startsWith('minuto')) now.setMinutes(now.getMinutes() - value)
      else if (unit.startsWith('mês')) now.setMonth(now.getMonth() - value)
      else if (unit.startsWith('ano')) now.setFullYear(now.getFullYear() - value)
      return now.toISOString()
    }
    if (s.includes('instante') || s.includes('pouco')) return now.toISOString()
  }

  // 5. Fallback para new Date em outros formatos genéricos
  try {
    const d = new Date(dateStr)
    if (!isNaN(d.getTime()) && d.getFullYear() > 2000) return d.toISOString()
  } catch { /* continua */ }

  // 6. Timestamp unix em milissegundos
  if (/^\d{13}$/.test(dateStr.trim())) {
    const d = new Date(parseInt(dateStr, 10))
    if (!isNaN(d.getTime())) return d.toISOString()
  }

  return null
}
