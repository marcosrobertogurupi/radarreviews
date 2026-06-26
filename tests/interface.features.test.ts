import { describe, it, expect, vi, beforeEach } from 'vitest'
import http from 'node:http'

const mocks = vi.hoisted(() => {
  process.env['GEMINI_API_KEY'] = 'mock-gemini-key'
  process.env['SUPABASE_URL'] = 'https://mock.supabase.co'
  process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'mock-service-role-key'

  const state = {
    tickets: [] as any[],
    messages: [] as any[],
    audits: [] as any[],
    kbDocs: [] as any[],
    kbEmbeddings: [] as any[],
    searchKnowledgeAllStatusReturn: [] as any[]
  }

  const fromFn = (table: string) => {
    let isSingle = false
    let currentId: string | null = null
    let actionResult: any = null

    const query: any = {
      select: () => query,
      eq: (col: string, val: any) => {
        if (col === 'id' || col === 'ticket_id' || col === 'doc_id') {
          currentId = val
        }
        return query
      },
      order: () => query,
      limit: () => query,
      single: () => {
        isSingle = true
        return query
      },
      insert: (data: any) => {
        const arr = Array.isArray(data) ? data : [data]
        if (table === 'ticket_messages') {
          actionResult = arr.map(item => ({ id: `msg-${Math.random()}`, ...item }))
          state.messages.push(...actionResult)
        } else if (table === 'ticket_audit_log') {
          actionResult = arr.map(item => ({ id: `audit-${Math.random()}`, ...item }))
          state.audits.push(...actionResult)
        } else if (table === 'support_knowledge_docs') {
          actionResult = arr.map(item => ({ id: item.id || `doc-${Math.random()}`, created_at: new Date().toISOString(), status: 'draft', ...item }))
          state.kbDocs.push(...actionResult)
        } else if (table === 'support_knowledge_embeddings') {
          actionResult = arr.map(item => ({ id: `emb-${Math.random()}`, ...item }))
          state.kbEmbeddings.push(...actionResult)
        }
        return query
      },
      update: (data: any) => {
        if (table === 'support_tickets') {
          state.tickets = state.tickets.map(t => {
            if (!currentId || t.id === currentId) {
              return { ...t, ...data }
            }
            return t
          })
          actionResult = currentId ? state.tickets.find(t => t.id === currentId) : state.tickets
        } else if (table === 'support_knowledge_docs') {
          state.kbDocs = state.kbDocs.map(d => {
            if (!currentId || d.id === currentId) {
              return { ...d, ...data }
            }
            return d
          })
          actionResult = currentId ? state.kbDocs.find(d => d.id === currentId) : state.kbDocs
        }
        return query
      },
      delete: () => {
        if (table === 'support_knowledge_embeddings') {
          if (currentId) {
            state.kbEmbeddings = state.kbEmbeddings.filter(emb => emb.doc_id !== currentId)
          }
          actionResult = []
        }
        return query
      },
      then: (onfulfilled: any) => {
        if (actionResult !== null) {
          const res = actionResult
          actionResult = null
          const isArr = Array.isArray(res)
          const data = isSingle ? (isArr ? res[0] : res) : (isArr ? res : [res])
          return Promise.resolve({ data, error: null }).then(onfulfilled)
        }

        let resolvedValue: any = { data: [], error: null }
        if (table === 'support_tickets') {
          const t = currentId ? state.tickets.find(x => x.id === currentId) : state.tickets
          resolvedValue = { data: isSingle ? t : (Array.isArray(t) ? t : [t]), error: null }
        } else if (table === 'support_knowledge_docs') {
          const d = currentId ? state.kbDocs.find(x => x.id === currentId) : state.kbDocs
          resolvedValue = { data: isSingle ? d : (Array.isArray(d) ? d : [d]), error: null }
        } else if (table === 'ticket_messages') {
          const m = currentId ? state.messages.filter(x => x.ticket_id === currentId) : state.messages
          resolvedValue = { data: m, error: null }
        } else if (table === 'ticket_audit_log') {
          const a = currentId ? state.audits.filter(x => x.ticket_id === currentId) : state.audits
          resolvedValue = { data: a, error: null }
        }
        return Promise.resolve(resolvedValue).then(onfulfilled)
      }
    }
    return query
  }

  const rpcFn = (fnName: string, args: any) => {
    if (fnName === 'search_knowledge_all_status') {
      return Promise.resolve({ data: state.searchKnowledgeAllStatusReturn, error: null })
    }
    return Promise.resolve({ data: [], error: null })
  }

  const mockGenerateContent = vi.fn().mockResolvedValue({
    response: {
      text: () => 'Resposta simulada gerada pelo Gemini.'
    }
  })
  const mockEmbedContent = vi.fn().mockResolvedValue({
    embedding: { values: new Array(768).fill(0.05) }
  })
  const mockGetGenerativeModel = vi.fn().mockReturnValue({
    generateContent: mockGenerateContent,
    embedContent: mockEmbedContent
  })

  const authGetUser = vi.fn().mockResolvedValue({
    data: { user: { id: 'user-1', email: 'cliente@teste.com' } },
    error: null
  })

  return { state, fromFn, rpcFn, mockGenerateContent, mockEmbedContent, mockGetGenerativeModel, authGetUser }
})

