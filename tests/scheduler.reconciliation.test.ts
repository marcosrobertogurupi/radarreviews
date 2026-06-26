import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockUpdate = vi.fn().mockReturnThis()
const mockEq = vi.fn().mockReturnThis()
const mockIn = vi.fn().mockReturnThis()
const mockLt = vi.fn().mockReturnThis()
const mockSelect = vi.fn().mockReturnThis()

const mockFrom = vi.fn((table: string) => {
  const query = {
    select: mockSelect,
    update: mockUpdate,
    eq: mockEq,
    in: mockIn,
    lt: mockLt,
    single: vi.fn(),
    maybeSingle: vi.fn(),
    then: (onfulfilled: any) => {
      let data: any = []
      let error: any = null

      if (table === 'usuarios') {
        data = { perfil: 'admin', nome: 'Admin', email: 'admin@reputei.com.br' }
      } else if (table === 'tenant_users') {
        data = { tenant_id: 'tenant-abc' }
      } else if (table === 'tenants') {
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

  query.single.mockImplementation(() => {
    let data: any = null
    if (table === 'usuarios') {
      data = { perfil: 'admin', nome: 'Admin', email: 'admin@reputei.com.br' }
    } else if (table === 'tenant_users') {
      data = { tenant_id: 'tenant-abc' }
    } else if (table === 'tenants') {
      data = {
        plan: 'trial',
        plan_status: 'suspended',
        subscription_status: 'suspended',
        trial_ends_at: '2026-05-01T00:00:00.000Z',
        is_active: false
      }
    }
    return Promise.resolve({ data, error: null })
  })

  query.maybeSingle.mockImplementation(() => {
    return Promise.resolve({ data: null, error: null })
  })

  return query
})

vi.mock('../src/lib/supabase.js', () => {
  const client = {
    from: mockFrom,
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: {
          user: {
            id: 'user-valido',
            app_metadata: { tenant_id: 'tenant-abc' },
          }
        },
        error: null
      })
    }
  }
  return {
    supabase: client,
    supabaseAdmin: client
  }
})

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

import http from 'node:http'

function createMockReq(method: string, url: string, body?: any): http.IncomingMessage {
  const req = new http.IncomingMessage(null as any)
  req.method = method
  req.url = url
  if (body) {
    req.push(JSON.stringify(body))
    req.push(null)
  } else {
    req.push(null)
  }
  return req
}

function createMockRes() {
  const res = {
    writeHead: vi.fn().mockReturnThis(),
    setHeader: vi.fn().mockReturnThis(),
    end: vi.fn().mockImplementation((payload) => {
      try { res.body = payload ? JSON.parse(payload) : null } catch { res.body = payload }
    }),
    headersSent: false,
    body: null as any
  } as unknown as http.ServerResponse & { writeHead: any; setHeader: any; end: any; body: any }
  return res
}

describe('API — handleUpdateTenant e Reativação Inteligente', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSelect.mockClear()
    mockUpdate.mockClear()
    mockEq.mockClear()
    mockIn.mockClear()
    mockLt.mockClear()
  })

  it('deve reativar o status do plano e da assinatura quando trial_ends_at for alterado para o futuro', async () => {

    // Simula a requisição PATCH para estender trial
    const req = createMockReq('PATCH', '/api/admin/tenant/tenant-trial-id', {
      trial_ends_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
    })
    req.headers = {
      authorization: 'Bearer token-valido'
    }
    const res = createMockRes()

    const { handleUpdateTenant } = await import('../src/api/server.js')
    await handleUpdateTenant(req, res)

    // Deve atualizar o tenant mudando status para trial e is_active para true
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
      plan_status: 'trial',
      subscription_status: 'trial',
      is_active: true
    }))

    // Deve atualizar as monitored_businesses vinculadas
    expect(mockFrom).toHaveBeenCalledWith('monitored_businesses')
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
      is_active: true
    }))
  })
})
