// Testes do conector Instagram
// Valida: recuperação de token do Vault, coleta de posts e comentários,
// filtragem por palavras-chave, normalização e cenários de erro.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { run } from '../../src/connectors/instagram.js'
import { mockConnector } from '../fixtures/connector.js'

vi.mock('dotenv/config', () => ({}))

// -----------------------------------------------------------------------------
// Mock do Supabase
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

const makeMedia = (id: string, commentsCount = 2) => ({
  id,
  caption: `Post sobre produto ${id}`,
  timestamp: '2024-11-10T10:00:00+0000',
  like_count: 100,
  comments_count: commentsCount,
})

const makeComment = (id: string, text: string, username = 'user_test') => ({
  id,
  text,
  username,
  timestamp: '2024-11-10T10:05:00+0000',
})

const makeMediaResponse = (media: ReturnType<typeof makeMedia>[]) => ({
  data: { data: media },
})

const makeCommentsResponse = (comments: ReturnType<typeof makeComment>[]) => ({
  data: { data: comments },
})

// -----------------------------------------------------------------------------
// Testes
// -----------------------------------------------------------------------------

describe('Instagram connector', () => {
  let axiosMockGet: any

  beforeEach(async () => {
    vi.clearAllMocks()

    const axiosModule = await import('axios')
    axiosMockGet = axiosModule.default.get

    // Vault retorna token válido por padrão
    mockSingle.mockResolvedValue({
      data: { decrypted_secret: 'MOCKED_IG_ACCESS_TOKEN' },
      error: null,
    })
  })

  it('coleta comentários de posts recentes', async () => {
    // Usar connector sem feedback_keywords para coletar todos os comentários
    axiosMockGet
      .mockResolvedValueOnce(makeMediaResponse([makeMedia('media1'), makeMedia('media2')]))
      .mockResolvedValueOnce(makeCommentsResponse([
        makeComment('c1', 'Produto ótimo!'),
        makeComment('c2', 'Atendimento péssimo'),
      ]))
      .mockResolvedValueOnce(makeCommentsResponse([
        makeComment('c3', 'Gostei muito'),
      ]))

    // Override config para remover keywords
    const connector = mockConnector('instagram', { config: { interval_minutes: 360 } })
    const result = await run(connector)

    expect(result.reviews_fetched).toBe(3)
    expect(result.error).toBeUndefined()
  })

  it('filtra comentários por feedback_keywords quando configurado', async () => {
    axiosMockGet
      .mockResolvedValueOnce(makeMediaResponse([makeMedia('media1')]))
      .mockResolvedValueOnce(makeCommentsResponse([
        makeComment('c1', 'Produto ótimo!'),      // match: 'ótimo'
        makeComment('c2', 'Entrega rápida'),       // sem match
        makeComment('c3', 'Atendimento péssimo'),  // match: 'péssimo'
      ]))

    const connector = mockConnector('instagram', {
      config: { feedback_keywords: ['ótimo', 'péssimo'], interval_minutes: 360 },
    })
    const result = await run(connector)

    // Apenas 2 dos 3 comentários devem passar pelo filtro
    expect(result.reviews_fetched).toBe(2)
  })

  it('coleta todos os comentários quando feedback_keywords não está configurado', async () => {
    axiosMockGet
      .mockResolvedValueOnce(makeMediaResponse([makeMedia('media1')]))
      .mockResolvedValueOnce(makeCommentsResponse([
        makeComment('c1', 'Primeiro comentário'),
        makeComment('c2', 'Segundo comentário'),
        makeComment('c3', 'Terceiro comentário'),
      ]))

    // Config sem feedback_keywords
    const connector = mockConnector('instagram', {
      config: { interval_minutes: 360 },
    })
    const result = await run(connector)

    expect(result.reviews_fetched).toBe(3)
  })

  it('pula posts sem comentários (comments_count = 0)', async () => {
    axiosMockGet
      .mockResolvedValueOnce(makeMediaResponse([
        makeMedia('media1', 0), // sem comentários
        makeMedia('media2', 3),  // com comentários
      ]))
      .mockResolvedValueOnce(makeCommentsResponse([
        makeComment('c1', 'Bom'),
        makeComment('c2', 'Ótimo'),
        makeComment('c3', 'Ruim'),
      ]))

    // Config sem keywords
    const connector = mockConnector('instagram', { config: { interval_minutes: 360 } })
    const result = await run(connector)

    // Só deve ter buscado comentários do media2 (media1 tem 0)
    expect(axiosMockGet).toHaveBeenCalledTimes(2) // 1 media + 1 comments
    expect(result.reviews_fetched).toBe(3)
  })

  it('retorna reviews_fetched = 0 quando não há posts', async () => {
    axiosMockGet.mockResolvedValueOnce(makeMediaResponse([]))

    const connector = mockConnector('instagram')
    const result = await run(connector)

    expect(result.reviews_fetched).toBe(0)
    expect(result.error).toBeUndefined()
  })

  it('retorna error quando vault_secret_id não está configurado', async () => {
    const connector = mockConnector('instagram', { vault_secret_id: null })
    const result = await run(connector)

    expect(result.error).toContain('vault_secret_id')
  })

  it('retorna error quando external_id está vazio', async () => {
    const connector = mockConnector('instagram', { external_id: '' })
    const result = await run(connector)

    expect(result.error).toContain('user_id obrigatório')
  })

  it('usa o comment.id como external_id (não um hash)', async () => {
    axiosMockGet
      .mockResolvedValueOnce(makeMediaResponse([makeMedia('media1')]))
      .mockResolvedValueOnce(makeCommentsResponse([makeComment('comment_ig_xyz', 'Bom!')]))

    // Sem keywords para que o comment passe
    const connector = mockConnector('instagram', { config: { interval_minutes: 360 } })
    await run(connector)

    const inCalls = mockSupabaseMethods.in.mock.calls
    expect(inCalls.length).toBeGreaterThan(0)
    expect(inCalls[0][1]).toContain('comment_ig_xyz')
  })
})
