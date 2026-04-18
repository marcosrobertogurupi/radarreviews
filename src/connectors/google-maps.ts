// Conector Google Maps — Playwright scraping (primário) + Places API (fallback)
//
// Estratégia:
//   1. Playwright: abre maps.google.com/maps/place/?q=place_id:{id}, ordena por
//      "Mais recentes", rola o painel de reviews e extrai os dados do DOM.
//      → Retorna reviews RECENTES (o que a API pública não consegue).
//   2. Places API: busca os 5 "mais relevantes" via REST, complementa o conjunto.
//   3. O pipeline de ingestão faz deduplicação por external_id (data-review-id == review ID da API).
//
// external_id: data-review-id do DOM (= último segmento do campo "name" da API,
//   ex: places/ChIJ.../reviews/<THIS_PART>). Garante dedup entre as duas fontes.
//
// Config disponível no connector.config:
//   use_scraper     boolean  (default true)  — habilita scraping Playwright
//   use_api         boolean  (default true)  — habilita fallback Places API
//   max_reviews     number   (default 50)    — máximo de reviews a raspar
//   timeout_ms      number   (default 30000) — timeout por operação Playwright

import 'dotenv/config'
import { createHash } from 'node:crypto'
import axios from 'axios'
import { chromium } from 'playwright-core'
import { z } from 'zod'
import { supabase } from '../lib/supabase.js'
import { logger } from '../lib/logger.js'
import { ingestReviews } from '../lib/ingest.js'
import type { ChannelConnector, JobResult } from '../types/connector.js'
import type { NormalizedReview } from '../types/review.js'

// ── Constantes ───────────────────────────────────────────────────────────────

const CHANNEL = 'google_maps' as const
const PLACES_BASE = 'https://places.googleapis.com/v1'
const FIELD_MASK = 'id,displayName,rating,userRatingCount,reviews'
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
const DEFAULT_TIMEOUT_MS = 30_000
const DEFAULT_MAX_REVIEWS = 50

// ── Schema Zod — Places API ──────────────────────────────────────────────────

const GoogleReviewSchema = z.object({
  name: z.string(),
  rating: z.number().min(1).max(5).optional(),
  text: z.object({ text: z.string().optional(), languageCode: z.string().optional() }).optional(),
  authorAttribution: z.object({
    displayName: z.string().optional(),
    uri: z.string().optional(),
    photoUri: z.string().optional(),
  }).optional(),
  publishTime: z.string(),
  relativePublishTimeDescription: z.string().optional(),
})

const GooglePlaceResponseSchema = z.object({
  id: z.string().optional(),
  displayName: z.object({ text: z.string().optional() }).optional(),
  rating: z.number().optional(),
  userRatingCount: z.number().optional(),
  reviews: z.array(GoogleReviewSchema).optional().default([]),
})

type GoogleReview = z.infer<typeof GoogleReviewSchema>

// ── Interface — dado raspado via DOM ─────────────────────────────────────────

interface ScrapedReview {
  reviewId: string       // data-review-id do DOM (= ID único do review no Google)
  rating: number | undefined
  body: string
  author: string
  relativeTime: string   // "há 2 meses", "2 weeks ago", etc.
  likes: number
}

// ── Função principal ─────────────────────────────────────────────────────────

