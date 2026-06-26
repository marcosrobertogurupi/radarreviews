import { supabaseAdmin } from './supabase.js'

export const VALID_TRANSITIONS: Record<string, string[]> = {
  open: ['ai_triaged', 'in_progress', 'waiting_tenant', 'escalated', 'resolved', 'closed', 'ai_responding', 'needs_human', 'learning'],
  ai_triaged: ['in_progress', 'waiting_tenant', 'escalated', 'resolved', 'closed', 'ai_responding', 'needs_human'],
  in_progress: ['waiting_tenant', 'escalated', 'resolved', 'closed'],
  waiting_tenant: ['in_progress', 'escalated', 'resolved', 'closed'],
  escalated: ['in_progress', 'waiting_tenant', 'resolved', 'closed'],
  resolved: ['closed', 'reopened'],
  ai_resolved: ['closed', 'reopened'],
  closed: ['reopened'],
  reopened: ['in_progress', 'waiting_tenant', 'escalated', 'resolved', 'closed'],
  ai_responding: ['ai_resolved', 'needs_human', 'resolved', 'closed'],
  needs_human: ['in_progress', 'escalated', 'resolved', 'closed'],
  learning: ['closed']
}

export function isValidTransition(from: string, to: string): boolean {
  if (from === to) return true
  const allowed = VALID_TRANSITIONS[from]
  return allowed ? allowed.includes(to) : false
}

export async function calculateSLADeadline(
  tenantId: string,
  priority: 'low' | 'medium' | 'high' | 'critical',
  createdAt: Date = new Date()
): Promise<Date> {
  // 1. Obter o plano do tenant
  const { data: tenant } = await supabaseAdmin
    .from('tenants')
    .select('plan')
    .eq('id', tenantId)
    .single()

  let planId: string | null = null

  if (tenant?.plan) {
    // Buscar o ID do plano pelo slug
    const { data: plan } = await supabaseAdmin
      .from('plans')
      .select('id')
      .eq('slug', tenant.plan)
      .maybeSingle()
    
    if (plan) {
      planId = plan.id
    }
  }

  // 2. Buscar a regra de SLA específica do plano
  let { data: rule } = await supabaseAdmin
    .from('ticket_sla_rules')
    .select('resolution_mins')
    .eq('priority', priority)
    .eq('plan_id', planId)
    .maybeSingle()

  // 3. Fallback para a regra padrão (plan_id IS NULL)
  if (!rule && planId !== null) {
    const { data: defaultRule } = await supabaseAdmin
      .from('ticket_sla_rules')
      .select('resolution_mins')
      .eq('priority', priority)
      .is('plan_id', null)
      .maybeSingle()
    rule = defaultRule
  }

  const mins = rule?.resolution_mins ?? 2880 // 48h de fallback
  return new Date(createdAt.getTime() + mins * 60 * 1000)
}
