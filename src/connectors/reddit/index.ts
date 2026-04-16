// Conector Reddit — Endpoints JSON Públicos (modo atual) + OAuth2 (futuro)
//
// MODO ATUAL: public — sem autenticação, usa endpoints JSON públicos do Reddit.
// O Reddit encerrou o self-service de OAuth em nov/2025. Novas apps exigem
// aprovação manual. Enquanto a aprovação está em andamento, este conector
// opera em modo público com rate limit de 10 req/min (delay >= 6000ms).
//
// config (JSONB) esperado:
// {
//   "mode": "public",
//   "search_terms": ["Nome da Empresa", "variação"],
//   "subreddits": ["brasil", "investimentos"],   // opcional — se vazio, busca global
//   "limit_per_request": 25,                     // máx 100
//   "delay_ms": 6000,                            // mínimo 6000 em modo público
//   "since_days": 30                             // ignora posts mais antigos
// }
//
// MIGRAÇÃO FUTURA PARA OAUTH:
// TODO(reddit-oauth): quando credenciais forem aprovadas pelo Reddit:
//   1. Adicionar client_id e client_secret no Supabase Vault
//   2. Atualizar config: mode="oauth"
//   3. Implementar fetchWithOAuth() substituindo fetchPublic()
//   4. Aumentar delay_ms para 1000ms (60 req/min com OAuth)
//   5. Remover limite de MAX_PAGES ou aumentar para 10

import axios from 'axios'
import * as cheerio from 'cheerio'
import 'dotenv/config'
import { logger } from '../../lib/logger.js'
import { ingestReviews } from '../../lib/ingest.js'
import type { ChannelConnector, JobResult } from '../../types/connector.js'
import type { NormalizedReview } from '../../types/review.js'
import type { RedditPublicConfig, RedditPost, RedditListing } from './types.js'

// ── Constantes ────────────────────────────────────────────────────

const CHANNEL = 'reddit' as const
const BASE_URL = 'https://www.reddit.com'
const MAX_PAGES = 3        // limite conservador para modo público (10 req/min)
const DEFAULT_DELAY_MS = 6_000
const DEFAULT_LIMIT = 25
const DEFAULT_SINCE_DAYS = 30

// User-Agents de navegadores reais para evitar bloqueios do Reddit
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Edge/123.0.0.0 Safari/537.36'
]

function getRandomUA(): string {
  const ua = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)]
  return (ua || USER_AGENTS[0]) as string
}

// ── Configuração do Proxy (Cloudflare Worker) ───────────────────
const PROXY_URL = process.env.REDDIT_PROXY_URL
const PROXY_KEY = process.env.REDDIT_PROXY_SECRET_KEY

// ── Função principal exportada ────────────────────────────────────

