import { describe, it, expect, vi, beforeEach } from 'vitest'

// Setup de variáveis de ambiente e mocks usando vi.hoisted para evitar problemas de hoisting no Vitest
const mocks = vi.hoisted(() => {
  process.env['GEMINI_API_KEY'] = 'mock-gemini-key'
  process.env['SUPABASE_URL'] = 'https://mock.supabase.co'
  process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'mock-service-role-key'

  const state = {
    tickets: [] as any[],
    messages: [] as any[],
    audits: [] as any[],
    interactions: [] as any[],
    kbDocs: [] as any[],
    kbEmbeddings: [] as any[],
    learningQueue: [] as any[],
    categories: [
      { id: 'cat-1', name: 'Conectores' }
    ],
    searchKnowledgeReturn: [] as any[],
    searchKnowledgeAllStatusReturn: [] as any[]
  }

  const fromFn = (table: string) => {
    let isSingle = false
    let currentId: string | null = null
    let actionResult: any = null

    const query: any = {
      select: () => query,
      eq: (col: string, val: any) => {
        if (col === 'id') {
          currentId = val
        }
        return query
      },
      in: () => query,
      not: () => query,
      is: () => query,
      lt: () => query,
      lte: () => query,
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
        const arr = Array.isArray(data) ? data : [data]
        if (table === 'support_tickets') {
          actionResult = arr.map(item => ({ id: item.id || `ticket-${Math.random()}`, created_at: new Date().toISOString(), status: 'open', ...item }))
          state.tickets.push(...actionResult)
        } else if (table === 'ticket_messages') {
          actionResult = arr.map(item => ({ id: `msg-${Math.random()}`, ...item }))
          state.messages.push(...actionResult)
        } else if (table === 'ticket_audit_log') {
          actionResult = arr.map(item => ({ id: `audit-${Math.random()}`, ...item }))
          state.audits.push(...actionResult)
        } else if (table === 'ticket_ai_interactions') {
          actionResult = arr.map(item => ({ id: `inter-${Math.random()}`, ...item }))
          state.interactions.push(...actionResult)
        } else if (table === 'support_knowledge_docs') {
          actionResult = arr.map(item => ({ id: item.id || `doc-${Math.random()}`, created_at: new Date().toISOString(), status: 'draft', ...item }))
          state.kbDocs.push(...actionResult)
        } else if (table === 'support_knowledge_embeddings') {
          actionResult = arr.map(item => ({ id: `emb-${Math.random()}`, ...item }))
          state.kbEmbeddings.push(...actionResult)
        } else if (table === 'support_learning_queue') {
          actionResult = arr.map(item => ({ id: `q-${Math.random()}`, ...item }))
          state.learningQueue.push(...actionResult)
        }
        return query
      },
      upsert: (data: any) => {
        const arr = Array.isArray(data) ? data : [data]
        if (table === 'support_learning_queue') {
          arr.forEach(item => {
            const idx = state.learningQueue.findIndex(q => q.ticket_id === item.ticket_id)
            if (idx >= 0) {
              state.learningQueue[idx] = { ...state.learningQueue[idx], ...item }
            } else {
              state.learningQueue.push({ id: `q-${Math.random()}`, ...item })
            }
          })
          actionResult = arr
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
        } else if (table === 'support_learning_queue') {
          state.learningQueue = state.learningQueue.map(q => {
            if (!currentId || q.id === currentId) {
              return { ...q, ...data }
            }
            return q
          })
          actionResult = currentId ? state.learningQueue.find(q => q.id === currentId) : state.learningQueue
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
        } else if (table === 'support_learning_queue') {
          const queueEnriched = state.learningQueue.map(q => {
            const ticket = state.tickets.find(t => t.id === q.ticket_id)
            const msgs = state.messages.filter(m => m.ticket_id === q.ticket_id)
            return {
              ...q,
              support_tickets: ticket ? { ...ticket, ticket_messages: msgs } : null
            }
          })
          resolvedValue = { data: queueEnriched, error: null }
        } else if (table === 'ticket_categories') {
          resolvedValue = { data: state.categories, error: null }
        }
        return Promise.resolve(resolvedValue).then(onfulfilled)
      }
    }
    return query
  }

  const rpcFn = (fnName: string, args: any) => {
    if (fnName === 'search_knowledge') {
      return Promise.resolve({ data: state.searchKnowledgeReturn, error: null })
    } else if (fnName === 'search_knowledge_all_status') {
      return Promise.resolve({ data: state.searchKnowledgeAllStatusReturn, error: null })
    }
    return Promise.resolve({ data: [], error: null })
  }

  const mockGenerateContent = vi.fn()
  const mockEmbedContent = vi.fn().mockResolvedValue({
    embedding: { values: new Array(768).fill(0.05) }
  })
  const mockGetGenerativeModel = vi.fn().mockReturnValue({
    generateContent: mockGenerateContent,
    embedContent: mockEmbedContent
  })

  return { state, fromFn, rpcFn, mockGenerateContent, mockEmbedContent, mockGetGenerativeModel }
})

