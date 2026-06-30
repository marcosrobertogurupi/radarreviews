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
  delete: vi.fn().mockReturnThis(),
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

// Mock auth.admin methods
const mockUpdateUserById = vi.fn()
const mockDeleteUser = vi.fn()

vi.mock('../src/lib/supabase.js', () => ({
  supabase: {
    from: mockFrom,
    rpc: mockRpc,
    auth: {
      admin: {
        getUserById: vi.fn(),
        generateLink: vi.fn(),
        updateUserById: mockUpdateUserById,
        deleteUser: mockDeleteUser,
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
        updateUserById: mockUpdateUserById,
        deleteUser: mockDeleteUser,
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
    authorization: authorization || 'Bearer admin_token'
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

describe('Módulo de Administração de Parceiros — API Admin', () => {
  const ADMIN_USER_ID = 'admin-user-123'
  const PARTNER_ID = 'partner-456'
  const PARTNER_USER_ID = 'partner-user-456'

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
      m.delete.mockClear().mockReturnThis()
    }

    // Mock global para tenant_users.single para evitar falhas no middleware getAuthUser
    getTableMock('tenant_users').single.mockResolvedValue({ data: null, error: null })
  })

  describe('PUT /api/admin/partners/:id', () => {
    it('deve atualizar o parceiro, dados de login no Supabase Auth e perfil usuarios', async () => {
      const { handlePartnerAdminRoutes } = await import('../src/api/partnerAdmin.js')
      const { supabaseAdmin } = await import('../src/lib/supabase.js')

      // Mock de autenticação do administrador logado
      vi.mocked(supabaseAdmin.auth.getUser).mockResolvedValue({
        data: { user: { id: ADMIN_USER_ID, email: 'admin@reputei.com' } as any },
        error: null
      })
      getTableMock('usuarios').single.mockResolvedValueOnce({
        data: { perfil: 'admin', nome: 'Administrador Principal', email: 'admin@reputei.com' },
        error: null
      })

      // Mock para buscar o parceiro por ID e obter user_id
      getTableMock('partners').single.mockResolvedValueOnce({
        data: { id: PARTNER_ID, user_id: PARTNER_USER_ID, name: 'Lucas', email: 'lucas@parceiro.com' },
        error: null
      })

      mockUpdateUserById.mockResolvedValue({ data: {}, error: null })

      const req = createMockReq('PUT', `/api/admin/partners/${PARTNER_ID}`, {
        name: 'Lucas Novo',
        email: 'lucas.novo@parceiro.com',
        password: 'novasenhasegura',
        status: 'suspended'
      })
      const res = createMockRes()

      await handlePartnerAdminRoutes(req, res)

      expect(res.writeHead).toHaveBeenCalledWith(200, { 'Content-Type': 'application/json' })
      expect(res.end).toHaveBeenCalledWith(JSON.stringify({ ok: true }))

      // Verifica se atualizou o auth user no Supabase
      expect(mockUpdateUserById).toHaveBeenCalledWith(PARTNER_USER_ID, {
        email: 'lucas.novo@parceiro.com',
        password: 'novasenhasegura'
      })

      // Verifica se atualizou na tabela usuarios com ativo = false (bloqueado)
      expect(getTableMock('usuarios').update).toHaveBeenCalledWith(expect.objectContaining({
        nome: 'Lucas Novo',
        email: 'lucas.novo@parceiro.com',
        ativo: false
      }))

      // Verifica se atualizou a tabela partners sem a senha
      expect(getTableMock('partners').update).toHaveBeenCalledWith(expect.not.objectContaining({
        password: expect.any(String)
      }))
      expect(getTableMock('partners').update).toHaveBeenCalledWith(expect.objectContaining({
        name: 'Lucas Novo',
        email: 'lucas.novo@parceiro.com',
        status: 'suspended'
      }))
    })
  })

  describe('DELETE /api/admin/partners/:id', () => {
    it('deve excluir o parceiro do banco e seu respectivo usuário no Auth do Supabase', async () => {
      const { handlePartnerAdminRoutes } = await import('../src/api/partnerAdmin.js')
      const { supabaseAdmin } = await import('../src/lib/supabase.js')

      // Mock de autenticação do administrador logado
      vi.mocked(supabaseAdmin.auth.getUser).mockResolvedValue({
        data: { user: { id: ADMIN_USER_ID, email: 'admin@reputei.com' } as any },
        error: null
      })
      getTableMock('usuarios').single.mockResolvedValueOnce({
        data: { perfil: 'admin', nome: 'Administrador Principal', email: 'admin@reputei.com' },
        error: null
      })

      // Mock para buscar o parceiro por ID e obter user_id
      getTableMock('partners').single.mockResolvedValueOnce({
        data: { id: PARTNER_ID, user_id: PARTNER_USER_ID, name: 'Lucas' },
        error: null
      })

      // Mock dos deletes
      getTableMock('usuarios').delete.mockReturnThis()
      getTableMock('usuarios').eq.mockReturnThis()
      
      mockDeleteUser.mockResolvedValue({ data: {}, error: null })

      getTableMock('partners').delete.mockReturnThis()
      getTableMock('partners').eq.mockReturnThis()

      const req = createMockReq('DELETE', `/api/admin/partners/${PARTNER_ID}`)
      const res = createMockRes()

      await handlePartnerAdminRoutes(req, res)

      expect(res.writeHead).toHaveBeenCalledWith(200, { 'Content-Type': 'application/json' })
      expect(res.end).toHaveBeenCalledWith(JSON.stringify({ ok: true }))

      // Deve ter deletado das tabelas auxiliares e auth
      expect(getTableMock('usuarios').delete).toHaveBeenCalled()
      expect(mockDeleteUser).toHaveBeenCalledWith(PARTNER_USER_ID)
      expect(getTableMock('partners').delete).toHaveBeenCalled()
    })
  })
})
