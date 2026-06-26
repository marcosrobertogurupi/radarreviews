import { describe, it, expect, vi, beforeEach } from 'vitest'
import http from 'node:http'
import { randomUUID } from 'node:crypto'

// ── Mocks base ─────────────────────────────────────────────────────────────
const createChainable = () => ({
  select: vi.fn().mockReturnThis(),
  eq:     vi.fn().mockReturnThis(),
  gt:     vi.fn().mockReturnThis(),
  single: vi.fn(),
  maybeSingle: vi.fn(),
  limit: vi.fn().mockReturnThis(),
  order: vi.fn().mockReturnThis(),
  not: vi.fn().mockReturnThis(),
  insert: vi.fn().mockReturnThis(),
  update: vi.fn().mockReturnThis(),
})

const queryMocks: Record<string, ReturnType<typeof createChainable>> = {}

const mockFrom = vi.fn().mockImplementation((table: string) => {
  if (!queryMocks[table]) {
    queryMocks[table] = createChainable()
  }
  return queryMocks[table]
})

function getTableMock(table: string) {
  if (!queryMocks[table]) {
    queryMocks[table] = createChainable()
  }
  return queryMocks[table]
}

const mockRpc = vi.fn()

vi.mock('../src/lib/supabase.js', () => ({
  supabase: {
    from: mockFrom,
    rpc: mockRpc,
    auth: {
      admin: {
        getUserById: vi.fn(),
        generateLink: vi.fn(),
      },
      getUser: vi.fn()
    }
  },
  supabaseAdmin: {
    from: mockFrom,
    rpc: mockRpc,
    auth: {
      admin: {
        getUserById: vi.fn(),
        generateLink: vi.fn(),
      },
      getUser: vi.fn()
    }
  }
}))

// Helper de requisições mockadas
function createMockReq(method: string, url: string, body?: any, authorization?: string): http.IncomingMessage {
  const req = new http.IncomingMessage(null as any)
  req.method = method
  req.url = url
  req.headers = {
    authorization: authorization || 'Bearer test_token'
  }
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
    setHeader: vi.fn(),
  } as unknown as http.ServerResponse & { writeHead: any; end: any; setHeader: any }
  return res
}

