// Scraper TripAdvisor — Playwright Extra + Stealth
//
// Estratégia:
// 1. Descobre a URL da listagem via API de detalhes (cacheia em config.listing_url)
// 2. Navega para a URL com ordenação por mais recentes
// 3. Extrai via JSON-LD schema.org (primário — estável para SEO)
// 4. Fallback: extração DOM com múltiplos seletores
// 5. Pagina via padrão -orN- no URL até atingir since_days ou max_reviews

import { chromium } from 'playwright-extra'
import StealthPlugin from 'puppeteer-extra-plugin-stealth'
import { logger } from '../lib/logger.js'

chromium.use(StealthPlugin())

const CHANNEL = 'tripadvisor'
const REVIEWS_PER_PAGE = 10
const MAX_PAGES = 20

const LAUNCH_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--disable-gpu',
  '--single-process',
  '--disable-blink-features=AutomationControlled',
  '--lang=pt-BR',
]

export interface RawTripAdvisorScrapedReview {
  id: string
  author: string
  rating: number | null
  published_date: string  // ISO string
  title: string
  text: string
  trip_type?: string
}

// ── Função principal ─────────────────────────────────────────────

export async function scrapeTripAdvisorReviews(
  listingUrl: string,
  maxReviews = 50,
  sinceDays = 90
): Promise<RawTripAdvisorScrapedReview[]> {
  const reviews: RawTripAdvisorScrapedReview[] = []
  const seenIds = new Set<string>()
  const cutoffDate = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000)

  logger.info(`[${CHANNEL}:scraper] Iniciando`, { listingUrl, maxReviews, sinceDays })

  const browser = await chromium.launch({ headless: true, args: LAUNCH_ARGS })

  try {
    const context = await browser.newContext({
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      viewport: { width: 1366, height: 768 },
      locale: 'pt-BR',
      timezoneId: 'America/Sao_Paulo',
    })

    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined })
    })

    const page = await context.newPage()
    page.setDefaultTimeout(30_000)

    let reachedDateLimit = false

    for (
      let pageNum = 0;
      pageNum < MAX_PAGES && !reachedDateLimit && reviews.length < maxReviews;
      pageNum++
    ) {
      const offset = pageNum * REVIEWS_PER_PAGE
      const pageUrl = buildPageUrl(listingUrl, offset)

      logger.info(`[${CHANNEL}:scraper] Página ${pageNum + 1} — offset ${offset}`)
      await page.goto(pageUrl, { waitUntil: 'domcontentloaded' })
      await randomDelay(3000, 2000)

      // Primeira página: ordenar por mais recentes
      if (pageNum === 0) {
        await sortByMostRecent(page)
        await randomDelay(2500, 1000)
      }

      // Extrai reviews: JSON-LD → DOM
      const pageReviews = await extractReviews(page)

      if (pageReviews.length === 0) {
        logger.info(`[${CHANNEL}:scraper] Página sem reviews — encerrando`)
        break
      }

      for (const r of pageReviews) {
        if (seenIds.has(r.id)) continue
        seenIds.add(r.id)

        if (r.published_date) {
          const reviewDate = new Date(r.published_date)
          if (!isNaN(reviewDate.getTime()) && reviewDate < cutoffDate) {
            reachedDateLimit = true
            break
          }
        }

        reviews.push(r)
        if (reviews.length >= maxReviews) break
      }
    }
  } catch (err) {
    logger.error(`[${CHANNEL}:scraper] Erro fatal`, {
      error: err instanceof Error ? err.message : String(err),
    })
    throw err
  } finally {
    await browser.close()
  }

  logger.info(`[${CHANNEL}:scraper] Finalizado — ${reviews.length} reviews`)
  return reviews
}

// ── URL helpers ──────────────────────────────────────────────────

// TripAdvisor usa padrão -Reviews-orN- para paginação
// Ex: Hotel_Review-g123-d456-Reviews-Hotel_Name.html
//  → Hotel_Review-g123-d456-Reviews-or10-Hotel_Name.html (offset 10)
export function buildPageUrl(baseUrl: string, offset: number): string {
  if (offset === 0) return baseUrl
  // Remove offset existente se houver
  const cleaned = baseUrl.replace(/-or\d+-/, '-')
  if (cleaned.includes('-Reviews-')) {
    return cleaned.replace('-Reviews-', `-Reviews-or${offset}-`)
  }
  // Fallback: query param
  const sep = cleaned.includes('?') ? '&' : '?'
  return `${cleaned}${sep}offset=${offset}`
}

