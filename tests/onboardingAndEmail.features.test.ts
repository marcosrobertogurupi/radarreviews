import { describe, it, expect, vi, beforeEach } from 'vitest'
import http from 'node:http'

// Setup de mocks do Vitest usando hoisting
const mocks = vi.hoisted(() => {
  process.env['GEMINI_API_KEY'] = 'mock-gemini-key'
  process.env['SUPABASE_URL'] = 'https://mock.supabase.co'
  process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'mock-service-role-key'
  process.env['SMTP_HOST'] = 'smtp.mock.com'
  process.env['SMTP_PORT'] = '587'
  process.env['SMTP_USER'] = 'user'
  process.env['SMTP_PASS'] = 'pass'

  const state = {
    tenants: [] as any[],
    tenantUsers: [] as any[],
    businesses: [] as any[],
    alertRules: [] as any[],
    connectors: [] as any[],
    users: [] as any[],
    tickets: [] as any[],
    messages: [] as any[],
    audits: [] as any[],
    sentEmails: [] as any[]
  }

  const fromFn = (table: string) => {
    let isSingle = false
    let currentId: string | null = null
    let actionResult: any = null
    let updateData: any = null

    const query: any = {
      select: () => query,
      eq: (col: string, val: any) => {
        if (col === 'id' || col === 'tenant_id') {
          currentId = val
        }
        return query
      },
      or: () => query,
      order: () => query,
      limit: () => query,
      single: () => {
        isSingle = true
        return query
      },
      maybeSingle: () => {
        isSingle = true
        return query
      },
      in: () => query,
      insert: (data: any) => {
        const arr = Array.isArray(data) ? data : [data]
        if (table === 'tenants') {
          actionResult = arr.map(item => ({ id: item.id || `tenant-${Math.random()}`, plan: 'trial', subscription_status: 'trial', ...item }))
          state.tenants.push(...actionResult)
        } else if (table === 'tenant_users') {
          actionResult = arr.map(item => ({ id: `tu-${Math.random()}`, ...item }))
          state.tenantUsers.push(...actionResult)
        } else if (table === 'monitored_businesses') {
          actionResult = arr.map(item => ({ id: item.id || `biz-${Math.random()}`, name: item.name, ...item }))
          state.businesses.push(...actionResult)
        } else if (table === 'alert_rules') {
          actionResult = arr.map(item => ({ id: `rule-${Math.random()}`, ...item }))
          state.alertRules.push(...actionResult)
        } else if (table === 'channel_connectors') {
          actionResult = arr.map(item => ({ id: `conn-${Math.random()}`, ...item }))
          state.connectors.push(...actionResult)
        } else if (table === 'support_tickets') {
          actionResult = arr.map(item => ({ id: item.id || `ticket-${Math.random()}`, ticket_number: 1, created_by: 'user-1', ...item }))
          state.tickets.push(...actionResult)
        } else if (table === 'ticket_messages') {
          actionResult = arr.map(item => ({ id: `msg-${Math.random()}`, ...item }))
          state.messages.push(...actionResult)
        } else if (table === 'ticket_audit_log') {
          actionResult = arr.map(item => ({ id: `audit-${Math.random()}`, ...item }))
          state.audits.push(...actionResult)
        }
        return query
      },
      update: (data: any) => {
        updateData = data
        return query
      },
      then: (onfulfilled: any) => {
        if (updateData !== null) {
          if (table === 'tenants') {
            state.tenants = state.tenants.map(t => (t.id === currentId ? { ...t, ...updateData } : t))
            actionResult = state.tenants.find(t => t.id === currentId)
          } else if (table === 'support_tickets') {
            state.tickets = state.tickets.map(t => (t.id === currentId ? { ...t, ...updateData } : t))
            actionResult = state.tickets.find(t => t.id === currentId)
          }
          updateData = null
        }

        if (actionResult !== null) {
          const res = actionResult
          actionResult = null
          const isArr = Array.isArray(res)
          const data = isSingle ? (isArr ? res[0] : res) : (isArr ? res : [res])
          return Promise.resolve({ data, error: null }).then(onfulfilled)
        }

        let resolvedValue: any = { data: [], error: null }
        if (table === 'tenants') {
          const t = currentId ? state.tenants.find(x => x.id === currentId) : state.tenants
          resolvedValue = { data: isSingle ? t : (Array.isArray(t) ? t : [t]), error: null }
        } else if (table === 'monitored_businesses') {
          const b = currentId ? state.businesses.find(x => x.id === currentId) : state.businesses
          resolvedValue = { data: isSingle ? b : (Array.isArray(b) ? b : [b]), error: null }
        } else if (table === 'plans') {
          resolvedValue = { data: { slug: ' basico', max_channels: 3, price_monthly: 99 }, error: null }
        } else if (table === 'support_tickets') {
          const t = currentId ? state.tickets.find(x => x.id === currentId) : state.tickets
          resolvedValue = { data: isSingle ? t : (Array.isArray(t) ? t : [t]), error: null }
        }
        return Promise.resolve(resolvedValue).then(onfulfilled)
      }
    }
    return query
  }

  const rpcFn = () => Promise.resolve({ data: [], error: null })

  const mockSendMail = vi.fn().mockImplementation((payload) => {
    state.sentEmails.push(payload)
    return Promise.resolve({ messageId: 'mock-msg-id' })
  })

  const mockCreateTransport = vi.fn().mockReturnValue({
    sendMail: mockSendMail
  })

  const authGetUser = vi.fn().mockResolvedValue({
    data: { user: { id: 'user-1', email: 'cliente@teste.com' } },
    error: null
  })

  const mockSchedulerRunOnce = vi.fn().mockResolvedValue(undefined)

  return { state, fromFn, rpcFn, mockSendMail, mockCreateTransport, authGetUser, mockSchedulerRunOnce }
})

