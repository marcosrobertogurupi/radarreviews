import { chromium } from 'playwright-core'
import { GMAPS_SELECTORS } from './selectors.js'
import { getDaysDiff } from './mapper.js'
import { logger } from '../../lib/logger.js'
import type { GoogleMapsConfig, RawGoogleReview } from './types.js'

const LAUNCH_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--disable-gpu',
  '--disable-blink-features=AutomationControlled',
  '--lang=pt-BR',
]

/**
 * Scraper principal do Google Maps usando Playwright.
 */
export async function scrapeGoogleMapsReviews(
  placeId: string,
  config: GoogleMapsConfig
): Promise<RawGoogleReview[]> {
  const reviews: RawGoogleReview[] = []
  const maxReviews = config.max_reviews ?? 50
  const sinceDays = config.since_days ?? 90
  
  logger.info(`[GoogleMaps] Iniciando scraping para PlaceID: ${placeId}`, { maxReviews, sinceDays })

  const browser = await chromium.launch({
    headless: true,
    args: LAUNCH_ARGS,
  })

  try {
    const context = await browser.newContext({
      userAgent: getRandomUserAgent(),
      viewport: { width: 1366, height: 768 },
      locale: 'pt-BR',
      timezoneId: 'America/Sao_Paulo',
    })

    // Evasão de detecção básica
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined })
    })

    const page = await context.newPage()
    page.setDefaultTimeout(30000)

    // 1. Navegação
    const url = `https://www.google.com/maps/place/?q=place_id:${placeId}&hl=pt-BR`
    await page.goto(url, { waitUntil: 'domcontentloaded' })
    await randomDelay(3000, 2000)

    // Aceitar cookies/consentimento se aparecer
    await handleConsent(page)

    // 2. Clicar na aba de avaliações
    const reviewsTabSelector = await findElement(page, GMAPS_SELECTORS.REVIEWS_TAB)
    if (!reviewsTabSelector) {
      throw new Error('Aba de avaliações não encontrada na página do local.')
    }
    await humanClick(page, reviewsTabSelector)
    await randomDelay(2000, 1000)

    // 3. Aguardar painel de reviews
    const panelSelector = await findElement(page, GMAPS_SELECTORS.REVIEWS_PANEL)
    if (!panelSelector) {
      throw new Error('Painel de reviews não carregou após clicar na aba.')
    }

    // 4. Ordenar por mais recentes
    await sortByNewest(page)
    await randomDelay(1500, 500)

    // 5. Loop de Scroll e Extração
    let consecutiveEmptyScrolls = 0
    let prevCount = 0

    while (reviews.length < maxReviews) {
      // Expandir textos longos
      await expandLongReviews(page)

      // Extrair o que está visível
      const visibleReviews = await extractVisibleReviews(page, placeId)

      // Filtrar novos e verificar data
      let reachedDateLimit = false
      for (const r of visibleReviews) {
        if (!reviews.find(existing => existing.id === r.id)) {
          const days = getDaysDiff(r.date_text)
          if (days > sinceDays) {
            reachedDateLimit = true
            break
          }
          reviews.push(r)
        }
      }

      if (reachedDateLimit || reviews.length >= maxReviews) break

      if (reviews.length === prevCount) {
        consecutiveEmptyScrolls++
        if (consecutiveEmptyScrolls >= 3) {
          logger.info('[GoogleMaps] Fim da lista de reviews atingido (scroll vazio).')
          break
        }
      } else {
        consecutiveEmptyScrolls = 0
        prevCount = reviews.length
      }

      // Rolar o painel
      await scrollPanel(page, panelSelector)
      await randomDelay(1500, 1000)
    }

    logger.info(`[GoogleMaps] Scraping finalizado. Total coletado: ${reviews.length}`)

  } catch (error) {
    logger.error('[GoogleMaps] Erro durante o scraping:', { error: error instanceof Error ? error.message : String(error) })
    throw error
  } finally {
    await browser.close()
  }

  return reviews
}

// ── Helpers de Interação ──────────────────────────────────────────

async function handleConsent(page: import('playwright-core').Page) {
  for (const selector of GMAPS_SELECTORS.CONSENT_BUTTONS) {
    try {
      const btn = page.locator(selector)
      if (await btn.count() > 0) {
        await btn.click()
        await page.waitForTimeout(1000)
        break
      }
    } catch { /* ignore */ }
  }
}