export async function run(connector: ChannelConnector): Promise<JobResult> {
  const result: JobResult = { reviews_fetched: 0, reviews_new: 0, reviews_updated: 0 }

  if (!connector.external_id) {
    result.error = `Conector ${connector.id} não tem external_id (place_id obrigatório).`
    return result
  }

  const useScraper = (connector.config['use_scraper'] as boolean) ?? true
  const useApi     = (connector.config['use_api']     as boolean) ?? true

  const all: NormalizedReview[] = []

  // ── 1. Playwright scraping ────────────────────────────────────────────────
  if (useScraper) {
    try {
      const scraped = await fetchFromScraper(connector)
      logger.info(`[${CHANNEL}] Scraping concluído`, { count: scraped.length })
      all.push(...scraped.map(r => normalizeScraped(r, connector)))
    } catch (err) {
      logger.warn(`[${CHANNEL}] Scraping falhou, tentando API`, {
        error: err instanceof Error ? err.message : String(err),
        connector_id: connector.id,
      })
    }
  }

  // ── 2. Places API (complementa / fallback) ────────────────────────────────
  if (useApi) {
    try {
      const apiReviews = await fetchFromApi(connector)
      logger.info(`[${CHANNEL}] API retornou`, { count: apiReviews.length })
      all.push(...apiReviews.map(r => normalizeApi(r, connector)))
    } catch (err) {
      if (all.length === 0) {
        result.error = err instanceof Error ? err.message : String(err)
        logger.error(`[${CHANNEL}] API e scraping falharam`, { error: err })
        return result
      }
      logger.warn(`[${CHANNEL}] API falhou mas scraping OK`, {
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  if (all.length === 0) {
    logger.info(`[${CHANNEL}] Nenhum review obtido`, { connector_id: connector.id })
    return result
  }

  result.reviews_fetched = all.length

  const ingest = await ingestReviews(all, CHANNEL, connector.id, connector.business_id)
  result.reviews_new     = ingest.reviews_new
  result.reviews_updated = ingest.reviews_updated

  logger.info(`[${CHANNEL}] Job concluído`, {
    connector_id: connector.id,
    place_id: connector.external_id,
    reviews_fetched: result.reviews_fetched,
    reviews_new: ingest.reviews_new,
    reviews_updated: ingest.reviews_updated,
  })

  return result
}

// ── Playwright scraper ────────────────────────────────────────────────────────
//
// Fluxo:
//   1. Abre maps.google.com/maps/place/?q=place_id:{id} com locale pt-BR
//   2. Aguarda o painel lateral da empresa carregar
//   3. Clica na aba "Avaliações" / "Reviews"
//   4. Abre o menu de ordenação e seleciona "Mais recentes"
//   5. Rola o painel para carregar mais reviews
//   6. Expande reviews truncados (botão "Mais")
//   7. Extrai dados do DOM
// ─────────────────────────────────────────────────────────────────────────────

async function fetchFromScraper(connector: ChannelConnector): Promise<ScrapedReview[]> {
  const placeId    = connector.external_id!
  const maxReviews = (connector.config['max_reviews'] as number)  ?? DEFAULT_MAX_REVIEWS
  const timeoutMs  = (connector.config['timeout_ms']  as number)  ?? DEFAULT_TIMEOUT_MS

  let browser = null
  try {
    browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--single-process',
        '--disable-blink-features=AutomationControlled',
      ],
    })

    const context = await browser.newContext({
      userAgent: USER_AGENT,
      locale: 'pt-BR',
      timezoneId: 'America/Sao_Paulo',
      viewport: { width: 1366, height: 768 },
      extraHTTPHeaders: {
        'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    })

    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined })
    })

    const page = await context.newPage()
    page.setDefaultTimeout(timeoutMs)
    page.setDefaultNavigationTimeout(timeoutMs * 2)

    const mapUrl = `https://www.google.com/maps/place/?q=place_id:${placeId}`
    logger.info(`[${CHANNEL}] Navegando`, { url: mapUrl })

    await page.goto(mapUrl, { waitUntil: 'domcontentloaded', timeout: timeoutMs * 2 })
    await page.waitForTimeout(3000)

    // Log da URL real após navegação (detecta redirecionamentos / CAPTCHA / consent page)
    const finalUrl = page.url()
    logger.info(`[${CHANNEL}] URL após navegação`, { finalUrl })

    // ── Rejeitar cookies / consent page do Google ────────────────────────────
    // Google às vezes exibe página de consentimento de cookies antes do Maps
    const consentSelectors = [
      'button[aria-label*="Aceitar tudo"]',
      'button[aria-label*="Accept all"]',
      'button:has-text("Aceitar tudo")',
      'button:has-text("Accept all")',
      'button:has-text("Concordar")',
      'button:has-text("I agree")',
      '#L2AGLb',   // ID do botão "I agree" do Google Consent
    ]
    for (const sel of consentSelectors) {
      try {
        if (await page.locator(sel).count() > 0) {
          await page.click(sel)
          await page.waitForTimeout(2000)
          logger.info(`[${CHANNEL}] Consent page aceita: ${sel}`)
          break
        }
      } catch { /* ignora */ }
    }

    // ── Clicar na aba de avaliações ──────────────────────────────────────────
    const reviewTabSelectors = [
      'button[aria-label*="Avaliações"]',
      'button[aria-label*="Reviews"]',
      '[role="tab"]:has-text("Avaliações")',
      '[role="tab"]:has-text("Reviews")',
      'button[jsaction*="review"]',
    ]
    for (const sel of reviewTabSelectors) {
      try {
        const el = page.locator(sel).first()
        if (await el.count() > 0) {
          await el.click()
          await page.waitForTimeout(2000)
          logger.info(`[${CHANNEL}] Aba de avaliações clicada: ${sel}`)
          break
        }
      } catch { /* tenta próximo seletor */ }
    }

    // ── Aguardar reviews aparecerem ──────────────────────────────────────────
    try {
      await page.waitForSelector('[data-review-id]', { timeout: timeoutMs })
    } catch {
      // Log diagnóstico: título da página e primeiros 500 chars do body
      const title = await page.title().catch(() => 'N/A')
      const bodySnippet = await page.evaluate(() =>
        document.body?.innerText?.slice(0, 300) ?? ''
      ).catch(() => '')
      logger.warn(`[${CHANNEL}] Nenhum review encontrado no DOM`, {
        finalUrl: page.url(),
        pageTitle: title,
        bodySnippet,
      })
      return []
    }

    // ── Ordenar por "Mais recentes" ──────────────────────────────────────────
    try {
      const sortSelectors = [
        'button[aria-label*="Ordenar avaliações"]',
        'button[aria-label*="Sort reviews"]',
        'button[aria-label="Ordenar"]',
        'button[aria-label="Sort"]',
        '[jsaction*="sortReviews"]',
        '[data-value="Sort"]',
      ]
      let sorted = false
      for (const sel of sortSelectors) {
        if (await page.locator(sel).count() > 0) {
          await page.click(sel)
          await page.waitForTimeout(1000)
          sorted = true
          break
        }
      }

      if (sorted) {
        // Selecionar "Mais recentes" no dropdown
        const newestSelectors = [
          '[role="menuitemradio"]:has-text("Mais recentes")',
          '[role="menuitemradio"]:has-text("Newest")',
          '[role="option"]:has-text("Mais recentes")',
          'li:has-text("Mais recentes")',
          'li[data-index="1"]',
        ]
        for (const sel of newestSelectors) {
          if (await page.locator(sel).count() > 0) {
            await page.click(sel)
            await page.waitForTimeout(2500)
            logger.info(`[${CHANNEL}] Ordenado por Mais recentes`)
            break
          }
        }
      }
    } catch (e) {
      logger.warn(`[${CHANNEL}] Ordenação falhou, continuando com ordem padrão`, {
        error: e instanceof Error ? e.message : String(e),
      })
    }

    // ── Rolar para carregar mais reviews ─────────────────────────────────────
    // O container scrollável pode ser identificado pelo feed de reviews
    const scrollableSelectors = [
      '[role="feed"]',
      '.m6QErb.DxyBCb',
      '.m6QErb[aria-label]',
      '.m6QErb',
    ]

    let scrollSelector = '[role="feed"]'
    for (const sel of scrollableSelectors) {
      if (await page.locator(sel).count() > 0) {
        scrollSelector = sel
        break
      }
    }

    let prevCount = 0
    let staleRounds = 0
    const MAX_STALE = 4

    for (let i = 0; i < 15; i++) {
      const count = await page.locator('[data-review-id]').count()
      if (count >= maxReviews) break

      if (count === prevCount) {
        staleRounds++
        if (staleRounds >= MAX_STALE) break
      } else {
        staleRounds = 0
      }
      prevCount = count

      // Rolar o container de reviews
      await page.evaluate((sel) => {
        const el = document.querySelector(sel)
        if (el) el.scrollBy(0, 2000)
        else window.scrollBy(0, 2000)
      }, scrollSelector)

      await page.waitForTimeout(1800)
    }

    logger.info(`[${CHANNEL}] Reviews carregados no DOM`, {
      count: await page.locator('[data-review-id]').count(),
    })

    // ── Expandir reviews truncados (botão "Mais") ────────────────────────────
    const moreSelectors = [
      'button[aria-label*="Ver mais"]',
      'button[aria-label*="See more"]',
      '.w8nwRe',
      'button.w8nwRe',
    ]
    for (const sel of moreSelectors) {
      const btns = await page.locator(sel).all()
      for (const btn of btns) {
        try { await btn.click({ timeout: 2000 }) } catch { /* ignora */ }
      }
    }
    if (moreSelectors.length > 0) await page.waitForTimeout(800)

    // ── Extrair dados do DOM ─────────────────────────────────────────────────
    const reviews: ScrapedReview[] = await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll('[data-review-id]'))

      return cards.map(card => {
        const reviewId = card.getAttribute('data-review-id') ?? ''

        // Rating: procura aria-label com "X estrelas" ou "X stars"
        const ratingEl = card.querySelector('[aria-label*="estrela"], [aria-label*="star"], .kvMYJc')
        const ratingLabel = ratingEl?.getAttribute('aria-label') ?? ''
        const ratingMatch = ratingLabel.match(/(\d(?:[.,]\d)?)/)
        const ratingStr = ratingMatch?.[1]
        const rating = ratingStr !== undefined ? parseFloat(ratingStr.replace(',', '.')) : undefined

        // Texto do review — tenta vários seletores em ordem
        const textEl =
          card.querySelector('.wiI7pd') ??
          card.querySelector('.MyEned') ??
          card.querySelector('[class*="review-full-text"]') ??
          card.querySelector('span[jsan]')
        const body = textEl?.textContent?.trim() ?? ''

        // Autor
        const authorEl =
          card.querySelector('.d4r55') ??
          card.querySelector('[class*="author"]') ??
          card.querySelector('button[aria-label]')
        const author = authorEl?.textContent?.trim() ?? ''

        // Tempo relativo
        const timeEl =
          card.querySelector('.rsqaWe') ??
          card.querySelector('[class*="publish-date"]') ??
          card.querySelector('span[class*="date"]')
        const relativeTime = timeEl?.textContent?.trim() ?? ''

        // Curtidas/útil
        const likesEl = card.querySelector('.pkWtMe, [class*="thumb"] span')
        const likes = parseInt(likesEl?.textContent?.trim() ?? '0', 10) || 0

        return { reviewId, rating, body, author, relativeTime, likes }
      })
    })

    const valid = reviews.filter(r => r.reviewId && (r.author || r.body))
    logger.info(`[${CHANNEL}] Reviews extraídos do DOM`, { total: reviews.length, valid: valid.length })

    return valid.slice(0, maxReviews)

  } finally {
    if (browser) await browser.close()
  }
}

