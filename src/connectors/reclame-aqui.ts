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
import StealthPlugin from 'puppeteer-extra-plugin-stealth'
import { z } from 'zod'
import { ingestReviews } from '../lib/ingest.js'
import { fetchReclameAquiComplaints } from '../lib/apify.js'
import { logger } from '../lib/logger.js'
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

  // --- ESTRATÉGIA PRINCIPAL: APIFY ---
  try {
    if (process.env['APIFY_TOKEN']) {
      logger.info(`[${CHANNEL}] Tentando coleta via Apify (Principal)`, { connector_id: connector.id, slug })
      const ctx = { tenant_id: connector.tenant_id, connector_id: connector.id }
      const apifyComplaints = await fetchReclameAquiComplaints(slug, 20, ctx)
      
      if (apifyComplaints.length > 0) {
        const normalized = apifyComplaints.map(c => normalize(c, connector))
        const ingest = await ingestReviews(normalized, CHANNEL, connector.id, connector.business_id)
        
        return {
          reviews_fetched: apifyComplaints.length,
          reviews_new: ingest.reviews_new,
          reviews_updated: ingest.reviews_updated
        }
      }
    }
  } catch (apifyError) {
    logger.warn(`[${CHANNEL}] Falha na Apify, tentando fallback local via Playwright...`, { 
      error: apifyError instanceof Error ? apifyError.message : String(apifyError) 
    })
  }

  // --- ESTRATÉGIA SECUNDÁRIA (FALLBACK): PLAYWRIGHT ---
  logger.info(`[${CHANNEL}] Iniciando scraping local (Fallback)`, {
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

    // Desabilitar flag de webdriver para reduzir detecção
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined })
    })

    const page = await context.newPage()
    page.setDefaultTimeout(timeoutMs)
    page.setDefaultNavigationTimeout(timeoutMs * 2)

    const allComplaints: ReclameAquiComplaint[] = []

    // Limpeza do slug: garantir minúsculas e hífens no lugar de espaços
    const sanitizedSlug = slug.trim().toLowerCase().replace(/\s+/g, '-')

    // URLs a tentar — começamos pela lista-reclamacoes, com fallback para a página principal
    // Para empresas com poucas reclamações (não verificadas), a lista-reclamacoes pode ser
    // vazia ou redirecionar para a página principal da empresa.
    const urlsToTry = [
      `${BASE_URL}/empresa/${sanitizedSlug}/lista-reclamacoes/?pagina=1`,
      `${BASE_URL}/empresa/${sanitizedSlug}/`,
    ]

    for (let urlIdx = 0; urlIdx < urlsToTry.length; urlIdx++) {
      const isMainPage = urlIdx > 0
      const maxPagesThisSource = isMainPage ? 1 : maxPages   // Página principal = 1 página apenas

      for (let pageNum = 1; pageNum <= maxPagesThisSource; pageNum++) {
        const url = isMainPage
          ? urlsToTry[urlIdx]!
          : `${BASE_URL}/empresa/${sanitizedSlug}/lista-reclamacoes/?pagina=${pageNum}`

        logger.info(`[${CHANNEL}] Navegando`, { connector_id: connector.id, url })

        try {
          await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs * 2 })
          await page.waitForTimeout(4000)

          const finalUrl = page.url()
          if (finalUrl !== url) {
            logger.info(`[${CHANNEL}] Redirecionado para`, { finalUrl })
          }

          // Estratégia 1: Extrair do __NEXT_DATA__
          const nextDataComplaints = await extractFromNextData(page, sanitizedSlug)

          if (nextDataComplaints.length > 0) {
            logger.info(`[${CHANNEL}] __NEXT_DATA__ extraiu ${nextDataComplaints.length}`, { url })
            allComplaints.push(...nextDataComplaints)
            if (nextDataComplaints.length < 10) {
              // Última página desta fonte — interrompe paginação mas continua para próxima fonte se não houver nada
              break
            }
            continue
          }

          // Estratégia 2: DOM scraping
          const domComplaints = await extractFromDom(page, sanitizedSlug)

          if (domComplaints.length > 0) {
            logger.info(`[${CHANNEL}] DOM extraiu ${domComplaints.length}`, { url })
            allComplaints.push(...domComplaints)
            if (domComplaints.length < 5) break
            continue
          }

          logger.info(`[${CHANNEL}] Nenhuma reclamação na URL`, { url })
          break   // Vai tentar próxima URL (página principal)

        } catch (pageError) {
          logger.warn(`[${CHANNEL}] Erro ao processar`, {
            url,
            error: pageError instanceof Error ? pageError.message : String(pageError),
          })
          if (pageNum === 1 && urlIdx === urlsToTry.length - 1) throw pageError
        }
      }

      // Se já temos reclamações, não precisa tentar a próxima URL
      if (allComplaints.length > 0) break
    }

    result.reviews_fetched = allComplaints.length

    if (allComplaints.length === 0) {
      logger.info(`[${CHANNEL}] Nenhuma reclamação encontrada para ${sanitizedSlug}`)
      return result
    }

    // Buscar corpo completo das reclamações (sempre buscar para garantir que não venha cortado)
    const fetchBody = (connector.config['fetch_body'] as boolean) ?? true
    if (fetchBody) {
      // Filtramos apenas as que têm URL válida
      const toFetch = allComplaints.filter(c => c.url && c.url.includes('/reclamacao/'))
      const MAX_BODY_FETCH = (connector.config['max_body_fetch'] as number) ?? 30
      const limitedToFetch = toFetch.slice(0, MAX_BODY_FETCH)

      if (limitedToFetch.length > 0) {
        logger.info(`[${CHANNEL}] Buscando corpo detalhado de ${limitedToFetch.length} reclamações para evitar texto cortado`)
        for (const complaint of limitedToFetch) {
          try {
            await page.goto(complaint.url!, { waitUntil: 'domcontentloaded', timeout: timeoutMs })
            await page.waitForTimeout(2500) // Pequena pausa para garantir carregamento
            
            const pageData = await page.evaluate(() => {
              // 1. Tentar via __NEXT_DATA__ do detalhe (mais garantido)
              const nextEl = document.getElementById('__NEXT_DATA__')
              if (nextEl) {
                try {
                  const data = JSON.parse(nextEl.textContent ?? '')
                  const pp = data?.props?.pageProps
                  const c = pp?.complaint ?? pp?.initialData?.complaint ?? pp?.initialData?.complaintData ?? pp?.initialState?.complaint
                  if (c && (c.description || c.text)) {
                    return {
                      body: String(c.description ?? c.text ?? ''),
                      date: String(c.createdDate ?? c.date ?? c.data ?? c.createdAt ?? c.legacyComplaint?.createdDate ?? ''),
                    }
                  }
                } catch { /* continua */ }
              }
              
              // 2. Fallback via seletores DOM (seletores mais abrangentes)
              const selectors = [
                '[class*="complaint-description"]',
                '[class*="Description"]',
                '[data-testid="complaint-description"]',
                'p[class*="text"]',
                '.complain-body'
              ]
              
              let bodyText = null
              for (const sel of selectors) {
                const el = document.querySelector(sel)
                if (el && (el.textContent?.trim().length ?? 0) > 50) {
                  bodyText = el.textContent!.trim()
                  break
                }
              }

              const timeEl = document.querySelector('time[datetime], [class*="date"], [class*="Date"]')
              return {
                body: bodyText,
                date: timeEl?.getAttribute('datetime') ?? timeEl?.textContent?.trim() ?? null,
              }
            })

            if (pageData.body) {
              complaint.description = pageData.body
            }
            if (pageData.date && !complaint.date) {
              complaint.date = pageData.date
            }
          } catch (err) {
            logger.warn(`[${CHANNEL}] Erro ao buscar detalhe da reclamação: ${complaint.url}`, { error: err })
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
    const pageProps = nextData?.props?.pageProps

    // Log diagnóstico: mostrar as chaves de pageProps para depuração
    if (pageProps && typeof pageProps === 'object') {
      logger.info(`[reclame_aqui] __NEXT_DATA__ pageProps keys: ${Object.keys(pageProps).join(', ')}`)
    }

    // Tentar todos os caminhos conhecidos para reclamações no __NEXT_DATA__
    // O Reclame Aqui usa estruturas diferentes por tipo de página e versão
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
        const url = String(c['complaintUrl'] ?? c['url'] ?? `https://www.reclameaqui.com.br/empresa/${companySlug}`)
        // Rejeita reclamações cujo URL pertence a outra empresa
        if (url.includes('/empresa/') && !url.includes(`/empresa/${companySlug}/`)) return null

        const parsed = ReclameAquiComplaintSchema.safeParse({
          id: String(c['id'] ?? c['_id'] ?? ''),
          title: String(c['title'] ?? c['titulo'] ?? ''),
          description: String(c['description'] ?? c['descricao'] ?? c['text'] ?? ''),
          status: String(c['status'] ?? ''),
          author: String(c['demanderName'] ?? c['author'] ?? c['nome'] ?? ''),
          date: String(c['createdDate'] ?? c['date'] ?? c['data'] ?? c['createdAt'] ?? (c['legacyComplaint'] as Record<string,unknown> | undefined)?.['createdDate'] ?? ''),
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
  const s = dateStr.toLowerCase().trim()

  // 1. Datas relativas: "há 2 dias", "há 3 horas", "há 1 minuto"
  if (s.startsWith('há')) {
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

  // 2. ISO 8601 (ex: "2024-04-17T15:30:00.000Z")
  try {
    const d = new Date(dateStr)
    if (!isNaN(d.getTime()) && d.getFullYear() > 2000) return d.toISOString()
  } catch { /* continua */ }

  // 3. Formato brasileiro com hora: "17/04/2024 às 15:30" ou "17/04/24 15:30"
  const brDateTime = dateStr.match(/(\d{2})\/(\d{2})\/(\d{2,4})[^\d]*(\d{2}):(\d{2})/)
  if (brDateTime) {
    const [, day, month, yearStr, hour, min] = brDateTime
    const year = yearStr!.length === 2 ? `20${yearStr}` : yearStr!
    const d = new Date(`${year}-${month}-${day}T${hour}:${min}:00-03:00`)
    if (!isNaN(d.getTime())) return d.toISOString()
  }

  // 4. Formato brasileiro simples: "17/04/2024" ou "17/04/24"
  const brMatch = dateStr.match(/(\d{2})\/(\d{2})\/(\d{2,4})/)
  if (brMatch) {
    const [, day, month, yearStr] = brMatch
    const year = yearStr!.length === 2 ? `20${yearStr}` : yearStr!
    const d = new Date(`${year}-${month}-${day}T12:00:00-03:00`)
    if (!isNaN(d.getTime())) return d.toISOString()
  }

  // 5. Timestamp unix em milissegundos
  if (/^\d{13}$/.test(dateStr.trim())) {
    const d = new Date(parseInt(dateStr, 10))
    if (!isNaN(d.getTime())) return d.toISOString()
  }

  return null
}