async function sortByNewest(page: import('playwright-core').Page) {
  try {
    const sortBtnSelector = await findElement(page, GMAPS_SELECTORS.SORT_BUTTON)
    if (!sortBtnSelector) return
    
    await humanClick(page, sortBtnSelector)
    await randomDelay(800, 400)

    const newestOptSelector = await findElement(page, GMAPS_SELECTORS.SORT_NEWEST)
    if (!newestOptSelector) return

    await humanClick(page, newestOptSelector)
    await randomDelay(2000, 1000)
  } catch (e) {
    logger.warn('[GoogleMaps] Falha ao tentar ordenar por mais recentes. Continuando com padrão.')
  }
}

async function extractVisibleReviews(page: import('playwright-core').Page, placeId: string): Promise<RawGoogleReview[]> {
  return page.evaluate(({ selectors, placeId, now }) => {
    const items = document.querySelectorAll(selectors.REVIEW_ITEM.join(', '))
    return Array.from(items).map(el => {
      const ratingEl = el.querySelector(selectors.REVIEW_RATING)
      const ratingMatch = ratingEl?.getAttribute('aria-label')?.match(/(\d+)/)

      const authorEl = el.querySelector(selectors.REVIEW_AUTHOR)
      const dateEl = el.querySelector(selectors.REVIEW_DATE)
      const textEl = el.querySelector(selectors.REVIEW_TEXT)

      const author = authorEl?.textContent?.trim() || 'Anônimo'
      const dateText = dateEl?.textContent?.trim() || ''

      // ID: data-review-id (primário) → filho com atributo → fallback composto
      const rawId =
        el.getAttribute('data-review-id') ||
        el.querySelector('[data-review-id]')?.getAttribute('data-review-id') ||
        el.getAttribute('data-jiid') ||
        ''

      // Fallback: hash simples de autor + data para nunca perder um review
      const fallbackId = rawId
        ? rawId
        : `fb_${(author + dateText)
            .split('')
            .reduce((acc, c) => ((acc * 31 + c.charCodeAt(0)) >>> 0), 0)
            .toString(16)}_${placeId.slice(-6)}`

      return {
        id: fallbackId,
        author,
        rating: ratingMatch?.[1] ? parseInt(ratingMatch[1], 10) : null,
        date_text: dateText,
        text: textEl?.textContent?.trim() || '',
        place_id: placeId,
        scraped_at: now,
      }
    }).filter(r => r.id) // fallbackId nunca é vazio, mas mantemos o guard
  }, { selectors: GMAPS_SELECTORS, placeId, now: new Date().toISOString() })
}

async function expandLongReviews(page: import('playwright-core').Page) {
  try {
    const buttons = await page.$$(GMAPS_SELECTORS.REVIEW_MORE_BTN.join(', '))
    for (const btn of buttons.slice(0, 5)) {
      await btn.click().catch(() => {})
      await page.waitForTimeout(200)
    }
  } catch { /* ignore */ }
}

async function scrollPanel(page: import('playwright-core').Page, selector: string) {
  await page.evaluate((sel) => {
    const panel = document.querySelector(sel)
    if (panel) {
      panel.scrollTop += panel.scrollHeight
    }
  }, selector)
}

async function humanClick(page: import('playwright-core').Page, selector: string) {
  const el = page.locator(selector).first()
  const box = await el.boundingBox()
  if (box) {
    await page.mouse.move(
      box.x + box.width / 2 + (Math.random() - 0.5) * 5,
      box.y + box.height / 2 + (Math.random() - 0.5) * 5
    )
    await page.waitForTimeout(100 + Math.random() * 100)
  }
  await el.click()
}

async function findElement(page: import('playwright-core').Page, selectors: string[]): Promise<string | null> {
  for (const s of selectors) {
    try {
      if (await page.locator(s).count() > 0) return s
    } catch { /* next */ }
  }
  return null
}

function randomDelay(base: number, jitter: number): Promise<void> {
  return new Promise(r => setTimeout(r, base + Math.random() * jitter))
}

function getRandomUserAgent(): string {
  const agents = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  ]
  return agents[Math.floor(Math.random() * agents.length)] || agents[0]!
}