vi.mock('../src/lib/supabase.js', () => {
  const client = {
    from: mocks.fromFn,
    rpc: mocks.rpcFn,
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

// Importar os serviços após os mocks
import { supportAIAgent } from '../src/services/supportAIAgent.js'
import { knowledgeLearningService } from '../src/services/knowledgeLearningService.js'

describe('Central de Suporte - RAG e Aprendizado Contínuo (F5)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.state.tickets = []
    mocks.state.messages = []
    mocks.state.audits = []
    mocks.state.interactions = []
    mocks.state.kbDocs = []
    mocks.state.kbEmbeddings = []
    mocks.state.learningQueue = []
    mocks.state.searchKnowledgeReturn = []
    mocks.state.searchKnowledgeAllStatusReturn = []
  })

  describe('Pipeline RAG - Tiers T1/T2/T3', () => {
    it('deve executar Tier T1 (similaridade >= 0.85): resposta automática e transição de estado', async () => {
      // 1. Arrange
      const ticketId = 't-t1'
      mocks.state.tickets = [{
        id: ticketId,
        subject: 'Dúvida sobre conexões',
        description: 'Não conecta com Maps',
        category_id: 'cat-1',
        status: 'ai_triaged',
        ai_attempt_count: 0
      }]

      // Retorno do search_knowledge com similaridade >= 0.85
      mocks.state.searchKnowledgeReturn = [{
        doc_id: 'doc-t1',
        title: 'Como conectar ao Google Maps',
        solution_summary: 'Basta sincronizar na aba Conectores',
        solution_steps: [{ step: 1, text: 'Ir na aba Conectores' }],
        similarity: 0.90,
        confidence_score: 0.95,
        resolution_count: 1
      }]

      // Mock da resposta do Gemini
      mocks.mockGenerateContent.mockResolvedValueOnce({
        response: {
          text: () => JSON.stringify({
            response_body: 'Olá, para conectar ao Maps, vá à aba Conectores e clique em sincronizar.',
            reasoning: 'Confiança alta a partir do doc da KB'
          })
        }
      })

      // 2. Act
      await supportAIAgent.handleNewTicket(ticketId)

      // 3. Assert
      const updatedTicket = mocks.state.tickets.find(t => t.id === ticketId)
      expect(updatedTicket).toBeDefined()
      expect(updatedTicket.status).toBe('ai_resolved')
      expect(updatedTicket.ai_confidence).toBe(0.90)
      expect(updatedTicket.ai_doc_used_id).toBe('doc-t1')

      // Mensagem da IA inserida
      const aiMessage = mocks.state.messages.find(m => m.ticket_id === ticketId && m.author_role === 'ai')
      expect(aiMessage).toBeDefined()
      expect(aiMessage.body).toContain('Olá, para conectar ao Maps')

      // Logs de auditoria (deve passar por ai_responding e depois ai_resolved)
      expect(mocks.state.audits.length).toBe(2)
      expect(mocks.state.audits[0].to_value).toBe('ai_responding')
      expect(mocks.state.audits[1].to_value).toBe('ai_resolved')

      // Log de interação
      const interaction = mocks.state.interactions.find(i => i.ticket_id === ticketId)
      expect(interaction).toBeDefined()
      expect(interaction.confidence_tier).toBe('T1')
      expect(interaction.outcome).toBe('sent_autonomously')
    })

    it('deve executar Tier T2 (0.65 <= similaridade < 0.85): gera rascunho de resposta e mantém status ai_triaged', async () => {
      // 1. Arrange
      const ticketId = 't-t2'
      mocks.state.tickets = [{
        id: ticketId,
        subject: 'Dúvida sobre relatório',
        description: 'Como gerar PDF de performance?',
        category_id: 'cat-1',
        status: 'ai_triaged',
        ai_attempt_count: 0
      }]

      // Retorno do search_knowledge com similaridade intermediária
      mocks.state.searchKnowledgeReturn = [{
        doc_id: 'doc-t2',
        title: 'Como exportar PDFs',
        solution_summary: 'Clique no botão Exportar no menu lateral',
        solution_steps: [{ step: 1, text: 'Ir em Relatórios' }],
        similarity: 0.78,
        confidence_score: 0.80,
        resolution_count: 2
      }]

      // Mock da resposta do Gemini
      mocks.mockGenerateContent.mockResolvedValueOnce({
        response: {
          text: () => JSON.stringify({
            response_body: 'Rascunho: Olá! Você pode exportar PDFs acessando a aba Relatórios.',
            reasoning: 'Rascunho útil com base na KB'
          })
        }
      })

      // 2. Act
      await supportAIAgent.handleNewTicket(ticketId)

      // 3. Assert
      const updatedTicket = mocks.state.tickets.find(t => t.id === ticketId)
      expect(updatedTicket).toBeDefined()
      expect(updatedTicket.status).toBe('ai_triaged') // mantém status
      expect(updatedTicket.ai_draft_response).toBe('Rascunho: Olá! Você pode exportar PDFs acessando a aba Relatórios.')
      expect(updatedTicket.ai_confidence).toBe(0.78)

      // Não envia mensagem direta
      const aiMessage = mocks.state.messages.find(m => m.ticket_id === ticketId && m.author_role === 'ai')
      expect(aiMessage).toBeUndefined()

      // Sem logs de transição de status
      expect(mocks.state.audits.length).toBe(0)

      // Log de interação
      const interaction = mocks.state.interactions.find(i => i.ticket_id === ticketId)
      expect(interaction).toBeDefined()
      expect(interaction.confidence_tier).toBe('T2')
      expect(interaction.outcome).toBe('draft_shown')
    })

    it('deve executar Tier T3 (similaridade < 0.65): pula chamada ao Gemini e encaminha direto para humanos', async () => {
      // 1. Arrange
      const ticketId = 't-t3'
      mocks.state.tickets = [{
        id: ticketId,
        subject: 'Bug crítico no pagamento',
        description: 'Cobrou duas vezes a assinatura gold',
        category_id: 'cat-1',
        status: 'ai_triaged',
        ai_attempt_count: 0
      }]

      // Retorno do search_knowledge com similaridade baixa
      mocks.state.searchKnowledgeReturn = [{
        doc_id: 'doc-t3',
        title: 'Como alterar o cartão de crédito',
        solution_summary: 'Vá nas configurações da conta e clique em cartões',
        solution_steps: [],
        similarity: 0.50,
        confidence_score: 0.60,
        resolution_count: 1
      }]

      // Resetar mock do Gemini para assegurar que ele não é chamado
      mocks.mockGenerateContent.mockClear()

      // 2. Act
      await supportAIAgent.handleNewTicket(ticketId)

      // 3. Assert
      // Gemini NÃO deve ter sido chamado
      expect(mocks.mockGenerateContent).not.toHaveBeenCalled()

      const updatedTicket = mocks.state.tickets.find(t => t.id === ticketId)
      expect(updatedTicket).toBeDefined()
      expect(updatedTicket.status).toBe('needs_human')
      expect(updatedTicket.ai_confidence).toBe(0.50)

      // Log de transição do status
      expect(mocks.state.audits.length).toBe(1)
      expect(mocks.state.audits[0].to_value).toBe('needs_human')

      // Log de interação
      const interaction = mocks.state.interactions.find(i => i.ticket_id === ticketId)
      expect(interaction).toBeDefined()
      expect(interaction.confidence_tier).toBe('T3')
      expect(interaction.outcome).toBe('routed_to_human')
    })
  })

  describe('Ciclo de Aprendizado e Enriquecimento', () => {
    it('deve criar novo artigo draft quando não houver artigo similar (similaridade < 0.80)', async () => {
      // 1. Arrange
      const ticketId = 't-learn-new'
      const ticket = {
        id: ticketId,
        subject: 'Problema novo',
        description: 'Erro 999 ao enviar e-mail',
        category_id: 'cat-1',
        csat_score: 3
      }
      mocks.state.tickets = [ticket]
      mocks.state.messages = [
        { ticket_id: ticketId, author_role: 'user', body: 'Erro 999 ao enviar e-mail' },
        { ticket_id: ticketId, author_role: 'agent', body: 'Limpe o cache e tente novamente.' }
      ]

      mocks.state.learningQueue = [{
        ticket_id: ticketId,
        priority: 5,
        attempts: 0,
        scheduled_at: new Date().toISOString()
      }]

      // Sem documento similar na KB
      mocks.state.searchKnowledgeAllStatusReturn = []

      // Mock da resposta do Gemini extraindo conhecimento
      mocks.mockGenerateContent.mockResolvedValueOnce({
        response: {
          text: () => JSON.stringify({
            should_learn: true,
            title: 'Erro 999 no e-mail',
            problem_description: 'Erro de conexão SMTP genérico (código 999)',
            solution_summary: 'Limpar o cache do navegador e reautenticar conta',
            solution_steps: [{ step: 1, text: 'Limpar cache' }],
            keywords: ['email', 'smtp', '999'],
            confidence: 0.90
          })
        }
      })

      // 2. Act
      await knowledgeLearningService.processQueue(1)

      // 3. Assert
      // Deve ter criado novo artigo na KB
      expect(mocks.state.kbDocs.length).toBe(1)
      const newDoc = mocks.state.kbDocs[0]
      expect(newDoc.title).toBe('Erro 999 no e-mail')
      expect(newDoc.status).toBe('draft') // CSAT 3 < 4.0, logo é criado como rascunho
      expect(newDoc.resolution_count).toBe(1)
      expect(newDoc.avg_csat).toBe(3)

      // Deve ter gerado embedding
      expect(mocks.state.kbEmbeddings.length).toBe(1)
      expect(mocks.state.kbEmbeddings[0].doc_id).toBe(newDoc.id)

      // Log de interação
      const interaction = mocks.state.interactions.find(i => i.ticket_id === ticketId)
      expect(interaction).toBeDefined()
      expect(interaction.outcome).toBe('knowledge_extracted')

      // Fila deve ter sido marcada como processada
      expect(mocks.state.learningQueue[0].processed_at).toBeDefined()
    })

    it('deve enriquecer artigo existente quando similaridade >= 0.80', async () => {
      // 1. Arrange
      const ticketId = 't-learn-enrich'
      const ticket = {
        id: ticketId,
        subject: 'Erro SMTP',
        description: 'SMTP falhou na autenticação',
        category_id: 'cat-1',
        csat_score: 5
      }
      mocks.state.tickets = [ticket]
      mocks.state.messages = [
        { ticket_id: ticketId, author_role: 'user', body: 'SMTP falhou na autenticação' },
        { ticket_id: ticketId, author_role: 'agent', body: 'Libere a porta 587 no seu firewall.' }
      ]

      mocks.state.learningQueue = [{
        ticket_id: ticketId,
        priority: 5,
        attempts: 0,
        scheduled_at: new Date().toISOString()
      }]

      // Artigo similar existente
      const existingDocId = 'doc-existing'
      mocks.state.kbDocs = [{
        id: existingDocId,
        title: 'Erros de SMTP',
        problem_description: 'Bloqueios na porta SMTP default',
        problem_variants: ['SMTP offline'],
        resolution_count: 2,
        avg_csat: 4.0,
        status: 'draft',
        source_ticket_ids: ['t-old-1']
      }]

      mocks.state.searchKnowledgeAllStatusReturn = [{
        doc_id: existingDocId,
        title: 'Erros de SMTP',
        solution_summary: 'Liberar portas no firewall',
        similarity: 0.88
      }]

      // Mock da resposta do Gemini extraindo conhecimento
      mocks.mockGenerateContent.mockResolvedValueOnce({
        response: {
          text: () => JSON.stringify({
            should_learn: true,
            title: 'Erro de Conexão SMTP',
            problem_description: 'Bloqueio de Firewall na porta SMTP 587',
            solution_summary: 'Liberar porta 587',
            solution_steps: [{ step: 1, text: 'Liberar porta' }],
            keywords: ['smtp', 'firewall'],
            confidence: 0.95
          })
        }
      })

      // 2. Act
      await knowledgeLearningService.processQueue(1)

      // 3. Assert
      // NÃO deve ter criado novo artigo na KB
      expect(mocks.state.kbDocs.length).toBe(1)
      const updatedDoc = mocks.state.kbDocs[0]
      expect(updatedDoc.id).toBe(existingDocId)

      // resolution_count deve ter incrementado
      expect(updatedDoc.resolution_count).toBe(3)

      // avg_csat recalculado: (4.0 * 2 + 5) / 3 = 4.33
      expect(Number(updatedDoc.avg_csat)).toBeCloseTo(4.33, 2)

      // problem_variants enriquecido com novas variantes de termos
      expect(updatedDoc.problem_variants).toContain('Erro de Conexão SMTP')
      expect(updatedDoc.problem_variants).toContain('Bloqueio de Firewall na porta SMTP 587')

      // source_ticket_ids deve conter o novo ticket_id
      expect(updatedDoc.source_ticket_ids).toContain(ticketId)

      // Fila deve ter sido marcada como processada
      expect(mocks.state.learningQueue[0].processed_at).toBeDefined()

      // Log de interação deve ser de atualização
      const interaction = mocks.state.interactions.find(i => i.ticket_id === ticketId)
      expect(interaction).toBeDefined()
      expect(interaction.outcome).toBe('knowledge_updated')
    })
  })

  describe('Regra de Publicação Automática', () => {
    it('deve publicar automaticamente (status = active) se avg_csat >= 4.0', async () => {
      // 1. Arrange
      const ticketId = 't-pub-csat'
      const ticket = {
        id: ticketId,
        subject: 'Erro ao salvar',
        description: 'Não salva nada',
        category_id: 'cat-1',
        csat_score: 4 // CSAT >= 4
      }
      mocks.state.tickets = [ticket]
      mocks.state.messages = [
        { ticket_id: ticketId, author_role: 'user', body: 'Não salva nada' },
        { ticket_id: ticketId, author_role: 'agent', body: 'Conceda permissão de escrita.' }
      ]

      mocks.state.learningQueue = [{
        ticket_id: ticketId,
        priority: 5,
        attempts: 0,
        scheduled_at: new Date().toISOString()
      }]

      mocks.state.searchKnowledgeAllStatusReturn = [] // Novo artigo

      mocks.mockGenerateContent.mockResolvedValueOnce({
        response: {
          text: () => JSON.stringify({
            should_learn: true,
            title: 'Permissões de Escrita',
            problem_description: 'Sem permissão de salvar no disco',
            solution_summary: 'Conceder permissão',
            solution_steps: [],
            keywords: [],
            confidence: 0.90
          })
        }
      })

      // 2. Act
      await knowledgeLearningService.processQueue(1)

      // 3. Assert
      expect(mocks.state.kbDocs.length).toBe(1)
      const doc = mocks.state.kbDocs[0]
      expect(doc.status).toBe('active')
      expect(doc.auto_published).toBe(true)
    })

    it('deve publicar automaticamente (status = active) se resolution_count >= 4', async () => {
      // 1. Arrange
      const ticketId = 't-pub-usage'
      const ticket = {
        id: ticketId,
        subject: 'Erro persistente',
        description: 'Dúvida sobre exportação',
        category_id: 'cat-1',
        csat_score: null // Sem nota de CSAT
      }
      mocks.state.tickets = [ticket]
      mocks.state.messages = [
        { ticket_id: ticketId, author_role: 'user', body: 'Dúvida sobre exportação' },
        { ticket_id: ticketId, author_role: 'agent', body: 'Vá em exportar.' }
      ]

      mocks.state.learningQueue = [{
        ticket_id: ticketId,
        priority: 5,
        attempts: 0,
        scheduled_at: new Date().toISOString()
      }]

      // Artigo similar existente com resolution_count = 3 (com este ticket vai para 4)
      const existingDocId = 'doc-usage-3'
      mocks.state.kbDocs = [{
        id: existingDocId,
        title: 'Como exportar planilhas',
        problem_description: 'Dúvidas ao exportar dados',
        resolution_count: 3,
        avg_csat: null,
        status: 'draft',
        source_ticket_ids: ['t-old-1', 't-old-2', 't-old-3']
      }]

      mocks.state.searchKnowledgeAllStatusReturn = [{
        doc_id: existingDocId,
        title: 'Como exportar planilhas',
        similarity: 0.92
      }]

      mocks.mockGenerateContent.mockResolvedValueOnce({
        response: {
          text: () => JSON.stringify({
            should_learn: true,
            title: 'Como exportar planilhas',
            problem_description: 'Dúvida de exportação',
            solution_summary: 'Menu exportar',
            solution_steps: [],
            keywords: [],
            confidence: 0.90
          })
        }
      })

      // 2. Act
      await knowledgeLearningService.processQueue(1)

      // 3. Assert
      expect(mocks.state.kbDocs.length).toBe(1)
      const doc = mocks.state.kbDocs[0]
      expect(doc.id).toBe(existingDocId)
      expect(doc.resolution_count).toBe(4)
      expect(doc.status).toBe('active')
      expect(doc.auto_published).toBe(true)
    })
  })
})
