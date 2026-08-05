import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockFrom = vi.fn()

vi.mock('../src/lib/supabase.js', () => {
  const client = {
    from: mockFrom,
    rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
  }
  return {
    supabase: client,
    supabaseAdmin: client,
  }
})

const analyzeBatchMock = vi.fn().mockResolvedValue(undefined)
vi.mock('../src/lib/sentiment.js', () => ({
  analyzeBatch: analyzeBatchMock,
}))

const checkAlertsMock = vi.fn().mockResolvedValue(undefined)
vi.mock('../src/lib/alerts.js', () => ({
  checkAlerts: checkAlertsMock,
}))

vi.mock('../src/services/ai/autoReplyGenerator.js', () => ({
  processAutonomousAutoReplies: vi.fn().mockResolvedValue(undefined),
}))

describe('Ingestão — Filtro de Data de Corte (30 dias Backfill / Incremental)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('deve descartar reviews com mais de 30 dias na primeira sincronização (backfill - last_sync_at null)', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'channel_connectors') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: { last_sync_at: null, config: {} },
            error: null,
          }),
        }
      }
      if (table === 'reviews') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          in: vi.fn().mockResolvedValue({ data: [], error: null }),
          upsert: vi.fn().mockResolvedValue({ data: [], error: null }),
        }
      }
      if (table === 'monitored_businesses') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: { tenant_id: 'tenant-123' }, error: null }),
        }
      }
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        in: vi.fn().mockResolvedValue({ data: [], error: null }),
      }
    })

    const { ingestReviews } = await import('../src/lib/ingest.js')

    const now = new Date()
    const recentDate = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000).toISOString() // 5 dias atrás
    const oldDate = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000).toISOString()   // 60 dias atrás (ex: 9 de junho de 2026)

    const reviews = [
      {
        external_id: 'review-recent-1',
        channel: 'tripadvisor' as const,
        rating: 5,
        body: 'Excelente serviço e café da manhã!',
        published_at: recentDate,
        tenant_id: 'tenant-123',
      },
      {
        external_id: 'review-old-2',
        channel: 'tripadvisor' as const,
        rating: 5,
        body: 'Review antigo fora dos 30 dias',
        published_at: oldDate,
        tenant_id: 'tenant-123',
      },
    ]

    const result = await ingestReviews(reviews as any, 'tripadvisor', 'conn-backfill-1', 'biz-123')

    expect(result.reviews_fetched).toBe(2)
    expect(result.reviews_new).toBe(1) // Apenas 1 aceito e ingerido

    expect(analyzeBatchMock).toHaveBeenCalledTimes(1)
    const batchArg = analyzeBatchMock.mock.calls[0][0]
    expect(batchArg).toHaveLength(1)
    expect(batchArg[0].external_id).toBe('review-recent-1')
  })

  it('deve descartar reviews anteriores a last_sync_at em coletas subsequentes (incremental)', async () => {
    const lastSyncAt = '2026-08-01T12:00:00.000Z'

    mockFrom.mockImplementation((table: string) => {
      if (table === 'channel_connectors') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: { last_sync_at: lastSyncAt, config: {} },
            error: null,
          }),
        }
      }
      if (table === 'reviews') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          in: vi.fn().mockResolvedValue({ data: [], error: null }),
          upsert: vi.fn().mockResolvedValue({ data: [], error: null }),
        }
      }
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: { tenant_id: 'tenant-123' }, error: null }),
      }
    })

    const { ingestReviews } = await import('../src/lib/ingest.js')

    const newReviewDate = '2026-08-03T10:00:00.000Z' // Novo (após last_sync_at)
    const oldReviewDate = '2026-07-20T10:00:00.000Z' // Antigo (antes de last_sync_at - 24h)

    const reviews = [
      {
        external_id: 'review-inc-new',
        channel: 'google_maps' as const,
        rating: 4,
        body: 'Novo review em agosto',
        published_at: newReviewDate,
        tenant_id: 'tenant-123',
      },
      {
        external_id: 'review-inc-old',
        channel: 'google_maps' as const,
        rating: 3,
        body: 'Review de julho já sincronizado',
        published_at: oldReviewDate,
        tenant_id: 'tenant-123',
      },
    ]

    const result = await ingestReviews(reviews as any, 'google_maps', 'conn-inc-1', 'biz-123')

    expect(result.reviews_fetched).toBe(2)
    expect(result.reviews_new).toBe(1)

    expect(analyzeBatchMock).toHaveBeenCalledTimes(1)
    const batchArg = analyzeBatchMock.mock.calls[0][0]
    expect(batchArg).toHaveLength(1)
    expect(batchArg[0].external_id).toBe('review-inc-new')
  })
})
