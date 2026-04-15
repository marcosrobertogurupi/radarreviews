// Testes do conector Trustpilot
// Valida: paginação automática, normalização de campos, tratamento de erros e API Key ausente.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { run } from '../../src/connectors/trustpilot.js'
import { mockConnector } from '../fixtures/connector.js'

// -----------------------------------------------------------------------------
// Mocks
// -----------------------------------------------------------------------------

vi.mock('dotenv/config', () => ({}))

// Mock Supabase (mesmo padrão dos outros conectores)
const mockSupabaseMethods = {
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  in: vi.fn().mockResolvedValue({ data: [], error: null }),
  or: vi.fn().mockResolvedValue({ data: [], error: null }),
  single: vi.fn().mockResolvedValue({ data: { id: 'job-123' }, error: null }),
  upsert: vi.fn().mockReturnThis(),
  update: vi.fn().mockReturnThis(),
  insert: vi.fn().mockResolvedValue({ data: null, error: null }),
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

const makeReview = (id: string, stars = 5, withNextPage = false) => ({
  id,
  stars,
  title: `Ótimo serviço ${id}`,
  text: `Review de teste ${id}`,
  language: 'pt',
  createdAt: '2024-11-10T10:00:00Z',
  consumer: {
    id: `consumer_${id}`,
    displayName: `Usuário ${id}`,
  },
  links: [{ rel: 'self', href: `https://www.trustpilot.com/reviews/${id}` }],
})

const makeApiResponse = (reviews: ReturnType<typeof makeReview>[], hasNextPage = false) => ({
  data: {
    reviews,
    ...(hasNextPage ? { nextPage: { page: 2 } } : {}),
  },
})

// -----------------------------------------------------------------------------
// Testes
// -----------------------------------------------------------------------------

describe('Trustpilot connector', () => {
  let axiosMock: any

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.stubEnv('TRUSTPILOT_API_KEY', 'TEST_KEY_123')

    const axiosModule = await import('axios')
    axiosMock = axiosModule.default.get
  })

  it('busca reviews e retorna reviews_fetched correto', async () => {
    axiosMock.mockResolvedValue(
      makeApiResponse([makeReview('rev1'), makeReview('rev2'), makeReview('rev3')])
    )

    const connector = mockConnector('trustpilot')
    const result = await run(connector)

    expect(result.reviews_fetched).toBe(3)
    expect(result.error).toBeUndefined()
  })

  it('chama a API com params corretos (apikey, page, perPage, orderBy)', async () => {
    axiosMock.mockResolvedValue(makeApiResponse([makeReview('rev1')]))

    const connector = mockConnector('trustpilot')
    await run(connector)

    expect(axiosMock).toHaveBeenCalledWith(
      expect.stringContaining('/business-units/'),
      expect.objectContaining({
        params: expect.objectContaining({
          apikey: 'TEST_KEY_123',
          page: 1,
          perPage: 20,
          orderBy: 'createdat.desc',
        }),
      })
    )
  })

  it('pagina automaticamente até não ter nextPage', async () => {
    // Página 1 retorna 3 reviews com nextPage
    axiosMock
      .mockResolvedValueOnce(makeApiResponse([makeReview('p1r1'), makeReview('p1r2'), makeReview('p1r3')], true))
      // Página 2 retorna 2 reviews sem nextPage
      .mockResolvedValueOnce(makeApiResponse([makeReview('p2r1'), makeReview('p2r2')]))

    const connector = mockConnector('trustpilot')
    const result = await run(connector)

    // Deve ter lido da primeira e segunda página
    expect(axiosMock).toHaveBeenCalledTimes(2)
    expect(result.reviews_fetched).toBe(5)
  })

  it('retorna reviews_fetched = 0 quando API retorna lista vazia', async () => {
    axiosMock.mockResolvedValue(makeApiResponse([]))

    const connector = mockConnector('trustpilot')
    const result = await run(connector)

    expect(result.reviews_fetched).toBe(0)
    expect(result.error).toBeUndefined()
  })

  it('retorna error quando TRUSTPILOT_API_KEY não está definida', async () => {
    vi.unstubAllEnvs()

    const connector = mockConnector('trustpilot')
    const result = await run(connector)

    expect(result.error).toContain('TRUSTPILOT_API_KEY')
  })

  it('retorna error quando connector.external_id está vazio', async () => {
    const connector = mockConnector('trustpilot')
    connector.external_id = ''
    const result = await run(connector)

    expect(result.error).toContain('business_unit_id obrigatório')
  })

  it('retorna error quando API retorna 500', async () => {
    // Simula erro 5xx direto via rejeição do axios.get
    const serverError = Object.assign(new Error('Internal Server Error'), {
      isAxiosError: true,
      response: { status: 500, data: { code: 'SERVER_ERROR' } },
    })
    axiosMock.mockRejectedValue(serverError)

    const connector = mockConnector('trustpilot')
    const result = await run(connector)

    expect(result.error).toBeDefined()
  })

  it('normaliza corretamente os campos do review', async () => {
    const connector = mockConnector('trustpilot')
    axiosMock.mockResolvedValue(
      makeApiResponse([
        {
          id: 'abc123',
          stars: 4,
          title: 'Bom serviço',
          text: 'Atendimento rápido.',
          language: 'pt',
          createdAt: '2024-11-08T09:15:00Z',
          consumer: { id: 'user456', displayName: 'Maria Oliveira' },
          links: [{ rel: 'self', href: 'https://www.trustpilot.com/reviews/abc123' }],
        },
      ])
    )

    await run(connector)

    // O upsert é chamado via ingest.ts — verificamos que o in() recebeu nosso ID
    const inCalls = mockSupabaseMethods.in.mock.calls
    expect(inCalls.length).toBeGreaterThan(0)
    // O external_id deve ser o ID da API (não um hash)
    expect(inCalls[0][1]).toContain('abc123')
  })
})
