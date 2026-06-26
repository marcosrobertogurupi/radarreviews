import http from 'node:http'
import { supabaseAdmin } from '../lib/supabase.js'
import { logger } from '../lib/logger.js'
import { isValidTransition, calculateSLADeadline } from '../lib/support-state.js'
import { knowledgeLearningService } from '../services/knowledgeLearningService.js'
import { embeddingService } from '../services/embeddingService.js'
import { AI_CONFIG } from '../lib/ai-config.js'
import { emailService } from '../services/emailService.js'

/**
 * Helper para responder JSON
 */
function json(res: http.ServerResponse, status: number, data: any) {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(data))
}

/**
 * Handler para o Painel Administrativo
 */
export async function handleSupportAdmin(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  auth: { userId: string; perfil: string }
): Promise<void> {
  const url = req.url || ''
  const method = req.method

  // RBAC: Apenas admin ou operador
  if (!['admin', 'operador'].includes(auth.perfil)) {
    return json(res, 403, { error: 'Acesso negado' })
  }

  // GET /api/admin/support/stats (KPIs Dashboard)
  if (url === '/api/admin/support/stats' && method === 'GET') {
    try {
      const [tickets, csat, sla] = await Promise.all([
        supabaseAdmin.from('support_tickets').select('status, priority'),
        supabaseAdmin.from('support_tickets').select('csat_score').not('csat_score', 'is', null),
        supabaseAdmin.from('support_tickets').select('is_sla_breached').eq('is_sla_breached', true)
      ])

      const stats = {
        total: tickets.data?.length || 0,
        open: tickets.data?.filter((t: any) => t.status === 'open' || t.status === 'reopened').length || 0,
        ai_handled: tickets.data?.filter((t: any) => t.status === 'ai_resolved').length || 0,
        critical: tickets.data?.filter((t: any) => t.priority === 'critical').length || 0,
        avg_csat: csat.data?.length 
          ? (csat.data.reduce((acc: number, curr: any) => acc + curr.csat_score, 0) / csat.data.length).toFixed(2)
          : 0,
        sla_breaches: sla.data?.length || 0
      }

      return json(res, 200, stats)
    } catch (error: any) {
      return json(res, 500, { error: error.message })
    }
  }

  // GET /api/admin/support/tickets (listagem global)
  if (url === '/api/admin/support/tickets' && method === 'GET') {
    const { data, error } = await supabaseAdmin
      .from('support_tickets')
      .select('*, tenants(name), ticket_categories(name)')
      .order('created_at', { ascending: false })
    if (error) return json(res, 500, { error: error.message })
    return json(res, 200, data)
  }

  // GET /api/admin/support/tickets/:id (detalhes do ticket com mensagens)
  if (url.startsWith('/api/admin/support/tickets/') && method === 'GET' && !url.endsWith('/audit')) {
    try {
      const id = url.split('/').pop()
      const { data: ticket, error } = await supabaseAdmin
        .from('support_tickets')
        .select('*, tenants(name), ticket_categories(name), ticket_messages(*)')
        .eq('id', id)
        .single()

      if (error || !ticket) return json(res, 404, { error: 'Ticket não encontrado' })

      if (ticket.ticket_messages) {
        ticket.ticket_messages.sort((a: any, b: any) =>
          new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
        )
      }

      return json(res, 200, ticket)
    } catch (error: any) {
      return json(res, 500, { error: error.message })
    }
  }

  // PATCH /api/admin/support/tickets/:id (atribuição, status, etc)
  if (url.startsWith('/api/admin/support/tickets/') && method === 'PATCH') {
    const id = url.split('/').pop()
    let body = ''
    for await (const chunk of req) body += chunk
    const parsed = JSON.parse(body)

    const { data: oldTicket } = await supabaseAdmin
      .from('support_tickets')
      .select('status, assigned_to, priority, tenant_id, created_at')
      .eq('id', id)
      .single()
    
    if (!oldTicket) {
      return json(res, 404, { error: 'Ticket original não encontrado' })
    }

    if (parsed.status && parsed.status !== oldTicket.status) {
      if (!isValidTransition(oldTicket.status, parsed.status)) {
        return json(res, 400, { error: `Transição inválida de ${oldTicket.status} para ${parsed.status}` })
      }
    }

    if (parsed.priority && parsed.priority !== oldTicket.priority) {
      const newSla = await calculateSLADeadline(oldTicket.tenant_id, parsed.priority, new Date(oldTicket.created_at))
      parsed.sla_deadline = newSla.toISOString()
    }

    const { data: ticket, error } = await supabaseAdmin
      .from('support_tickets')
      .update(parsed)
      .eq('id', id)
      .select()
      .single()

    if (error) return json(res, 500, { error: error.message })

    // Auditoria de mudanças
    const auditEntries = []
    if (parsed.status && parsed.status !== oldTicket.status) {
      auditEntries.push({ ticket_id: id, action: 'status_changed', from_value: oldTicket.status, to_value: parsed.status, actor_id: auth.userId, actor_role: 'agent' })
      if (parsed.status === 'resolved') {
        auditEntries.push({ ticket_id: id, action: 'resolved', actor_id: auth.userId, actor_role: 'agent' })
      } else if (parsed.status === 'closed') {
        auditEntries.push({ ticket_id: id, action: 'closed', actor_id: auth.userId, actor_role: 'agent' })
      }
    }
    if (parsed.priority && parsed.priority !== oldTicket.priority) {
      auditEntries.push({ ticket_id: id, action: 'priority_changed', from_value: oldTicket.priority, to_value: parsed.priority, actor_id: auth.userId, actor_role: 'agent' })
    }
    if (parsed.assigned_to && parsed.assigned_to !== oldTicket.assigned_to) {
      auditEntries.push({ ticket_id: id, action: 'assigned', to_value: parsed.assigned_to, actor_id: auth.userId, actor_role: 'agent' })
    }

    if (auditEntries.length > 0) {
      await supabaseAdmin.from('ticket_audit_log').insert(auditEntries)
    }

    if (parsed.status === 'closed' && id) {
      knowledgeLearningService.queueTicket(id).catch(err => {
        logger.error('Erro ao agendar aprendizado do ticket', { id, err })
      })
    }

    return json(res, 200, ticket)
  }

  // GET /api/admin/support/kb (gestão da Base de Conhecimento)
  if (url === '/api/admin/support/kb' && method === 'GET') {
    const { data, error } = await supabaseAdmin
      .from('support_knowledge_docs')
      .select('*, ticket_categories(name)')
      .order('updated_at', { ascending: false })
    if (error) return json(res, 500, { error: error.message })
    return json(res, 200, data)
  }

  // PATCH /api/admin/support/kb/:id (aprovação/revisão)
  if (url.startsWith('/api/admin/support/kb/') && method === 'PATCH') {
    try {
      const id = url.split('/').pop()
      let body = ''
      for await (const chunk of req) body += chunk
      const parsed = JSON.parse(body)

      const updatePayload: any = { ...parsed }
      if (parsed.status === 'active') {
        updatePayload.reviewed_by = auth.userId
        updatePayload.reviewed_at = new Date().toISOString()
      }

      const { data: doc, error } = await supabaseAdmin
        .from('support_knowledge_docs')
        .update(updatePayload)
        .eq('id', id)
        .select()
        .single()

      if (error) return json(res, 500, { error: error.message })

      // Regenerar o embedding do documento atualizado
      const contentToEmbed = `${doc.title}\n${doc.problem_description || ''}\n${doc.solution_summary || ''}`
      await embeddingService.upsertDocEmbedding(doc.id, contentToEmbed).catch(err => {
        logger.error('Erro ao atualizar embedding do KB', { id, err })
      })

      return json(res, 200, doc)
    } catch (error: any) {
      return json(res, 500, { error: error.message })
    }
  }

  // POST /api/admin/support/kb (criação de novo artigo)
  if (url === '/api/admin/support/kb' && method === 'POST') {
    try {
      let body = ''
      for await (const chunk of req) body += chunk
      const parsed = JSON.parse(body)

      if (!parsed.title || !parsed.solution_summary) {
        return json(res, 400, { error: 'Título e Resumo da solução são obrigatórios' })
      }

      const { data: doc, error } = await supabaseAdmin
        .from('support_knowledge_docs')
        .insert({
          title: parsed.title,
          problem_description: parsed.problem_description || '',
          solution_summary: parsed.solution_summary,
          solution_steps: parsed.solution_steps || [],
          category_id: parsed.category_id || null,
          keywords: parsed.keywords || [],
          status: parsed.status || 'draft',
          confidence_score: parsed.confidence_score || 1.0,
          resolution_count: 0
        })
        .select()
        .single()

      if (error) return json(res, 500, { error: error.message })

      // Gerar embedding do documento cadastrado
      const contentToEmbed = `${doc.title}\n${doc.problem_description || ''}\n${doc.solution_summary || ''}`
      await embeddingService.upsertDocEmbedding(doc.id, contentToEmbed).catch(err => {
        logger.error('Erro ao cadastrar embedding do novo KB', { id: doc.id, err })
      })

      return json(res, 201, doc)
    } catch (error: any) {
      return json(res, 500, { error: error.message })
    }
  }

  // POST /api/admin/support/tickets/:id/approve-ai-draft
  if (url.match(/\/api\/admin\/support\/tickets\/[^/]+\/approve-ai-draft/) && method === 'POST') {
    try {
      const match = url.match(/\/api\/admin\/support\/tickets\/([^/]+)\/approve-ai-draft/)
      const id = match ? match[1] : ''
      if (!id) {
        return json(res, 400, { error: 'ID do ticket inválido' })
      }

      // Buscar ticket original
      const { data: ticket } = await supabaseAdmin
        .from('support_tickets')
        .select('*')
        .eq('id', id)
        .single()

      if (!ticket) {
        return json(res, 404, { error: 'Ticket não encontrado' })
      }

      if (!ticket.ai_draft_response) {
        return json(res, 400, { error: 'Não há rascunho de IA para aprovar' })
      }

      // Inserir mensagem com a resposta do operador (usando o rascunho da IA)
      const { data: msg, error: msgErr } = await supabaseAdmin
        .from('ticket_messages')
        .insert({
          ticket_id: id,
          author_id: auth.userId,
          author_role: 'agent',
          body: ticket.ai_draft_response,
          is_internal: false
        })
        .select()
        .single()

      if (msgErr) return json(res, 500, { error: msgErr.message })

      // Atualizar o ticket para resolved
      const { data: updatedTicket, error: ticketErr } = await supabaseAdmin
        .from('support_tickets')
        .update({
          status: 'resolved',
          ai_draft_response: null,
          resolved_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq('id', id)
        .select()
        .single()

      if (ticketErr) return json(res, 500, { error: ticketErr.message })

      // Logs de auditoria
      await supabaseAdmin.from('ticket_audit_log').insert([
        {
          ticket_id: id,
          actor_id: auth.userId,
          actor_role: 'agent',
          action: 'status_changed',
          from_value: ticket.status,
          to_value: 'resolved',
          metadata: { reason: 'Rascunho de IA aprovado pelo operador' }
        },
        {
          ticket_id: id,
          actor_id: auth.userId,
          actor_role: 'agent',
          action: 'resolved',
          from_value: ticket.status,
          to_value: 'resolved'
        }
      ])

      // Notificar criador do ticket por e-mail
      supabaseAdmin.auth.admin.getUserById(ticket.created_by).then((res: any) => {
        const email = res.data?.user?.email
        if (email) {
          emailService.sendTicketReplyEmail(email, updatedTicket, msg.body, 'Assistente IA (Aprovado)')
            .catch((err: any) => logger.error('Erro ao notificar resposta de ticket', { id, err }))
        }
      }).catch((err: any) => {
        logger.error('Erro ao buscar usuário para notificação de resposta de ticket', { userId: ticket.created_by, err })
      })

      return json(res, 200, { ok: true, ticket: updatedTicket, message: msg })
    } catch (error: any) {
      return json(res, 500, { error: error.message })
    }
  }

  // POST /api/admin/support/tickets/:id/messages
  if (url.match(/\/api\/admin\/support\/tickets\/[^/]+\/messages/) && method === 'POST') {
    try {
      const match = url.match(/\/api\/admin\/support\/tickets\/([^/]+)\/messages/)
      const id = match ? match[1] : ''
      if (!id) {
        return json(res, 400, { error: 'ID do ticket inválido' })
      }

      let body = ''
      for await (const chunk of req) body += chunk
      const parsed = JSON.parse(body)

      if (!parsed.body) {
        return json(res, 400, { error: 'Mensagem vazia' })
      }

      // Buscar ticket original
      const { data: ticket } = await supabaseAdmin
        .from('support_tickets')
        .select('*')
        .eq('id', id)
        .single()

      if (!ticket) {
        return json(res, 404, { error: 'Ticket não encontrado' })
      }

      // Se status foi fornecido e é diferente, valida
      const updateData: any = { updated_at: new Date().toISOString() }
      if (!ticket.first_response_at) {
        updateData.first_response_at = new Date().toISOString()
      }

      if (parsed.status && parsed.status !== ticket.status) {
        if (!isValidTransition(ticket.status, parsed.status)) {
          return json(res, 400, { error: `Transição inválida de ${ticket.status} para ${parsed.status}` })
        }
        updateData.status = parsed.status
        if (parsed.status === 'resolved') {
          updateData.resolved_at = new Date().toISOString()
        } else if (parsed.status === 'closed') {
          updateData.closed_at = new Date().toISOString()
        }
      }

      // Inserir mensagem
      const { data: msg, error: msgErr } = await supabaseAdmin
        .from('ticket_messages')
        .insert({
          ticket_id: id,
          author_id: auth.userId,
          author_role: 'agent',
          body: parsed.body,
          is_internal: parsed.is_internal || false
        })
        .select()
        .single()

      if (msgErr) return json(res, 500, { error: msgErr.message })

      // Atualizar ticket
      const { data: updatedTicket, error: ticketErr } = await supabaseAdmin
        .from('support_tickets')
        .update(updateData)
        .eq('id', id)
        .select()
        .single()

      if (ticketErr) return json(res, 500, { error: ticketErr.message })

      // Trilha de auditoria
      const auditEntries = [
        {
          ticket_id: id,
          actor_id: auth.userId,
          actor_role: 'agent',
          action: 'message_added',
          metadata: { is_internal: parsed.is_internal || false }
        }
      ] as any[]

      if (updateData.status) {
        auditEntries.push({
          ticket_id: id,
          actor_id: auth.userId,
          actor_role: 'agent',
          action: 'status_changed',
          from_value: ticket.status,
          to_value: updateData.status,
          metadata: { reason: 'Alteração manual pelo operador' }
        })
        if (updateData.status === 'resolved') {
          auditEntries.push({
            ticket_id: id,
            actor_id: auth.userId,
            actor_role: 'agent',
            action: 'resolved',
            from_value: ticket.status,
            to_value: 'resolved'
          })
        } else if (updateData.status === 'closed') {
          auditEntries.push({
            ticket_id: id,
            actor_id: auth.userId,
            actor_role: 'agent',
            action: 'closed',
            from_value: ticket.status,
            to_value: 'closed'
          })
        }
      }

      await supabaseAdmin.from('ticket_audit_log').insert(auditEntries)

      // Notificar criador do ticket por e-mail (se não for nota interna)
      if (!parsed.is_internal) {
        supabaseAdmin.auth.admin.getUserById(ticket.created_by).then((res: any) => {
          const email = res.data?.user?.email
          if (email) {
            emailService.sendTicketReplyEmail(email, updatedTicket, msg.body, 'Suporte Reputei')
              .catch((err: any) => logger.error('Erro ao notificar resposta de ticket', { id, err }))
          }
        }).catch((err: any) => {
          logger.error('Erro ao buscar usuário para notificação de resposta de ticket', { userId: ticket.created_by, err })
        })
      }

      return json(res, 200, { ok: true, ticket: updatedTicket, message: msg })
    } catch (error: any) {
      return json(res, 500, { error: error.message })
    }
  }

  // GET /api/admin/support/tickets/:id/audit
  if (url.match(/\/api\/admin\/support\/tickets\/[^/]+\/audit/) && method === 'GET') {
    try {
      const match = url.match(/\/api\/admin\/support\/tickets\/([^/]+)\/audit/)
      const id = match ? match[1] : ''
      if (!id) {
        return json(res, 400, { error: 'ID do ticket inválido' })
      }

      const { data, error } = await supabaseAdmin
        .from('ticket_audit_log')
        .select('*')
        .eq('ticket_id', id)
        .order('created_at', { ascending: true })

      if (error) return json(res, 500, { error: error.message })
      return json(res, 200, data)
    } catch (error: any) {
      return json(res, 500, { error: error.message })
    }
  }

  // POST /api/admin/support/kb/test-query (RAG simulation)
  if (url === '/api/admin/support/kb/test-query' && method === 'POST') {
    try {
      let body = ''
      for await (const chunk of req) body += chunk
      const parsed = JSON.parse(body)

      if (!parsed.query) {
        return json(res, 400, { error: 'O parâmetro query é obrigatório' })
      }

      // Realiza a busca RAG em todos os status
      const docs = await embeddingService.searchKnowledgeAllStatus(parsed.query, {
        categoryId: parsed.category_id || undefined,
        threshold: 0.0,
        count: 5
      })

      // Gerar resposta simulada com Gemini
      let reply = 'Nenhum documento relevante encontrado para gerar a resposta.'
      if (docs.length > 0) {
        const activeDocs = docs.filter(d => d.similarity >= 0.65)
        if (activeDocs.length > 0) {
          const kbContext = activeDocs.map((doc, idx) => `
          Documento #${idx + 1}:
          Título: ${doc.title}
          Resumo: ${doc.solutionSummary}
          Passos: ${JSON.stringify(doc.solutionSteps)}
          `).join('\n')

          const key = process.env['GEMINI_API_KEY']
          if (key) {
            const { GoogleGenerativeAI } = await import('@google/generative-ai')
            const genAI = new GoogleGenerativeAI(key)
            const model = genAI.getGenerativeModel({ model: AI_CONFIG.model })
            const prompt = `
            Você é o assistente virtual da Reputei simulação.
            Pergunta simulada do usuário: ${parsed.query}

            Contexto da Base de Conhecimento:
            ${kbContext}

            Instruções:
            1. Responda à pergunta do usuário baseando-se estritamente nas informações dos documentos fornecidos.
            2. Não mencione "base de conhecimento" ou "documento" na resposta final, aja como se soubesse diretamente.
            3. Caso os documentos não contenham a resposta ou a similaridade seja irrelevante, explique que não há informações suficientes.

            Resposta:`.trim()

            const genResult = await model.generateContent(prompt)
            reply = genResult.response.text()
          } else {
            reply = `[Simulação sem Gemini] Melhor correspondência: ${activeDocs[0]?.title || ''}`
          }
        }
      }

      return json(res, 200, {
        query: parsed.query,
        documents: docs,
        response: reply
      })
    } catch (error: any) {
      return json(res, 500, { error: error.message })
    }
  }

  json(res, 404, { error: 'Rota admin de suporte não encontrada' })
}
