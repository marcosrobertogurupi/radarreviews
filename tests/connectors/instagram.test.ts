import { describe, it, expect, vi, beforeEach } from 'vitest'
import { run } from '../../src/connectors/instagram.js'
import { mockConnector } from '../fixtures/connector.js'
import * as facebookInstagramLib from '../../src/connectors/facebook-instagram.js'
import * as socialListeningLib from '../../src/services/social/social-listening.js'

const mockSingle = vi.fn()
const mockSupabaseMethods = {
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  single: mockSingle,
}

vi.mock('../../src/lib/supabase.js', () => ({
  supabase: {
    from: vi.fn(() => mockSupabaseMethods)
  }
}))

vi.mock('../../src/connectors/facebook-instagram.js', () => ({
  syncMetaSocial: vi.fn().mockResolvedValue(undefined)
}))

vi.mock('../../src/services/social/social-listening.js', () => ({
  runSocialListening: vi.fn().mockResolvedValue({ fetched: 0, new: 0 })
}))

describe('Instagram connector', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSingle.mockResolvedValue({
      data: { id: 'conn-1', monitored_businesses: { tenant_id: 'tenant-1' } },
      error: null
    })
  })

  it('deve chamar syncMetaSocial e runSocialListening e retornar as contagens', async () => {
    vi.mocked(socialListeningLib.runSocialListening).mockResolvedValue({ fetched: 5, new: 5 })

    const connector = mockConnector('instagram')
    const result = await run(connector)

    // Sincronizacao oficial via META
    expect(facebookInstagramLib.syncMetaSocial).toHaveBeenCalledWith(connector.business_id, 'instagram')

    // Buscas via Apify / Social Listening
    expect(socialListeningLib.runSocialListening).toHaveBeenCalledWith(expect.objectContaining({
      id: 'conn-1',
      monitored_businesses: { tenant_id: 'tenant-1' }
    }))

    // Retorna reviews baseados no social listening (o Meta Social ja salva os dele direto no BD)
    expect(result.reviews_fetched).toBe(5)
    expect(result.reviews_new).toBe(5)
  })

  it('deve retornar error caso alguma das integracoes falhe', async () => {
    vi.mocked(facebookInstagramLib.syncMetaSocial).mockRejectedValue(new Error('Meta API Rate Limit'))

    const connector = mockConnector('instagram')
    const result = await run(connector)

    expect(result.error).toBe('Meta API Rate Limit')
    expect(result.reviews_fetched).toBe(0)
  })
})
