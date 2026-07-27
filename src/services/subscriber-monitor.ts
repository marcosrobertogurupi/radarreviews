// Agente de Monitoramento de Assinantes e Classificação Rigorosa de Reviews
//
// Responsabilidades:
// 1. Monitorar continuamente todas as contas de assinantes ativas
// 2. Realizar classificação e auditoria rigorosa de reviews críticos (sentimento, score, risco legal)
// 3. Garantir a criação incondicional de alert_events pendentes (notified: false) para cada review crítico
// 4. Disparar e-mails de alerta em tempo hábil para o administrador do assinante

import { supabase } from '../lib/supabase.js'
import { logger } from '../lib/logger.js'
import { emailService } from './emailService.js'

export interface SubscriberAuditResult {
  tenants_audited: number
  reviews_checked: number
  critical_reviews_found: number
  missing_alerts_created: number
  emails_sent: number
}

/**
 * Executa a auditoria e monitoramento de assinantes.
 * Pode ser chamado periodicamente pelo scheduler ou manualmente via API.
 */
export async function runSubscriberMonitorJob(): Promise<SubscriberAuditResult> {
  logger.info('[subscriber-monitor] Iniciando ciclo do Agente de Monitoramento de Assinantes...')

  const stats: SubscriberAuditResult = {
    tenants_audited: 0,
    reviews_checked: 0,
    critical_reviews_found: 0,
    missing_alerts_created: 0,
    emails_sent: 0,
  }

  try {
    // 1. Buscar todos os tenants ativos
    const { data: tenants, error: tenantErr } = await supabase
      .from('tenants')
      .select('id, name, admin_email, is_active')
      .eq('is_active', true)

    if (tenantErr || !tenants) {
      logger.error('[subscriber-monitor] Erro ao buscar tenants', { error: tenantErr?.message })
      return stats
    }

    stats.tenants_audited = tenants.length

    for (const tenant of tenants) {
      // Obter e-mail de notificação do assinante
      let adminEmail = tenant.admin_email

      if (!adminEmail) {
        // Fallback: buscar em tenant_users
        const { data: tu } = await supabase
          .from('tenant_users')
          .select('email')
          .eq('tenant_id', tenant.id)
          .limit(1)
          .single()
        if (tu?.email) adminEmail = tu.email
      }

      // Buscar empresas do tenant
      const { data: businesses } = await supabase
        .from('monitored_businesses')
        .select('id, name')
        .eq('tenant_id', tenant.id)

      if (!businesses || businesses.length === 0) continue

      const bizIds = businesses.map(b => b.id)

      // 2. Buscar reviews dos últimos 30 dias para as empresas do tenant
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
      const { data: reviews, error: revErr } = await supabase
        .from('reviews')
        .select('*')
        .in('business_id', bizIds)
        .gte('published_at', thirtyDaysAgo)

      if (revErr || !reviews) continue

      stats.reviews_checked += reviews.length

      // 3. Identificar reviews críticos
      const criticalReviews = reviews.filter(r => {
        const isCriticalSentiment = r.sentiment === 'critical'
        const isHighScore = (r.dissatisfaction_score ?? 0) >= 80
        const isFormalComplaint = r.channel === 'reclame_aqui' || r.channel === 'consumidor_gov'
        const isLowRating = r.rating !== null && r.rating !== undefined && r.rating <= 2
        return isCriticalSentiment || isHighScore || isFormalComplaint || isLowRating
      })

      stats.critical_reviews_found += criticalReviews.length

      if (criticalReviews.length === 0) continue

      // Buscar alertas existentes para as empresas do tenant
      const { data: existingAlerts } = await supabase
        .from('alert_events')
        .select('id, detail, business_id')
        .in('business_id', bizIds)

      const alertedExtIds = new Set<string>()
      for (const alert of existingAlerts ?? []) {
        const extId = (alert.detail as any)?.review_external_id || (alert.detail as any)?.external_id
        if (extId) alertedExtIds.add(extId)
      }

      // Buscar ou criar regra de alerta crítica para o tenant
      const { data: rules } = await supabase
        .from('alert_rules')
        .select('id, business_id')
        .eq('tenant_id', tenant.id)
        .eq('condition_type', 'critical_review')
        .limit(1)

      let criticalRuleId = rules?.[0]?.id

      if (!criticalRuleId) {
        const { data: createdRule } = await supabase
          .from('alert_rules')
          .insert({
            tenant_id: tenant.id,
            business_id: bizIds[0],
            name: 'Avaliação Crítica (IA)',
            condition_type: 'critical_review',
            threshold: 80,
            notify_email: true,
            is_active: true
          })
          .select('id')
          .single()

        criticalRuleId = createdRule?.id
      }

      // 4. Processar reviews críticos que não possuem alert_event
      for (const review of criticalReviews) {
        if (alertedExtIds.has(review.external_id)) continue

        logger.warn('[subscriber-monitor] Review crítico sem alerta detectado! Criando alerta agora...', {
          tenant_id: tenant.id,
          tenant_name: tenant.name,
          external_id: review.external_id,
          channel: review.channel,
          sentiment: review.sentiment
        })

        const urgencyLevel = review.sentiment === 'critical' || (review.dissatisfaction_score ?? 0) >= 80 ? 'urgente' : 'atencao'

        const { data: newAlert, error: alertInsertErr } = await supabase
          .from('alert_events')
          .insert({
            rule_id: criticalRuleId,
            business_id: review.business_id,
            channel: review.channel,
            triggered_at: review.published_at || new Date().toISOString(),
            notified: false, // Mantém PENDENTE no portal do cliente
            detail: {
              condition_type: 'critical_review',
              triggered_by_rule: 'Agente de Monitoramento de Assinantes (Reputei)',
              review_external_id: review.external_id,
              review_channel: review.channel,
              review_rating: review.rating,
              review_sentiment: review.sentiment,
              review_dissatisfaction_score: review.dissatisfaction_score,
              review_body_preview: review.body?.slice(0, 300),
              review_author: review.author_name,
              review_url: review.url,
              review_published_at: review.published_at,
              sentiment_summary: review.sentiment_summary || review.title || 'Review crítico detectado pelo monitor',
              alert_reason: review.sentiment_result?.alert_reason || 'Atenção urgente exigida: responder ao cliente o quanto antes.',
              urgency_level: urgencyLevel,
              is_legal_risk: review.channel === 'reclame_aqui' || review.channel === 'consumidor_gov' || urgencyLevel === 'urgente'
            }
          })
          .select()
          .single()

        if (!alertInsertErr && newAlert) {
          stats.missing_alerts_created++
          alertedExtIds.add(review.external_id)

          // Disparar notificação por e-mail para o admin do assinante
          if (adminEmail) {
            try {
              await emailService.sendReviewAlertEmail(adminEmail, review, 'Avaliação Crítica Detectada')
              stats.emails_sent++
              logger.info('[subscriber-monitor] E-mail enviado com sucesso pelo Agente', { recipient: adminEmail, review_id: review.external_id })
            } catch (mailErr) {
              logger.error('[subscriber-monitor] Erro ao enviar e-mail de alerta', { adminEmail, error: mailErr })
            }
          }
        }
      }
    }

    logger.info('[subscriber-monitor] Ciclo do Agente concluído com sucesso', { ...stats })
  } catch (error) {
    logger.error('[subscriber-monitor] Erro durante o monitoramento de assinantes', {
      error: error instanceof Error ? error.message : String(error)
    })
  }

  return stats
}