export async function run(connector: ChannelConnector): Promise<JobResult> {
  const result: JobResult = { reviews_fetched: 0, reviews_new: 0, reviews_updated: 0 }

  try {
    const config = (connector.config ?? {}) as RedditPublicConfig

    // Suporte retrocompatível: aceitar "keywords" ou "search_terms"
    const searchTerms = config.search_terms ?? config.keywords ?? []
    if (searchTerms.length === 0) {
      result.error =
        `Conector ${connector.id} não tem search_terms configurados. ` +
        `Configure via connector.config.search_terms (ex: ["NomeDaEmpresa"]).`
      return result
    }

    const delayMs         = config.delay_ms         ?? DEFAULT_DELAY_MS
    const limitPerRequest = config.limit_per_request ?? DEFAULT_LIMIT
    const sinceDays       = config.since_days        ?? DEFAULT_SINCE_DAYS
    const subreddits      = config.subreddits        ?? []
    const cutoff          = new Date(Date.now() - sinceDays * 86_400_000)

    logger.info(`[${CHANNEL}] Iniciando coleta`, {
      connector_id: connector.id,
      search_terms: searchTerms,
      subreddits: subreddits.length > 0 ? subreddits : 'global',
      since_days: sinceDays,
      mode: 'public',
    })

    const allPosts: RedditPost[] = []
    const urls = buildSearchUrls(searchTerms, subreddits, limitPerRequest)

    for (const baseUrl of urls) {
      let after: string | null = null

      for (let page = 0; page < MAX_PAGES; page++) {
        const url = after ? `${baseUrl}&after=${after}` : baseUrl

        // TODO(reddit-oauth): substituir sleep + fetchPublic por fetchWithOAuth
        // quando credenciais forem aprovadas. Ver comentário no topo do arquivo.
        await sleep(delayMs)

        const { posts, nextAfter, error, error_type } = await fetchPublic(url, 3, delayMs)

        if (error) {
          // Fallback para RSS se o JSON for bloqueado (403)
          if (error_type === 'transient' && error.includes('403')) {
            logger.info(`[${CHANNEL}] JSON bloqueado (403). Tentando fallback via RSS...`, { connector_id: connector.id, url })
            const rssResult = await fetchRSS(url.replace('.json', '.rss'))
            
            if (rssResult.posts.length > 0) {
              const valid = rssResult.posts.filter(p => new Date(p.created_utc * 1000) >= cutoff)
              allPosts.push(...valid)
              logger.info(`[${CHANNEL}] Sucesso via RSS Fallback`, { total: rssResult.posts.length, valid: valid.length })
              continue // Próxima página ou fim
            } else if (rssResult.error) {
               logger.warn(`[${CHANNEL}] RSS Fallback também falhou: ${rssResult.error}`)
            }
          }

          result.error = error
          if (error_type) {
            result.error_type = error_type
          }
          logger.warn(`[${CHANNEL}] ${error}`, { connector_id: connector.id, url })
          break
        }

        // Filtrar posts deletados e muito antigos
        const valid = posts.filter(p => {
          if (p.author === '[deleted]' || !p.title) return false
          return new Date(p.created_utc * 1000) >= cutoff
        })

        allPosts.push(...valid)

        logger.info(`[${CHANNEL}] Página ${page + 1} carregada`, {
          url_base: baseUrl.split('?')[0],
          total: posts.length,
          valid: valid.length,
        })

        // Parar paginação se: sem cursor ou posts mais antigos que cutoff
        // Nota: não usar posts.length < limit como critério — o after é a fonte da verdade
        const hasOldPosts = posts.some(p => new Date(p.created_utc * 1000) < cutoff)
        after = nextAfter
        if (!after || hasOldPosts) break
      }
    }

    result.reviews_fetched = allPosts.length

    if (allPosts.length === 0) {
      logger.info(`[${CHANNEL}] Nenhuma menção encontrada`, { connector_id: connector.id })
      return result
    }

    const normalized = allPosts.map(p => mapPostToReview(p, connector))
    const ingest = await ingestReviews(normalized, CHANNEL, connector.id, connector.business_id)

    result.reviews_new     = ingest.reviews_new
    result.reviews_updated = ingest.reviews_updated

    logger.info(`[${CHANNEL}] Job concluído`, {
      connector_id: connector.id,
      reviews_fetched: result.reviews_fetched,
      reviews_new: ingest.reviews_new,
    })

  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err)
    logger.error(`[${CHANNEL}] Erro crítico`, { connector_id: connector.id, error: result.error })
  }

  return result
}

// ── Construir URLs de busca ───────────────────────────────────────

