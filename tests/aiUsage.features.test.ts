import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mocks do Supabase
const chainable = {
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  maybeSingle: vi.fn(),
  single: vi.fn(),
  insert: vi.fn().mockResolvedValue({ data: null, error: null }),
  update: vi.fn().mockReturnThis(),
}

const mockFrom = vi.fn().mockReturnValue(chainable)

vi.mock('../src/lib/supabase.js', () => ({
  supabase: {
    from: mockFrom,
    auth: { getUser: vi.fn() },
  },
  supabaseAdmin: {
    from: mockFrom,
    auth: { getUser: vi.fn() },
  },
}))

describe('Gestão de Cotas e Métricas de IA (ai-usage)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    chainable.select.mockReturnThis()
    chainable.eq.mockReturnThis()
    chainable.update.mockReturnThis()
  })

  it('deve permitir acesso à IA se a cota estiver abaixo do limite e não houver bloqueio', async () => {
    chainable.maybeSingle.mockResolvedValueOnce({
      data: { ai_quota_limit: 500000, ai_quota_used: 150000, ai_blocked: false },
      error: null,
    })

    const { checkTenantAIQuota } = await import('../src/services/ai/ai-usage.js')
    const res = await checkTenantAIQuota('tenant-123')

    expect(res.allowed).toBe(true)
    expect(res.used).toBe(150000)
    expect(res.limit).toBe(500000)
    expect(res.blocked).toBe(false)
  })

  it('deve bloquear acesso à IA se ai_blocked for verdadeiro', async () => {
    chainable.maybeSingle.mockResolvedValueOnce({
      data: { ai_quota_limit: 500000, ai_quota_used: 1000, ai_blocked: true },
      error: null,
    })

    const { checkTenantAIQuota } = await import('../src/services/ai/ai-usage.js')
    const res = await checkTenantAIQuota('tenant-blocked')

    expect(res.allowed).toBe(false)
    expect(res.blocked).toBe(true)
    expect(res.reason).toContain('bloqueado')
  })

  it('deve bloquear acesso à IA se o consumo tiver atingido/excedido o limite', async () => {
    chainable.maybeSingle.mockResolvedValueOnce({
      data: { ai_quota_limit: 500000, ai_quota_used: 500000, ai_blocked: false },
      error: null,
    })

    const { checkTenantAIQuota } = await import('../src/services/ai/ai-usage.js')
    const res = await checkTenantAIQuota('tenant-exceeded')

    expect(res.allowed).toBe(false)
    expect(res.reason).toContain('Cota mensal de uso de IA excedida')
  })

  it('deve registrar o consumo de tokens e calcular o custo estimado em USD corretamente', async () => {
    chainable.single.mockResolvedValueOnce({
      data: { ai_quota_used: 1000 },
      error: null,
    })

    const { recordAIUsage } = await import('../src/services/ai/ai-usage.js')

    await recordAIUsage({
      tenantId: 'tenant-123',
      requestType: 'copilot',
      modelUsed: 'gemini-2.5-flash',
      promptTokens: 1000,
      completionTokens: 500,
    })

    // Deve ter chamado a tabela tenant_ai_usage_logs para inserir o log
    expect(mockFrom).toHaveBeenCalledWith('tenant_ai_usage_logs')
    expect(chainable.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        tenant_id: 'tenant-123',
        request_type: 'copilot',
        model_used: 'gemini-2.5-flash',
        prompt_tokens: 1000,
        completion_tokens: 500,
        estimated_cost_usd: 0.000225, // (1000 * 0.075/1M) + (500 * 0.30/1M) = 0.000075 + 0.00015 = 0.000225
      })
    )

    // Deve ter incrementado ai_quota_used na tabela tenants
    expect(mockFrom).toHaveBeenCalledWith('tenants')
    expect(chainable.update).toHaveBeenCalledWith({ ai_quota_used: 2500 })
  })
})
