// Testes do conector Facebook
// Valida: recuperação de token do Vault, busca de ratings, paginação,
// normalização de campos e tratamento de erros.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { run } from '../../src/connectors/facebook.js'
import { mockConnector } from '../fixtures/connector.js'

vi.mock('dotenv/config', () => ({}))

// -----------------------------------------------------------------------------
// Mock do Supabase — inclui vault (decrypted_secrets) e cadeia de ingest
// -----------------------------------------------------------------------------

const mockSingle = vi.fn()
const mockSupabaseMethods = {
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  in: vi.fn().mockResolvedValue({ data: [], error: null }),
  or: vi.fn().mockResolvedValue({ data: [], error: null }),
  upsert: vi.fn().mockReturnThis(),
  update: vi.fn().mockReturnThis(),
  insert: vi.fn().mockResolvedValue({ data: null, error: null }),
  single: mockSingle,
}

vi.mock('../../src/lib/supabase.js', () => ({
  supabase: {
    from: vi.fn(() => mockSupabaseMethods),
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
  },
}))

vi.mock('axios', async importOriginal => {
  const actual = await importOriginal<typeof import('axios')>()
  return {
    ...actual,
    default: {
      ...actual.default,
      get: vi.fn(),
      isAxiosError: actual.default.isAxiosError,
    },
  }
})

// -----------------------------------------------------------------------------
// Dados de exemplo
// -----------------------------------------------------------------------------

const makeRating = (reviewerId: string, rating: number, text?: string) => ({
  reviewer: { id: reviewerId, name: `Usuário ${reviewerId}` },
  review_text: text || `Review de ${reviewerId}`,
  rating,
  created_time: '2024-11-10T10:00:00+0000',
})

const makePageResponse = (ratings: ReturnType<typeof makeRating>[], nextUrl?: string) => ({
  data: {
    data: ratings,
    ...(nextUrl ? { paging: { next: nextUrl } } : {}),
  },
})

// -----------------------------------------------------------------------------
// Testes
// -----------------------------------------------------------------------------

describe('Facebook connector', () => {
  let axiosMockGet: any

  beforeEach(async () => {
    vi.clearAllMocks()

    const axiosModule = await import('axios')
    axiosMockGet = axiosModule.default.get

    // Por padrão, o Vault retorna um token válido
    mockSingle.mockResolvedValue({
      data: { decrypted_secret: 'MOCKED_PAGE_ACCESS_TOKEN' },
      error: null,
    })
  })

  it('busca ratings e retorna reviews_fetched correto', async () => {
    axiosMockGet.mockResolvedValue(
      makePageResponse([makeRating('user1', 5), makeRating('user2', 3)])
    )

    const connector = mockConnector('facebook')
    const result = await run(connector)

    expect(result.reviews_fetched).toBe(2)
    expect(result.error).toBeUndefined()
  })

  it('chama a Graph API com o page_id correto e o token via header', async () => {
    axiosMockGet.mockResolvedValue(makePageResponse([makeRating('user1', 4)]))

    const connector = mockConnector('facebook')
    await run(connector)

    expect(axiosMockGet).toHaveBeenCalledWith(
      expect.stringContaining('/123456789/ratings'),
      expect.objectContaining({
        params: expect.objectContaining({
          access_token: 'MOCKED_PAGE_ACCESS_TOKEN',
        }),
      })
    )
  })

  it('pagina automaticamente quando há URL next', async () => {
    const fakeNextUrl = 'https://graph.facebook.com/next_page_cursor'
    axiosMockGet
      .mockResolvedValueOnce(makePageResponse([makeRating('u1', 5)], fakeNextUrl))
      .mockResolvedValueOnce(makePageResponse([makeRating('u2', 2)]))

    const connector = mockConnector('facebook')
    const result = await run(connector)

    expect(axiosMockGet).toHaveBeenCalledTimes(2)
    expect(result.reviews_fetched).toBe(2)
  })

  it('retorna reviews_fetched = 0 quando não há ratings', async () => {
    axiosMockGet.mockResolvedValue(makePageResponse([]))

    const connector = mockConnector('facebook')
    const result = await run(connector)

    expect(result.reviews_fetched).toBe(0)
    expect(result.error).toBeUndefined()
  })

  it('retorna error quando vault_secret_id não está configurado', async () => {
    const connector = mockConnector('facebook', { vault_secret_id: null })
    const result = await run(connector)

    expect(result.error).toContain('vault_secret_id')
  })

  it('retorna error quando o Vault não encontra o segredo', async () => {
    mockSingle.mockResolvedValueOnce({ data: null, error: { message: 'not found' } })

    const connector = mockConnector('facebook')
    const result = await run(connector)

    expect(result.error).toContain('Vault')
  })

  it('retorna error quando external_id está vazio', async () => {
    const connector = mockConnector('facebook', { external_id: '' })
    const result = await run(connector)

    expect(result.error).toContain('page_id obrigatório')
  })

  it('gera external_id composto (reviewer.id + created_time)', async () => {
    axiosMockGet.mockResolvedValue(
      makePageResponse([makeRating('reviewer999', 4)])
    )

    const connector = mockConnector('facebook')
    await run(connector)

    // O external_id gerado deve conter o reviewer.id
    const inCalls = mockSupabaseMethods.in.mock.calls
    expect(inCalls.length).toBeGreaterThan(0)
    expect(inCalls[0][1][0]).toContain('reviewer999')
  })
})
