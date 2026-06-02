/**
 * @file tenantIsolation.security.test.ts
 * @description Testes de isolamento multi-tenant: tenantQuery(), getAuthUser(),
 *              checkTenantStatus() e BOLA/IDOR.
 * Refs: C2 (tenant filter), C3 (JWT), C4 (IDOR), C5 (trial enforcement)
 * OWASP: A01, A07
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mocks base ─────────────────────────────────────────────────────────────
const chainable = {
  select: vi.fn().mockReturnThis(),
  eq:     vi.fn().mockReturnThis(),
  single: vi.fn(),
  update: vi.fn().mockReturnThis(),
}

const mockFrom = vi.fn().mockReturnValue(chainable)

vi.mock('../src/lib/supabase.js', () => ({
  supabaseAdmin: { 
    from: mockFrom,
    auth: { getUser: vi.fn() }
  },
}))

  beforeEach(() => {
    vi.clearAllMocks()
  })

  // [APPSEC C3-A] Token ausente deve retornar null
  it('deve retornar null quando Authorization header está ausente', async () => {
    const { getAuthUser } = await import('../src/api/server.js') as any
    const result = await getAuthUser(undefined)
    expect(result).toBeNull()
  })

  // [APPSEC C3-B] Token inválido deve retornar null
  it('deve retornar null quando o token é inválido ou expirado', async () => {
    const { supabaseAdmin } = await import('../src/lib/supabase.js')
    vi.mocked(supabaseAdmin.auth.getUser).mockResolvedValueOnce({
      data: { user: null },
      error: { message: 'Invalid JWT' } as any,
    })

    const { getAuthUser } = await import('../src/api/server.js') as any
    const result = await getAuthUser('Bearer token-invalido')
    expect(result).toBeNull()
  })

  // [APPSEC C3-C] Token válido com tenant_id em app_metadata deve retornar tenant_id correto
  it('deve retornar auth config com tenant_id do app_metadata', async () => {
    const { supabaseAdmin } = await import('../src/lib/supabase.js')
    vi.mocked(supabaseAdmin.auth.getUser).mockResolvedValueOnce({
      data: {
        user: {
          id: 'user-valido',
          app_metadata: { tenant_id: 'tenant-abc' },
        } as any,
      },
      error: null,
    })

    // Mock das queries subsequentes
    chainable.single.mockResolvedValueOnce({ data: { perfil: 'admin' }, error: null }) // usuarios
    chainable.single.mockResolvedValueOnce({ data: { id: 'rel-id' }, error: null }) // tenant_users

    const { getAuthUser } = await import('../src/api/server.js') as any
    const result = await getAuthUser('Bearer token-bom')

    expect(result).not.toBeNull()
    expect(result.tenantId).toBe('tenant-abc')
  })
})

describe('[C5] Controle de Acesso — checkTenantStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // [APPSEC C5-A] Tenant suspenso deve retornar false
  it('deve retornar false para tenant com status = suspended', async () => {
    chainable.single.mockResolvedValueOnce({
      data: { is_active: true, subscription_status: 'suspended', trial_ends_at: null },
      error: null,
    })

    const { checkTenantStatus } = await import('../src/api/server.js') as any
    const result = await checkTenantStatus('tenant-suspenso')
    expect(result).toBe(false)
  })

  // [APPSEC C5-B] Trial expirado deve retornar false
  it('deve retornar false para tenant com trial expirado', async () => {
    const yesterday = new Date(Date.now() - 86_400_000).toISOString()
    chainable.single.mockResolvedValueOnce({
      data: { is_active: true, subscription_status: 'trial', trial_ends_at: yesterday },
      error: null,
    })

    const { checkTenantStatus } = await import('../src/api/server.js') as any
    const result = await checkTenantStatus('tenant-trial-expirado')
    expect(result).toBe(false)
  })

  // [APPSEC C5-C] Trial ainda válido deve retornar true
  it('deve retornar true para tenant com trial ainda válido', async () => {
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString()
    chainable.single.mockResolvedValueOnce({
      data: { is_active: true, subscription_status: 'trial', trial_ends_at: tomorrow },
      error: null,
    })

    const { checkTenantStatus } = await import('../src/api/server.js') as any
    const result = await checkTenantStatus('tenant-trial-ok')
    expect(result).toBe(true)
  })
})

describe('[C2] Isolamento Multi-Tenant — tenantQuery()', () => {

  // [APPSEC C2-A] tenantQuery deve sempre encadear .eq('tenant_id', ...)
  it('deve incluir filtro tenant_id em qualquer query via tenantQuery()', async () => {
    const { tenantQuery } = await import('../src/api/server.js') as any

    tenantQuery('reviews', 'tenant-abc')

    expect(mockFrom).toHaveBeenCalledWith('reviews')
    expect(chainable.eq).toHaveBeenCalledWith('tenant_id', 'tenant-abc')
  })
})
