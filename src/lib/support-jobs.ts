import { supabaseAdmin } from './supabase.js'
import { logger } from './logger.js'
import { knowledgeLearningService } from '../services/knowledgeLearningService.js'

/**
 * Monitoramento de SLA
 * Busca tickets abertos que passaram do prazo e marca como breached.
 */
export async function checkSLA(): Promise<void> {
  const now = new Date().toISOString()
  
  const { data: tickets, error } = await supabaseAdmin
    .from('support_tickets')
    .select('id, ticket_number, tenant_id')
    .eq('is_sla_breached', false)
    .not('status', 'in', '("resolved","closed","ai_resolved")')
    .lt('sla_deadline', now)

  if (error || !tickets?.length) return

  logger.info(`[support-jobs] SLA violado em ${tickets.length} tickets`)

  for (const ticket of tickets) {
    await supabaseAdmin
      .from('support_tickets')
      .update({ is_sla_breached: true })
      .eq('id', ticket.id)

    await supabaseAdmin.from('ticket_audit_log').insert({
      ticket_id: ticket.id,
      action: 'sla_breached',
      actor_role: 'system',
      metadata: { deadline_at: now }
    })

    // Opcional: Notificar Slack/Webhook de escalação aqui
  }
}

/**
 * Aprendizado contínuo
 * Processa a fila de extração de conhecimento.
 */
export async function runKnowledgeLearningJob(): Promise<void> {
  logger.info('[support-jobs] Iniciando ciclo de aprendizado da KB')
  await knowledgeLearningService.processQueue(5)
}

/**
 * Encerramento por inatividade
 * Fecha tickets em status 'waiting_tenant' ou 'resolved' (não fechados) após 48h sem mensagens.
 */
export async function checkSupportInactivity(): Promise<void> {
  const cutoff = new Date(Date.now() - 48 * 3600_000).toISOString()
  
  const { data: tickets, error } = await supabaseAdmin
    .from('support_tickets')
    .select('id, status')
    .in('status', ['waiting_tenant', 'resolved', 'ai_resolved'])
    .lt('updated_at', cutoff)

  if (error || !tickets?.length) return

  logger.info(`[support-jobs] Fechando ${tickets.length} tickets por inatividade`)

  for (const ticket of tickets) {
    await supabaseAdmin
      .from('support_tickets')
      .update({ 
        status: 'closed',
        closed_at: new Date().toISOString()
      })
      .eq('id', ticket.id)

    await supabaseAdmin.from('ticket_audit_log').insert({
      ticket_id: ticket.id,
      action: 'closed',
      actor_role: 'system',
      metadata: { reason: 'Inatividade > 48h' }
    })
  }
}
