// Conector Google Maps — 3 estratégias em sequência
//
// 1. fetchFromApiNewest  — Places API legada com reviews_sort=newest (5 reviews recentes, CONFIÁVEL)
// 2. fetchFromApiRelevant — Places API Nova,  reviews "mais relevantes" (5 reviews, CONFIÁVEL)
// 3. fetchFromScraper    — Playwright scraping com interceptação de rede (até 50, MELHOR ESFORÇO)
//
// Todas as fontes rodam e o pipeline de ingestão faz deduplicação por external_id.
//
// Config disponível em connector.config:
//   use_scraper     boolean  (default true)  — habilita scraping Playwright
//   max_reviews     number   (default 50)    — máximo de reviews no scraping
//   timeout_ms      number   (default 30000) — timeout Playwright

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

const CHANNEL      = 'google_maps' as const
const PLACES_NEW   = 'https://places.googleapis.com/v1'
const PLACES_OLD   = 'https://maps.googleapis.com/maps/api/place/details/json'
const FIELD_MASK   = 'id,displayName,rating,userRatingCount,reviews'
const USER_AGENT   =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
const DEFAULT_TIMEOUT_MS  = 30_000
const DEFAULT_MAX_REVIEWS = 50

// ── Schemas Zod ──────────────────────────────────────────────────────────────

const GoogleReviewSchema = z.object({
  name: z.string(),
  rating: z.number().min(1).max(5).optional(),
  text: z.object({ text: z.string().optional(), languageCode: z.string().optional() }).optional(),
  authorAttribution: z.object({
    displayName: z.string().optional(),
    uri: z.string().optional(),
  }).optional(),
  publishTime: z.string(),
  relativePublishTimeDescription: z.string().optional(),
})

const GooglePlaceResponseSchema = z.object({
  id: z.string().optional(),
  reviews: z.array(GoogleReviewSchema).optional().default([]),
})

// Schema para a API legada (details v1)
const OldPlaceResponseSchema = z.object({
  result: z.object({
    reviews: z.array(z.object({
      author_name:  z.string().optional(),
      rating:       z.number().optional(),
      text:         z.string().optional(),
      time:         z.number(),               // Unix timestamp em segundos
      relative_time_description: z.string().optional(),
    })).optional().default([]),
  }).optional(),
  status: z.string(),
})

type GoogleReview    = z.infer<typeof GoogleReviewSchema>
type OldReview       = NonNullable<z.infer<typeof OldPlaceResponseSchema>['result']>['reviews'][number]

// ── Interface do scraper ──────────────────────────────────────────────────────

interface ScrapedReview {
  reviewId:     string
  rating:       number | undefined
  body:         string
  author:       string
  relativeTime: string
  likes:        number
}

// ── Função principal ──────────────────────────────────────────────────────────

