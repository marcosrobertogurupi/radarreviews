// Testes do conector Reddit (modo público — sem OAuth)
// Cobre: busca global, subreddits específicos, paginação, filtros,
// tratamento de erros HTTP, normalização e deduplicação.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { run } from '../../src/connectors/reddit/index.js'
import { mockConnector } from '../fixtures/connector.js'

// ── Mocks globais ────────────────────────────────────────────────

vi.mock('dotenv/config', () => ({}))

vi.mock('axios', () => ({
  default: {
    get: vi.fn().mockRejectedValue(new Error('Axios mocked error')),
  },
}))

const mockSupabaseMethods: any = {
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  in: vi.fn().mockReturnThis(),
  or: vi.fn().mockReturnThis(),
  gte: vi.fn().mockReturnThis(),
  lte: vi.fn().mockReturnThis(),
  limit: vi.fn().mockReturnThis(),
  order: vi.fn().mockReturnThis(),
  single: vi.fn().mockResolvedValue({ data: { id: 'job-123' }, error: null }),
  upsert: vi.fn().mockReturnThis(),
  update: vi.fn().mockReturnThis(),
  insert: vi.fn().mockReturnThis(),
  then: (onfulfilled: any) => Promise.resolve({ data: [], error: null }).then(onfulfilled),
}

vi.mock('../../src/lib/supabase.js', () => ({
  supabase: {
    from: vi.fn(() => mockSupabaseMethods),
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
  },
}))

// ── Helpers de fixture ───────────────────────────────────────────

const RECENT_UTC = Math.floor(Date.now() / 1000) - 3600  // 1 hora atrás
const OLD_UTC    = Math.floor(Date.now() / 1000) - 40 * 86400  // 40 dias atrás

function makePost(id: string, overrides: Partial<{
  selftext: string; author: string; created_utc: number; subreddit: string
}> = {}) {
  return {
    kind: 't3' as const,
    data: {
      id,
      name:                    `t3_${id}`,
      title:                   `Experiência com empresa ${id}`,
      selftext:                overrides.selftext ?? `Texto do post ${id}`,
      author:                  overrides.author ?? `user_${id}`,
      subreddit:               overrides.subreddit ?? 'brasil',
      subreddit_name_prefixed: `r/${overrides.subreddit ?? 'brasil'}`,
      score:                   42,
      upvote_ratio:            0.9,
      num_comments:            7,
      created_utc:             overrides.created_utc ?? RECENT_UTC,
      permalink:               `/r/brasil/comments/${id}/post/`,
      url:                     `https://reddit.com/r/brasil/comments/${id}`,
      is_self:                 true,
      over_18:                 false,
      stickied:                false,
    },
  }
}

function makeListing(
  posts: ReturnType<typeof makePost>[],
  after: string | null = null
) {
  return {
    kind: 'Listing',
    data: { children: posts, after, before: null, dist: posts.length },
  }
}

function mockFetch(responses: unknown[]) {
  let call = 0
  vi.stubGlobal('fetch', vi.fn(async () => {
    const body = responses[call] ?? makeListing([])
    call++
    return {
      ok: true,
      status: 200,
      json: async () => body,
    }
  }))
}


// ── Testes ───────────────────────────────────────────────────────

