// Testes do conector Google Maps
// Usa mocks do Supabase e do axios para evitar chamadas reais à API

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { run } from '../../src/connectors/google_maps/index.js'
import { mockConnector } from '../fixtures/connector.js'

// -----------------------------------------------------------------------------
// Mocks
// -----------------------------------------------------------------------------

// Mock do dotenv para não precisar do .env em testes
vi.mock('dotenv/config', () => ({}))

// Mock do cliente Supabase
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

vi.mock('../../src/connectors/google_maps/scraper.js', () => ({
  scrapeGoogleMapsReviews: vi.fn().mockRejectedValue(new Error('Scraper failed')),
}))

// Mock do axios
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

// Resposta de exemplo da Google Places API
const googleMapsApiResponse = {
  data: {
    id: 'ChIJN1t_tDeuEmsRUsoyG83frY4',
    displayName: { text: 'Local de Teste' },
    rating: 4.2,
    userRatingCount: 312,
    reviews: [
      {
        name: 'places/ChIJN1t_tDeuEmsRUsoyG83frY4/reviews/ChdDSUhNMG9nS0VJQ0FnSUNqbW9fU1ZRQRAB',
        rating: 5,
        text: { text: 'Excelente lugar!', languageCode: 'pt' },
        authorAttribution: {
          displayName: 'João Silva',
          uri: 'https://www.google.com/maps/contrib/123456',
          photoUri: 'https://lh3.googleusercontent.com/photo123',
        },
        publishTime: '2026-05-15T10:00:00Z',
        relativePublishTimeDescription: 'há 2 semanas',
      },
      {
        name: 'places/ChIJN1t_tDeuEmsRUsoyG83frY4/reviews/AnotherReviewId',
        rating: 4,
        text: { text: 'Muito bom, recomendo!', languageCode: 'pt' },
        authorAttribution: {
          displayName: 'Maria Oliveira',
          uri: 'https://www.google.com/maps/contrib/789012',
          photoUri: 'https://lh3.googleusercontent.com/photo456',
        },
        publishTime: '2026-05-15T10:00:00Z',
        relativePublishTimeDescription: 'há 3 semanas',
      },
    ],
  },
}

// -----------------------------------------------------------------------------
// Testes
// -----------------------------------------------------------------------------

describe('Google Maps connector', () => {
  let axiosMock: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    vi.clearAllMocks()
    const axiosModule = await import('axios')
    axiosMock = vi.mocked(axiosModule.default.get)
    axiosMock.mockResolvedValue(googleMapsApiResponse)

    // Definir variável de ambiente necessária
    process.env['GOOGLE_MAPS_API_KEY'] = 'test-api-key'
  })

  it('retorna JobResult com reviews_fetched > 0 para um place_id válido', async () => {
    const connector = mockConnector('google_maps')
    const result = await run(connector)

    expect(result.reviews_fetched).toBe(2)
    expect(result.error).toBeUndefined()
  })

  it('chama a API com os headers corretos', async () => {
    const connector = mockConnector('google_maps')
    await run(connector)

    expect(axiosMock).toHaveBeenCalledWith(
      expect.stringContaining('/places/ChIJN1t_tDeuEmsRUsoyG83frY4'),
      expect.objectContaining({
        headers: expect.objectContaining({
          'X-Goog-Api-Key': 'test-api-key',
          'X-Goog-FieldMask': 'id,displayName,rating,userRatingCount,reviews',
        }),
      })
    )
  })

  it('retorna reviews_fetched = 0 quando API retorna lista vazia', async () => {
    axiosMock.mockResolvedValue({
      data: {
        id: 'ChIJN1t_tDeuEmsRUsoyG83frY4',
        reviews: [],
      },
    })

    const connector = mockConnector('google_maps')
    const result = await run(connector)

    expect(result.reviews_fetched).toBe(0)
    expect(result.reviews_new).toBe(0)
    expect(result.error).toBeUndefined() // Alterado: O scraper ou API retornou 0 mas sem crash
  })

  it('retorna error no JobResult quando a API falha com erro 500', async () => {
    const error = new Error('Internal Server Error')
    Object.assign(error, { response: { status: 500 } })
    axiosMock.mockRejectedValue(error)

    const connector = mockConnector('google_maps')
    const result = await run(connector)

    expect(result.error).toBeDefined()
    expect(result.reviews_fetched).toBe(0)
  })

  it('retorna error quando as estratégias falham', async () => {
    // Apaga a key
    vi.stubEnv('GOOGLE_MAPS_API_KEY', '')

    const connector = mockConnector('google_maps')
    const result = await run(connector)

    expect(result.error).toContain('Todas as estratégias (Scraper e API) falharam')
  })

  it('retorna error quando connector.external_id está vazio', async () => {
    const connector = mockConnector('google_maps', { external_id: null })
    const result = await run(connector)

    expect(result.error).toContain('external_id')
  })

  it('normaliza corretamente os campos do review', async () => {
    // Verificar que o upsert foi chamado com dados normalizados corretos
    const { supabase } = await import('../../src/lib/supabase.js')
    const fromMock = vi.mocked(supabase.from)

    const connector = mockConnector('google_maps')
    await run(connector)

    expect(fromMock).toHaveBeenCalledWith('reviews')

    // Verificar que upsert foi chamado
    const upsertMock = fromMock.mock.results[0]?.value?.upsert
    expect(upsertMock).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          external_id: expect.any(String),
          sentiment: expect.any(String),
        }),
      ]),
      expect.objectContaining({ onConflict: 'external_id,channel,tenant_id' })
    )
  })
})