export async function run(connector: ChannelConnector): Promise<JobResult> {
  const result: JobResult = { reviews_fetched: 0, reviews_new: 0, reviews_updated: 0 }

  if (!connector.external_id) {
    result.error = `Conector ${connector.id} sem external_id (place_id obrigatório).`
    return result
  }

  const useScraper = (connector.config['use_scraper'] as boolean) ?? true
  const all: NormalizedReview[] = []

  // ── 1. API legada — 5 reviews RECENTES (mais confiável) ──────────────────
  try {
    const newest = await fetchFromApiNewest(connector)
    logger.info(`[${CHANNEL}] API legada (newest) retornou`, { count: newest.length })
    all.push(...newest.map(r => normalizeOld(r, connector)))
  } catch (err) {
    logger.warn(`[${CHANNEL}] API legada falhou`, {
      error: err instanceof Error ? err.message : String(err),
    })
  }

  // ── 2. API Nova — 5 reviews "mais relevantes" ────────────────────────────
  try {
    const relevant = await fetchFromApiRelevant(connector)
    logger.info(`[${CHANNEL}] API Nova (relevant) retornou`, { count: relevant.length })
    all.push(...relevant.map(r => normalizeNew(r, connector)))
  } catch (err) {
    logger.warn(`[${CHANNEL}] API Nova falhou`, {
      error: err instanceof Error ? err.message : String(err),
    })
  }

  // ── 3. Playwright scraper — reviews adicionais ────────────────────────────
  if (useScraper) {
    try {
      const scraped = await fetchFromScraper(connector)
      logger.info(`[${CHANNEL}] Scraper retornou`, { count: scraped.length })
      all.push(...scraped.map(r => normalizeScraped(r, connector)))
    } catch (err) {
      logger.warn(`[${CHANNEL}] Scraper falhou`, {
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  if (all.length === 0) {
    result.error = 'Nenhuma estratégia retornou reviews (API key inválida ou place_id errado?)'
    logger.error(`[${CHANNEL}] Todas as estratégias falharam`, { connector_id: connector.id })
    return result
  }

  result.reviews_fetched = all.length
  const ingest = await ingestReviews(all, CHANNEL, connector.id, connector.business_id)
  result.reviews_new     = ingest.reviews_new
  result.reviews_updated = ingest.reviews_updated

  logger.info(`[${CHANNEL}] Job concluído`, {
    connector_id: connector.id,
    place_id:     connector.external_id,
    sources: { newest: all.length },
    reviews_fetched: result.reviews_fetched,
    reviews_new:     ingest.reviews_new,
  })

  return result
}

// ── Estratégia 1: Places API legada com reviews_sort=newest ──────────────────
// Retorna os 5 reviews mais recentes via REST (sem Playwright)
// Documentação: https://developers.google.com/maps/documentation/places/web-service/details

async function fetchFromApiNewest(connector: ChannelConnector): Promise<OldReview[]> {
  const apiKey = process.env['GOOGLE_MAPS_API_KEY']
  if (!apiKey) throw new Error('GOOGLE_MAPS_API_KEY não configurada.')

  const resp = await fetchWithRetry(() =>
    axios.get(PLACES_OLD, {
      params: {
        place_id:     connector.external_id,
        fields:       'reviews',
        reviews_sort: 'newest',
        language:     'pt',
        key:          apiKey,
      },
    })
  )

  const parsed = OldPlaceResponseSchema.safeParse(resp.data)
  if (!parsed.success || parsed.data.status !== 'OK') {
    logger.warn(`[${CHANNEL}] API legada status: ${resp.data?.status}`)
    return []
  }

  return parsed.data.result?.reviews ?? []
}

// ── Estratégia 2: Places API Nova — 5 "mais relevantes" ──────────────────────

async function fetchFromApiRelevant(connector: ChannelConnector): Promise<GoogleReview[]> {
  const apiKey = process.env['GOOGLE_MAPS_API_KEY']
  if (!apiKey) throw new Error('GOOGLE_MAPS_API_KEY não configurada.')

  const resp = await fetchWithRetry(() =>
    axios.get(`${PLACES_NEW}/places/${connector.external_id}`, {
      headers: {
        'X-Goog-Api-Key':   apiKey,
        'X-Goog-FieldMask': FIELD_MASK,
      },
    })
  )

  const parsed = GooglePlaceResponseSchema.safeParse(resp.data)
  if (!parsed.success) {
    logger.warn(`[${CHANNEL}] Resposta da API Nova fora do schema`, { errors: parsed.error.errors })
    return []
  }

  // Marcar conector como ativo após sucesso
  await supabase.from('channel_connectors')
    .update({ status: 'active', error_message: null })
    .eq('id', connector.id)

  return parsed.data.reviews
}

// ── Estratégia 3: Playwright com interceptação de rede ───────────────────────
//
// Quando Google Maps carrega reviews, faz chamadas XHR internas.
// Capturamos as respostas dessas chamadas e fazemos DOM scraping como complemento.
// Isso é mais robusto do que depender apenas de seletores CSS.
// ─────────────────────────────────────────────────────────────────────────────

async function fetchFromScraper(connector: ChannelConnector): Promise<ScrapedReview[]> {
  const placeId    = connector.external_id!
  const maxReviews = (connector.config['max_reviews'] as number) ?? DEFAULT_MAX_REVIEWS
  const timeoutMs  = (connector.config['timeout_ms']  as number) ?? DEFAULT_TIMEOUT_MS

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
      viewport: { width: 1280, height: 900 },
      extraHTTPHeaders: {
        'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    })

    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (window as any).cdc_adoQpoasnfa76pfcZLmcfl_Array
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (window as any).cdc_adoQpoasnfa76pfcZLmcfl_Promise
    })

    const page = await context.newPage()
    page.setDefaultTimeout(timeoutMs)
    page.setDefaultNavigationTimeout(timeoutMs * 2)

    // ── Interceptar respostas XHR do Google Maps ─────────────────────────────
    // Quando a página carrega reviews, faz chamadas para endpoints internos do Google.
    // Capturamos os dados brutos dessas chamadas para parsing.
    const networkReviews: ScrapedReview[] = []

    page.on('response', async response => {
      try {
        const url = response.url()
        const status = response.status()
        if (status !== 200) return

        // Endpoints internos do Google Maps para reviews
        const isReviewEndpoint =
          url.includes('/maps/preview/review/listentity') ||
          url.includes('/maps/rpc/') ||
          (url.includes('google.com/maps') && url.includes('review'))

        if (!isReviewEndpoint) return

        const body = await response.text().catch(() => '')
        if (!body) return

        // Remover prefixo de proteção XSSI do Google: )]}'\n
        const jsonStr = body.replace(/^\)\]\}'\s*\n?/, '')
        const parsed = tryParseGoogleReviewArray(jsonStr, placeId)
        if (parsed.length > 0) {
          networkReviews.push(...parsed)
          logger.info(`[${CHANNEL}] Capturadas ${parsed.length} reviews via rede`, { url: url.split('?')[0] })
        }
      } catch { /* ignora erros individuais de interceptação */ }
    })

    // ── Navegar para a página do local ───────────────────────────────────────
    const mapUrl = `https://www.google.com/maps/place/?q=place_id:${placeId}`
    logger.info(`[${CHANNEL}] Scraper navegando para`, { url: mapUrl })

    await page.goto(mapUrl, { waitUntil: 'domcontentloaded', timeout: timeoutMs * 2 })
    await page.waitForTimeout(3000)

    const finalUrl = page.url()
    logger.info(`[${CHANNEL}] URL final após navegação`, { finalUrl })

    // ── Aceitar cookies / página de consentimento ────────────────────────────
    for (const sel of [
      '#L2AGLb',
      'button[aria-label*="Aceitar tudo"]',
      'button[aria-label*="Accept all"]',
      'form[action*="consent"] button',
    ]) {
      try {
        if (await page.locator(sel).count() > 0) {
          await page.click(sel)
          await page.waitForTimeout(2000)
          logger.info(`[${CHANNEL}] Consent aceito: ${sel}`)
          break
        }
      } catch { /* ignora */ }
    }

    // ── Clicar na aba de avaliações ──────────────────────────────────────────
    for (const sel of [
      'button[aria-label*="Avaliações"]',
      'button[aria-label*="Reviews"]',
      '[role="tab"]:has-text("Avaliações")',
      '[role="tab"]:has-text("Reviews")',
    ]) {
      try {
        if (await page.locator(sel).count() > 0) {
          await page.click(sel)
          await page.waitForTimeout(2500)
          logger.info(`[${CHANNEL}] Aba clicada: ${sel}`)
          break
        }
      } catch { /* tenta próximo */ }
    }

    // ── Aguardar reviews no DOM ──────────────────────────────────────────────
    // Tentamos múltiplos indicadores de que reviews carregaram
    const reviewLoaded = await Promise.race([
      page.waitForSelector('[data-review-id]',           { timeout: timeoutMs }).then(() => 'review-id'),
      page.waitForSelector('.MyEned',                    { timeout: timeoutMs }).then(() => 'MyEned'),
      page.waitForSelector('[aria-label*="estrelas"]',   { timeout: timeoutMs }).then(() => 'stars'),
      page.waitForSelector('[aria-label*="stars"]',      { timeout: timeoutMs }).then(() => 'stars'),
      new Promise<string>(r => setTimeout(() => r('timeout'), timeoutMs)),
    ])

    logger.info(`[${CHANNEL}] Indicador de reviews carregado: ${reviewLoaded}`)

    if (reviewLoaded === 'timeout') {
      const title = await page.title().catch(() => 'N/A')
      const snippet = await page.evaluate(() => document.body?.innerText?.slice(0, 400) ?? '').catch(() => '')
      logger.warn(`[${CHANNEL}] Timeout aguardando reviews`, { finalUrl: page.url(), title, snippet })
      // Retorna o que conseguimos via rede
      return networkReviews.slice(0, maxReviews)
    }

    // ── Ordenar por "Mais recentes" ──────────────────────────────────────────
    try {
      for (const sel of [
        'button[aria-label*="Ordenar avaliações"]',
        'button[aria-label*="Sort reviews"]',
        'button[aria-label="Ordenar"]',
        'button[aria-label="Sort"]',
        '[jsaction*="sortReviews"]',
      ]) {
        if (await page.locator(sel).count() > 0) {
          await page.click(sel)
          await page.waitForTimeout(1000)

          for (const opt of [
            '[role="menuitemradio"]:has-text("Mais recentes")',
            '[role="menuitemradio"]:has-text("Newest")',
            'li:has-text("Mais recentes")',
          ]) {
            if (await page.locator(opt).count() > 0) {
              await page.click(opt)
              await page.waitForTimeout(2500)
              logger.info(`[${CHANNEL}] Ordenado por mais recentes`)
              break
            }
          }
          break
        }
      }
    } catch (e) {
      logger.warn(`[${CHANNEL}] Não foi possível ordenar`, { err: String(e) })
    }

    // ── Rolar para carregar mais reviews ─────────────────────────────────────
    // Testa múltiplos containers scrolláveis
    const scrollContainer = await page.evaluate(() => {
      const candidates = [
        document.querySelector('[role="feed"]'),
        document.querySelector('.m6QErb'),
        document.querySelector('[aria-label*="Avaliações"]'),
        document.querySelector('[aria-label*="Reviews"]'),
      ]
      for (const el of candidates) {
        if (el && el.scrollHeight > el.clientHeight) return el.className
      }
      return null
    })

    logger.info(`[${CHANNEL}] Container scroll detectado`, { scrollContainer })

    let prevCount = 0
    let stale = 0
    for (let i = 0; i < 12 && stale < 3; i++) {
      const count = await page.locator('[data-review-id], .MyEned').count()
      if (count >= maxReviews) break
      if (count === prevCount) { stale++; } else { stale = 0 }
      prevCount = count

      // Scroll do container identificado ou fallback para scroll de tela
      await page.evaluate((cls) => {
        const el = cls
          ? document.querySelector(`.${cls.split(' ')[0]}`)
          : null
        if (el) el.scrollBy(0, 2000)
        else window.scrollBy(0, 2000)
      }, scrollContainer)

      await page.waitForTimeout(1500)
    }

    // ── Expandir reviews truncados ────────────────────────────────────────────
    for (const sel of ['.w8nwRe', 'button[aria-label*="Ver mais"]', 'button[aria-label*="See more"]']) {
      const btns = await page.locator(sel).all()
      for (const btn of btns) {
        try { await btn.click({ timeout: 1500 }) } catch { /* ignora */ }
      }
    }
    await page.waitForTimeout(600)

    // ── Extrair do DOM ────────────────────────────────────────────────────────
    const domReviews: ScrapedReview[] = await page.evaluate(() => {
      // Tenta localizar cards por múltiplos seletores
      const cards = Array.from(
        document.querySelectorAll('[data-review-id], [jsaction*="review"]:has(.MyEned), .jJc9Ad')
      )

      return cards.map(card => {
        const reviewId = card.getAttribute('data-review-id') ?? ''

        const ratingEl = card.querySelector('[aria-label*="estrela"], [aria-label*="star"], .kvMYJc')
        const ratingLabel = ratingEl?.getAttribute('aria-label') ?? ''
        const ratingStr = ratingLabel.match(/(\d(?:[.,]\d)?)/)?.[1]
        const rating = ratingStr !== undefined ? parseFloat(ratingStr.replace(',', '.')) : undefined

        const textEl =
          card.querySelector('.wiI7pd') ??
          card.querySelector('.MyEned') ??
          card.querySelector('[class*="review-full-text"]')
        const body = textEl?.textContent?.trim() ?? ''

        const authorEl = card.querySelector('.d4r55') ?? card.querySelector('button[aria-label]')
        const author = authorEl?.textContent?.trim() ?? ''

        const timeEl = card.querySelector('.rsqaWe') ?? card.querySelector('[class*="publish-date"]')
        const relativeTime = timeEl?.textContent?.trim() ?? ''

        const likesEl = card.querySelector('.pkWtMe')
        const likes = parseInt(likesEl?.textContent?.trim() ?? '0', 10) || 0

        return { reviewId, rating, body, author, relativeTime, likes }
      })
    })

    const validDom = domReviews.filter(r => r.author || r.body)
    logger.info(`[${CHANNEL}] DOM extraiu`, { domCount: validDom.length, networkCount: networkReviews.length })

    // Merge: rede + DOM, preferindo o que tiver mais reviews
    const merged = networkReviews.length > validDom.length ? networkReviews : validDom
    return merged.slice(0, maxReviews)

  } finally {
    if (browser) await browser.close()
  }
}

