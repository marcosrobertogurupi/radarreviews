/**
 * @file scheduler.security.test.ts
 * @description Testes de prevenção de Race Condition no scheduler.
 * Refs: C8 (FOR UPDATE SKIP LOCKED via RPC), OWASP A04
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockRpc  = vi.fn()
const mockFrom = vi.fn().mockReturnValue({
  update: vi.fn().mockReturnThis(),
  eq:     vi.fn().mockReturnThis(),
  in:     vi.fn().mockReturnThis(),
  or:     vi.fn().mockReturnThis(),
  order:  vi.fn().mockReturnThis(),
  insert: vi.fn().mockReturnThis(),
  select: vi.fn().mockReturnThis(),
  single: vi.fn().mockResolvedValue({ data: null, error: null }),
})

vi.mock('../src/lib/supabase.js', () => ({
  supabase: {
    rpc:  mockRpc,
    from: mockFrom,
  },
}))

describe('[C8] Scheduler — Prevenção de Race Condition', () => {

  beforeEach(() => {
    vi.clearAllMocks()
  })

  // [APPSEC C8-A] runOnce deve usar RPC claim_review_jobs, nunca SELECT direto
  it('deve chamar claim_review_jobs via RPC (não SELECT direto na tabela)', async () => {
    mockRpc.mockResolvedValueOnce({ data: [], error: null })

    // Mock fetchDueConnectors
    vi.mock('../src/scheduler/index.js', async (importOriginal) => {
      const original = await importOriginal<typeof import('../src/scheduler/index.js')>()
      return {
        ...original,
        fetchDueConnectors: vi.fn().mockResolvedValue([]),
      }
    })

    const { runOnce } = await import('../src/scheduler/index.js') as any
    await runOnce()

    expect(mockRpc).toHaveBeenCalledWith(
      'claim_review_jobs',
      expect.objectContaining({
        p_batch_size: expect.any(Number),
        p_worker_id:  expect.any(String),
      })
    )
  })

  // [APPSEC C8-E] Erro na RPC não deve crashar o processo
  it('não deve lançar exceção não tratada quando claim_review_jobs retorna erro', async () => {
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'connection timeout' },
    })

    const { runOnce } = await import('../src/scheduler/index.js') as any
    await expect(runOnce()).resolves.not.toThrow()
  })
})
