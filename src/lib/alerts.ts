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
  // Buscar regras de alerta ativas para esta empresa
  const { data: rules, error } = await supabase
    .from('alert_rules')
    .select('*')
    .eq('is_active', true)
    .eq('business_id', businessId)
    // canal null = regra se aplica a todos os canais
    .or(`channel.eq.${channel},channel.is.null`)

  if (error) {
    logger.warn('[alerts] Falha ao buscar regras de alerta', {
      business_id: businessId,
      error: error.message,
    })
    return
  }

  if (!rules || rules.length === 0) return

  // Para cada combinação (review × regra), verificar se deve disparar
  const events: Array<{
    rule_id: string
    business_id: string
    channel: SourceChannel
    detail: Record<string, unknown>
  }> = []

  for (const review of reviews) {
    for (const rule of rules as AlertRule[]) {
      if (shouldTrigger(review, rule)) {
        const urgency = calculateUrgency(review, rule);
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

        logger.info('[alerts] Alerta disparado', {
          rule_id: rule.id,
          rule_name: rule.name,
          condition: rule.condition_type,
          review_external_id: review.external_id,
          channel,
        })
      }
    }
  }

  if (events.length === 0) return

  // Inserir alert_events em lote
  const { error: insertError } = await supabase.from('alert_events').insert(events)

  if (insertError) {
    logger.warn('[alerts] Falha ao inserir alert_events', { error: insertError.message })
    return
  }

  // Disparar webhooks para regras que têm notify_webhook configurado
  const rulesById = new Map((rules as AlertRule[]).map(r => [r.id, r]))

  // Buscar dados do Tenant para incluir no webhook (contato do assinante)
  const tenantId = reviews[0]?.tenant_id
  const { data: tenant } = await supabase
    .from('tenants')
    .select('admin_whatsapp, admin_email')
    .eq('id', tenantId)
    .single()

  for (const event of events) {
    const rule = rulesById.get(event.rule_id)
    if (rule?.notify_webhook) {
      // Verificar Horário de Silêncio
      if (isQuietTime(rule) && (event.detail.urgency_level as string) !== 'urgente') {
        logger.info('[alerts] Alerta silenciado por Horário de Silêncio', {
          rule_id: rule.id,
          urgency: event.detail.urgency_level,
        })
        continue
      }

      const extraData = {
        subscriber_whatsapp: tenant?.admin_whatsapp || '',
        subscriber_email: tenant?.admin_email || '',
      }
      await fireWebhook(rule.notify_webhook, event, rule, extraData).catch(err => {
        logger.warn('[alerts] Falha ao disparar webhook', {
          rule_id: rule.id,
          webhook_url: rule.notify_webhook,
          error: err instanceof Error ? err.message : String(err),
        })
      })
    }
  }
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
function shouldTrigger(review: NormalizedReview, rule: AlertRule): boolean {
  switch (rule.condition_type) {
    case 'rating_drop':
      // Disparar se o rating for <= threshold (ex: threshold=2 → alerta para 1 e 2 estrelas)
      if (rule.threshold === null || review.rating === undefined) return false
      return review.rating <= rule.threshold

    case 'negative_surge':
      // Disparar para reviews com sentimento negative OU critical
      return review.sentiment === 'negative' || review.sentiment === 'critical'

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

    case 'volume_spike':
      // Implementar na Fase 5 (requer análise histórica de volume)
      return false

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

  const payload = {
    event_type: 'alert_triggered',
    rule_name: rule.name,
    condition_type: rule.condition_type,
    business_id: rule.business_id,
    channel: event['channel'],
    triggered_at: new Date().toISOString(),
    // Dados para o n8n saber para quem disparar (Contato do Assinante)
    subscriber_whatsapp: extraData?.subscriber_whatsapp || '',
    subscriber_email: extraData?.subscriber_email || '',
    // Contexto do review
    review: {
      external_id: detail['review_external_id'],
      channel: detail['review_channel'],
      rating: detail['review_rating'],
      author: detail['review_author'],
      url: detail['review_url'],
      published_at: detail['review_published_at'],
      body_preview: detail['review_body_preview'],
    },
    // Análise de IA
    sentiment_analysis: {
      sentiment: detail['review_sentiment'],
      dissatisfaction_score: detail['sentiment_score'],
      topics: detail['sentiment_topics'],
      summary: detail['sentiment_summary'],
      alert_reason: detail['alert_reason'],
      method: detail['analysis_method'],
    },
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