// ── Parser da resposta interna do Google Maps (formato ")]}'") ────────────────
// O Google retorna arrays aninhados. Tentamos extrair dados de review
// procurando padrões: [string, string, null, null, number (rating), string (text), ...]

function tryParseGoogleReviewArray(jsonStr: string, placeId: string): ScrapedReview[] {
  try {
    const data = JSON.parse(jsonStr)
    const reviews: ScrapedReview[] = []
    collectReviews(data, reviews, 0)

    // Deduplica por reviewId
    const seen = new Set<string>()
    return reviews.filter(r => {
      if (seen.has(r.reviewId)) return false
      seen.add(r.reviewId)
      return true
    })
  } catch {
    return []
  }

  // Percorre recursivamente o array tentando identificar estruturas de review
  function collectReviews(node: unknown, out: ScrapedReview[], depth: number): void {
    if (depth > 12 || !Array.isArray(node)) return

    for (const item of node) {
      if (!Array.isArray(item)) continue

      // Heurística: array com [string, string, null, null, número 1-5, string longa...]
      // É um possível review quando:
      // - Tem pelo menos 6 elementos
      // - O 5° elemento (index 4) é um número entre 1 e 5
      // - O 6° elemento (index 5) é uma string com conteúdo
      if (
        item.length >= 6 &&
        typeof item[0] === 'string' && item[0].length > 5 &&   // possível ID
        typeof item[4] === 'number' && item[4] >= 1 && item[4] <= 5 &&
        typeof item[5] === 'string' && item[5].length > 5
      ) {
        const reviewId = String(item[0])
        const author   = typeof item[1] === 'string' ? item[1] : ''
        const rating   = item[4] as number
        const body     = item[5] as string
        // Timestamp em ms pode estar em vários índices; procuramos o primeiro número grande
        let relativeTime = ''
        for (let i = 6; i < Math.min(item.length, 20); i++) {
          if (typeof item[i] === 'string' && (item[i] as string).length > 3) {
            relativeTime = item[i] as string
            break
          }
        }

        out.push({ reviewId, rating, body, author, relativeTime, likes: 0 })
      }

      // Recursão
      collectReviews(item, out, depth + 1)
    }
  }
}

