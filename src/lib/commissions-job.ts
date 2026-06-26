import { supabase } from './supabase.js'
import { logger } from './logger.js'

/**
 * Job mensal recorrente para gerar comissões para parceiros ativos baseados
 * nos planos de seus clientes ativos.
 */
export async function runCommissionsJob(): Promise<void> {
  const now = new Date()
  const referenceMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`

  logger.info(`[commissions-job] Iniciando processamento de comissões recorrentes para ${referenceMonth}`)

  try {
    // 1. Buscar todos os tenants ativos vinculados a parceiros
    const { data: tenants, error: tenantsErr } = await supabase
      .from('tenants')
      .select(`
        id,
        name,
        plan,
        partner_id,
        partners (
          id,
          commission_recurring_rate,
          tier
        )
      `)
      .eq('is_active', true)
      .not('partner_id', 'is', null)

    if (tenantsErr) {
      throw tenantsErr
    }

    if (!tenants || tenants.length === 0) {
      logger.info('[commissions-job] Nenhum tenant ativo vinculado a parceiro encontrado.')
      return
    }

    // 2. Buscar planos ativos para mapear valores e nomes
    const { data: plans, error: plansErr } = await supabase
      .from('plans')
      .select('slug, name, price_monthly')

    if (plansErr) {
      throw plansErr
    }

    const plansMap = new Map<string, { name: string; price: number }>()
    if (plans) {
      for (const p of plans) {
        plansMap.set(p.slug, { name: p.name, price: Number(p.price_monthly) })
      }
    }

    for (const tenant of tenants) {
      try {
        const partner = tenant.partners as any
        if (!partner) continue

        const planSlug = tenant.plan
        const planInfo = plansMap.get(planSlug) || { name: planSlug, price: 0 }

        // O valor da taxa de comissão
        const recurringRate = partner.commission_recurring_rate || 10.00 // fallback bronze

        // 3. Verificar se já existe comissão recorrente para este parceiro + tenant + mês de referência
        const { data: existing, error: existErr } = await supabase
          .from('commissions')
          .select('id')
          .eq('partner_id', partner.id)
          .eq('tenant_id', tenant.id)
          .eq('reference_month', referenceMonth)
          .eq('is_setup', false)
          .maybeSingle()

        if (existErr) {
          logger.error(`[commissions-job] Erro ao verificar comissão existente para tenant ${tenant.id}:`, { error: existErr as any })
          continue
        }

        if (existing) {
          logger.debug(`[commissions-job] Comissão recorrente já gerada para tenant ${tenant.name} (${referenceMonth})`)
          continue
        }

        // 4. Inserir registro de comissão
        const { error: insertErr } = await supabase
          .from('commissions')
          .insert({
            partner_id: partner.id,
            tenant_id: tenant.id,
            reference_month: referenceMonth,
            plan_name: planInfo.name,
            plan_value: planInfo.price,
            is_setup: false,
            commission_rate: recurringRate,
            status: 'pending'
          })

        if (insertErr) {
          logger.error(`[commissions-job] Erro ao salvar comissão para tenant ${tenant.name}:`, { error: insertErr as any })
        } else {
          logger.info(`[commissions-job] Comissão recorrente de R$ ${(planInfo.price * recurringRate / 100).toFixed(2)} gerada para ${tenant.name}`)
        }
      } catch (err: any) {
        logger.error(`[commissions-job] Falha ao processar comissão para tenant ${tenant.name}:`, { error: err })
      }
    }

    logger.info(`[commissions-job] Processamento concluído para ${referenceMonth}`)
  } catch (err: any) {
    logger.error('[commissions-job] Erro geral no job de comissões:', { error: err })
  }
}
