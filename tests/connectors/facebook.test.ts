import { describe, it, expect, vi, beforeEach } from 'vitest'
import { run } from '../../src/connectors/facebook.js'
import { mockConnector } from '../fixtures/connector.js'
import * as apifyLib from '../../src/lib/apify.js'
import * as facebookInstagramLib from '../../src/connectors/facebook-instagram.js'

// Mock ingest to avoid writing to DB during tests
vi.mock('../../src/lib/ingest.js', () => ({
  ingestReviews: vi.fn().mockResolvedValue({ reviews_new: 2, reviews_updated: 0 })
}))

// Mock APIFY module
vi.mock('../../src/lib/apify.js', () => ({
  fetchFacebookReviews: vi.fn()
}))

// Mock syncMetaSocial
vi.mock('../../src/connectors/facebook-instagram.js', () => ({
  syncMetaSocial: vi.fn().mockResolvedValue(undefined)
}))

describe('Facebook connector', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('APIFY_TOKEN', 'TEST_TOKEN')
  })

  it('busca reviews via Apify e retorna resultado correto', async () => {
    const mockApifyReviews = [
      { id: '1', text: 'Bom', stars: 5, author: 'User1', publishedAt: '2026-05-15T10:00:00Z', url: 'http://fb' },
      { id: '2', text: 'Ruim', stars: 1, author: 'User2', publishedAt: '2026-05-15T10:00:00Z', url: 'http://fb' }
    ]
    vi.mocked(apifyLib.fetchFacebookReviews).mockResolvedValue(mockApifyReviews)

    const connector = mockConnector('facebook', { external_id: 'http://facebook.com/mypage' })
    const result = await run(connector)

    expect(apifyLib.fetchFacebookReviews).toHaveBeenCalledWith('http://facebook.com/mypage', 20)
    expect(result.reviews_fetched).toBe(2)
    expect(result.reviews_new).toBe(2)
    
    // Nao deve chamar fallback
    expect(facebookInstagramLib.syncMetaSocial).not.toHaveBeenCalled()
  })

  it('usa fallback (syncMetaSocial) se URL não for HTTP', async () => {
    const connector = mockConnector('facebook', { external_id: '123456789' })
    const result = await run(connector)

    expect(apifyLib.fetchFacebookReviews).not.toHaveBeenCalled()
    expect(facebookInstagramLib.syncMetaSocial).toHaveBeenCalledWith(connector.business_id, 'facebook')
    expect(result.reviews_fetched).toBe(0) // syncMetaSocial atualiza DB diretamente, run retorna 0
  })

  it('usa fallback (syncMetaSocial) se Apify falhar', async () => {
    vi.mocked(apifyLib.fetchFacebookReviews).mockRejectedValue(new Error('Apify Error'))

    const connector = mockConnector('facebook', { external_id: 'http://facebook.com/mypage' })
    const result = await run(connector)

    expect(apifyLib.fetchFacebookReviews).toHaveBeenCalled()
    expect(facebookInstagramLib.syncMetaSocial).toHaveBeenCalledWith(connector.business_id, 'facebook')
    expect(result.error).toBeUndefined()
  })
})
