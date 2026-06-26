import { describe, it, expect, vi, beforeEach } from 'vitest'
import http from 'node:http'
import { randomUUID } from 'node:crypto'

// Configurar variáveis de ambiente necessárias para o teste
process.env.N8N_EMAIL_WEBHOOK_URL = 'https://mock-webhook-n8n.com'

// Mock global fetch para simular os disparos de webhook n8n
global.fetch = vi.fn().mockResolvedValue({
  ok: true,
  json: () => Promise.resolve({ message: 'E-mail enviado' }),
  text: () => Promise.resolve('OK')
} as any)

// ── Custom Thenable Chainable Mock ──────────────────────────────────────────
const createChainable = () => {
  const chain: any = {
    select: vi.fn().mockReturnThis(),
    eq:     vi.fn().mockReturnThis(),
    lte:    vi.fn().mockReturnThis(),
    order:  vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    upsert: vi.fn().mockReturnThis(),
    single: vi.fn(),
    
    // Fila para simular retornos sequenciais
    _resolvedQueue: [] as any[],
    
    mockResolvedValueOnce(val: any) {
      this._resolvedQueue.push(val)
      return this
    },

    mockResolvedValue(val: any) {
      this._resolvedQueue = [val]
      return this
    },

    // O método single() deve resolver a promessa usando a fila
    then(onfulfilled: any) {
      let val = { data: null, error: null }
      if (this._resolvedQueue.length > 0) {
        val = this._resolvedQueue.shift()
      }
      return Promise.resolve(val).then(onfulfilled)
    }
  }

  // Fazer single resolver usando a mesma lógica do chain
  chain.single.mockImplementation(() => {
    return {
      then(onfulfilled: any) {
        let val = { data: null, error: null }
        if (chain._resolvedQueue.length > 0) {
          val = chain._resolvedQueue.shift()
        }
        return Promise.resolve(val).then(onfulfilled)
      }
    }
  })

  return chain
}

const queryMocks: Record<string, any> = {}

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

vi.mock('../src/lib/supabase.js', () => ({
  supabase: {
    from: mockFrom,
    auth: {
      getUser: vi.fn()
    }
  },
  supabaseAdmin: {
    from: mockFrom,
    auth: {
      getUser: vi.fn()
    }
  }
}))

// Mock de envio de WhatsApp
vi.mock('../src/services/whatsapp/uazapi.js', () => ({
  sendWhatsAppMessage: vi.fn().mockResolvedValue({ success: true })
}))

// Helper de requisições mockadas
function createMockReq(method: string, url: string, body?: any): http.IncomingMessage {
  const req = new http.IncomingMessage(null as any)
  req.method = method
  req.url = url
  req.headers = {}
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
    setHeader: vi.fn(),
  } as unknown as http.ServerResponse & { writeHead: any; end: any; setHeader: any }
  return res
}