// ── Ordenação ────────────────────────────────────────────────────

async function sortByMostRecent(page: import('playwright-core').Page): Promise<void> {
  try {
    // Tenta clicar no botão de ordenação atual (padrão: "Mais relevantes")
    const sortBtnSelectors = [
      'button[aria-label*="Classificar"]',
      'button[aria-label*="Sort"]',
      'span:has-text("Mais relevantes")',
      'button:has-text("Mais relevantes")',
      'span:has-text("Most relevant")',
      '[data-testid*="sort-filter"]',
    ]

    let opened = false
    for (const sel of sortBtnSelectors) {
      try {
        const el = page.locator(sel).first()
        if ((await el.count()) > 0) {
          await el.click()
          await randomDelay(800, 300)
          opened = true
          break
        }
      } catch { /* tenta próximo */ }
    }

    if (!opened) {
      logger.warn(`[${CHANNEL}:scraper] Botão de ordenação não encontrado`)
      return
    }

    // Seleciona "Mais recentes"
    const recentSelectors = [
      '[data-value="RECENT"]',
      'span:has-text("Mais recentes")',
      'button:has-text("Mais recentes")',
      'a:has-text("Mais recentes")',
      '[aria-label*="Mais recentes"]',
      'span:has-text("Most recent")',
      '[data-value="recência"]',
    ]

    for (const sel of recentSelectors) {
      try {
        const el = page.locator(sel).first()
        if ((await el.count()) > 0) {
          await el.click()
          await randomDelay(2000, 1000)
          logger.info(`[${CHANNEL}:scraper] Ordenado por mais recentes`)
          return
        }
      } catch { /* tenta próximo */ }
    }

    logger.warn(`[${CHANNEL}:scraper] Opção "Mais recentes" não encontrada`)
  } catch (err) {
    logger.warn(`[${CHANNEL}:scraper] Erro ao ordenar: ${err instanceof Error ? err.message : String(err)}`)
  }
}

// ── Extração ─────────────────────────────────────────────────────

async function extractReviews(
  page: import('playwright-core').Page
): Promise<RawTripAdvisorScrapedReview[]> {
  const jsonLd = await extractFromJsonLd(page)
  if (jsonLd.length > 0) {
    logger.info(`[${CHANNEL}:scraper] JSON-LD: ${jsonLd.length} reviews`)
    return jsonLd
  }
  logger.info(`[${CHANNEL}:scraper] JSON-LD vazio — tentando DOM`)
  return extractFromDom(page)
}

// Extração via JSON-LD schema.org — estável, preferida
async function extractFromJsonLd(
  page: import('playwright-core').Page
): Promise<RawTripAdvisorScrapedReview[]> {
  return page.evaluate(() => {
    const results: Array<{
      id: string
      author: string
      rating: number | null
      published_date: string
      title: string
      text: string
    }> = []

    const scripts = document.querySelectorAll('script[type="application/ld+json"]')

    for (const script of scripts) {
      try {
        const data = JSON.parse(script.textContent || '{}') as Record<string, unknown>
        const items = Array.isArray(data) ? data : [data]

        for (const item of items as Record<string, unknown>[]) {
          const reviewList = Array.isArray(item['review']) ? item['review'] : []

          for (const rev of reviewList as Record<string, unknown>[]) {
            if (rev['@type'] !== 'Review') continue

            const ratingObj = rev['reviewRating'] as Record<string, unknown> | undefined
            const rating = ratingObj?.['ratingValue'] != null
              ? Number(ratingObj['ratingValue'])
              : null

            const authorObj = rev['author'] as Record<string, unknown> | undefined
            const author = (authorObj?.['name'] as string) || 'Anônimo'

            // ID: identifier > reviewId > fallback composto
            const id = String(
              rev['identifier'] ??
              rev['reviewId'] ??
              `${author}_${rev['datePublished'] ?? ''}`
            )

            results.push({
              id,
              author,
              rating,
              published_date: (rev['datePublished'] as string) || '',
              title: (rev['name'] as string) || '',
              text: (rev['reviewBody'] as string) || '',
            })
          }
        }
      } catch { /* JSON inválido — ignora */ }
    }

    return results
  })
}