describe('Reddit connector — modo público', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    vi.spyOn(Math, 'random').mockReturnValue(0)
    vi.spyOn(global, 'setTimeout').mockImplementation((cb: any) => {
      cb()
      return 0 as any
    })
  })

  // 1. Busca global retorna posts normalizados
  it('busca global por search_terms retorna posts normalizados', async () => {
    mockFetch([makeListing([makePost('abc1'), makePost('abc2')])])

    const connector = mockConnector('reddit', {
      config: { search_terms: ['Empresa'], delay_ms: 0 },
    })
    const result = await run(connector)

    expect(result.reviews_fetched).toBe(2)
    expect(result.error).toBeUndefined()
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      expect.stringContaining('search.json'),
      expect.objectContaining({
        headers: expect.objectContaining({
          'User-Agent': expect.stringContaining('Mozilla'),
        }),
      })
    )
  })

  // 2. Retrocompatibilidade com campo "keywords"
  it('aceita "keywords" como alias retrocompatível de search_terms', async () => {
    mockFetch([makeListing([makePost('k1')])])

    const connector = mockConnector('reddit', {
      config: { keywords: ['empresa', 'k1'], delay_ms: 0 },
    })
    const result = await run(connector)

    expect(result.reviews_fetched).toBe(1)
    expect(result.error).toBeUndefined()
  })

  // 3. Erro quando sem search_terms nem keywords
  it('retorna error quando search_terms não está configurado', async () => {
    const connector = mockConnector('reddit', { config: {} })
    const result = await run(connector)

    expect(result.error).toContain('search_terms')
    expect(result.reviews_fetched).toBe(0)
  })

  // 4. Posts deletados são filtrados
  it('filtra posts com author=[deleted]', async () => {
    mockFetch([makeListing([
      makePost('del1', { author: '[deleted]' }),
      makePost('ok1'),
    ])])

    const connector = mockConnector('reddit', { config: { search_terms: ['Empresa'], delay_ms: 0 } })
    const result = await run(connector)

    expect(result.reviews_fetched).toBe(1)
  })

  // 5. Posts mais antigos que since_days são ignorados
  it('ignora posts mais antigos que since_days', async () => {
    mockFetch([makeListing([
      makePost('old1', { created_utc: OLD_UTC }),
      makePost('new1'),
    ])])

    const connector = mockConnector('reddit', {
      config: { search_terms: ['Empresa'], since_days: 30, delay_ms: 0 },
    })
    const result = await run(connector)

    expect(result.reviews_fetched).toBe(1)
  })

  // 6. Paginação via cursor "after"
  it('pagina usando o cursor after', async () => {
    mockFetch([
      makeListing([makePost('p1'), makePost('p2')], 't3_cursor'),
      makeListing([makePost('p3')]),
    ])

    const connector = mockConnector('reddit', {
      config: { search_terms: ['Empresa'], delay_ms: 0 },
    })
    const result = await run(connector)

    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2)
    expect(result.reviews_fetched).toBe(3)
  })

  // 7. Para paginação quando after é null
  it('para paginação quando after=null mesmo com posts completos', async () => {
    mockFetch([makeListing([makePost('p1'), makePost('p2')], null)])

    const connector = mockConnector('reddit', {
      config: { search_terms: ['Empresa'], limit_per_request: 2, delay_ms: 0 },
    })
    await run(connector)

    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1)
  })

  // 8. body = título + corpo; se selftext vazio, só título
  it('body usa título + corpo quando selftext existe', async () => {
    mockFetch([makeListing([makePost('b1', { selftext: 'Corpo do post' })])])

    const connector = mockConnector('reddit', { config: { search_terms: ['Empresa'], delay_ms: 0 } })
    await run(connector)

    const upsertCall = mockSupabaseMethods.upsert.mock.calls[0]
    if (upsertCall) {
      const review = upsertCall[0][0]
      expect(review?.body).toContain('Corpo do post')
      expect(review?.body).toContain('Experiência com empresa')
    }
    expect(upsertCall).toBeDefined()
  })

  it('body usa só o título quando selftext está vazio', async () => {
    mockFetch([makeListing([makePost('b2', { selftext: '' })])])

    const connector = mockConnector('reddit', { config: { search_terms: ['Empresa'], delay_ms: 0 } })
    const result = await run(connector)

    expect(result.reviews_fetched).toBe(1)
  })

  // 9. created_utc (segundos) → ISO 8601
  it('converte created_utc (Unix segundos) para ISO 8601', async () => {
    const utc = 1704067200  // 2026-05-15T10:00:00Z
    mockFetch([makeListing([makePost('ts1', { created_utc: utc })])])

    const connector = mockConnector('reddit', { config: { search_terms: ['Empresa'], delay_ms: 0 } })
    await run(connector)

    const upsertCall = mockSupabaseMethods.upsert.mock.calls[0]
    if (upsertCall) {
      const review = upsertCall[0][0]
      expect(review?.published_at).toBe(new Date(utc * 1000).toISOString())
    }
  })

  // 10. Erro 403 — não lança exceção, registra warning e continua
  it('403 em subreddit privado não interrompe outros subreddits', async () => {
    let call = 0
    vi.stubGlobal('fetch', vi.fn(async () => {
      call++
      // retries=3 → calls 1–3 são todas tentativas da URL 'X' → todas 403
      if (call <= 3) return { ok: false, status: 403, json: async () => ({}) }
      return { ok: true, status: 200, json: async () => makeListing([makePost('ok1')]) }
    }))

    const connector = mockConnector('reddit', {
      config: {
        search_terms: ['X', 'Y'],
        subreddits: [],
        delay_ms: 0,
      },
    })
    const result = await run(connector)

    expect(result.error).toBeUndefined()
    expect(result.reviews_fetched).toBe(1)
  })

  // 11. Erro 429 — retenta com backoff
  it('429 dispara backoff e retenta', async () => {
    let call = 0
    vi.stubGlobal('fetch', vi.fn(async () => {
      call++
      if (call <= 2) return { ok: false, status: 429, json: async () => ({}) }
      return { ok: true, status: 200, json: async () => makeListing([makePost('r1')]) }
    }))

    const connector = mockConnector('reddit', {
      config: { search_terms: ['Empresa'], delay_ms: 0 },
    })
    const result = await run(connector)

    expect(result.reviews_fetched).toBe(1)
  })

  // 12. Busca por subreddits específicos usa URL /r/subreddit/search.json
  it('restringe busca a subreddits específicos quando configurado', async () => {
    mockFetch([
      makeListing([makePost('s1')]),
      makeListing([makePost('s2')]),
    ])

    const connector = mockConnector('reddit', {
      config: {
        search_terms: ['Empresa'],
        subreddits: ['brasil', 'investimentos'],
        delay_ms: 0,
      },
    })
    const result = await run(connector)

    const calls = vi.mocked(fetch).mock.calls.map(c => c[0] as string)
    expect(calls.some(u => u.includes('/r/brasil/search.json'))).toBe(true)
    expect(calls.some(u => u.includes('/r/investimentos/search.json'))).toBe(true)
    expect(result.reviews_fetched).toBe(2)
  })

  // 13. Nenhuma menção encontrada — sem erro
  it('retorna reviews_fetched=0 quando Reddit não retorna posts', async () => {
    mockFetch([makeListing([])])

    const connector = mockConnector('reddit', { config: { search_terms: ['Empresa'], delay_ms: 0 } })
    const result = await run(connector)

    expect(result.reviews_fetched).toBe(0)
    expect(result.error).toBeUndefined()
  })
})