// ── Places API (fallback) ────────────────────────────────────────────────────

async function fetchFromApi(connector: ChannelConnector): Promise<GoogleReview[]> {
  const apiKey = process.env['GOOGLE_MAPS_API_KEY']
  if (!apiKey) throw new Error('GOOGLE_MAPS_API_KEY não configurada.')
  if (!connector.external_id) throw new Error(`Conector ${connector.id} sem place_id.`)

  const url = `${PLACES_BASE}/places/${connector.external_id}`

  const response = await fetchWithRetry(() =>
    axios.get(url, {
      headers: {
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': FIELD_MASK,
      },
    })
  )

  const parsed = GooglePlaceResponseSchema.safeParse(response.data)
  if (!parsed.success) {
    logger.warn(`[${CHANNEL}] Resposta da API fora do schema`, { errors: parsed.error.errors })
    return []
  }

  // Sinalizar limite da API
  if ((parsed.data.reviews?.length ?? 0) >= 5) {
    logger.info(`[${CHANNEL}] API retornou limite de 5 reviews (histórico completo requer scraping)`, {
      connector_id: connector.id,
    })

    // Marcar status de autenticação da API como válido
    await supabase
      .from('channel_connectors')
      .update({ status: 'active', error_message: null })
      .eq('id', connector.id)
  }

  return parsed.data.reviews
}

