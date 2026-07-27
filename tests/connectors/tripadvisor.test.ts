// Testes do conector TripAdvisor
// Usa mocks do Supabase e do axios para evitar chamadas reais à API

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { run } from '../../src/connectors/tripadvisor.js'
import { mockConnector } from '../fixtures/connector.js'

// -----------------------------------------------------------------------------
// Mocks
// -----------------------------------------------------------------------------

vi.mock('dotenv/config', () => ({}))

// Mock do Supabase com rpc na raiz e encadeamento de select/in
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

vi.mock('axios', async importOriginal => {
  const actual = await importOriginal<typeof import('axios')>()
  const mockGet = vi.fn()
  return {
    ...actual,
    default: {
      ...actual.default,
      get: mockGet,
      isAxiosError: actual.default.isAxiosError,
    },
  }
})

// Resposta de exemplo baseada na resposta real da API TripAdvisor
const tripAdvisorApiResponse = {
  data: {
    data: [
      {
        id: 1056182371,
        lang: 'pt',
        location_id: 21186238,
        published_date: '2026-04-11T08:38:32Z',
        rating: 5,
        helpful_votes: 3,
        rating_image_url:
          'https://www.tripadvisor.com/img/cdsi/img2/ratings/traveler/s5.0-66827-5.svg',
        url: 'https://www.tripadvisor.com/ShowUserReviews-g187791-d21186238-r1056182371',
        text: 'Lugar incrível, recomendo muito!',
        title: 'EXCELLENCE',
        trip_type: 'Business',
        travel_date: '2026-03-31',
        user: {
          username: 'antoniapA6607NO',
          user_location: {
            id: 'null', // string literal "null" — comportamento real da API
          },
          avatar: {
            thumbnail: 'https://media-cdn.tripadvisor.com/media/photo-t/1a/f6/e3/6a/default-avatar.jpg',
          },
        },
        subratings: {
          '0': { name: 'RATE_VALUE', value: 5 },
          '1': { name: 'RATE_ROOM', value: 5 },
        },
      },
      {
        id: 1056182200,
        lang: 'en',
        location_id: 21186238,
        published_date: '2026-04-10T15:00:00Z',
        rating: 4,
        helpful_votes: 0,
        rating_image_url:
          'https://www.tripadvisor.com/img/cdsi/img2/ratings/traveler/s4.0-66827-5.svg',
        url: 'https://www.tripadvisor.com/ShowUserReviews-g187791-d21186238-r1056182200',
        text: 'Very good service.',
        title: 'Great place',
        trip_type: 'Couples',
        travel_date: '2026-04-01',
        user: {
          username: 'E2712LGclarer',
          user_location: {
            id: '187058',
            name: 'Watford, England',
          },
        },
        subratings: {},
      },
      {
        id: 1056180000,
        lang: 'pt',
        location_id: 21186238,
        published_date: '2026-04-09T10:00:00Z',
        rating: 3,
        helpful_votes: 1,
        rating_image_url: '',
        url: 'https://www.tripadvisor.com/ShowUserReviews-r1056180000',
        text: 'Razoável, poderia ser melhor.',
        title: 'OK',
        trip_type: 'Family',
        travel_date: '2026-03-20',
        user: {
          username: 'viajante_br',
          user_location: { id: 'null' },
        },
        subratings: {},
      },
    ],
  },
}

// -----------------------------------------------------------------------------
// Testes
// -----------------------------------------------------------------------------

describe('TripAdvisor connector', () => {
  let axiosMock: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    vi.clearAllMocks()
    const axiosModule = await import('axios')
    axiosMock = vi.mocked(axiosModule.default.get)
    axiosMock.mockResolvedValue(tripAdvisorApiResponse)

    process.env['TRIPADVISOR_API_KEY'] = 'test-api-key'
  })

  it('retorna JobResult com reviews_fetched > 0 para location_id válido', async () => {
    const connector = mockConnector('tripadvisor')
    const result = await run(connector)

    expect(result.reviews_fetched).toBe(3)
    expect(result.error).toBeUndefined()
  })

  it('chama a API com URL e params corretos', async () => {
    const connector = mockConnector('tripadvisor')
    await run(connector)

    expect(axiosMock).toHaveBeenCalledWith(
      expect.stringContaining('/location/187791/reviews'),
      expect.objectContaining({
        params: expect.objectContaining({
          key: 'test-api-key',
          language: 'pt',
          limit: 5,
        }),
      })
    )
  })

  it('retorna reviews_fetched = 0 quando API retorna lista vazia', async () => {
    axiosMock.mockResolvedValue({ data: { data: [] } })

    const connector = mockConnector('tripadvisor')
    const result = await run(connector)

    expect(result.reviews_fetched).toBe(0)
    expect(result.reviews_new).toBe(0)
    expect(result.error).toBeUndefined()
  })

  it('retorna error no JobResult quando a API falha com erro 500', async () => {
    const error = new Error('Internal Server Error')
    Object.assign(error, { response: { status: 500 } })
    axiosMock.mockRejectedValue(error)

    const connector = mockConnector('tripadvisor')
    const result = await run(connector)

    expect(result.error).toBeDefined()
    expect(result.reviews_fetched).toBe(0)
  })

  it('retorna error quando TRIPADVISOR_API_KEY não está definida', async () => {
    delete process.env['TRIPADVISOR_API_KEY']

    const connector = mockConnector('tripadvisor')
    const result = await run(connector)

    expect(result.error).toContain('TRIPADVISOR_API_KEY')
  })

  it('retorna error quando connector.external_id está vazio', async () => {
    const connector = mockConnector('tripadvisor', { external_id: null })
    const result = await run(connector)

    expect(result.error).toContain('external_id')
  })

  it('normaliza o id numérico da API para string no external_id', async () => {
    const { supabase } = await import('../../src/lib/supabase.js')
    const fromMock = vi.mocked(supabase.from)

    const connector = mockConnector('tripadvisor')
    await run(connector)

    const upsertMock = fromMock.mock.results[0]?.value?.upsert
    expect(upsertMock).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          channel: 'tripadvisor',
          external_id: '1056182371', // número convertido para string
          rating: 5,
          upvotes: 3,
          // sentiment é preenchido pelo motor de IA antes do upsert
          // aceita qualquer valor classificado (não mais 'unanalyzed')
          sentiment: expect.stringMatching(/^(positive|neutral|negative|critical|unanalyzed)$/),
        }),
      ]),
        expect.objectContaining({ onConflict: expect.stringContaining('tenant_id') })
    )
  })

  it('trata o user_location.id = "null" (string literal) sem erro', async () => {
    const connector = mockConnector('tripadvisor')
    const result = await run(connector)

    // Não deve lançar erro mesmo com user_location.id sendo string "null"
    expect(result.error).toBeUndefined()
    expect(result.reviews_fetched).toBe(3)
  })

  it('usa o idioma do config do conector quando definido', async () => {
    const connector = mockConnector('tripadvisor', {
      config: { language: 'en', interval_minutes: 1440 },
    })
    await run(connector)

    expect(axiosMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        params: expect.objectContaining({ language: 'en' }),
      })
    )
  })
})
