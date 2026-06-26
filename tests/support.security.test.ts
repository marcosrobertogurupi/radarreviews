import { describe, it, expect, vi, beforeEach } from 'vitest'
import http from 'node:http'

// Criar estados compartilhados usando vi.hoisted para evitar problemas de hoisting no Vitest
const mocks = vi.hoisted(() => {
  // Configura variáveis de ambiente necessárias para evitar erros de inicialização nos módulos importados
  process.env['GEMINI_API_KEY'] = 'mock-gemini-key'
  process.env['SUPABASE_URL'] = 'https://mock.supabase.co'
  process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'mock-service-role-key'

  const state = {
    tenant: { plan: 'completo' },
    plan: { id: 'plan-completo-id', slug: 'completo' },
    slaRule: { resolution_mins: 60, escalation_level: 2 },
    tickets: [] as any[],
    insertedAudits: [] as any[],
    updatedTickets: [] as any[],
  }

  const fromFn = (table: string) => {
    let isSingle = false
    let resolveVal: any = null

    const query: any = {
      select: () => query,
      eq: () => query,
      or: () => query,
      gte: () => query,
      lte: () => query,
      lt: () => query,
      not: () => query,
      is: () => query,
      order: () => query,
      limit: () => query,
      maybeSingle: () => {
        isSingle = true
        return query
      },
      single: () => {
        isSingle = true
        return query
      },
      insert: (data: any) => {
        if (table === 'support_tickets') {
          const arr = Array.isArray(data) ? data : [data]
          const inserted = arr.map((item, index) => ({
            id: `ticket-${index}-${Math.random().toString(36).substring(2, 9)}`,
            created_at: new Date().toISOString(),
            status: 'open',
            escalation_level: 0,
            ...item
          }))
          state.tickets.push(...inserted)
          resolveVal = { data: isSingle ? inserted[0] : inserted, error: null }
        } else if (table === 'ticket_audit_log') {
          const arr = Array.isArray(data) ? data : [data]
          state.insertedAudits.push(...arr)
          resolveVal = { data: arr, error: null }
        }
        return query
      },
      update: (data: any) => {
        state.updatedTickets.push(data)
        if (table === 'support_tickets') {
          state.tickets = state.tickets.map(t => ({ ...t, ...data }))
          resolveVal = { data: state.tickets, error: null }
        } else {
          resolveVal = { data: [], error: null }
        }
        return query
      },
      then: (onfulfilled: any) => {
        if (resolveVal) {
          const v = resolveVal
          resolveVal = null // reset for next queries
          return Promise.resolve(v).then(onfulfilled)
        }
        let resolvedValue: any = { data: [] as any[], error: null }
        if (table === 'tenants') {
          resolvedValue = { data: state.tenant, error: null }
        } else if (table === 'plans') {
          resolvedValue = { data: state.plan, error: null }
        } else if (table === 'ticket_sla_rules') {
          resolvedValue = { data: state.slaRule, error: null }
        } else if (table === 'support_tickets') {
          resolvedValue = { data: isSingle ? state.tickets[0] : state.tickets, error: null }
        }
        return Promise.resolve(resolvedValue).then(onfulfilled)
      }
    }

    return query
  }

  const authGetUser = vi.fn().mockResolvedValue({
    data: { user: { id: 'user-1', email: 'cliente@teste.com' } },
    error: null
  })

  return { state, fromFn, authGetUser }
})

vi.mock('../src/lib/supabase.js', () => {
  const client = {
    from: mocks.fromFn,
    rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
    auth: {
      admin: {
        getUserById: mocks.authGetUser
      }
    }
  }
  return {
    supabase: client,
    supabaseAdmin: client,
  }
})

// Mocks secundários
vi.mock('../src/services/supportAITriage.js', () => ({
  supportAITriageService: {
    triage: vi.fn().mockResolvedValue(undefined)
  }
}))

// Importar os handlers e jobs
import { handleSupportPortal } from '../src/api/support.js'
import { handleSupportAdmin } from '../src/api/supportAdmin.js'
import { checkSLA } from '../src/lib/support-jobs.js'

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
    end: vi.fn(),
    headersSent: false,
  } as unknown as http.ServerResponse & { writeHead: any; end: any }
  return res
}