// ── Retry com backoff exponencial ────────────────────────────────────────────

async function fetchWithRetry<T>(fn: () => Promise<T>, retries = 3): Promise<T> {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn()
    } catch (err: unknown) {
      const status = axios.isAxiosError(err) ? err.response?.status : undefined
      const isRetryable = status === 429 || (status !== undefined && status >= 500)
      if (!isRetryable || i === retries - 1) {
        // Erro de auth: marcar conector como pending_auth
        if (axios.isAxiosError(err) && (status === 401 || status === 403)) {
          await supabase
            .from('channel_connectors')
            .update({ status: 'pending_auth', error_message: `Token inválido: ${(err as Error).message}` })
            .eq('id', 'unknown') // connector_id não disponível aqui, tratado em run()
            .throwOnError()
        }
        throw err
      }
      const delay = Math.pow(2, i) * 1000
      logger.warn(`[${CHANNEL}] Rate limit, aguardando ${delay}ms`, { status, tentativa: i + 1 })
      await new Promise(r => setTimeout(r, delay))
    }
  }
  throw new Error('Máximo de tentativas excedido')
}

// ── Normalização — dado raspado (DOM) ────────────────────────────────────────

function normalizeScraped(raw: ScrapedReview, connector: ChannelConnector): NormalizedReview {
  // Usa o data-review-id diretamente como external_id (= review ID no Google)
  // Isso garante dedup com reviews obtidos via API (que usa o mesmo ID no campo "name")
  const external_id = raw.reviewId || createHash('sha256')
    .update(`${connector.business_id}:${raw.author}:${raw.relativeTime}`)
    .digest('hex')
    .slice(0, 16)

  const published_at = parseRelativeTime(raw.relativeTime) ?? new Date().toISOString()

  const review: NormalizedReview = {
    tenant_id:    connector.tenant_id,
    business_id:  connector.business_id,
    connector_id: connector.id,
    channel:      CHANNEL,
    external_id,
    published_at,
    sentiment:    'unanalyzed',
    raw_data:     raw as unknown as Record<string, unknown>,
  }

  if (raw.rating !== undefined) review.rating      = raw.rating
  if (raw.body)                 review.body        = raw.body
  if (raw.author)               review.author_name = raw.author
  if (raw.likes > 0)            review.upvotes     = raw.likes

  return review
}

