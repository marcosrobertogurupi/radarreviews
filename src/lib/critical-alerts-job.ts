import { supabase } from './supabase.js'
import { logger } from './logger.js'
import axios from 'axios'

/**
 * Job que verifica reviews críticos não resolvidos e dispara alertas atrasados (Fluxo 1).
 * Compara o tempo de publicação com o critical_alert_hours configurado no tenant.
 */
export async function checkCriticalAlerts(): Promise<void> {
  const webhookUrl = process.env['N8N_CRITICAL_ALERTS_WEBHOOK']
  if (!webhookUrl) {
    logger.debug('[critical-alerts] N8N_CRITICAL_ALERTS_WEBHOOK não configurado. Pulando.')
    return
  }

  logger.info('[critical-alerts] Iniciando verificação de reviews críticos atrasados...')

  // 1. Buscar reviews críticos, não resolvidos e que ainda não foram notificados via delayed alert
  // Unimos com monitored_businesses e tenants para pegar as regras de tempo e contatos
  const { data: pendingReviews, error } = await supabase
    .from('reviews')
    .select(`
      *,
      monitored_businesses!inner (
        name,
        tenants!inner (
          id,
          name,
          admin_whatsapp,
          admin_email,
          critical_alert_hours
        )
      )
    `)
    .eq('sentiment', 'critical')
    .eq('is_resolved', false)
    // Filtro para excluir reviews que já estão no log de notificados
    // Como o Supabase/PostgREST não suporta NOT EXISTS facilmente em uma query simples,
    // vamos buscar todos e filtrar os já notificados comparando com a tabela reviews_notified_log
    .order('published_at', { ascending: true })

  if (error) {
    logger.error('[critical-alerts] Erro ao buscar reviews críticos', { error: error.message })
    return
  }

  if (!pendingReviews || pendingReviews.length === 0) return

  // 2. Buscar IDs de reviews já notificados para evitar spam
  const { data: alreadyNotified } = await supabase
    .from('reviews_notified_log')
    .select('review_id')

  const notifiedIds = new Set((alreadyNotified || []).map(n => n.review_id))

  const now = new Date()
  let dispatchedCount = 0

  for (const review of pendingReviews as any[]) {
    if (notifiedIds.has(review.id)) continue

    const tenant = review.monitored_businesses.tenants
    const alertHours = tenant.critical_alert_hours || 24 // Default 24h
    const publishedAt = new Date(review.published_at)
    
    // Calcular quantas horas se passaram desde a publicação
    const diffMs = now.getTime() - publishedAt.getTime()
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60))

    // 3. Se passou do tempo limite, dispara o alerta
    if (diffHours >= alertHours) {
      dispatchedCount++
      
      const payload = {
        event_id: `alert-${review.id}`,
        tenant_name: review.monitored_businesses.name,
        admin_whatsapp: tenant.admin_whatsapp || '',
        admin_email: tenant.admin_email || '',
        hours_without_action: diffHours,
        alert_reason: review.sentiment_result?.alert_reason || 'Reclamação crítica pendente de resolução.',
        review_author: review.author_name || 'Anônimo',
        review_channel: review.channel,
        review_published_at: review.published_at,
        triggered_at: now.toISOString(),
        sentiment_summary: review.sentiment_summary || '',
        review_body_preview: review.body?.slice(0, 500) || '',
        review_url: review.url || ''
      }

      try {
        await axios.post(webhookUrl, payload, { timeout: 10000 })
        
        // 4. Registrar no log de notificações para não repetir
        await supabase.from('reviews_notified_log').insert({
          review_id: review.id,
          tenant_id: tenant.id
        })

        logger.info('[critical-alerts] Alerta disparado para n8n', { 
          review_id: review.id, 
          tenant: tenant.name,
          delay: `${diffHours}h`
        })
      } catch (err) {
        logger.warn('[critical-alerts] Falha ao enviar alerta para n8n', {
          review_id: review.id,
          error: err instanceof Error ? err.message : String(err)
        })
      }
    }
  }

  if (dispatchedCount > 0) {
    logger.info(`[critical-alerts] Ciclo concluído. ${dispatchedCount} alertas enviados.`)
  }
}
