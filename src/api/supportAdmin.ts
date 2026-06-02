import http from 'node:http'
import { supabaseAdmin } from '../lib/supabase.js'
import { logger } from '../lib/logger.js'

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

  // PATCH /api/admin/support/tickets/:id (atribuição, status, etc)
  if (url.startsWith('/api/admin/support/tickets/') && method === 'PATCH') {
    const id = url.split('/').pop()
    let body = ''
    for await (const chunk of req) body += chunk
    const parsed = JSON.parse(body)

    const { data: oldTicket } = await supabaseAdmin
      .from('support_tickets')
      .select('status, assigned_to, priority')
      .eq('id', id)
      .single()
    
    if (!oldTicket) {
      return json(res, 404, { error: 'Ticket original não encontrado' })
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
    }
    if (parsed.assigned_to && parsed.assigned_to !== oldTicket.assigned_to) {
      auditEntries.push({ ticket_id: id, action: 'assigned', to_value: parsed.assigned_to, actor_id: auth.userId, actor_role: 'agent' })
    }

    if (auditEntries.length > 0) {
      await supabaseAdmin.from('ticket_audit_log').insert(auditEntries)
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
    const id = url.split('/').pop()
    let body = ''
    for await (const chunk of req) body += chunk
    const parsed = JSON.parse(body)

    const { data: doc, error } = await supabaseAdmin
      .from('support_knowledge_docs')
      .update({
        ...parsed,
        reviewed_by: auth.userId,
        reviewed_at: parsed.status === 'active' ? new Date().toISOString() : null
      })
      .eq('id', id)
      .select()
      .single()

    if (error) return json(res, 500, { error: error.message })
    return json(res, 200, doc)
  }

  json(res, 404, { error: 'Rota admin de suporte não encontrada' })
}
