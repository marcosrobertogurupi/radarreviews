import http from 'node:http'
import { supabaseAdmin } from '../lib/supabase.js'
import { logger } from '../lib/logger.js'
import { supportAITriageService } from '../services/supportAITriage.js'
import { calculateSLADeadline } from '../lib/support-state.js'
import { emailService } from '../services/emailService.js'

/**
 * Helper para responder JSON
 */
function json(res: http.ServerResponse, status: number, data: any) {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(data))
}

/**
 * Handler para o Portal do Assinante
 */
export async function handleSupportPortal(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  auth: { userId: string; tenantId: string }
): Promise<void> {
  const url = req.url || ''
  const method = req.method

  // GET /api/support/categories
  if (url === '/api/support/categories' && method === 'GET') {
    const { data, error } = await supabaseAdmin
      .from('ticket_categories')
      .select('*')
      .eq('active', true)
      .order('name')
    if (error) return json(res, 500, { error: error.message })
    return json(res, 200, data)
  }

  // GET /api/support/tickets (listagem)
  if (url === '/api/support/tickets' && method === 'GET') {
    const { data, error } = await supabaseAdmin
      .from('support_tickets')
      .select('*, ticket_categories(name)')
      .eq('tenant_id', auth.tenantId)
      .order('created_at', { ascending: false })
    if (error) return json(res, 500, { error: error.message })
    return json(res, 200, data)
  }

  // POST /api/support/tickets (novo chamado)
  if (url === '/api/support/tickets' && method === 'POST') {
    let body = ''
    for await (const chunk of req) body += chunk
    const parsed = JSON.parse(body)

    if (!parsed.subject || !parsed.description) {
      return json(res, 400, { error: 'Assunto e descrição são obrigatórios' })
    }

    const priority = parsed.priority || 'medium'
    const slaDeadline = await calculateSLADeadline(auth.tenantId, priority)

    const { data: ticket, error } = await supabaseAdmin
      .from('support_tickets')
      .insert({
        tenant_id: auth.tenantId,
        created_by: auth.userId,
        subject: parsed.subject,
        description: parsed.description,
        category_id: parsed.category_id || null,
        channel: 'portal',
        priority,
        sla_deadline: slaDeadline.toISOString()
      })
      .select()
      .single()

    if (error) return json(res, 500, { error: error.message })

    // Log de auditoria inicial
    await supabaseAdmin.from('ticket_audit_log').insert({
      ticket_id: ticket.id,
      action: 'created',
      actor_id: auth.userId,
      actor_role: 'tenant_user'
    })

    // Envia e-mail de confirmação ao criador do ticket
    supabaseAdmin.auth.admin.getUserById(auth.userId).then((res: any) => {
      const email = res.data?.user?.email
      if (email) {
        emailService.sendTicketCreatedEmail(email, ticket).catch((err: any) => {
          logger.error('Erro ao enviar e-mail de chamado criado', { ticketId: ticket.id, err })
        })
      }
    }).catch((err: any) => {
      logger.error('Erro ao obter usuário para envio de e-mail de ticket', { userId: auth.userId, err })
    })

    // Dispara Triagem Assíncrona
    supportAITriageService.triage(ticket.id).catch(err => {
      logger.error('Erro na triagem automática', { ticketId: ticket.id, err })
    })

    return json(res, 201, ticket)
  }

  // GET /api/support/tickets/:id
  if (url.startsWith('/api/support/tickets/') && method === 'GET') {
    const id = url.split('/').pop()
    const { data: ticket, error } = await supabaseAdmin
      .from('support_tickets')
      .select('*, ticket_categories(name), ticket_messages(*)')
      .eq('id', id)
      .eq('tenant_id', auth.tenantId)
      .single()

    if (error) return json(res, 404, { error: 'Ticket não encontrado' })
    
    // Ordenar mensagens
    if (ticket.ticket_messages) {
      ticket.ticket_messages.sort((a: any, b: any) => 
        new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      )
    }

    return json(res, 200, ticket)
  }

  // POST /api/support/tickets/:id/messages
  if (url.match(/\/api\/support\/tickets\/.*\/messages/) && method === 'POST') {
    const id = url.split('/')[4]
    let body = ''
    for await (const chunk of req) body += chunk
    const parsed = JSON.parse(body)

    if (!parsed.body) return json(res, 400, { error: 'Mensagem vazia' })

    // Verifica se o ticket pertence ao tenant
    const { data: ticket } = await supabaseAdmin
      .from('support_tickets')
      .select('id, status')
      .eq('id', id)
      .eq('tenant_id', auth.tenantId)
      .single()

    if (!ticket) return json(res, 404, { error: 'Ticket não encontrado' })

    const { data: msg, error } = await supabaseAdmin
      .from('ticket_messages')
      .insert({
        ticket_id: id,
        author_id: auth.userId,
        author_role: 'tenant_user',
        body: parsed.body
      })
      .select()
      .single()

    if (error) return json(res, 500, { error: error.message })

    // Se o ticket estava resolvido/fechado, reabre
    if (['resolved', 'closed', 'ai_resolved'].includes(ticket.status)) {
      await supabaseAdmin.from('support_tickets')
        .update({ status: 'reopened', updated_at: new Date().toISOString() })
        .eq('id', id)
      
      await supabaseAdmin.from('ticket_audit_log').insert([
        {
          ticket_id: id,
          action: 'reopened',
          actor_id: auth.userId,
          actor_role: 'tenant_user'
        },
        {
          ticket_id: id,
          action: 'status_changed',
          from_value: ticket.status,
          to_value: 'reopened',
          actor_id: auth.userId,
          actor_role: 'tenant_user'
        }
      ])
    } else {
      // Apenas atualiza o timestamp do ticket
      await supabaseAdmin.from('support_tickets')
        .update({ updated_at: new Date().toISOString() })
        .eq('id', id)
    }

    return json(res, 201, msg)
  }

  // POST /api/support/tickets/:id/rate (CSAT)
  if (url.match(/\/api\/support\/tickets\/.*\/rate/) && method === 'POST') {
    const id = url.split('/')[4]
    let body = ''
    for await (const chunk of req) body += chunk
    const parsed = JSON.parse(body)

    if (!parsed.score) return json(res, 400, { error: 'Score obrigatório' })

    const { error } = await supabaseAdmin
      .from('support_tickets')
      .update({
        csat_score: parsed.score,
        csat_comment: parsed.comment || null,
        csat_at: new Date().toISOString()
      })
      .eq('id', id)
      .eq('tenant_id', auth.tenantId)

    if (error) return json(res, 500, { error: error.message })

    await supabaseAdmin.from('ticket_audit_log').insert({
      ticket_id: id,
      action: 'csat_rated',
      actor_id: auth.userId,
      actor_role: 'tenant_user',
      to_value: parsed.score.toString()
    })

    return json(res, 200, { ok: true })
  }

  json(res, 404, { error: 'Rota de suporte não encontrada' })
}
