// Sistema de alertas — verifica regras configuradas por tenant após cada sync
//
// Fluxo:
// 1. Busca regras de alerta ativas para a empresa/canal
// 2. Para cada review novo, avalia as condições
// 3. Cria alert_events para regras disparadas
// 4. Dispara notificação via webhook (se configurado)
//
// Tipos de condição suportados:
// - 'rating_drop'       : review com rating <= threshold (ex: 2 estrelas ou menos)
// - 'negative_surge'    : sentimento negative ou critical detectado pela IA
// - 'critical_review'   : score de insatisfação >= 81 (cliente furioso)
// - 'keyword'           : review contém palavra-chave monitorada
// - 'topic_billing'     : IA detectou tópicos financeiros (cobrança, reembolso)
// - 'reclame_aqui_new'  : qualquer review novo no Reclame Aqui (sempre crítico)
// - 'volume_spike'      : (+N reviews negativos em X horas) — Fase 5

import { supabase } from './supabase.js'
import { logger } from './logger.js'
import axios from 'axios'
import type { NormalizedReview, SourceChannel } from '../types/review.js'
import { emailService } from '../services/emailService.js'

interface AlertRule {
  id: string
  tenant_id: string
  business_id: string | null
  name: string
  channel: SourceChannel | null     // null = todos os canais
  condition_type: string
  threshold: number | null
  keywords: string[] | null
  urgency_level?: 'urgente' | 'atencao' | 'informativo'
  risk_keywords?: string[]
  notify_email: boolean
  notify_webhook: string | null
  is_active: boolean
}

const DEFAULT_RISK_KEYWORDS = ['PROCON', 'processo', 'advogado', 'IDEC', 'Juizado Especial', 'denúncia', 'justiça'];

/**
 * Verifica regras de alerta para um conjunto de reviews novos.
 * Chamado automaticamente pelo pipeline de ingestão após cada sync.
 *
 * @param reviews  - Reviews recém-inseridos (já são novos — nunca vistos antes)
 * @param businessId - UUID da empresa monitorada
 * @param channel  - Canal de origem
 */
