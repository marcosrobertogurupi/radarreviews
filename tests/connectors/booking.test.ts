import { describe, it, expect, vi, beforeEach } from 'vitest'
import { normalizeBookingReview, run } from '../../src/connectors/booking.js'
import type { ChannelConnector } from '../../src/types/connector.js'

// Mocking dependencies
vi.mock('../../src/lib/apify.js', () => ({
  scrapeBookingReviews: vi.fn(),
}))

vi.mock('../../src/lib/ingest.ts', () => ({
  ingestReviews: vi.fn().mockResolvedValue({
    reviews_new: 2,
    reviews_updated: 0,
  }),
}))

describe('Booking Connector Unit Tests', () => {
  const dummyConnector: ChannelConnector = {
    id: 'conn-booking-123',
    business_id: 'biz-hotel-456',
    tenant_id: 'tenant-789',
    channel: 'booking',
    status: 'active',
    external_id: 'https://www.booking.com/hotel/br/grand-hotel.html',
    vault_secret_id: null,
    config: {
      hotel_url: 'https://www.booking.com/hotel/br/grand-hotel.html',
    },
    last_sync_at: null,
    next_sync_at: null,
    error_message: null,
    error_count: 0,
    first_error_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('normalizeBookingReview', () => {
    it('deve converter nota de 10 para escala 5.0 do Reputei', () => {
      const rawItem = {
        id: 'rev-001',
        score: 9.0,
        title: 'Excelente estadia',
        positiveText: 'O atendimento e o café da manhã foram incríveis.',
        negativeText: 'O chuveiro poderia ser um pouco mais forte.',
        authorName: 'Rodrigo Alencar',
        userCountry: 'Brasil',
        date: '2026-07-20T10:00:00Z',
      }

      const normalized = normalizeBookingReview(
        rawItem,
        dummyConnector,
        'https://www.booking.com/hotel/br/grand-hotel.html'
      )

      expect(normalized).not.toBeNull()
      expect(normalized?.external_id).toBe('rev-001')
      expect(normalized?.rating).toBe(4.5) // 9.0 / 2 = 4.5
      expect(normalized?.title).toBe('Excelente estadia')
      expect(normalized?.body).toContain('👍 Positivo: O atendimento e o café da manhã foram incríveis.')
      expect(normalized?.body).toContain('👎 Negativo: O chuveiro poderia ser um pouco mais forte.')
      expect(normalized?.author_name).toBe('Rodrigo Alencar (Brasil)')
      expect(normalized?.channel).toBe('booking')
    })

    it('deve clampar a nota máxima em 5.0 caso o score venha acima de 10', () => {
      const rawItem = {
        id: 'rev-002',
        score: 11.0, // anomalia
        positiveText: 'Perfeito',
      }

      const normalized = normalizeBookingReview(
        rawItem,
        dummyConnector,
        'https://www.booking.com/hotel/br/grand-hotel.html'
      )

      expect(normalized?.rating).toBe(5.0)
    })

    it('deve extrair subRatings como tags', () => {
      const rawItem = {
        id: 'rev-003',
        score: 8.0,
        positiveText: 'Tudo limpo.',
        subRatings: {
          limpeza: 10,
          conforto: 9,
          localizacao: 8,
        },
      }

      const normalized = normalizeBookingReview(
        rawItem,
        dummyConnector,
        'https://www.booking.com/hotel/br/grand-hotel.html'
      )

      expect(normalized?.tags).toContain('booking')
      expect(normalized?.tags).toContain('limpeza: 10')
      expect(normalized?.tags).toContain('conforto: 9')
    })

    it('deve gerar hash de fallback quando a review não possui ID explícito', () => {
      const rawItem = {
        score: 10,
        positiveText: 'Maravilhoso!',
        authorName: 'Maria',
        date: '2026-07-25',
      }

      const normalized = normalizeBookingReview(
        rawItem,
        dummyConnector,
        'https://www.booking.com/hotel/br/grand-hotel.html'
      )

      expect(normalized?.external_id).toBeDefined()
      expect(normalized?.external_id.length).toBeGreaterThan(10)
    })
  })

  describe('run(connector)', () => {
    it('deve retornar erro fatal se a URL do hotel for inválida', async () => {
      const invalidConnector = { ...dummyConnector, config: {}, external_id: null }
      const result = await run(invalidConnector)

      expect(result.reviews_fetched).toBe(0)
      expect(result.error_type).toBe('fatal')
      expect(result.error).toContain('URL do hotel não configurada')
    })

    it('deve executar a coleta e chamar ingestReviews com sucesso', async () => {
      const { scrapeBookingReviews } = await import('../../src/lib/apify.js')
      vi.mocked(scrapeBookingReviews).mockResolvedValue([
        { id: 'rev-1', score: 10, positiveText: 'Ótimo' },
        { id: 'rev-2', score: 8, negativeText: 'Barulhento' },
      ])

      const result = await run(dummyConnector)

      expect(scrapeBookingReviews).toHaveBeenCalledWith(
        'https://www.booking.com/hotel/br/grand-hotel.html',
        30,
        dummyConnector.last_sync_at,
        expect.objectContaining({ tenant_id: 'tenant-789', connector_id: 'conn-booking-123' }),
        'backfill'
      )
      expect(result.reviews_fetched).toBe(2)
      expect(result.reviews_new).toBe(2)
    })
  })
})
