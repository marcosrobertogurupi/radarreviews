import { describe, it, expect, vi, beforeEach } from 'vitest'
import http from 'node:http'

// Hoisted mocks para evitar problemas de hoisting do Vitest
const mocks = vi.hoisted(() => {
  process.env['GEMINI_API_KEY'] = 'mock-gemini-key'
  process.env['SUPABASE_URL'] = 'https://mock.supabase.co'
  process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'mock-service-role-key'

  const state = {
    businesses: [] as any[],
    tenants: [] as any[],
    plans: [] as any[],
    connectors: [] as any[],
    inserted: [] as any[]
  }

  // Factory de sub-query para .in() — retorna objeto-like para ser usado como subquery
  const makeSubquery = (results: any[]) => results

  const fromFn = (table: string) => {
    let currentId: string | null = null
    let inValues: any[] | null = null
    let countMode = false
    let insertData: any = null
    let headMode = false

    const query: any = {
      select: (_col?: string, opts?: { count?: string; head?: boolean }) => {
        if (opts?.count === 'exact') countMode = true
        if (opts?.head === true) headMode = true
        return query
      },
      eq: (_col: string, val: any) => {
        currentId = val
        return query
      },
      in: (_col: string, subquery: any) => {
        // Extrair os ids do resultado da subquery
        if (Array.isArray(subquery)) {
          inValues = subquery.map((x: any) => (typeof x === 'string' ? x : x.id)).filter(Boolean)
        } else {
          // É uma subquery do Supabase — simular com estado atual de businesses
          inValues = state.businesses.map(b => b.id)
        }
        return query
      },
      single: () => query,
      maybeSingle: () => query,
      insert: (data: any) => {
        insertData = data
        const arr = Array.isArray(data) ? data : [data]
        const result = arr.map(item => ({ id: `conn-${Math.random()}`, ...item }))
        if (table === 'channel_connectors') {
          state.connectors.push(...result)
          state.inserted.push(...result)
        }
        return query
      },
      then: (onfulfilled: any) => {
        let resolvedValue: any = { data: null, error: null }

        if (countMode) {
          // Retorna contagem de conectores do tenant via inValues
          let count = 0
          if (inValues !== null) {
            count = state.connectors.filter(c => inValues!.includes(c.business_id)).length
          } else {
            count = state.connectors.length
          }
          return Promise.resolve({ count, error: null }).then(onfulfilled)
        }

        if (insertData !== null) {
          const arr = Array.isArray(insertData) ? insertData : [insertData]
          const res = arr.map(item => ({ id: `conn-${Math.random()}`, ...item }))
          return Promise.resolve({ data: res[0], error: null }).then(onfulfilled)
        }

        if (table === 'monitored_businesses') {
          const found = currentId
            ? state.businesses.find(b => b.id === currentId)
            : null
          resolvedValue = { data: found ?? null, error: found ? null : { message: 'Não encontrado' } }
        } else if (table === 'tenants') {
          const found = currentId
            ? state.tenants.find(t => t.id === currentId)
            : null
          resolvedValue = { data: found ?? null, error: null }
        } else if (table === 'plans') {
          const found = currentId
            ? state.plans.find(p => p.slug === currentId)
            : null
          resolvedValue = { data: found ?? null, error: null }
        }

        return Promise.resolve(resolvedValue).then(onfulfilled)
      }
    }
    return query
  }

  return { state, fromFn }
})

vi.mock('../src/lib/supabase.js', () => {
  const client = {
    from: mocks.fromFn,
    rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
    auth: {
      admin: {
        getUserById: vi.fn().mockResolvedValue({ data: { user: { email: 'test@test.com' } }, error: null })
      }
    }
  }
  return {
    supabase: client,
    supabaseAdmin: client
  }
})

import { handleCreateConnector } from '../src/api/server.js'

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

