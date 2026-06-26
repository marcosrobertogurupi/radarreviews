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
    .select('id, ticket_number, tenant_id, priority, escalation_level, status')
    .eq('is_sla_breached', false)
    .not('status', 'in', '("resolved","closed","ai_resolved")')
    .lt('sla_deadline', now)

  if (error || !tickets?.length) return

  logger.info(`[support-jobs] SLA violado em ${tickets.length} tickets`)

  for (const ticket of tickets) {
    // 1. Obter o plano do tenant
    const { data: tenant } = await supabaseAdmin
      .from('tenants')
      .select('plan')
      .eq('id', ticket.tenant_id)
      .single()

    let planId: string | null = null
    if (tenant?.plan) {
      const { data: plan } = await supabaseAdmin
        .from('plans')
        .select('id')
        .eq('slug', tenant.plan)
        .maybeSingle()
      if (plan) planId = plan.id
    }

    // 2. Buscar a regra de SLA específica do plano ou fallback
    let { data: rule } = await supabaseAdmin
      .from('ticket_sla_rules')
      .select('escalation_level')
      .eq('priority', ticket.priority)
      .eq('plan_id', planId)
      .maybeSingle()

    if (!rule && planId !== null) {
      const { data: defaultRule } = await supabaseAdmin
        .from('ticket_sla_rules')
        .select('escalation_level')
        .eq('priority', ticket.priority)
        .is('plan_id', null)
        .maybeSingle()
      rule = defaultRule
    }

    const nextEscalationLevel = Math.max(ticket.escalation_level ?? 0, rule?.escalation_level ?? 1)

    await supabaseAdmin
      .from('support_tickets')
      .update({
        is_sla_breached: true,
        status: 'escalated',
        escalation_level: nextEscalationLevel,
        updated_at: new Date().toISOString()
      })
      .eq('id', ticket.id)

    await supabaseAdmin.from('ticket_audit_log').insert([
      {
        ticket_id: ticket.id,
        action: 'sla_breached',
        actor_role: 'system',
        metadata: { deadline_at: now }
      },
      {
        ticket_id: ticket.id,
        action: 'status_changed',
        from_value: ticket.status,
        to_value: 'escalated',
        actor_role: 'system'
      },
      {
        ticket_id: ticket.id,
        action: 'escalated',
        actor_role: 'system',
        to_value: nextEscalationLevel.toString()
      }
    ])

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

    await knowledgeLearningService.queueTicket(ticket.id)
  }
}