function buildSearchUrls(
  searchTerms: string[],
  subreddits: string[],
  limit: number
): string[] {
  const urls: string[] = []

  for (const term of searchTerms) {
    const params = new URLSearchParams({
      q:     term,
      sort:  'new',
      limit: String(limit),
      type:  'link',
      t:     'month',
    })

    if (subreddits.length > 0) {
      // Busca restrita aos subreddits configurados
      for (const sub of subreddits) {
        const cleanSub = sub.replace(/^r\//i, '')
        params.set('restrict_sr', '1')
        urls.push(`${BASE_URL}/r/${cleanSub}/search.json?${params}`)
      }
    } else {
      // Busca global no Reddit todo
      urls.push(`${BASE_URL}/search.json?${params}`)
    }
  }

  return urls
}

// ── Fetch público (sem autenticação) ─────────────────────────────
// TODO(reddit-oauth): quando OAuth for aprovado, criar fetchWithOAuth()
// com header Authorization: Bearer ACCESS_TOKEN e URL oauth.reddit.com.
// TODO(reddit-oauth): aumentar delay_ms para 1000 (60 req/min vs 10 req/min atual)

async function fetchPublic(
  url: string,
  retries = 3,
  delayMs = DEFAULT_DELAY_MS
): Promise<{ posts: RedditPost[]; nextAfter: string | null; error?: string, error_type?: 'transient' | 'fatal' }> {
  for (let attempt = 0; attempt < retries; attempt++) {
    let status = 0
    try {
      let finalUrl = url
      const headers: Record<string, string> = {
        'User-Agent':      getRandomUA(),
        'Accept':          'application/json',
        'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8',
        'Cache-Control':   'no-cache',
      }

      // Se o proxy estiver configurado, redirecionar a chamada
      if (PROXY_URL && PROXY_KEY) {
        const urlObj = new URL(url)
        const redditPath = urlObj.pathname
        const proxyParams = new URLSearchParams(urlObj.search)
        proxyParams.set('path', redditPath)

        let proxyBase = PROXY_URL.trim()
        if (!proxyBase.startsWith('http')) {
          proxyBase = `https://${proxyBase}`
        }
        
        finalUrl = `${proxyBase}?${proxyParams.toString()}`
        headers['X-Proxy-Key'] = PROXY_KEY
        
        logger.info(`[${CHANNEL}] Usando Proxy Relay`, { redditPath })
      }

      const resp = await fetch(finalUrl as string, { headers })

      status = resp.status

      if (resp.ok) {
        const json = (await resp.json()) as RedditListing
        const children = json?.data?.children ?? []
        const posts = children
          .filter(c => c.kind === 't3')
          .map(c => c.data)
        return { posts, nextAfter: json?.data?.after ?? null }
      }

      // 403 — subreddit privado ou bloqueio temporário de IP
      if (status === 403) {
        const delay = Math.pow(2, attempt + 1) * delayMs
        logger.warn(`[${CHANNEL}] 403 Forbidden — possível bloqueio de IP. Aguardando ${delay}ms para retry`, { url, attempt })
        if (attempt < retries - 1) { await sleep(delay); continue }
        return { posts: [], nextAfter: null, error: `403 Forbidden: ${url}`, error_type: 'transient' }
      }

      // 429 — rate limit (muito comum em modo público)
      if (status === 429) {
        // Backoff exponencial agressivo para 429: 6s, 12s, 24s...
        const delay = Math.pow(2, attempt) * delayMs
        logger.warn(`[${CHANNEL}] 429 Rate Limit — aguardando ${delay}ms`, { url, attempt })
        if (attempt < retries - 1) { await sleep(delay); continue }
        return { posts: [], nextAfter: null, error: `429 Rate limit excedido após ${retries} tentativas: ${url}`, error_type: 'transient' }
      }

      // 404 — subreddit não existe
      if (status === 404) {
        return { posts: [], nextAfter: null, error: `404 Subreddit não encontrado: ${url}` }
      }

      return { posts: [], nextAfter: null, error: `HTTP ${status}: ${url}` }

    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (attempt < retries - 1) {
        logger.warn(`[${CHANNEL}] Erro de rede, tentando novamente em 10s`, { url, error: msg })
        await sleep(Math.max(delayMs, 1_000))
        continue
      }
      return { posts: [], nextAfter: null, error: `Erro de rede: ${msg}` }
    }
  }

  /* c8 ignore next */
  return { posts: [], nextAfter: null, error: 'Máximo de tentativas excedido' }
}

// ── Normalização ──────────────────────────────────────────────────

function mapPostToReview(post: RedditPost, connector: ChannelConnector): NormalizedReview {
  // body = título + corpo (se existir corpo)
  const body = post.selftext?.trim()
    ? `${post.title}\n\n${post.selftext.trim()}`
    : post.title

  const review: NormalizedReview = {
    tenant_id:    connector.tenant_id,
    business_id:  connector.business_id,
    connector_id: connector.id,
    channel:      CHANNEL,
    external_id:  post.id,
    published_at: new Date(post.created_utc * 1000).toISOString(),
    sentiment:    'unanalyzed',
    title:        post.title,
    body:         body.trim(),
    author_name:  post.author,
    url:          `https://reddit.com${post.permalink}`,
    upvotes:      post.score,
    comment_count: post.num_comments,
    tags:         [post.subreddit],
    raw_data:     post as unknown as Record<string, unknown>,
  }

  return review
}

/**
 * Fallback para buscar posts via RSS do Reddit.
 * Útil quando o endpoint JSON retorna 403 (bloqueio de IP/Bot detection).
 */
async function fetchRSS(url: string): Promise<{ posts: RedditPost[]; error?: string }> {
  try {
    const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
    const { data } = await axios.get(url, { 
      headers: { 'User-Agent': ua },
      timeout: 10000 
    })
    
    const $ = cheerio.load(data, { xmlMode: true })
    const posts: RedditPost[] = []

    $('entry').each((_, el) => {
      const entry = $(el)
      const link = entry.find('link').attr('href') || ''
      
      // ID do post no Reddit (ex: t3_xxxx)
      const id = entry.find('id').text().split('/').pop() || Math.random().toString(36).slice(2)
      
      posts.push({
        id,
        name: `t3_${id}`,
        title: entry.find('title').text(),
        author: entry.find('author name').text() || 'anonymous',
        subreddit: entry.find('category').attr('label') || 'unknown',
        subreddit_name_prefixed: `r/${entry.find('category').attr('label') || 'unknown'}`,
        selftext: entry.find('content').text().replace(/<[^>]*>?/gm, ''),
        permalink: link.replace('https://www.reddit.com', ''),
        url: link,
        created_utc: Math.floor(new Date(entry.find('updated').text()).getTime() / 1000),
        score: 0,
        upvote_ratio: 1,
        num_comments: 0,
        is_self: true,
        over_18: false,
        stickied: false
      } as RedditPost)
    })

    return { posts }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { posts: [], error: msg }
  }
}

// ── Helpers ───────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