vi.mock('../src/lib/supabase.js', () => {
  const client = {
    from: mocks.fromFn,
    rpc: mocks.rpcFn,
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

vi.mock('@google/generative-ai', () => {
  return {
    GoogleGenerativeAI: vi.fn().mockImplementation(() => ({
      getGenerativeModel: mocks.mockGetGenerativeModel
    }))
  }
})

// Importar os handlers após os mocks
import { handleSupportAdmin } from '../src/api/supportAdmin.js'

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

describe('Testes de Interface do Suporte Admin - F9', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.state.tickets = []
    mocks.state.messages = []
    mocks.state.audits = []
    mocks.state.kbDocs = []
    mocks.state.kbEmbeddings = []
    mocks.state.searchKnowledgeAllStatusReturn = []
  })

  it('deve aprovar o rascunho de IA (T2) do ticket em 1-clique', async () => {
    mocks.state.tickets = [{
      id: 't-123',
      status: 'ai_triaged',
      ai_draft_response: 'Olá, isso é uma resposta sugerida pela IA.'
    }]

    const req = createMockReq('POST', '/api/admin/support/tickets/t-123/approve-ai-draft')
    const res = createMockRes()
    const auth = { userId: 'op-1', perfil: 'operador' }

    await handleSupportAdmin(req, res, auth)

    expect(res.writeHead).toHaveBeenCalledWith(200, expect.any(Object))
    expect(res.body.ok).toBe(true)
    expect(res.body.ticket.status).toBe('resolved')
    expect(res.body.ticket.ai_draft_response).toBeNull()

    // Verifica que a resposta foi enviada como mensagem
    expect(mocks.state.messages.length).toBe(1)
    expect(mocks.state.messages[0].ticket_id).toBe('t-123')
    expect(mocks.state.messages[0].author_role).toBe('agent')
    expect(mocks.state.messages[0].body).toBe('Olá, isso é uma resposta sugerida pela IA.')

    // Verifica logs de auditoria
    expect(mocks.state.audits.length).toBe(2)
    expect(mocks.state.audits[0].action).toBe('status_changed')
    expect(mocks.state.audits[1].action).toBe('resolved')
  })

  it('deve retornar 400 se o ticket não contiver rascunho de IA para aprovar', async () => {
    mocks.state.tickets = [{
      id: 't-123',
      status: 'open',
      ai_draft_response: null
    }]

    const req = createMockReq('POST', '/api/admin/support/tickets/t-123/approve-ai-draft')
    const res = createMockRes()
    const auth = { userId: 'op-1', perfil: 'operador' }

    await handleSupportAdmin(req, res, auth)

    expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object))
    expect(res.body.error).toBe('Não há rascunho de IA para aprovar')
  })

  it('deve enviar uma resposta humana no ticket e registrar auditoria', async () => {
    mocks.state.tickets = [{
      id: 't-123',
      status: 'open',
      first_response_at: null
    }]

    const req = createMockReq('POST', '/api/admin/support/tickets/t-123/messages', {
      body: 'Estou verificando seu problema agora mesmo.',
      status: 'in_progress'
    })
    const res = createMockRes()
    const auth = { userId: 'op-1', perfil: 'operador' }

    await handleSupportAdmin(req, res, auth)

    expect(res.writeHead).toHaveBeenCalledWith(200, expect.any(Object))
    expect(res.body.ticket.status).toBe('in_progress')
    expect(res.body.ticket.first_response_at).not.toBeNull()

    expect(mocks.state.messages.length).toBe(1)
    expect(mocks.state.messages[0].body).toBe('Estou verificando seu problema agora mesmo.')

    expect(mocks.state.audits.length).toBe(2)
    expect(mocks.state.audits[0].action).toBe('message_added')
    expect(mocks.state.audits[1].action).toBe('status_changed')
  })

  it('deve obter logs de auditoria do ticket cronologicamente', async () => {
    mocks.state.audits = [
      { ticket_id: 't-123', action: 'created', created_at: '2026-06-26T10:00:00Z', actor_role: 'tenant_user' },
      { ticket_id: 't-123', action: 'message_added', created_at: '2026-06-26T10:10:00Z', actor_role: 'agent' }
    ]

    const req = createMockReq('GET', '/api/admin/support/tickets/t-123/audit')
    const res = createMockRes()
    const auth = { userId: 'op-1', perfil: 'operador' }

    await handleSupportAdmin(req, res, auth)

    expect(res.writeHead).toHaveBeenCalledWith(200, expect.any(Object))
    expect(res.body.length).toBe(2)
    expect(res.body[0].action).toBe('created')
  })

  it('deve simular consulta RAG retornando scores e resposta sintetizada', async () => {
    mocks.state.searchKnowledgeAllStatusReturn = [
      {
        doc_id: 'doc-1',
        title: 'Artigo de Teste',
        solution_summary: 'Descrição da solução RAG',
        solution_steps: [],
        similarity: 0.88,
        confidence_score: 0.90,
        resolution_count: 5,
        status: 'active'
      }
    ]

    const req = createMockReq('POST', '/api/admin/support/kb/test-query', {
      query: 'como fazer o teste?'
    })
    const res = createMockRes()
    const auth = { userId: 'op-1', perfil: 'operador' }

    await handleSupportAdmin(req, res, auth)

    expect(res.writeHead).toHaveBeenCalledWith(200, expect.any(Object))
    expect(res.body.query).toBe('como fazer o teste?')
    expect(res.body.documents.length).toBe(1)
    expect(res.body.documents[0].similarity).toBe(0.88)
    expect(res.body.response).toBe('Resposta simulada gerada pelo Gemini.')
  })

  it('deve cadastrar novo artigo de KB e gerar embedding', async () => {
    const req = createMockReq('POST', '/api/admin/support/kb', {
      title: 'Artigo Cadastrado',
      solution_summary: 'Solução rápida cadastrada',
      problem_description: 'Descrição do problema cadastrado',
      status: 'draft'
    })
    const res = createMockRes()
    const auth = { userId: 'op-1', perfil: 'operador' }

    await handleSupportAdmin(req, res, auth)

    expect(res.writeHead).toHaveBeenCalledWith(201, expect.any(Object))
    expect(res.body.title).toBe('Artigo Cadastrado')

    // Deve salvar nos KB docs
    expect(mocks.state.kbDocs.length).toBe(1)
    
    // Deve disparar geração de embedding
    expect(mocks.state.kbEmbeddings.length).toBe(1)
    expect(mocks.state.kbEmbeddings[0].doc_id).toBe(res.body.id)
  })
})