// ── Normalização — dado da API ────────────────────────────────────────────────

function normalizeApi(raw: GoogleReview, connector: ChannelConnector): NormalizedReview {
  // Extrai apenas o segmento de ID do review (ex: "places/XYZ/reviews/<ID>" → "<ID>")
  // Isso garante que o external_id case com o data-review-id do DOM
  const external_id = raw.name.includes('/reviews/')
    ? raw.name.split('/reviews/').pop()!
    : raw.name

  const review: NormalizedReview = {
    tenant_id:    connector.tenant_id,
    business_id:  connector.business_id,
    connector_id: connector.id,
    channel:      CHANNEL,
    external_id,
    published_at: new Date(raw.publishTime).toISOString(),
    sentiment:    'unanalyzed',
    raw_data:     raw as unknown as Record<string, unknown>,
  }

  const rating = normalizeRating(raw.rating)
  const body   = raw.text?.text?.trim() || undefined
  const lang   = raw.text?.languageCode ?? 'pt'
  const author = raw.authorAttribution?.displayName?.trim() || undefined

  if (rating !== undefined) review.rating      = rating
  if (body   !== undefined) review.body        = body
  if (lang   !== undefined) review.language    = lang
  if (author !== undefined) review.author_name = author

  return review
}

function normalizeRating(value: unknown): number | undefined {
  if (value == null) return undefined
  const num = Number(value)
  if (isNaN(num)) return undefined
  return Math.min(5, Math.max(0, num))
}

// ── Parser de tempo relativo ──────────────────────────────────────────────────
// Converte "há 2 meses", "3 weeks ago", "ontem" etc. → ISO 8601
// Erros de parsing retornam null (ingest usa new Date() como fallback)

function parseRelativeTime(text: string): string | null {
  if (!text) return null
  const t = text.toLowerCase().trim()
  const now = Date.now()

  // "hoje" / "today" / "agora" / "just now"
  if (/^(hoje|today|agora|just now|neste momento)$/.test(t)) {
    return new Date(now).toISOString()
  }

  // "ontem" / "yesterday"
  if (/^(ontem|yesterday)$/.test(t)) {
    return new Date(now - 86_400_000).toISOString()
  }

  // "há X [unidade]" | "X [unit] ago"
  const match =
    t.match(/há\s+(\d+)\s+(segundo|minuto|hora|dia|semana|mês|mes|ano)/) ??
    t.match(/(\d+)\s+(second|minute|hour|day|week|month|year)s?\s+ago/)

  if (match) {
    const nStr = match[1]
    const unit = match[2]
    if (nStr !== undefined && unit !== undefined) {
      const n = parseInt(nStr, 10)

      const msMap: Record<string, number> = {
        segundo: 1_000,           second: 1_000,
        minuto:  60_000,          minute: 60_000,
        hora:    3_600_000,       hour:   3_600_000,
        dia:     86_400_000,      day:    86_400_000,
        semana:  7 * 86_400_000,  week:   7 * 86_400_000,
        mês: 30 * 86_400_000,  mes: 30 * 86_400_000,  month: 30 * 86_400_000,
        ano: 365 * 86_400_000,                          year:  365 * 86_400_000,
      }

      const ms = msMap[unit]
      if (ms !== undefined) return new Date(now - n * ms).toISOString()
    }
  }

  return null
}