describe('Módulo de Parceiros — Funcionalidades e Regras de Negócio', () => {

  beforeEach(() => {
    vi.clearAllMocks()
    // Reset all table mocks
    for (const key of Object.keys(queryMocks)) {
      const m = queryMocks[key]
      m.select.mockClear().mockReturnThis()
      m.eq.mockClear().mockReturnThis()
      m.gt.mockClear().mockReturnThis()
      m.single.mockReset()
      m.maybeSingle.mockReset()
      m.limit.mockClear().mockReturnThis()
      m.order.mockClear().mockReturnThis()
      m.not.mockClear().mockReturnThis()
      m.insert.mockClear().mockReturnThis()
      m.update.mockClear().mockReturnThis()
    }
  })

  describe('Autenticação e Impersonação via getAuthUser', () => {
    it('deve autenticar com sucesso usando token de impersonação válido', async () => {
      const { getAuthUser } = await import('../src/api/server.js') as any

      // Mock da sessão de impersonação no banco
      getTableMock('partner_impersonation_sessions').maybeSingle.mockResolvedValueOnce({
        data: { tenant_id: 'tenant-123', partner_id: 'partner-123', expires_at: new Date(Date.now() + 10000).toISOString() },
        error: null
      })

      // Mock do usuário do tenant
      getTableMock('tenant_users').maybeSingle.mockResolvedValueOnce({
        data: { user_id: 'user-456' },
        error: null
      })

      // Mock dos dados de usuario
      getTableMock('usuarios').single.mockResolvedValueOnce({
        data: { nome: 'João da Reputação', email: 'joao@cliente.com', perfil: 'assinante' },
        error: null
      })

      const result = await getAuthUser('Bearer impersonate_token_valido')

      expect(result).not.toBeNull()
      expect(result.userId).toBe('user-456')
      expect(result.tenantId).toBe('tenant-123')
      expect(result.perfil).toBe('assinante')
      expect(result.nome).toBe('João da Reputação')
      expect(result.email).toBe('joao@cliente.com')
    })

    it('deve falhar se o token de impersonação estiver expirado ou inválido', async () => {
      const { getAuthUser } = await import('../src/api/server.js') as any

      // Mock retornando nulo (não encontrado ou expirado)
      getTableMock('partner_impersonation_sessions').maybeSingle.mockResolvedValueOnce({
        data: null,
        error: null
      })

      const result = await getAuthUser('Bearer impersonate_token_expirado')
      expect(result).toBeNull()
    })
  })

  describe('Cálculo e Geração de Comissões Recorrentes (Job)', () => {
    it('deve processar e inserir comissões recorrentes para todos os tenants ativos de parceiros', async () => {
      const { runCommissionsJob } = await import('../src/lib/commissions-job.js')

      // Mock de tenants vinculados a parceiros
      const mockTenants = [
        {
          id: 'tenant-abc',
          name: 'Empresa ABC',
          plan: 'pro',
          partner_id: 'partner-abc',
          partners: {
            id: 'partner-abc',
            commission_recurring_rate: 15.00,
            tier: 'silver'
          }
        }
      ]
      getTableMock('tenants').not.mockResolvedValueOnce({ data: mockTenants, error: null })

      // Mock de planos ativos para mapear preços
      const mockPlans = [
        { slug: 'pro', name: 'Plano Pro', price_monthly: 199.90 }
      ]
      getTableMock('plans').select.mockResolvedValueOnce({ data: mockPlans, error: null })

      // Mock de verificação de duplicidade (não existe comissão para este mês ainda)
      getTableMock('commissions').maybeSingle.mockResolvedValueOnce({ data: null, error: null })

      // Mock de insert do registro de comissão
      getTableMock('commissions').insert.mockResolvedValueOnce({ data: null, error: null })

      await runCommissionsJob()

      // Verificar se tentou inserir a comissão recorrente
      expect(getTableMock('commissions').insert).toHaveBeenCalledWith(
        expect.objectContaining({
          partner_id: 'partner-abc',
          tenant_id: 'tenant-abc',
          plan_name: 'Plano Pro',
          plan_value: 199.90,
          is_setup: false,
          commission_rate: 15.00,
          status: 'pending'
        })
      )
    })

    it('não deve inserir comissão recorrente duplicada se já existir para o mês de referência', async () => {
      const { runCommissionsJob } = await import('../src/lib/commissions-job.js')

      // Mock de tenants vinculados a parceiros
      const mockTenants = [
        {
          id: 'tenant-abc',
          name: 'Empresa ABC',
          plan: 'pro',
          partner_id: 'partner-abc',
          partners: {
            id: 'partner-abc',
            commission_recurring_rate: 15.00,
            tier: 'silver'
          }
        }
      ]
      getTableMock('tenants').not.mockResolvedValueOnce({ data: mockTenants, error: null })

      // Mock de planos ativos
      const mockPlans = [
        { slug: 'pro', name: 'Plano Pro', price_monthly: 199.90 }
      ]
      getTableMock('plans').select.mockResolvedValueOnce({ data: mockPlans, error: null })

      // Mock de verificação de duplicidade (já existe comissão)
      getTableMock('commissions').maybeSingle.mockResolvedValueOnce({ data: { id: 'existing-comm-id' }, error: null })

      await runCommissionsJob()

      // Não deve chamar o insert
      expect(getTableMock('commissions').insert).not.toHaveBeenCalled()
    })
  })

  describe('Endpoints do Parceiro e Criação Automática de Comissão de Setup', () => {
    const VALID_USER_ID = 'a3b9843d-0453-43ef-956b-df867160914c'
    const VALID_PARTNER_ID = 'b2b9843d-0453-43ef-956b-df867160914d'
    const VALID_TENANT_ID = 'c2b9843d-0453-43ef-956b-df867160914e'

    it('GET /api/partner/profile deve retornar os dados do parceiro', async () => {
      const { handlePartnerRoutes } = await import('../src/api/partner.js')
      const { supabaseAdmin } = await import('../src/lib/supabase.js')

      // Mock de autenticação do parceiro
      vi.mocked(supabaseAdmin.auth.getUser).mockResolvedValue({
        data: { user: { id: VALID_USER_ID, email: 'partner@test.com' } as any },
        error: null
      })
      getTableMock('usuarios').single.mockResolvedValue({
        data: { perfil: 'parceiro', nome: 'Parceiro X', email: 'partner@test.com' },
        error: null
      })
      getTableMock('tenant_users').single.mockResolvedValue({
        data: null,
        error: null
      })
      getTableMock('partners').single.mockResolvedValue({
        data: { id: VALID_PARTNER_ID, status: 'active', partner_type: 'vendedor', commission_setup_rate: 10.00, commission_recurring_rate: 10.00, user_id: VALID_USER_ID, name: 'Parceiro X', tier: 'bronze', pix_key: 'pix-123' },
        error: null
      })

      const req = createMockReq('GET', '/api/partner/profile')
      const res = createMockRes()

      await handlePartnerRoutes(req, res)

      expect(res.writeHead).toHaveBeenCalledWith(200, { 'Content-Type': 'application/json' })
      expect(res.end).toHaveBeenCalledWith(expect.stringContaining('"ok":true'))
      expect(res.end).toHaveBeenCalledWith(expect.stringContaining('"pix_key":"pix-123"'))
    })

    it('PUT /api/partner/profile deve atualizar os dados do parceiro e chave Pix', async () => {
      const { handlePartnerRoutes } = await import('../src/api/partner.js')
      const { supabaseAdmin } = await import('../src/lib/supabase.js')

      // Mock de autenticação do parceiro
      vi.mocked(supabaseAdmin.auth.getUser).mockResolvedValue({
        data: { user: { id: VALID_USER_ID, email: 'partner@test.com' } as any },
        error: null
      })
      getTableMock('usuarios').single.mockResolvedValue({
        data: { perfil: 'parceiro', nome: 'Parceiro X', email: 'partner@test.com' },
        error: null
      })
      getTableMock('tenant_users').single.mockResolvedValue({
        data: null,
        error: null
      })
      getTableMock('partners').single.mockResolvedValueOnce({
        data: { id: VALID_PARTNER_ID, status: 'active', partner_type: 'vendedor', commission_setup_rate: 10.00, commission_recurring_rate: 10.00, user_id: VALID_USER_ID },
        error: null
      })

      // Mock do update
      getTableMock('partners').update.mockReturnThis()
      getTableMock('partners').single.mockResolvedValueOnce({
        data: { id: VALID_PARTNER_ID, name: 'Parceiro X', tier: 'bronze', pix_key: 'new-pix-key', status: 'active' },
        error: null
      })

      const req = createMockReq('PUT', '/api/partner/profile', { pix_key: 'new-pix-key' })
      const res = createMockRes()

      await handlePartnerRoutes(req, res)

      expect(res.writeHead).toHaveBeenCalledWith(200, { 'Content-Type': 'application/json' })
      expect(getTableMock('partners').update).toHaveBeenCalledWith({ pix_key: 'new-pix-key' })
    })

    it('POST /api/partner/clients deve registrar cliente e gerar comissão de setup', async () => {
      const { handlePartnerRoutes } = await import('../src/api/partner.js')
      const { supabaseAdmin } = await import('../src/lib/supabase.js')

      // Mock de autenticação do parceiro
      vi.mocked(supabaseAdmin.auth.getUser).mockResolvedValue({
        data: { user: { id: VALID_USER_ID, email: 'partner@test.com' } as any },
        error: null
      })
      getTableMock('usuarios').single.mockResolvedValue({
        data: { perfil: 'parceiro', nome: 'Parceiro X', email: 'partner@test.com' },
        error: null
      })
      getTableMock('tenant_users').single.mockResolvedValue({
        data: null,
        error: null
      })
      getTableMock('partners').single.mockResolvedValue({
        data: { id: VALID_PARTNER_ID, status: 'active', partner_type: 'vendedor', commission_setup_rate: 20.00, commission_recurring_rate: 15.00, user_id: VALID_USER_ID },
        error: null
      })

      // Mock do RPC de registro
      mockRpc.mockResolvedValueOnce({ data: VALID_TENANT_ID, error: null })

      // Mock de busca de plano na comissão de setup
      getTableMock('plans').maybeSingle.mockResolvedValueOnce({
        data: { name: 'Plano Inicial', price_monthly: 99.00 },
        error: null
      })

      // Mock do insert da comissão de setup
      getTableMock('commissions').insert.mockResolvedValueOnce({ data: null, error: null })

      const req = createMockReq('POST', '/api/partner/clients', {
        business_name: 'Novo Cliente Corp',
        email: 'cliente@corp.com',
        plan_slug: 'starter'
      })
      const res = createMockRes()

      await handlePartnerRoutes(req, res)

      expect(res.writeHead).toHaveBeenCalledWith(201, { 'Content-Type': 'application/json' })
      expect(mockRpc).toHaveBeenCalledWith('partner_register_tenant', expect.any(Object))
      
      // Deve criar a comissão de setup correspondente
      expect(getTableMock('commissions').insert).toHaveBeenCalledWith(
        expect.objectContaining({
          partner_id: VALID_PARTNER_ID,
          tenant_id: VALID_TENANT_ID,
          plan_name: 'Plano Inicial',
          plan_value: 99.00,
          is_setup: true,
          commission_rate: 20.00,
          status: 'pending'
        })
      )
    })

    it('POST /api/partner/impersonate/:tenantId deve gerar link de impersonação com sucesso', async () => {
      const { handlePartnerRoutes } = await import('../src/api/partner.js')
      const { supabaseAdmin } = await import('../src/lib/supabase.js')

      const IMPERSONATED_USER_ID = 'e2b9843d-0453-43ef-956b-df8671609140'

      // Mock de autenticação do parceiro
      vi.mocked(supabaseAdmin.auth.getUser).mockResolvedValue({
        data: { user: { id: VALID_USER_ID, email: 'partner@test.com' } as any },
        error: null
      })
      getTableMock('usuarios').single.mockResolvedValue({
        data: { perfil: 'parceiro', nome: 'Parceiro X', email: 'partner@test.com' },
        error: null
      })
      getTableMock('tenant_users').single.mockResolvedValue({
        data: null,
        error: null
      })
      getTableMock('partners').single.mockResolvedValue({
        data: { id: VALID_PARTNER_ID, status: 'active', partner_type: 'vendedor', commission_setup_rate: 10.00, commission_recurring_rate: 10.00, user_id: VALID_USER_ID },
        error: null
      })

      // 1. Validar acesso ao tenant
      getTableMock('tenants').maybeSingle.mockResolvedValueOnce({
        data: { id: VALID_TENANT_ID, partner_id: VALID_PARTNER_ID },
        error: null
      })

      // 2. Buscar usuário associado ao tenant
      getTableMock('tenant_users').maybeSingle.mockResolvedValueOnce({
        data: { user_id: IMPERSONATED_USER_ID },
        error: null
      })

      // 3. Buscar e-mail do usuário do tenant
      vi.mocked(supabaseAdmin.auth.admin.getUserById).mockResolvedValueOnce({
        data: { user: { email: 'client@company.com' } as any },
        error: null
      })

      // 4. Gerar Magic Link do Supabase
      vi.mocked(supabaseAdmin.auth.admin.generateLink).mockResolvedValueOnce({
        data: { properties: { action_link: 'http://supabase.magic.link/login?token=abc' } } as any,
        error: null
      })

      // 5. Inserir sessão de impersonação
      getTableMock('partner_impersonation_sessions').insert.mockResolvedValueOnce({ data: null, error: null })

      const req = createMockReq('POST', `/api/partner/impersonate/${VALID_TENANT_ID}`)
      const res = createMockRes()

      await handlePartnerRoutes(req, res)

      expect(res.writeHead).toHaveBeenCalledWith(200, { 'Content-Type': 'application/json' })
      expect(res.end).toHaveBeenCalledWith(expect.stringContaining('"link":"http://supabase.magic.link/login?token=abc"'))
      expect(getTableMock('partner_impersonation_sessions').insert).toHaveBeenCalledWith(
        expect.objectContaining({
          partner_id: VALID_PARTNER_ID,
          tenant_id: VALID_TENANT_ID,
          token: expect.stringContaining('impersonate_'),
          created_by: VALID_USER_ID
        })
      )
    })
  })
})
