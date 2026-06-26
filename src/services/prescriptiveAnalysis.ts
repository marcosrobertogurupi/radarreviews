// Serviço de Análise Prescritiva Multi-Unidade (F12-E7-T1 + T2)
//
// Especificação técnica:
//   Entrada  : resumos de sentiment_topics e review_stats_daily dos últimos 30 dias,
//              agrupados por business (unidade) dentro do tenant.
//   IA       : Gemini Flash com prompt estruturado.
//   Saída    : Array de insights acionáveis por unidade (texto + categoria + urgência).
//   Limites  : máx 5 insights por tenant por execução; confiança mínima para emitir alerta.
//   Canal    : reutiliza o módulo de alertas existente (alert_rules + alert_events) para
//              entrega, gerando um evento sintético do tipo 'prescriptive_insight'.

import { supabaseAdmin } from '../lib/supabase.js'
import { logger } from '../lib/logger.js'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { AI_CONFIG } from '../lib/ai-config.js'

export interface PrescriptiveInsight {
  business_id: string
  business_name: string
  category: 'atendimento' | 'preco' | 'produto' | 'entrega' | 'limpeza' | 'geral'
  urgency: 'high' | 'medium' | 'low'
  insight: string       // texto acionável gerado pela IA
  metric_context: string // dado que embasou o insight (ex: "queda de 0.8 na nota média")
  confidence: number    // 0.0 a 1.0 — insights abaixo de 0.6 são descartados
}

const MIN_CONFIDENCE = 0.6
const MAX_INSIGHTS_PER_TENANT = 5

function getGemini() {
  const key = process.env['GEMINI_API_KEY']
  if (!key) throw new Error('GEMINI_API_KEY não configurada.')
  return new GoogleGenerativeAI(key)
}

async function buildTenantContext(tenantId: string): Promise<string> {
  const since30 = new Date(Date.now() - 30 * 86_400_000).toISOString().split('T')[0]!
  const since60 = new Date(Date.now() - 60 * 86_400_000).toISOString().split('T')[0]!

  const { data: businesses } = await supabaseAdmin
    .from('monitored_businesses')
    .select('id, name')
    .eq('tenant_id', tenantId)
    .eq('is_active', true)

  if (!businesses?.length) return ''

  const lines: string[] = []

  for (const biz of businesses) {
    const [stats30, stats60, topics] = await Promise.all([
      supabaseAdmin
        .from('review_stats_daily')
        .select('avg_rating, total_reviews, positive_count, negative_count, critical_count')
        .eq('business_id', biz.id)
        .gte('date', since30),
      supabaseAdmin
        .from('review_stats_daily')
        .select('avg_rating, total_reviews')
        .eq('business_id', biz.id)
        .gte('date', since60)
        .lt('date', since30),
      supabaseAdmin
        .from('reviews')
        .select('sentiment_topics')
        .eq('business_id', biz.id)
        .gte('published_at', `${since30}T00:00:00Z`)
        .not('sentiment_topics', 'is', null)
        .limit(50),
    ])

    const s30 = stats30.data ?? []
    const s60 = stats60.data ?? []

    const total30 = s30.reduce((a, r) => a + (r.total_reviews ?? 0), 0)
    const avgRating30 = total30 > 0
      ? s30.reduce((a, r) => a + (r.avg_rating ?? 0) * (r.total_reviews ?? 0), 0) / total30
      : null

    const total60 = s60.reduce((a, r) => a + (r.total_reviews ?? 0), 0)
    const avgRating60 = total60 > 0
      ? s60.reduce((a, r) => a + (r.avg_rating ?? 0) * (r.total_reviews ?? 0), 0) / total60
      : null

    const negCount  = s30.reduce((a, r) => a + (r.negative_count ?? 0), 0)
    const critCount = s30.reduce((a, r) => a + (r.critical_count ?? 0), 0)

    // Agregar sentiment_topics em frequências
    const topicFreq: Record<string, number> = {}
    for (const r of topics.data ?? []) {
      const ts = r.sentiment_topics as string[] | null
      if (!ts) continue
      for (const t of ts) topicFreq[t] = (topicFreq[t] ?? 0) + 1
    }
    const topTopics = Object.entries(topicFreq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([t, c]) => `${t}(${c})`)
      .join(', ')

    const trend = avgRating30 && avgRating60
      ? (avgRating30 - avgRating60).toFixed(2)
      : 'sem dados de período anterior'

    lines.push(
      `Unidade: ${biz.name} (id=${biz.id})\n` +
      `  Reviews últimos 30d: ${total30} | Nota média: ${avgRating30?.toFixed(2) ?? 'N/A'} | Variação vs 30-60d: ${trend}\n` +
      `  Negativos: ${negCount} | Críticos: ${critCount}\n` +
      `  Temas mais citados: ${topTopics || 'nenhum'}`
    )
  }

  return lines.join('\n\n')
}