// ── Retry com backoff exponencial ────────────────────────────────────────────

async function fetchWithRetry<T>(fn: () => Promise<T>, retries = 3): Promise<T> {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn()
    } catch (err: unknown) {
      const status = axios.isAxiosError(err) ? err.response?.status : undefined
      const retryable = status === 429 || (status !== undefined && status >= 500)

      if (!retryable || i === retries - 1) {
        if (axios.isAxiosError(err) && (status === 401 || status === 403)) {
          await supabase.from('channel_connectors')
            .update({ status: 'pending_auth', error_message: `Token inválido: ${(err as Error).message}` })
            .eq('id', 'unknown')
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

// ── Normalização — API legada (places/details) ────────────────────────────────

function normalizeOld(raw: OldReview, connector: ChannelConnector): NormalizedReview {
  // A API legada não retorna um ID de review; usamos hash autor+timestamp como ID estável
  const external_id = createHash('sha256')
    .update(`${connector.external_id}:${raw.author_name ?? ''}:${raw.time}`)
    .digest('hex')
    .slice(0, 20)

  const review: NormalizedReview = {
    tenant_id:    connector.tenant_id,
    business_id:  connector.business_id,
    connector_id: connector.id,
    channel:      CHANNEL,
    external_id,
    published_at: new Date(raw.time * 1000).toISOString(),
    sentiment:    'unanalyzed',
    raw_data:     raw as unknown as Record<string, unknown>,
  }

  if (raw.rating !== undefined)  review.rating      = raw.rating
  if (raw.text?.trim())          review.body        = raw.text.trim()
  if (raw.author_name?.trim())   review.author_name = raw.author_name.trim()

  return review
}

// ── Normalização — API Nova (places.googleapis.com) ──────────────────────────

function normalizeNew(raw: GoogleReview, connector: ChannelConnector): NormalizedReview {
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

  const rating = raw.rating !== undefined ? Math.min(5, Math.max(0, raw.rating)) : undefined
  const body   = raw.text?.text?.trim() || undefined
  const lang   = raw.text?.languageCode ?? 'pt'
  const author = raw.authorAttribution?.displayName?.trim() || undefined

  if (rating !== undefined) review.rating      = rating
  if (body   !== undefined) review.body        = body
  if (lang   !== undefined) review.language    = lang
  if (author !== undefined) review.author_name = author

  return review
}

// ── Normalização — Playwright scraper ────────────────────────────────────────

function normalizeScraped(raw: ScrapedReview, connector: ChannelConnector): NormalizedReview {
  const external_id = raw.reviewId || createHash('sha256')
    .update(`${connector.business_id}:${raw.author}:${raw.relativeTime}`)
    .digest('hex')
    .slice(0, 16)

  const review: NormalizedReview = {
    tenant_id:    connector.tenant_id,
    business_id:  connector.business_id,
    connector_id: connector.id,
    channel:      CHANNEL,
    external_id,
    published_at: parseRelativeTime(raw.relativeTime) ?? new Date().toISOString(),
    sentiment:    'unanalyzed',
    raw_data:     raw as unknown as Record<string, unknown>,
  }

  if (raw.rating !== undefined) review.rating      = raw.rating
  if (raw.body)                 review.body        = raw.body
  if (raw.author)               review.author_name = raw.author
  if (raw.likes > 0)            review.upvotes     = raw.likes

  return review
}

// ── Parser de tempo relativo ──────────────────────────────────────────────────

function parseRelativeTime(text: string): string | null {
  if (!text) return null
  const t = text.toLowerCase().trim()
  const now = Date.now()

  if (/^(hoje|today|agora|just now|neste momento)$/.test(t)) return new Date(now).toISOString()
  if (/^(ontem|yesterday)$/.test(t)) return new Date(now - 86_400_000).toISOString()

  const match =
    t.match(/há\s+(\d+)\s+(segundo|minuto|hora|dia|semana|mês|mes|ano)/) ??
    t.match(/(\d+)\s+(second|minute|hour|day|week|month|year)s?\s+ago/)

  if (match) {
    const nStr = match[1]
    const unit = match[2]
    if (nStr !== undefined && unit !== undefined) {
      const n = parseInt(nStr, 10)
      const msMap: Record<string, number> = {
        segundo: 1_000, second: 1_000, minuto: 60_000, minute: 60_000,
        hora: 3_600_000, hour: 3_600_000, dia: 86_400_000, day: 86_400_000,
        semana: 7 * 86_400_000, week: 7 * 86_400_000,
        mês: 30 * 86_400_000, mes: 30 * 86_400_000, month: 30 * 86_400_000,
        ano: 365 * 86_400_000, year: 365 * 86_400_000,
      }
      const ms = msMap[unit]
      if (ms !== undefined) return new Date(now - n * ms).toISOString()
    }
  }

  return null
}