// Extração via DOM — fallback quando JSON-LD está vazio
async function extractFromDom(
  page: import('playwright-core').Page
): Promise<RawTripAdvisorScrapedReview[]> {
  return page.evaluate(() => {
    const results: Array<{
      id: string
      author: string
      rating: number | null
      published_date: string
      title: string
      text: string
    }> = []

    // Tenta múltiplos seletores para o container de reviews
    const containerSelectors = [
      '[data-reviewid]',
      '[data-automation="reviewCard"]',
      'div[class*="review_container"]',
      'section[class*="review"]',
    ]

    let containers: NodeListOf<Element> | null = null
    for (const sel of containerSelectors) {
      const found = document.querySelectorAll(sel)
      if (found.length > 0) { containers = found; break }
    }

    if (!containers || containers.length === 0) return results

    for (const el of containers) {
      const reviewId =
        el.getAttribute('data-reviewid') ||
        el.getAttribute('data-review-id') ||
        ''
      if (!reviewId) continue

      // Rating: bubbles TripAdvisor ou aria-label
      let rating: number | null = null
      const ratingEl = el.querySelector(
        '[aria-label*="Excelente"], [aria-label*="Muito bom"], [aria-label*="estrela"], ' +
        '[class*="ui_bubble_rating"], [aria-label*="Horrível"], [aria-label*="Razoável"]'
      )
      if (ratingEl) {
        const label = ratingEl.getAttribute('aria-label') || ''
        const m = label.match(/(\d)/)
        if (m) {
          rating = parseInt(m[1])
        } else {
          // Padrão class bubble_50 = 5 estrelas, bubble_40 = 4, etc.
          const cls = ratingEl.className || ''
          const bm = cls.match(/bubble_(\d+)/)
          if (bm) rating = Math.round(parseInt(bm[1]) / 10)
        }
      }

      // Texto do review
      const textSelectors = [
        '[data-test-target="review-body"] q',
        '[data-test-target="review-body"]',
        'q[class]',
        'p[class*="partial_entry"]',
        'span[class*="ReviewText"]',
      ]
      let text = ''
      for (const sel of textSelectors) {
        const t = el.querySelector(sel)
        if (t?.textContent) { text = t.textContent.trim(); break }
      }

      // Título
      const titleEl = el.querySelector(
        '[data-test-target="review-title"], a[href*="ShowUserReviews"], h2'
      )
      const title = titleEl?.textContent?.trim() || ''

      // Autor
      const authorEl = el.querySelector('a[href*="/Profile/"], a[href*="/members/"]')
      const author = authorEl?.textContent?.trim() || 'Anônimo'

      // Data — TripAdvisor usa "janeiro de 2025" ou "Written January 2025"
      const dateEl = el.querySelector(
        '[class*="review_date"], [class*="ratingDate"], ' +
        '[class*="review_header"] span, span[class*="date"]'
      )
      const dateText = dateEl?.textContent?.trim() || ''
      const published_date = parseTripAdvisorMonthYear(dateText)

      results.push({ id: reviewId, author, rating, published_date, title, text })
    }

    // Parser de datas "janeiro de 2025" inline para ser executado no browser
    function parseTripAdvisorMonthYear(text: string): string {
      if (!text) return new Date().toISOString()
      const months: Record<string, number> = {
        janeiro: 1, jan: 1, fevereiro: 2, fev: 2,
        março: 3, mar: 3, abril: 4, abr: 4,
        maio: 5, junho: 6, jun: 6,
        julho: 7, jul: 7, agosto: 8, ago: 8,
        setembro: 9, set: 9, outubro: 10, out: 10,
        novembro: 11, nov: 11, dezembro: 12, dez: 12,
        january: 1, february: 2, march: 3, april: 4,
        may: 5, june: 6, july: 7, august: 8,
        september: 9, october: 10, november: 11, december: 12,
      }
      const lower = text.toLowerCase().replace(/\./g, '')
      for (const [name, num] of Object.entries(months)) {
        if (lower.includes(name)) {
          const yearMatch = lower.match(/\d{4}/)
          const year = yearMatch ? parseInt(yearMatch[0]) : new Date().getFullYear()
          return new Date(year, num - 1, 1).toISOString()
        }
      }
      return new Date().toISOString()
    }

    return results
  })
}

// ── Utilitários ──────────────────────────────────────────────────

function randomDelay(base: number, jitter: number): Promise<void> {
  return new Promise(r => setTimeout(r, base + Math.random() * jitter))
}