async function generateInsights(context: string, tenantId: string): Promise<PrescriptiveInsight[]> {
  if (!context.trim()) return []

  const prompt = `Você é um analista de reputação especializado em redes de lojas/unidades.
Analise os dados abaixo e gere insights ACIONÁVEIS e ESPECÍFICOS — não genéricos.
Cada insight deve citar o dado que o embasou e uma ação concreta sugerida.

Dados das unidades (tenant ${tenantId}):
${context}

Responda EXCLUSIVAMENTE em JSON válido, sem markdown:
{
  "insights": [
    {
      "business_id": "<id exato da unidade>",
      "business_name": "<nome da unidade>",
      "category": "<atendimento|preco|produto|entrega|limpeza|geral>",
      "urgency": "<high|medium|low>",
      "insight": "<texto acionável de 1-2 frases, em português>",
      "metric_context": "<dado numérico que motivou este insight>",
      "confidence": <0.0 a 1.0>
    }
  ]
}

Regras:
- Gere no máximo ${MAX_INSIGHTS_PER_TENANT} insights por resposta
- Urgência "high" = queda de nota ≥ 0.5 ou críticos > 10% do total
- Inclua apenas insights com confiança ≥ ${MIN_CONFIDENCE}
- Se não houver dados suficientes para uma unidade, omita ela
- NUNCA invente dados — use apenas o que foi fornecido acima`

  const genAI = getGemini()
  const model = genAI.getGenerativeModel({
    model: AI_CONFIG.model,
    generationConfig: { temperature: 0.3, maxOutputTokens: 2048 },
  })

  const result = await model.generateContent(prompt)
  const raw = result.response.text().trim()

  // Extrair JSON da resposta
  const jsonMatch = raw.match(/\{[\s\S]*\}/)
  if (!jsonMatch) {
    logger.warn('[prescriptive] Resposta da IA não continha JSON válido')
    return []
  }

  let parsed: { insights?: unknown[] }
  try {
    parsed = JSON.parse(jsonMatch[0]) as { insights?: unknown[] }
  } catch {
    logger.warn('[prescriptive] Falha ao parsear JSON da IA')
    return []
  }

  const insights = (parsed.insights ?? []) as PrescriptiveInsight[]
  return insights.filter(i => i.confidence >= MIN_CONFIDENCE)
}

async function storeInsightsAsAlertEvents(
  tenantId: string,
  insights: PrescriptiveInsight[]
): Promise<void> {
  for (const insight of insights) {
    // Buscar ou criar uma alert_rule do tipo prescriptive_insight para este tenant
    let { data: rule } = await supabaseAdmin
      .from('alert_rules')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('condition_type', 'prescriptive_insight')
      .eq('business_id', insight.business_id)
      .maybeSingle()

    if (!rule) {
      const { data: newRule } = await supabaseAdmin
        .from('alert_rules')
        .insert({
          tenant_id: tenantId,
          business_id: insight.business_id,
          name: `Insight Prescritivo — ${insight.business_name}`,
          condition_type: 'prescriptive_insight',
          notify_email: true,
        })
        .select('id')
        .single()
      rule = newRule
    }

    if (!rule) continue

    await supabaseAdmin.from('alert_events').insert({
      rule_id: rule.id,
      business_id: insight.business_id,
      notified: false,
      detail: {
        type: 'prescriptive_insight',
        category: insight.category,
        urgency: insight.urgency,
        insight: insight.insight,
        metric_context: insight.metric_context,
        confidence: insight.confidence,
        sentiment_summary: `[${insight.urgency.toUpperCase()}] ${insight.insight}`,
      },
    })
  }
}

/**
 * Job semanal: gera e armazena insights prescritivos para todos os tenants ativos.
 */
export async function runPrescriptiveAnalysisJob(): Promise<void> {
  logger.info('[prescriptive] Iniciando job de análise prescritiva')

  const { data: tenants } = await supabaseAdmin
    .from('tenants')
    .select('id')
    .eq('is_active', true)
    .in('subscription_status', ['active', 'trial'])

  if (!tenants?.length) {
    logger.info('[prescriptive] Nenhum tenant ativo')
    return
  }

  let totalInsights = 0

  for (const tenant of tenants) {
    try {
      const context = await buildTenantContext(tenant.id)
      if (!context) continue

      const insights = await generateInsights(context, tenant.id)
      if (insights.length > 0) {
        await storeInsightsAsAlertEvents(tenant.id, insights)
        totalInsights += insights.length
        logger.info('[prescriptive] Insights gerados', {
          tenant_id: tenant.id,
          count: insights.length,
        })
      }
    } catch (err) {
      logger.error('[prescriptive] Erro em tenant', { tenant_id: tenant.id, err })
    }
  }

  logger.info('[prescriptive] Job concluído', {
    tenants: tenants.length,
    total_insights: totalInsights,
  })
}
