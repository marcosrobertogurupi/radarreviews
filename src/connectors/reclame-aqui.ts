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
import { chromium } from 'playwright-extra'
import StealthPlugin from 'playwright-stealth'
import { z } from 'zod'
import { logger } from '../lib/logger.js'
import { ingestReviews } from '../lib/ingest.js'
import type { ChannelConnector, JobResult } from '../types/connector.js'
import type { NormalizedReview } from '../types/review.js'

// Ativar stealth
chromium.use(StealthPlugin())


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

  logger.info(`[${CHANNEL}] Iniciando scraping`, {
    connector_id: connector.id,
    slug,
    max_pages: maxPages,
  })

  let browser = null
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

    const context = await browser.newContext({
      userAgent: USER_AGENT,
      locale: 'pt-BR',
      timezoneId: 'America/Sao_Paulo',
      viewport: { width: 1366, height: 768 },
    })

    const page = await context.newPage()
    page.setDefaultTimeout(timeoutMs)

    const allComplaints: ReclameAquiComplaint[] = []

    // Limpeza do slug: garantir minúsculas e hífens no lugar de espaços
    const sanitizedSlug = slug.trim().toLowerCase().replace(/\s+/g, '-')

    // Iterar pelas páginas
    for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
      const url = `${BASE_URL}/empresa/${sanitizedSlug}/lista-reclamacoes/?pagina=${pageNum}`

      logger.info(`[${CHANNEL}] Navegando para página ${pageNum}`, {
        connector_id: connector.id,
        url,
      })

      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs * 2 })

        // Aguardar o Next.js terminar de renderizar (aumentado para estabilidade)
        await page.waitForTimeout(5000)

        // Estratégia 1: Extrair do __NEXT_DATA__ (SSR — mais confiável)
        const nextDataComplaints = await extractFromNextData(page, sanitizedSlug)

        if (nextDataComplaints.length > 0) {
          logger.info(`[${CHANNEL}] Dados extraídos via __NEXT_DATA__`, {
            page: pageNum,
            count: nextDataComplaints.length,
          })
          allComplaints.push(...nextDataComplaints)

          // Se retornou menos que o esperado, chegamos na última página
          if (nextDataComplaints.length < 10) break
          continue
        }

        // Estratégia 2: Fallback para scraping via DOM
        const domComplaints = await extractFromDom(page, sanitizedSlug)

        if (domComplaints.length > 0) {
          logger.info(`[${CHANNEL}] Dados extraídos via DOM`, {
            page: pageNum,
            count: domComplaints.length,
          })
          allComplaints.push(...domComplaints)

          if (domComplaints.length < 5) break
          continue
        }

        // Nenhuma reclamação encontrada nesta página — fim da paginação
        logger.info(`[${CHANNEL}] Nenhuma reclamação encontrada na página ${pageNum} — finalizando`)
        break
      } catch (pageError) {
        logger.warn(`[${CHANNEL}] Erro ao processar página ${pageNum}`, {
          error: pageError instanceof Error ? pageError.message : String(pageError),
        })
        // Continua para tentar a próxima página
        if (pageNum === 1) throw pageError // Falha total na primeira página = erro crítico
      }
    }

    result.reviews_fetched = allComplaints.length

    if (allComplaints.length === 0) {
      logger.info(`[${CHANNEL}] Nenhuma reclamação encontrada para ${sanitizedSlug}`)
      return result
    }

    // Buscar corpo completo das reclamações que só têm título
    const fetchBody = (connector.config['fetch_body'] as boolean) ?? true
    if (fetchBody) {
      const withoutBody = allComplaints.filter(c => !c.description && c.url && c.url.includes('/reclamacao/'))
      const MAX_BODY_FETCH = (connector.config['max_body_fetch'] as number) ?? 20
      const toFetch = withoutBody.slice(0, MAX_BODY_FETCH)

      if (toFetch.length > 0) {
        logger.info(`[${CHANNEL}] Buscando corpo de ${toFetch.length} reclamações`)
        for (const complaint of toFetch) {
          try {
            await page.goto(complaint.url!, { waitUntil: 'domcontentloaded', timeout: timeoutMs })
            await page.waitForTimeout(2000)
            const pageData = await page.evaluate(() => {
              const nextEl = document.getElementById('__NEXT_DATA__')
              if (nextEl) {
                try {
                  const data = JSON.parse(nextEl.textContent ?? '')
                  const pp = data?.props?.pageProps
                  const c = pp?.complaint ?? pp?.initialData?.complaint
                  if (c) return {
                    body: String(c.description ?? c.text ?? ''),
                    date: String(c.createdDate ?? c.date ?? c.data ?? ''),
                  }
                } catch { /* continua */ }
              }
              const el = document.querySelector('[class*="complaint-description"], [class*="ComplaintDescription"], [class*="description"], [data-testid*="description"]')
              const timeEl = document.querySelector('time[datetime], [class*="date"], [class*="Date"]')
              return {
                body: el?.textContent?.trim() ?? null,
                date: timeEl?.getAttribute('datetime') ?? timeEl?.textContent?.trim() ?? null,
              }
            })
            if (pageData.body) complaint.description = pageData.body
            if (pageData.date && !complaint.date) complaint.date = pageData.date
          } catch {
            // Ignora erros individuais de página
          }
        }
      }
    }

    // Normalizar e ingerir
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
    result.error = error instanceof Error ? error.message : String(error)
    logger.error(`[${CHANNEL}] Erro crítico no conector ${connector.id}`, {
      error,
      connector_id: connector.id,
    })
  } finally {
    // Sempre fecha o browser para liberar recursos
    if (browser) {
      await browser.close()
    }
  }

  return result
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

    const nextData = JSON.parse(nextDataJson)

    // Percorrer a árvore do Next.js para encontrar os dados de reclamações
    // O caminho pode variar: props.pageProps.complaints ou queries[0].data.complaints
    const pageProps = nextData?.props?.pageProps

    // Tentar diferentes caminhos possíveis na estrutura do Next.js
    const complaintsRaw =
      pageProps?.complaints?.LAST ??
      pageProps?.complaints ??
      pageProps?.initialData?.complaintList?.complaints ??
      pageProps?.initialData?.complaints ??
      null

    if (!complaintsRaw || !Array.isArray(complaintsRaw)) return []

    return complaintsRaw
      .map((c: Record<string, unknown>) => {
        const url = String(c['complaintUrl'] ?? c['url'] ?? `https://www.reclameaqui.com.br/empresa/${companySlug}`)
        // Rejeita reclamações cujo URL pertence a outra empresa
        if (url.includes('/empresa/') && !url.includes(`/empresa/${companySlug}/`)) return null

        const parsed = ReclameAquiComplaintSchema.safeParse({
          id: String(c['id'] ?? c['_id'] ?? ''),
          title: String(c['title'] ?? c['titulo'] ?? ''),
          description: String(c['description'] ?? c['descricao'] ?? c['text'] ?? ''),
          status: String(c['status'] ?? ''),
          author: String(c['demanderName'] ?? c['author'] ?? c['nome'] ?? ''),
          date: String(c['createdDate'] ?? c['date'] ?? c['data'] ?? ''),
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
          const dateEl = container.querySelector('time, [class*="date"], [class*="Date"]')
          const statusEl = container.querySelector('[class*="status"], [class*="Status"], [class*="badge"]')

          const href = (link as HTMLAnchorElement).href
          // Extrair o ID/slug da URL: /reclamacao/empresa/titulo-XXXXXXXX/
          const urlParts = href.split('/')
          const lastPart = urlParts[urlParts.length - 2] ?? ''
          const idMatch = lastPart.match(/-([A-Z0-9]+)$/)
          const id = idMatch ? idMatch[1] : lastPart

          return {
            id,
            title: titleEl?.textContent?.trim() ?? '',
            date: dateEl?.getAttribute('datetime') ?? dateEl?.textContent?.trim() ?? '',
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
    ...(raw.url ? { url: raw.url } : {}),
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

  // ISO 8601 (ex: "2024-04-17T15:30:00.000Z" ou "2024-04-17")
  try {
    const d = new Date(dateStr)
    if (!isNaN(d.getTime()) && d.getFullYear() > 2000) return d.toISOString()
  } catch { /* continua */ }

  // Formato brasileiro com hora: "17/04/2024 às 15:30" ou "17/04/2024 15:30"
  const brDateTime = dateStr.match(/(\d{2})\/(\d{2})\/(\d{4})[^\d]*(\d{2}):(\d{2})/)
  if (brDateTime) {
    const [, day, month, year, hour, min] = brDateTime
    const d = new Date(`${year}-${month}-${day}T${hour}:${min}:00-03:00`)
    if (!isNaN(d.getTime())) return d.toISOString()
  }

  // Formato brasileiro simples: "17/04/2024"
  const brMatch = dateStr.match(/(\d{2})\/(\d{2})\/(\d{4})/)
  if (brMatch) {
    const [, day, month, year] = brMatch
    const d = new Date(`${year}-${month}-${day}T12:00:00-03:00`)
    if (!isNaN(d.getTime())) return d.toISOString()
  }

  // Timestamp unix em milissegundos (ex: 1713369600000)
  if (/^\d{13}$/.test(dateStr.trim())) {
    const d = new Date(parseInt(dateStr, 10))
    if (!isNaN(d.getTime())) return d.toISOString()
  }

  return null
}