describe('Módulo de Prospecção Outbound e Comercial (Fase F7)', () => {

  beforeEach(() => {
    vi.clearAllMocks()
    for (const key of Object.keys(queryMocks)) {
      const m = queryMocks[key]
      m._resolvedQueue = []
      m.select.mockClear().mockReturnThis()
      m.eq.mockClear().mockReturnThis()
      m.lte.mockClear().mockReturnThis()
      m.order.mockClear().mockReturnThis()
      m.insert.mockClear().mockReturnThis()
      m.update.mockClear().mockReturnThis()
      m.delete.mockClear().mockReturnThis()
      m.upsert.mockClear().mockReturnThis()
      m.single.mockClear()
    }
  })

  describe('F7-E1-T1: Modelagem e Gerenciamento de Campanhas (prospect_campaigns)', () => {
    it('deve criar uma nova campanha pelo time comercial (perfil admin/operador)', async () => {
      const { handleProspectAdmin } = await import('../src/api/prospectAdmin.js')
      const campId = randomUUID()

      getTableMock('prospect_campaigns').mockResolvedValueOnce({
        data: { id: campId, slug: 'camp-natal', name: 'Campanha de Natal', is_active: true },
        error: null
      })

      const req = createMockReq('POST', '/api/admin/prospects/campaigns', {
        slug: 'camp-natal',
        name: 'Campanha de Natal',
        description: 'Campanha de prospecção de fim de ano'
      })
      const res = createMockRes()

      await handleProspectAdmin(req, res, { userId: 'admin-user', perfil: 'operador' })

      expect(getTableMock('prospect_campaigns').insert).toHaveBeenCalledWith(
        expect.objectContaining({
          slug: 'camp-natal',
          name: 'Campanha de Natal',
          description: 'Campanha de prospecção de fim de ano',
          is_active: true
        })
      )
      expect(res.writeHead).toHaveBeenCalledWith(201, expect.any(Object))
      expect(res.end).toHaveBeenCalledWith(expect.stringContaining('camp-natal'))
    })

    it('deve pausar uma campanha existente definindo is_active para false', async () => {
      const { handleProspectAdmin } = await import('../src/api/prospectAdmin.js')
      const campId = randomUUID()

      getTableMock('prospect_campaigns').mockResolvedValueOnce({
        data: { id: campId, slug: 'camp-natal', name: 'Campanha de Natal', is_active: false },
        error: null
      })

      const req = createMockReq('PATCH', `/api/admin/prospects/campaigns/${campId}`, {
        is_active: false
      })
      const res = createMockRes()

      await handleProspectAdmin(req, res, { userId: 'admin-user', perfil: 'admin' })

      expect(getTableMock('prospect_campaigns').update).toHaveBeenCalledWith(
        expect.objectContaining({ is_active: false })
      )
      expect(getTableMock('prospect_campaigns').eq).toHaveBeenCalledWith('id', campId)
      expect(res.writeHead).toHaveBeenCalledWith(200, expect.any(Object))
      expect(res.end).toHaveBeenCalledWith(expect.stringContaining('"is_active":false'))
    })

    it('deve encerrar e remover uma campanha comercial', async () => {
      const { handleProspectAdmin } = await import('../src/api/prospectAdmin.js')
      const campId = randomUUID()

      getTableMock('prospect_campaigns').mockResolvedValueOnce({
        error: null
      })

      const req = createMockReq('DELETE', `/api/admin/prospects/campaigns/${campId}`)
      const res = createMockRes()

      await handleProspectAdmin(req, res, { userId: 'admin-user', perfil: 'admin' })

      expect(getTableMock('prospect_campaigns').delete).toHaveBeenCalled()
      expect(getTableMock('prospect_campaigns').eq).toHaveBeenCalledWith('id', campId)
      expect(res.writeHead).toHaveBeenCalledWith(200, expect.any(Object))
      expect(res.end).toHaveBeenCalledWith(expect.stringContaining('"success":true'))
    })

    it('deve barrar acesso a rotas de prospecção para usuários que não sejam admin ou operador', async () => {
      const { handleProspectAdmin } = await import('../src/api/prospectAdmin.js')

      const req = createMockReq('GET', '/api/admin/prospects/campaigns')
      const res = createMockRes()

      await handleProspectAdmin(req, res, { userId: 'regular-user', perfil: 'assinante' })

      expect(res.writeHead).toHaveBeenCalledWith(403, expect.any(Object))
      expect(res.end).toHaveBeenCalledWith(expect.stringContaining('Acesso negado'))
    })
  })

  describe('F7-E1-T2 & F7-E2-T2: Enriquecimento de Leads e Polimorfismo Comercial', () => {
    it('deve empurrar filiais para prospecção enriquecendo o lead com scores polimórficos de pelo menos 2 canais', async () => {
      const { handleCommercialAdmin } = await import('../src/api/commercialAdmin.js')
      const branchId = randomUUID()
      const companyId = randomUUID()
      const campaignId = randomUUID()

      // 1. Mock da criação/upsert da campanha
      getTableMock('prospect_campaigns').mockResolvedValueOnce({
        data: { id: campaignId, slug: 'natal-vendas' },
        error: null
      })

      // 2. Mock de obter branch
      getTableMock('commercial_branches').mockResolvedValueOnce({
        data: { id: branchId, company_id: companyId, name: 'Filial Centro', city: 'São Paulo', phone: '11999999999', email: 'centro@loja.com', contact_name: 'Carlos' },
        error: null
      })

      // 3. Mock de obter company
      getTableMock('commercial_companies').mockResolvedValueOnce({
        data: { id: companyId, segment_id: 'seg_varejo', name: 'Lojas Americanas' },
        error: null
      })

      // 4. Mock de scores da filial (Google Maps)
      getTableMock('commercial_channel_scores').mockResolvedValueOnce({
        data: [{ channel: 'google_maps', score: 4.2, score_max: 5.0, target_type: 'branch', target_id: branchId }],
        error: null
      })

      // 5. Mock de scores da matriz (Reclame Aqui)
      getTableMock('commercial_channel_scores').mockResolvedValueOnce({
        data: [{ channel: 'reclame_aqui', score: 8.5, score_max: 10.0, target_type: 'company', target_id: companyId }],
        error: null
      })

      // 6. Mock do insert do lead na prospecção
      getTableMock('prospect_leads').mockResolvedValueOnce({
        error: null
      })

      // 7. Mock da contagem de leads final (para o update da campanha)
      getTableMock('prospect_leads').mockResolvedValueOnce({
        data: { length: 1 },
        error: null
      })

      // 8. Mock da atualização da campanha
      getTableMock('prospect_campaigns').mockResolvedValueOnce({
        data: { id: campaignId },
        error: null
      })

      const req = createMockReq('POST', '/api/admin/commercial/push-to-prospect', {
        campaign_slug: 'natal-vendas',
        branch_ids: [branchId]
      })
      const res = createMockRes()

      await handleCommercialAdmin(req, res, { userId: 'admin-user', perfil: 'operador' })

      // Verificar se o lead de prospecção foi criado com os scores consolidados das variáveis
      expect(getTableMock('prospect_leads').insert).toHaveBeenCalledWith(
        expect.objectContaining({
          company_name: 'Filial Centro',
          segment_id: 'seg_varejo',
          phone: '11999999999',
          email: 'centro@loja.com',
          variables: expect.objectContaining({
            nota_google: 4.2,
            nota_reclame: 8.5
          })
        })
      )
      expect(res.writeHead).toHaveBeenCalledWith(200, expect.any(Object))
      expect(res.end).toHaveBeenCalledWith(expect.stringContaining('"success":true'))
    })
  })

  describe('F7-E2-T1: Fila de Followups e Cancelamento Automático', () => {
    it('deve cancelar automaticamente follow-ups futuros pendentes caso o lead mude para o status responded ou converted', async () => {
      const { handleProspectAdmin } = await import('../src/api/prospectAdmin.js')
      const leadId = randomUUID()

      // 1. Mock do cancelamento na fila (primeira operação no lead status patch)
      getTableMock('prospect_followup_queue').mockResolvedValueOnce({
        data: null,
        error: null
      })

      // 2. Mock do update do lead em si
      getTableMock('prospect_leads').mockResolvedValueOnce({
        data: { id: leadId, status: 'responded' },
        error: null
      })

      const req = createMockReq('PATCH', `/api/admin/prospects/leads/${leadId}`, {
        status: 'responded'
      })
      const res = createMockRes()

      await handleProspectAdmin(req, res, { userId: 'admin-user', perfil: 'admin' })

      // Deve cancelar os followups futuros pendentes
      expect(getTableMock('prospect_followup_queue').update).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'canceled' })
      )
      expect(getTableMock('prospect_followup_queue').eq).toHaveBeenCalledWith('lead_id', leadId)
      expect(getTableMock('prospect_followup_queue').eq).toHaveBeenCalledWith('status', 'pending')

      expect(res.writeHead).toHaveBeenCalledWith(200, expect.any(Object))
      expect(res.end).toHaveBeenCalledWith(expect.stringContaining('"status":"responded"'))
    })

    it('deve agendar o próximo followup ao disparar um passo manualmente', async () => {
      const { handleProspectAdmin } = await import('../src/api/prospectAdmin.js')
      const leadId = randomUUID()

      // 1. Mock de obter lead
      getTableMock('prospect_leads').mockResolvedValueOnce({
        data: { id: leadId, company_name: 'Empresa Teste', email: 'teste@empresa.com' },
        error: null
      })

      // 2. Mock de logs
      getTableMock('prospect_dispatch_logs').mockResolvedValueOnce({ error: null })
      // 3. Mock de update de status do lead
      getTableMock('prospect_leads').mockResolvedValueOnce({ error: null })
      // 4. Mock de agendamento de followup
      getTableMock('prospect_followup_queue').mockResolvedValueOnce({ error: null })

      const req = createMockReq('POST', '/api/admin/prospects/dispatch', {
        lead_id: leadId,
        channel: 'email',
        step: 2,
        text: 'Olá [EMPRESA], vimos que sua nota é [NOTA_GOOGLE]',
        subject: 'Vagas de Reputação'
      })
      const res = createMockRes()

      await handleProspectAdmin(req, res, { userId: 'admin-user', perfil: 'admin' })

      // Se for passo 2 (E-mail), deve agendar o passo 3 (WhatsApp) para daqui a 120h (5 dias)
      expect(getTableMock('prospect_followup_queue').insert).toHaveBeenCalledWith(
        expect.objectContaining({
          lead_id: leadId,
          channel: 'whatsapp',
          step: 3,
          status: 'pending',
          scheduled_at: expect.any(String)
        })
      )
      expect(res.writeHead).toHaveBeenCalledWith(200, expect.any(Object))
    })
  })
})
