import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockUpdate = vi.fn().mockReturnThis()
const mockEq = vi.fn().mockReturnThis()
const mockIn = vi.fn().mockReturnThis()
const mockLt = vi.fn().mockReturnThis()
const mockSelect = vi.fn().mockReturnThis()

const mockFrom = vi.fn((table: string) => {
  return {
    select: mockSelect,
    update: mockUpdate,
    eq: mockEq,
    in: mockIn,
    lt: mockLt,
    then: (onfulfilled: any) => {
      let data: any = []
      let error: any = null

      if (table === 'tenants') {
        // Simulação do update de trials expirados
        data = []
      } else if (table === 'channel_connectors') {
        // Se for o select dos ativos
        if (mockSelect.mock.calls.length === 1) {
          data = [
            {
              id: 'connector-1',
              status: 'active',
              monitored_businesses: {
                id: 'business-1',
                tenant_id: 'tenant-1',
                tenants: {
                  id: 'tenant-1',
                  is_active: false, // Tenant inativo -> deve ser pausado
                  subscription_status: 'suspended'
                }
              }
            },
            {
              id: 'connector-2',
              status: 'active',
              monitored_businesses: {
                id: 'business-2',
                tenant_id: 'tenant-2',
                tenants: {
                  id: 'tenant-2',
                  is_active: true,
                  subscription_status: 'active' // Ativo -> não deve ser pausado
                }
              }
            }
          ]
        } 
        // Se for o select dos pausados
        else {
          data = [
            {
              id: 'connector-3',
              status: 'paused',
              error_message: 'Pausado automaticamente: assinatura suspensa ou inativa.',
              monitored_businesses: {
                id: 'business-3',
                tenant_id: 'tenant-3',
                tenants: {
                  id: 'tenant-3',
                  is_active: true,
                  subscription_status: 'trial' // Voltou a ficar ativo/trial -> deve ser reativado
                }
              }
            },
            {
              id: 'connector-4',
              status: 'paused',
              error_message: 'Pausado automaticamente: assinatura suspensa ou inativa.',
              monitored_businesses: {
                id: 'business-4',
                tenant_id: 'tenant-4',
                tenants: {
                  id: 'tenant-4',
                  is_active: false,
                  subscription_status: 'suspended' // Continua suspenso -> não deve ser reativado
                }
              }
            }
          ]
        }
      }

      return Promise.resolve({ data, error }).then(onfulfilled)
    }
  }
})

vi.mock('../src/lib/supabase.js', () => ({
  supabase: {
    from: mockFrom,
  },
}))

describe('Scheduler — Reconciliação de Assinaturas e Reativação de Conectores', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSelect.mockClear()
    mockUpdate.mockClear()
    mockEq.mockClear()
    mockIn.mockClear()
    mockLt.mockClear()
  })

  it('deve pausar conectores de tenants inativos e reativar conectores de tenants reativados', async () => {
    const { reconcileSubscriptionConnectors } = await import('../src/scheduler/index.js')
    await reconcileSubscriptionConnectors()

    // 1. Deve atualizar tenants com trial expirado
    expect(mockFrom).toHaveBeenCalledWith('tenants')
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
      subscription_status: 'suspended',
      plan_status: 'suspended'
    }))

    // 2. Deve verificar os conectores ativos/running/error e pausar os inativos
    expect(mockFrom).toHaveBeenCalledWith('channel_connectors')
    // Deve pausar apenas o connector-1
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
      status: 'paused',
      error_message: 'Pausado automaticamente: assinatura suspensa ou inativa.'
    }))
    expect(mockIn).toHaveBeenCalledWith('id', ['connector-1'])

    // 3. Deve verificar os conectores pausados automaticamente e reativar os que voltaram a ficar ativos
    // Deve reativar apenas o connector-3
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
      status: 'active',
      error_message: null,
      next_sync_at: expect.any(String)
    }))
    expect(mockIn).toHaveBeenCalledWith('id', ['connector-3'])
  })
})
