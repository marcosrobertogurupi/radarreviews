import { supabase } from './supabase.js'

export interface UsageLog {
  tenant_id: string
  connector_id?: string
  service_name: string
  operation_type: string
  units_consumed: number
  estimated_cost_brl: number
}

/**
 * Registra o consumo de uma API no banco de dados e verifica limites de alerta.
 */
export async function logApiUsage(log: UsageLog) {
  try {
    const { error } = await supabase
      .from('api_usage_logs')
      .insert({
        tenant_id:          log.tenant_id,
        connector_id:       log.connector_id,
        service_name:       log.service_name,
        operation_type:     log.operation_type,
        units_consumed:     log.units_consumed,
        estimated_cost_brl: log.estimated_cost_brl
      })

    if (error) throw error

    // Monitoramento imediato (simplificado)
    // Em produção, isso seria um job de fundo para não travar a API
    checkUsageAlerts(log.tenant_id).catch(err => console.error('[Usage] Erro ao verificar alertas:', err))

  } catch (err) {
    console.error('[Usage] Falha ao logar consumo:', err)
  }
}

/**
 * Verifica se o consumo mensal do tenant ultrapassou 50% do valor da assinatura.
 */
async function checkUsageAlerts(tenantId: string) {
  // 1. Pegar o valor do plano do tenant
  const { data: tenant } = await supabase
    .from('tenants')
    .select('id, name, plan, last_usage_alert_at')
    .eq('id', tenantId)
    .single()

  if (!tenant) return

  // 1.5. Buscar preços de todos os planos para referência
  const { data: plans } = await supabase
    .from('plans')
    .select('slug, price_monthly')

  const planPrices: Record<string, number> = {}
  if (plans) {
    plans.forEach(p => {
      planPrices[p.slug] = Number(p.price_monthly)
    })
  }

  const planBasePrice = planPrices[tenant.plan] || 139

  if (planBasePrice === 0) return

  // 2. Calcular consumo do mês atual
  const startOfMonth = new Date()
  startOfMonth.setDate(1)
  startOfMonth.setHours(0, 0, 0, 0)

  const { data: usage } = await supabase
    .from('api_usage_logs')
    .select('estimated_cost_brl')
    .eq('tenant_id', tenantId)
    .gte('created_at', startOfMonth.toISOString())

  const totalConsumed = (usage || []).reduce((sum, item) => sum + Number(item.estimated_cost_brl), 0)

  // 3. Se consumo > 50% do plano, disparar alerta no sistema
  if (totalConsumed > (planBasePrice * 0.5)) {
    // Evitar spam de alertas (máximo 1 a cada 24h)
    const lastAlert = tenant.last_usage_alert_at ? new Date(tenant.last_usage_alert_at) : new Date(0)
    const hoursSinceLast = (Date.now() - lastAlert.getTime()) / (1000 * 60 * 60)

    if (hoursSinceLast > 24) {
      console.log(`[Usage Alert] Tenant ${tenant.name} consumiu R$ ${totalConsumed.toFixed(2)} (> 50% de R$ ${planBasePrice})`)
      
      await supabase.from('system_notifications').insert({
        tenant_id: tenantId,
        type: 'usage_limit_warning',
        message: `ALERTA DE CONSUMO: O cliente ${tenant.name} atingiu R$ ${totalConsumed.toFixed(2)} em custos de API este mês, o que supera 50% do valor da assinatura (R$ ${planBasePrice}).`,
        status: 'pendente',
        payload: { totalConsumed, planBasePrice, threshold: 0.5 }
      })

      await supabase
        .from('tenants')
        .update({ last_usage_alert_at: new Date().toISOString() })
        .eq('id', tenantId)
    }
  }
}