describe('F11 — Limites de Plano por Canais', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.state.businesses = []
    mocks.state.tenants = []
    mocks.state.plans = []
    mocks.state.connectors = []
    mocks.state.inserted = []
  })

  describe('F11-E1-T2: Bloquear quando o limite do plano for atingido', () => {
    it('Tenant no plano Basico não consegue habilitar um 4º canal sem upgrade', async () => {
      // Arrange: tenant no plano basico com 3 conectores já ativos
      mocks.state.businesses = [{ id: 'biz-1', tenant_id: 'tenant-1' }]
      mocks.state.tenants = [{ id: 'tenant-1', plan: 'basico' }]
      mocks.state.plans = [{ slug: 'basico', max_channels: 3 }]
      // Simular 3 conectores já existentes para biz-1
      mocks.state.connectors = [
        { id: 'c1', business_id: 'biz-1', channel: 'google_maps' },
        { id: 'c2', business_id: 'biz-1', channel: 'tripadvisor' },
        { id: 'c3', business_id: 'biz-1', channel: 'trustpilot' }
      ]

      const req = createMockReq('POST', '/api/admin/connector', {
        business_id: 'biz-1',
        channel: 'facebook',
        external_id: 'minha-pagina'
      })
      const res = createMockRes()

      await handleCreateConnector(req, res)

      expect(res.writeHead).toHaveBeenCalledWith(422, expect.any(Object))
      expect(res.body.code).toBe('PLAN_CHANNEL_LIMIT_EXCEEDED')
      expect(res.body.max).toBe(3)
      expect(res.body.current).toBe(3)
      expect(res.body.plan).toBe('basico')
    })

    it('Tenant no plano Basico consegue adicionar até 3 canais (dentro do limite)', async () => {
      // Arrange: tenant basico com 2 conectores — pode adicionar mais 1
      mocks.state.businesses = [{ id: 'biz-1', tenant_id: 'tenant-1' }]
      mocks.state.tenants = [{ id: 'tenant-1', plan: 'basico' }]
      mocks.state.plans = [{ slug: 'basico', max_channels: 3 }]
      mocks.state.connectors = [
        { id: 'c1', business_id: 'biz-1', channel: 'google_maps' },
        { id: 'c2', business_id: 'biz-1', channel: 'tripadvisor' }
      ]

      const req = createMockReq('POST', '/api/admin/connector', {
        business_id: 'biz-1',
        channel: 'trustpilot',
        external_id: 'minha-empresa'
      })
      const res = createMockRes()

      await handleCreateConnector(req, res)

      // Deve passar (201), não bloquear
      expect(res.writeHead).toHaveBeenCalledWith(201, expect.any(Object))
      expect(res.body.channel).toBe('trustpilot')
    })

    it('Tenant no plano Completo consegue adicionar até 8 canais', async () => {
      // Arrange: tenant completo com 7 conectores — pode adicionar mais 1
      mocks.state.businesses = [{ id: 'biz-2', tenant_id: 'tenant-2' }]
      mocks.state.tenants = [{ id: 'tenant-2', plan: 'completo' }]
      mocks.state.plans = [{ slug: 'completo', max_channels: 8 }]
      // 7 conectores existentes
      mocks.state.connectors = Array.from({ length: 7 }, (_, i) => ({
        id: `c${i}`,
        business_id: 'biz-2',
        channel: `channel_${i}`
      }))

      const req = createMockReq('POST', '/api/admin/connector', {
        business_id: 'biz-2',
        channel: 'reddit',
        external_id: 'r/minha-empresa'
      })
      const res = createMockRes()

      await handleCreateConnector(req, res)

      expect(res.writeHead).toHaveBeenCalledWith(201, expect.any(Object))
    })

    it('Tenant no plano Completo é bloqueado ao tentar adicionar o 9º canal', async () => {
      mocks.state.businesses = [{ id: 'biz-2', tenant_id: 'tenant-2' }]
      mocks.state.tenants = [{ id: 'tenant-2', plan: 'completo' }]
      mocks.state.plans = [{ slug: 'completo', max_channels: 8 }]
      // 8 conectores existentes
      mocks.state.connectors = Array.from({ length: 8 }, (_, i) => ({
        id: `c${i}`,
        business_id: 'biz-2',
        channel: `channel_${i}`
      }))

      const req = createMockReq('POST', '/api/admin/connector', {
        business_id: 'biz-2',
        channel: 'reddit',
        external_id: 'r/overflow'
      })
      const res = createMockRes()

      await handleCreateConnector(req, res)

      expect(res.writeHead).toHaveBeenCalledWith(422, expect.any(Object))
      expect(res.body.code).toBe('PLAN_CHANNEL_LIMIT_EXCEEDED')
      expect(res.body.max).toBe(8)
    })

    it('Tenant no plano Enterprise (999 canais) não é bloqueado', async () => {
      mocks.state.businesses = [{ id: 'biz-3', tenant_id: 'tenant-3' }]
      mocks.state.tenants = [{ id: 'tenant-3', plan: 'enterprise' }]
      mocks.state.plans = [{ slug: 'enterprise', max_channels: 999 }]
      // 50 conectores existentes — bem abaixo do limite
      mocks.state.connectors = Array.from({ length: 50 }, (_, i) => ({
        id: `c${i}`,
        business_id: 'biz-3',
        channel: `channel_${i}`
      }))

      const req = createMockReq('POST', '/api/admin/connector', {
        business_id: 'biz-3',
        channel: 'trustpilot',
        external_id: 'enterprise-brand'
      })
      const res = createMockRes()

      await handleCreateConnector(req, res)

      expect(res.writeHead).toHaveBeenCalledWith(201, expect.any(Object))
    })

    it('Retorna 404 quando business_id não existe', async () => {
      mocks.state.businesses = [] // Nenhuma empresa

      const req = createMockReq('POST', '/api/admin/connector', {
        business_id: 'biz-inexistente',
        channel: 'facebook',
        external_id: 'pagina'
      })
      const res = createMockRes()

      await handleCreateConnector(req, res)

      expect(res.writeHead).toHaveBeenCalledWith(404, expect.any(Object))
    })
  })
})