export async function checkAlerts(
  reviews: NormalizedReview[],
  businessId: string,
  channel: SourceChannel
): Promise<void> {
  // Buscar regras de alerta ativas para esta empresa ou globais do tenant
  const { data: rules, error } = await supabase
    .from('alert_rules')
    .select('*')
    .eq('is_active', true)
    .or(`business_id.eq.${businessId},business_id.is.null`)

  if (error) {
    logger.warn('[alerts] Falha ao buscar regras de alerta', {
      business_id: businessId,
      error: error.message,
    })
  }

  let activeRules = ((rules as AlertRule[]) ?? []).filter(
    r => !r.channel || r.channel === channel
  )

  // Se não existirem regras para a empresa/tenant, garantir regra padrão de Critical Review
  if (activeRules.length === 0 && reviews.length > 0) {
    const tenantId = reviews[0]?.tenant_id
    if (tenantId) {
      const { data: newRule } = await supabase
        .from('alert_rules')
        .insert({
          tenant_id: tenantId,
          business_id: businessId,
          name: 'Sentimento Crítico (IA)',
          condition_type: 'critical_review',
          threshold: 80,
          notify_email: true,
          is_active: true
        })
        .select()
        .single()

      if (newRule) {
        activeRules = [newRule as AlertRule]
      }
    }
  }

  // ── Cálculo de volume_spike e negative_surge ──
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const { data: dbRecent } = await supabase
    .from('reviews')
    .select('external_id, sentiment')
    .eq('business_id', businessId)
    .gte('published_at', oneDayAgo)

  const newExternalIds = new Set(reviews.map(r => r.external_id))
  
  // Excluir os reviews novos que já foram inseridos no banco para evitar double counting
  const dbRecentCount = dbRecent?.filter(r => !newExternalIds.has(r.external_id)).length ?? 0
  const dbRecentNegativeCount = dbRecent?.filter(r => !newExternalIds.has(r.external_id) && (r.sentiment === 'negative' || r.sentiment === 'critical')).length ?? 0

  // Contar quantos reviews novos estão dentro da janela de 24h
  const newRecentReviews = reviews.filter(r => r.published_at >= oneDayAgo)
  const newRecentCount = newRecentReviews.length
  const newRecentNegativeCount = newRecentReviews.filter(r => r.sentiment === 'negative' || r.sentiment === 'critical').length

  const recentCount = dbRecentCount + newRecentCount
  const recentNegativeCount = dbRecentNegativeCount + newRecentNegativeCount

  // ── Buscar estatísticas diárias históricas (últimos 30 dias) para cálculo de limiares dinâmicos ──
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]!
  const { data: dailyStats } = await supabase
    .from('review_stats_daily')
    .select('channel, total_reviews, negative_count, date')
    .eq('business_id', businessId)
    .gte('date', thirtyDaysAgo)

  const triggeredRules = new Set<string>()
  const triggeredReviews = new Set<string>()

  // Para cada combinação (review × regra), verificar se deve disparar
  const events: Array<{
    rule_id: string
    business_id: string
    channel: SourceChannel
    detail: Record<string, unknown>
  }> = []

  for (const review of reviews) {
    for (const rule of activeRules) {
      if (triggeredReviews.has(review.external_id)) continue
      if (triggeredRules.has(rule.id)) continue

      // Calcular a média diária histórica baseada na regra
      const statsByDate = new Map<string, { total: number; negative: number }>()
      for (const s of dailyStats ?? []) {
        if (!rule.channel || s.channel === rule.channel) {
          const current = statsByDate.get(s.date) || { total: 0, negative: 0 }
          current.total += s.total_reviews ?? 0
          current.negative += s.negative_count ?? 0
          statsByDate.set(s.date, current)
        }
      }

      const daysCount = statsByDate.size || 1
      let totalSum = 0
      let negativeSum = 0
      for (const val of statsByDate.values()) {
        totalSum += val.total
        negativeSum += val.negative
      }

      const avgDailyTotal = totalSum / daysCount
      const avgDailyNegative = negativeSum / daysCount

      if (shouldTrigger(review, rule, recentCount, recentNegativeCount, avgDailyTotal, avgDailyNegative)) {
        const urgency = calculateUrgency(review, rule)
        events.push({
          rule_id: rule.id,
          business_id: businessId,
          channel,
          detail: {
            ...buildAlertDetail(review, rule),
            urgency_level: urgency,
            is_legal_risk: urgency === 'urgente' && containsRiskKeywords(review, rule)
          },
        })
        triggeredReviews.add(review.external_id)

        if (rule.condition_type === 'volume_spike' || rule.condition_type === 'negative_surge') {
          triggeredRules.add(rule.id)
        }

        logger.info('[alerts] Alerta disparado', {
          rule_id: rule.id,
          rule_name: rule.name,
          condition: rule.condition_type,
          review_external_id: review.external_id,
          channel,
        })
      }
    }

    // ── REDE DE SEGURANÇA ABSOLUTA PARA REVIEWS CRÍTICOS ──
    // Se o review for crítico (sentiment critical, score >= 80, Reclame Aqui ou risco jurídico)
    // e NENHUMA regra customizada disparou, força a criação de um alerta para o assinante!
    const isCriticalOrSevere = review.sentiment === 'critical' ||
      (review.dissatisfaction_score ?? 0) >= 80 ||
      review.channel === 'reclame_aqui' ||
      review.channel === 'consumidor_gov'

    if (isCriticalOrSevere && !triggeredReviews.has(review.external_id)) {
      const fallbackRule = activeRules[0]
      const tenantId = review.tenant_id
      let ruleId = fallbackRule?.id

      if (!ruleId && tenantId) {
        // Obter ou criar uma regra padrão no banco
        const { data: sysRule } = await supabase
          .from('alert_rules')
          .insert({
            tenant_id: tenantId,
            business_id: businessId,
            name: 'Alerta Crítico Automático (Reputei Safety Net)',
            condition_type: 'critical_review',
            threshold: 80,
            notify_email: true,
            is_active: true
          })
          .select()
          .single()

        if (sysRule) ruleId = sysRule.id
      }

      if (ruleId) {
        const dummyRule: AlertRule = fallbackRule ?? {
          id: ruleId,
          tenant_id: tenantId || '',
          business_id: businessId,
          name: 'Alerta Crítico Automático (Reputei Safety Net)',
          channel: null,
          condition_type: 'critical_review',
          threshold: 80,
          keywords: null,
          notify_email: true,
          notify_webhook: null,
          is_active: true
        }

        events.push({
          rule_id: ruleId,
          business_id: businessId,
          channel,
          detail: {
            ...buildAlertDetail(review, dummyRule),
            urgency_level: 'urgente',
            is_legal_risk: containsRiskKeywords(review, dummyRule) || review.channel === 'reclame_aqui' || review.channel === 'consumidor_gov'
          }
        })
        triggeredReviews.add(review.external_id)

        logger.info('[alerts] Rede de segurança acionada: Alerta Crítico Forçado', {
          review_external_id: review.external_id,
          sentiment: review.sentiment,
          score: review.dissatisfaction_score,
          channel
        })
      }
    }
  }

  if (events.length === 0) return

  // Inserir alert_events em lote com notified: false (mantém pendente no portal para o assinante responder)
  const { data: insertedEvents, error: insertError } = await supabase
    .from('alert_events')
    .insert(events.map(e => ({ ...e, notified: false })))
    .select()

  if (insertError) {
    logger.warn('[alerts] Falha ao inserir alert_events', { error: insertError.message })
    return
  }

  if (!insertedEvents || insertedEvents.length === 0) return

  const rulesById = new Map((activeRules).map(r => [r.id, r]))

  // Obter e-mail e WhatsApp do assinante para notificação
  const tenantId = reviews[0]?.tenant_id
  const subscriberDetails = tenantId ? await getSubscriberDetails(tenantId) : { email: null, whatsapp: null }

  for (const event of insertedEvents) {
    const rule = rulesById.get(event.rule_id)
    const webhookUrl = rule?.notify_webhook || process.env['N8N_SUBSCRIBER_ALERTS_WEBHOOK']
    
    // Disparar Webhook se configurado
    if (webhookUrl && (rule?.notify_email ?? true)) {
      if (isQuietTime(rule) && (event.detail.urgency_level as string) !== 'urgente') {
        logger.info('[alerts] Alerta silenciado por Horário de Silêncio', {
          rule_id: rule?.id,
          urgency: event.detail.urgency_level,
        })
        continue
      }

      const extraData = {
        subscriber_whatsapp: subscriberDetails.whatsapp || '',
        subscriber_email: subscriberDetails.email || '',
      }

      try {
        await fireWebhook(webhookUrl, event, rule ?? {
          id: event.rule_id,
          tenant_id: tenantId ?? '',
          business_id: businessId,
          name: 'Alerta Crítico Automático',
          channel: null,
          condition_type: 'critical_review',
          threshold: 80,
          keywords: null,
          notify_email: true,
          notify_webhook: null,
          is_active: true
        }, extraData)
        
        // Atualiza apenas os metadados de envio no detail, NUNCA alterando notified para true
        await supabase
          .from('alert_events')
          .update({
            detail: {
              ...(event.detail as Record<string, unknown>),
              webhook_sent: true,
              webhook_sent_at: new Date().toISOString()
            }
          })
          .eq('id', event.id)

        logger.info('[alerts] Webhook enviado com sucesso (alerta mantido PENDENTE no portal)', { event_id: event.id })
      } catch (err) {
        logger.warn('[alerts] Falha ao disparar webhook', {
          rule_id: rule?.id,
          webhook_url: webhookUrl,
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }

    // Enviar e-mail de alerta para o administrador do assinante
    if (subscriberDetails.email) {
      const reviewExtId = (event.detail as any)?.review_external_id || (event.detail as any)?.external_id
      const matchedReview = reviews.find(r => r.external_id === reviewExtId)
      if (matchedReview) {
        await emailService.sendReviewAlertEmail(subscriberDetails.email, matchedReview, rule?.name || 'Avaliação Crítica Detectada').then(() => {
          logger.info('[alerts] E-mail de alerta enviado para o assinante', { recipient: subscriberDetails.email, review_id: matchedReview.external_id })
        }).catch(err => {
          logger.error('[alerts] Erro ao enviar e-mail de alerta', { rule_id: rule?.id, err })
        })
      }
    }
  }
}

/**
 * Busca e-mail e WhatsApp do administrador do assinante para notificações.
 */
async function getSubscriberDetails(tenantId: string): Promise<{ email: string | null; whatsapp: string | null }> {
  const { data: tenant } = await supabase
    .from('tenants')
    .select('admin_email, admin_whatsapp')
    .eq('id', tenantId)
    .single()

  let email = tenant?.admin_email ?? null
  const whatsapp = tenant?.admin_whatsapp ?? null

  if (!email) {
    const { data: user } = await supabase
      .from('tenant_users')
      .select('email')
      .eq('tenant_id', tenantId)
      .limit(1)
      .single()
    email = user?.email ?? null
  }

  return { email, whatsapp }
}


/**
 * Verifica se a hora atual está dentro do período de silêncio da regra.
 */
function isQuietTime(rule: any): boolean {
  const start = rule.quiet_hours_start ?? 22
  const end = rule.quiet_hours_end ?? 7
  
  // Se start == end, silêncio está desativado
  if (start === end) return false

  const now = new Date()
  // Ajustar para fuso horário de Brasília (UTC-3) se necessário
  // Simplificado: usa a hora local do servidor (que deve estar em BRT/UTC-3)
  const hour = now.getHours()

  if (start > end) {
    // Ex: 22h às 07h (atravessa meia-noite)
    return hour >= start || hour < end
  } else {
    // Ex: 08h às 10h
    return hour >= start && hour < end
  }
}


// -----------------------------------------------------------------------------
// Avaliação de condições
// -----------------------------------------------------------------------------

/**
 * Avalia se um review dispara uma regra de alerta.
 */
function shouldTrigger(
  review: NormalizedReview,
  rule: AlertRule,
  recentCount: number,
  recentNegativeCount: number,
  avgDailyTotal: number,
  avgDailyNegative: number
): boolean {
  switch (rule.condition_type) {
    case 'rating_drop':
      // Disparar se o rating for <= threshold (ex: threshold=2 → alerta para 1 e 2 estrelas)
      if (rule.threshold === null || review.rating === undefined) return false
      return review.rating <= rule.threshold

    case 'negative_surge': {
      // Disparar para reviews com sentimento negative OU critical
      const isNegative = review.sentiment === 'negative' || review.sentiment === 'critical'
      if (!isNegative) return false
      
      const threshold = rule.threshold !== null && rule.threshold !== undefined
        ? Number(rule.threshold)
        : Math.max(Math.ceil(2 * avgDailyNegative), 3)
      
      return recentNegativeCount >= threshold
    }

    case 'critical_review':
      // Disparar para reviews com score de insatisfação >= threshold da regra
      return (review.dissatisfaction_score ?? 0) >= (rule.threshold ?? 81)

    case 'topic_billing': {
      // Disparar se IA detectou tópicos financeiros críticos
      const financialTopics = ['cobrança', 'reembolso', 'dados_privados']
      return (review.sentiment_topics ?? []).some(t => financialTopics.includes(t))
    }

    case 'reclame_aqui_new':
      // Qualquer review novo no canal Reclame Aqui dispara automaticamente
      // (por definição, todo review nesse canal é uma reclamação formal)
      return review.channel === 'reclame_aqui'

    case 'keyword': {
      // Disparar se o texto do review contiver alguma das palavras-chave monitoradas
      if (!rule.keywords || rule.keywords.length === 0) return false
      const text = `${review.title ?? ''} ${review.body ?? ''}`.toLowerCase()
      return rule.keywords.some(kw => text.includes(kw.toLowerCase()))
    }

    case 'volume_spike': {
      const threshold = rule.threshold !== null && rule.threshold !== undefined
        ? Number(rule.threshold)
        : Math.max(Math.ceil(2 * avgDailyTotal), 5)
      
      return recentCount >= threshold
    }

    default:
      logger.warn('[alerts] Tipo de condição desconhecido', {
        condition_type: rule.condition_type,
        rule_id: rule.id,
      })
      return false
  }
}
/**
 * Calcula o nível de urgência com base no conteúdo e na regra.
 */
function calculateUrgency(review: NormalizedReview, rule: AlertRule): 'urgente' | 'atencao' | 'informativo' {
  // 1. Se contém palavras de risco jurídico -> URGENTE
  if (containsRiskKeywords(review, rule)) return 'urgente';

  // 2. Se rating <= 2 -> URGENTE
  if (review.rating !== undefined && review.rating <= 2) return 'urgente';

  // 3. Se rating == 3 ou sentimento negativo -> ATENÇÃO
  if (review.rating === 3 || review.sentiment === 'negative' || review.sentiment === 'critical') return 'atencao';

  // 4. Caso contrário -> INFORMATIVO (ou o nível padrão da regra)
  return rule.urgency_level || 'informativo';
}

/**
 * Verifica se o review contém palavras de risco jurídico.
 */
function containsRiskKeywords(review: NormalizedReview, rule: AlertRule): boolean {
  const riskWords = rule.risk_keywords || DEFAULT_RISK_KEYWORDS;
  const text = `${review.title ?? ''} ${review.body ?? ''}`.toLowerCase();
  return riskWords.some(kw => text.includes(kw.toLowerCase()));
}

/**
 * Constrói o objeto `detail` do alert_event para diagnóstico.
 */
function buildAlertDetail(
  review: NormalizedReview,
  rule: AlertRule
): Record<string, unknown> {
  return {
    // Regra que disparou
    condition_type: rule.condition_type,
    threshold: rule.threshold,
    triggered_by_rule: rule.name,
    // Dados do review
    review_external_id: review.external_id,
    review_channel: review.channel,
    review_rating: review.rating,
    review_sentiment: review.sentiment,
    review_dissatisfaction_score: review.dissatisfaction_score,
    review_body_preview: review.body?.slice(0, 300),
    review_author: review.author_name,
    review_url: review.url,
    review_published_at: review.published_at,
    // Análise da IA
    sentiment_score: review.dissatisfaction_score,
    sentiment_topics: review.sentiment_topics ?? [],
    sentiment_summary: review.sentiment_summary ?? '',
    alert_reason: review.sentiment_result?.alert_reason ?? '',
    analysis_method: review.sentiment_result?.method ?? 'unanalyzed',
  }
}

// -----------------------------------------------------------------------------
// Webhook
// -----------------------------------------------------------------------------

/**
 * Dispara uma notificação HTTP POST para o webhook configurado na regra.
 * Payload compatível com N8N, Make, Zapier etc.
 */
async function fireWebhook(
  webhookUrl: string,
  event: Record<string, unknown>,
  rule: AlertRule,
  extraData?: Record<string, string>
): Promise<void> {
  const detail = event['detail'] as Record<string, unknown>

  const review = {
    external_id: detail['review_external_id'],
    channel: detail['review_channel'],
    rating: detail['review_rating'],
    author: detail['review_author'],
    url: detail['review_url'],
    published_at: detail['review_published_at'],
    body_preview: detail['review_body_preview'],
  }

  const sentiment = {
    sentiment: detail['review_sentiment'],
    dissatisfaction_score: detail['sentiment_score'],
    topics: detail['sentiment_topics'] as string[],
    summary: detail['sentiment_summary'],
    alert_reason: detail['alert_reason'],
    method: detail['analysis_method'],
  }

  // Montar mensagem formatada para WhatsApp (padrão excelente)
  const channelLabel = (review.channel as string || 'Canal Desconhecido').toUpperCase().replace('_', ' ')
  const ratingStars = review.rating ? '⭐'.repeat(Math.round(Number(review.rating))) : 'N/A'
  
  const formattedMessage = [
    `🔔 *Radar de Reviews - Reputei*`,
    ``,
    `🚨 *Nova avaliação crítica detectada!*`,
    ``,
    `*📺 Canal:* ${channelLabel}`,
    `*⭐ Nota:* ${review.rating ? `${review.rating} / 5 ${ratingStars}` : 'Sem nota'}`,
    ``,
    `*👤 Cliente:* ${review.author || 'Anônimo'}`,
    `*💬 Review:* "${review.body_preview || '(sem texto)'}"`,
    ``,
    `*🧠 Análise de IA:*`,
    `*📉 Sentimento:* ${(sentiment.sentiment as string || '').toUpperCase()}`,
    `*🔥 Nível de Crise:* ${sentiment.dissatisfaction_score || 0}%`,
    `*🏷️ Tópicos:* ${(sentiment.topics || []).join(', ') || 'nenhum'}`,
    `*💡 Resumo:* ${sentiment.summary || 'Não disponível'}`,
    ``,
    review.url ? `🔗 *Ver no Canal:* ${review.url}` : null,
    `_Reputei Intelligence_`
  ].filter(Boolean).join('\n')

  const payload = {
    event_type: 'alert_triggered',
    rule_name: rule.name,
    condition_type: rule.condition_type,
    business_id: rule.business_id,
    channel: event['channel'],
    triggered_at: new Date().toISOString(),
    subscriber_whatsapp: extraData?.subscriber_whatsapp || '',
    subscriber_email: extraData?.subscriber_email || '',
    formatted_message: formattedMessage,
    review,
    sentiment_analysis: sentiment
  }

  await axios.post(webhookUrl, payload, {
    timeout: 10_000,
    headers: { 'Content-Type': 'application/json' },
  })

  logger.info('[alerts] Webhook disparado com sucesso', {
    rule_id: rule.id,
    webhook_url: webhookUrl,
  })
}