vi.mock('nodemailer', () => ({
  default: {
    createTransport: mocks.mockCreateTransport
  }
}))

vi.mock('../src/lib/supabase.js', () => {
  const client = {
    from: mocks.fromFn,
    rpc: mocks.rpcFn,
    auth: {
      admin: {
        createUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null }),
        getUserById: mocks.authGetUser
      }
    }
  }
  return {
    supabase: client,
    supabaseAdmin: client
  }
})

vi.mock('../src/scheduler/index.js', () => ({
  startScheduler: vi.fn(),
  runOnce: mocks.mockSchedulerRunOnce
}))

// Importar serviços
import { emailService } from '../src/services/emailService.js'
import { handleOnboarding } from '../src/api/server.js'
import { handleSupportPortal } from '../src/api/support.js'
import { handleSupportAdmin } from '../src/api/supportAdmin.js'
import { runOnce } from '../src/scheduler/index.js'

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
      res.body = payload ? JSON.parse(payload) : null
    }),
    headersSent: false,
    body: null as any
  } as unknown as http.ServerResponse & { writeHead: any; setHeader: any; end: any; body: any }
  return res
}

describe('Onboarding Self-service e Notificações por E-mail - F10', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.state.tenants = []
    mocks.state.tenantUsers = []
    mocks.state.businesses = []
    mocks.state.alertRules = []
    mocks.state.connectors = []
    mocks.state.tickets = []
    mocks.state.messages = []
    mocks.state.audits = []
    mocks.state.sentEmails = []
  })

  describe('Fluxo Assistido de Onboarding', () => {
    it('deve cadastrar tenant, vincular conectores e agendar sincronização inicial', async () => {
      const payload = {
        email: 'novo-inquilino@teste.com',
        password: 'senha_segura_123',
        businessName: 'Lanchonete Reputei',
        channels: ['trustpilot', 'facebook'],
        plan: 'basico',
        billingMethod: 'pix',
        periodicity: 'monthly'
      }

      const req = createMockReq('POST', '/api/onboarding', payload)
      const res = createMockRes()

      await handleOnboarding(req, res)

      expect(res.writeHead).toHaveBeenCalledWith(201, expect.any(Object))
      expect(res.body.ok).toBe(true)
      expect(res.body.tenantId).toBeDefined()
      expect(res.body.businessId).toBeDefined()

      // Verifica inserção do tenant
      expect(mocks.state.tenants.length).toBe(1)
      expect(mocks.state.tenants[0].name).toBe('Lanchonete Reputei')

      // Verifica conectores vinculados
      expect(mocks.state.connectors.length).toBe(2)

      // Aguarda o setTimeout disparar
      await new Promise(r => setTimeout(r, 1100))
      
      // Verifica que runOnce() foi agendado/executado
      expect(runOnce).toHaveBeenCalled()
    })
  })

  describe('Serviço de E-mail (EmailService)', () => {
    it('deve enviar e-mail de alerta de review crítico com template HTML consistente', async () => {
      const review = {
        channel: 'tripadvisor',
        rating: 1,
        author_name: 'Marcos Silva',
        body: 'Péssimo atendimento e comida fria.'
      }

      const success = await emailService.sendReviewAlertEmail('assinante@empresa.com', review, 'Alerta TripAdvisor')
      expect(success).toBe(true)
      expect(mocks.state.sentEmails.length).toBe(1)
      
      const email = mocks.state.sentEmails[0]
      expect(email.to).toBe('assinante@empresa.com')
      expect(email.subject).toContain('Nova avaliação crítica no TRIPADVISOR')
      expect(email.html).toContain('Péssimo atendimento e comida fria.')
      expect(email.html).toContain('★☆☆☆☆')
    })

    it('deve enviar e-mail de ticket criado', async () => {
      const ticket = {
        ticket_number: 104,
        subject: 'Erro de conexões',
        priority: 'high',
        description: 'Não conecta com o Instagram'
      }

      const success = await emailService.sendTicketCreatedEmail('cliente@teste.com', ticket)
      expect(success).toBe(true)
      expect(mocks.state.sentEmails.length).toBe(1)

      const email = mocks.state.sentEmails[0]
      expect(email.to).toBe('cliente@teste.com')
      expect(email.subject).toContain('Chamado #104 aberto com sucesso')
      expect(email.html).toContain('Não conecta com o Instagram')
    })

    it('deve enviar e-mail de nova resposta do chamado de suporte', async () => {
      const ticket = {
        ticket_number: 104,
        subject: 'Erro de conexões'
      }

      const success = await emailService.sendTicketReplyEmail('cliente@teste.com', ticket, 'Já corrigimos a integração, verifique.', 'Suporte Reputei')
      expect(success).toBe(true)
      expect(mocks.state.sentEmails.length).toBe(1)

      const email = mocks.state.sentEmails[0]
      expect(email.to).toBe('cliente@teste.com')
      expect(email.subject).toContain('Nova resposta no chamado #104')
      expect(email.html).toContain('Já corrigimos a integração, verifique.')
    })
  })

  describe('Integrações com Tickets', () => {
    it('deve disparar e-mail automático ao criar ticket no portal', async () => {
      const req = createMockReq('POST', '/api/support/tickets', {
        subject: 'Chamado via portal',
        description: 'Descrição do portal de testes'
      })
      const res = createMockRes()
      const auth = { userId: 'user-1', tenantId: 'tenant-1' }

      await handleSupportPortal(req, res, auth)

      expect(res.writeHead).toHaveBeenCalledWith(201, expect.any(Object))
      
      // Aguardar processos de Promises assíncronas do e-mail
      await new Promise(r => setTimeout(r, 100))

      expect(mocks.state.sentEmails.length).toBe(1)
      expect(mocks.state.sentEmails[0].to).toBe('cliente@teste.com')
      expect(mocks.state.sentEmails[0].subject).toContain('aberto com sucesso')
    })

    it('deve disparar e-mail de resposta de agente humano (suporte admin)', async () => {
      mocks.state.tickets = [{
        id: 't-100',
        created_by: 'user-1',
        ticket_number: 100,
        status: 'open',
        first_response_at: null
      }]

      const req = createMockReq('POST', '/api/admin/support/tickets/t-100/messages', {
        body: 'Nova resposta humana'
      })
      const res = createMockRes()
      const auth = { userId: 'op-1', perfil: 'operador' }

      await handleSupportAdmin(req, res, auth)

      expect(res.writeHead).toHaveBeenCalledWith(200, expect.any(Object))

      await new Promise(r => setTimeout(r, 100))

      expect(mocks.state.sentEmails.length).toBe(1)
      expect(mocks.state.sentEmails[0].to).toBe('cliente@teste.com')
      expect(mocks.state.sentEmails[0].html).toContain('Nova resposta humana')
    })
  })
})