describe('Central de Suporte - Helpdesk, SLA e Auditoria', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.state.tickets = []
    mocks.state.insertedAudits = []
    mocks.state.updatedTickets = []
    mocks.state.tenant = { plan: 'completo' }
    mocks.state.plan = { id: 'plan-completo-id', slug: 'completo' }
    mocks.state.slaRule = { resolution_mins: 60, escalation_level: 2 }
  })

  describe('Máquina de Estados de Tickets', () => {
    it('deve permitir transição válida de status de open para in_progress', async () => {
      mocks.state.tickets = [{
        id: 'ticket-123',
        tenant_id: 'tenant-1',
        status: 'open',
        priority: 'medium',
        created_at: new Date().toISOString()
      }]

      const req = createMockReq('PATCH', '/api/admin/support/tickets/ticket-123', { status: 'in_progress' })
      const res = createMockRes()
      const auth = { userId: 'agent-1', perfil: 'admin' }

      await handleSupportAdmin(req, res, auth)

      expect(res.writeHead).toHaveBeenCalledWith(200, expect.any(Object))
      expect(mocks.state.insertedAudits.length).toBe(1)
      expect(mocks.state.insertedAudits[0].action).toBe('status_changed')
      expect(mocks.state.insertedAudits[0].from_value).toBe('open')
      expect(mocks.state.insertedAudits[0].to_value).toBe('in_progress')
    })

    it('deve bloquear transição inválida de status de closed para in_progress com 400', async () => {
      mocks.state.tickets = [{
        id: 'ticket-456',
        tenant_id: 'tenant-1',
        status: 'closed',
        priority: 'medium',
        created_at: new Date().toISOString()
      }]

      const req = createMockReq('PATCH', '/api/admin/support/tickets/ticket-456', { status: 'in_progress' })
      const res = createMockRes()
      const auth = { userId: 'agent-1', perfil: 'admin' }

      await handleSupportAdmin(req, res, auth)

      expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object))
      expect(mocks.state.insertedAudits.length).toBe(0)
    })

    it('deve reabrir o ticket e auditar a mudança quando o tenant enviar uma mensagem no ticket fechado', async () => {
      mocks.state.tickets = [{
        id: 'ticket-789',
        tenant_id: 'tenant-1',
        status: 'closed',
        priority: 'medium',
        created_at: new Date().toISOString()
      }]

      const req = createMockReq('POST', '/api/support/tickets/ticket-789/messages', { body: 'Nova dúvida sobre o mesmo tema' })
      const res = createMockRes()
      const auth = { userId: 'user-1', tenantId: 'tenant-1' }

      await handleSupportPortal(req, res, auth)

      expect(res.writeHead).toHaveBeenCalledWith(201, expect.any(Object))
      // Deve ter inserido auditoria de reopened e status_changed
      expect(mocks.state.insertedAudits.some(a => a.action === 'reopened')).toBe(true)
      expect(mocks.state.insertedAudits.some(a => a.action === 'status_changed' && a.to_value === 'reopened')).toBe(true)
    })
  })

  describe('Cálculo de SLA Dinâmico', () => {
    it('deve calcular a data de SLA baseado na prioridade e plano do tenant na criação', async () => {
      const req = createMockReq('POST', '/api/support/tickets', {
        subject: 'Instabilidade no Maps',
        description: 'Não sincroniza',
        priority: 'high'
      })
      const res = createMockRes()
      const auth = { userId: 'user-1', tenantId: 'tenant-1' }

      await handleSupportPortal(req, res, auth)

      expect(res.writeHead).toHaveBeenCalledWith(201, expect.any(Object))
      expect(mocks.state.tickets.length).toBe(1)
      expect(mocks.state.tickets[0].priority).toBe('high')
      expect(mocks.state.tickets[0].sla_deadline).toBeDefined()
      
      const deadline = new Date(mocks.state.tickets[0].sla_deadline).getTime()
      const now = Date.now()
      // A regra mocked tem resolution_mins: 60 minutos (1 hora)
      expect(deadline - now).toBeLessThanOrEqual(60 * 60 * 1000 + 5000)
    })

    it('deve recalcular a data de SLA se a prioridade do ticket for alterada no PATCH', async () => {
      const createdAt = new Date(Date.now() - 30 * 60 * 1000) // Criado há 30 min
      mocks.state.tickets = [{
        id: 'ticket-abc',
        tenant_id: 'tenant-1',
        status: 'open',
        priority: 'medium',
        created_at: createdAt.toISOString(),
        sla_deadline: new Date(createdAt.getTime() + 240 * 60 * 1000).toISOString() // 4 horas
      }]

      // Nova regra de SLA simulada para critical (10 min)
      mocks.state.slaRule = { resolution_mins: 10, escalation_level: 3 }

      const req = createMockReq('PATCH', '/api/admin/support/tickets/ticket-abc', { priority: 'critical' })
      const res = createMockRes()
      const auth = { userId: 'agent-1', perfil: 'admin' }

      await handleSupportAdmin(req, res, auth)

      expect(res.writeHead).toHaveBeenCalledWith(200, expect.any(Object))
      const lastUpdate = mocks.state.updatedTickets[mocks.state.updatedTickets.length - 1]
      expect(lastUpdate.priority).toBe('critical')
      
      // Nova data limite deve ser createdAt + 10 min
      const newDeadline = new Date(lastUpdate.sla_deadline).getTime()
      expect(newDeadline - createdAt.getTime()).toBe(10 * 60 * 1000)
    })
  })

  describe('Auditoria Imutável e Watchdog de SLA', () => {
    it('deve marcar o ticket como breached, alterar para status escalated e registrar auditoria de escalação se passar da data limite', async () => {
      const deadlinePast = new Date(Date.now() - 5000).toISOString() // Expirou há 5s
      mocks.state.tickets = [{
        id: 'ticket-expired',
        tenant_id: 'tenant-1',
        status: 'open',
        priority: 'high',
        escalation_level: 0,
        is_sla_breached: false,
        sla_deadline: deadlinePast
      }]

      await checkSLA()

      expect(mocks.state.updatedTickets.length).toBe(1)
      const ticketUpdate = mocks.state.updatedTickets[0]
      expect(ticketUpdate.is_sla_breached).toBe(true)
      expect(ticketUpdate.status).toBe('escalated')
      expect(ticketUpdate.escalation_level).toBe(2) // da regra de SLA mockada

      // Deve ter inserido auditoria de sla_breached, status_changed e escalated
      expect(mocks.state.insertedAudits.some(a => a.action === 'sla_breached')).toBe(true)
      expect(mocks.state.insertedAudits.some(a => a.action === 'status_changed' && a.to_value === 'escalated')).toBe(true)
      expect(mocks.state.insertedAudits.some(a => a.action === 'escalated' && a.to_value === '2')).toBe(true)
    })
  })
})
