// Serviço de Análise Prescritiva (Next Steps e Diagnósticos por Rede) — powered by Gemini (F12-E7)
import { GoogleGenerativeAI } from '@google/generative-ai'
import { supabaseAdmin } from '../lib/supabase.js'
import { logger } from '../lib/logger.js'
import { emailService } from './emailService.js'

export interface PrescriptiveInsight {
  business_id: string | null
  title: string
  description: string
  action_plan: string
  confidence_score: number
}

function getGeminiClient(): GoogleGenerativeAI | null {
  const key = process.env['GEMINI_API_KEY']
  if (!key) return null
  return new GoogleGenerativeAI(key)
}

/**
 * Executa a análise de IA Prescritiva para as unidades de um tenant específico.
 */
export async function calculatePrescriptiveInsights(tenantId: string): Promise<PrescriptiveInsight[]> {
  const gemini = getGeminiClient()
  if (!gemini) {
    logger.warn('[prescriptiveAI] GEMINI_API_KEY não configurada. Pulando análise prescritiva.')
    return []
  }

  // 1. Buscar dados do tenant e suas unidades
  const { data: tenant, error: tenantErr } = await supabaseAdmin
    .from('tenants')
    .select('name, admin_email')
    .eq('id', tenantId)
    .single()

  if (tenantErr || !tenant) {
    logger.error('[prescriptiveAI] Tenant não encontrado para gerar insights', { tenantId })
    return []
  }

  const { data: businesses, error: bizErr } = await supabaseAdmin
    .from('monitored_businesses')
    .select('id, name')
    .eq('tenant_id', tenantId)
    .eq('is_active', true)

  if (bizErr || !businesses || businesses.length === 0) {
    logger.info('[prescriptiveAI] Nenhum estabelecimento ativo encontrado para este tenant', { tenantId })
    return []
  }

  // 2. Buscar reviews dos últimos 30 dias para todas as unidades deste tenant
  const since30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
  const { data: reviews, error: reviewsErr } = await supabaseAdmin
    .from('reviews')
    .select('business_id, rating, sentiment, sentiment_summary, body, published_at')
    .eq('tenant_id', tenantId)
    .gte('published_at', since30d)

  if (reviewsErr || !reviews) {
    logger.error('[prescriptiveAI] Erro ao buscar reviews para insights', { error: reviewsErr?.message })
    return []
  }

  if (reviews.length < 3) {
    logger.info('[prescriptiveAI] Volume de reviews insuficiente (< 3) nas últimas 4 semanas para análise acionável', { tenantId, reviews_count: reviews.length })
    return []
  }

  // 3. Agrupar dados por estabelecimento monitorado
  const businessDataMap = new Map<string, {
    name: string
    total: number
    ratingSum: number
    ratingCount: number
    sentimentCounts: Record<string, number>
    negatives: Array<{ text: string; published_at: string }>
  }>()

  for (const b of businesses) {
    businessDataMap.set(b.id, {
      name: b.name,
      total: 0,
      ratingSum: 0,
      ratingCount: 0,
      sentimentCounts: { positive: 0, neutral: 0, negative: 0, critical: 0, unanalyzed: 0 },
      negatives: []
    })
  }

  for (const r of reviews) {
    const bId = r.business_id
    if (!bId || !businessDataMap.has(bId)) continue

    const bData = businessDataMap.get(bId)!
    bData.total++
    if (r.rating != null) {
      bData.ratingSum += r.rating
      bData.ratingCount++
    }
    const sentiment = r.sentiment || 'unanalyzed'
    bData.sentimentCounts[sentiment] = (bData.sentimentCounts[sentiment] || 0) + 1

    if (sentiment === 'negative' || sentiment === 'critical') {
      const summaryText = r.sentiment_summary || r.body?.slice(0, 100) || '(Sem conteúdo)'
      bData.negatives.push({
        text: summaryText,
        published_at: r.published_at
      })
    }
  }

  // Formatar sumários de dados das unidades para o prompt da IA
  let promptData = ''
  for (const [id, data] of businessDataMap.entries()) {
    const avgRating = data.ratingCount > 0 ? (data.ratingSum / data.ratingCount).toFixed(1) : 'N/A'
    promptData += `\nEstabelecimento: "${data.name}" (ID: ${id})\n`
    promptData += `- Total de reviews: ${data.total}\n`
    promptData += `- Nota Média: ${avgRating} estrelas\n`
    promptData += `- Sentimentos: Positivo: ${data.sentimentCounts['positive']} | Neutro: ${data.sentimentCounts['neutral']} | Negativo: ${data.sentimentCounts['negative']} | Crítico: ${data.sentimentCounts['critical']}\n`
    if (data.negatives.length > 0) {
      promptData += `- Resumos de Críticas/Reclamações:\n`
      data.negatives.slice(0, 8).forEach(neg => {
        promptData += `  * [${neg.published_at.slice(0, 10)}] ${neg.text}\n`
      })
    }
    promptData += `---------------------------------------\n`
  }

  // 4. Invocar o Gemini para gerar recomendações prescritivas
  const systemInstruction = `Você é o Reputei IA, o módulo avançado de IA Prescritiva do SaaS Reputei.
Sua missão é analisar dados de avaliações e reputação de toda a rede de lojas de um inquilino multi-unidade.
Seu foco é identificar padrões, fraquezas sistêmicas (ex. queda na nota média de atendimento de uma filial, picos de reclamações sobre cobrança ou velocidade) e prescrever recomendações e planos de ação altamente práticos e acionáveis.

Você DEVE produzir e retornar obrigatoriamente um objeto JSON no formato exato especificado abaixo:
{
  "insights": [
    {
      "business_id": "UUID da unidade afetada ou null se for um insight geral da rede inteira",
      "title": "Título conciso e direto do insight (ex: Plano de Ação - Atendimento Centro)",
      "description": "Explicação detalhada sobre o problema ou queda observada nos dados, mencionando as métricas se possível.",
      "action_plan": "Plano de ação numerado e prático para o gestor resolver o problema da unidade.",
      "confidence_score": 0 a 100 (número inteiro que indica sua confiança na relevância deste insight baseado nos dados)
    }
  ]
}
Importante: Suas recomendações devem ser baseadas EXCLUSIVAMENTE nos dados reais fornecidos. Se não houver problemas críticos ou quedas acentuadas de performance reputacional, você pode sugerir melhorias gerais ou manter a lista vazia.`

  const userPrompt = `Analise os seguintes dados agregados de rede do inquilino "${tenant.name}" nos últimos 30 dias e sugira recomendações prescritivas acionáveis:

${promptData}

Retorne exclusivamente o JSON especificado.`

  try {
    const model = gemini.getGenerativeModel({
      model: 'gemini-2.5-flash',
      generationConfig: {
        responseMimeType: 'application/json'
      }
    })

    const response = await model.generateContent({
      contents: [
        { role: 'user', parts: [{ text: userPrompt }] }
      ],
      systemInstruction: systemInstruction
    })

    const responseText = response.response.text()
    const parsed = JSON.parse(responseText) as { insights?: PrescriptiveInsight[] }
    const insights = parsed.insights ?? []

    if (insights.length > 0) {
      // 5. Salvar novos insights no banco
      // Limpar os insights antigos com status 'pending' para evitar duplicatas
      await supabaseAdmin
        .from('prescriptive_insights')
        .delete()
        .eq('tenant_id', tenantId)
        .eq('status', 'pending')

      for (const ins of insights) {
        // Validar UUID do business_id para garantir integridade referencial se não for nulo
        let bizId: string | null = null
        if (ins.business_id && businessDataMap.has(ins.business_id)) {
          bizId = ins.business_id
        }

        const { data: newInsight, error: insertErr } = await supabaseAdmin
          .from('prescriptive_insights')
          .insert({
            tenant_id: tenantId,
            business_id: bizId,
            title: ins.title,
            description: ins.description,
            action_plan: ins.action_plan,
            confidence_score: ins.confidence_score,
            status: 'pending',
            impact_measured: false,
            metadata: { generated_at: new Date().toISOString() }
          })
          .select('id')
          .single()

        if (insertErr) {
          logger.error('[prescriptiveAI] Erro ao inserir insight no banco', { error: insertErr.message })
          continue
        }

        // 6. Enviar notificação por e-mail se o score de confiança for alto (>= 80) e tiver admin_email
        if (ins.confidence_score >= 80 && tenant.admin_email && newInsight) {
          const emailHtml = `
            <h2 style="margin-top: 0; color: #ffffff;">💡 Novo Insight Prescritivo da IA</h2>
            <p>Olá,</p>
            <p>Nossa inteligência artificial identificou um padrão importante na sua rede de estabelecimentos que merece sua atenção:</p>
            
            <div class="card" style="border-left: 4px solid #6366f1;">
              <h3 style="margin: 0 0 8px 0; color: #a5b4fc;">${ins.title}</h3>
              <p style="margin: 0 0 12px 0; color: #e5e7eb; line-height: 1.5;">${ins.description}</p>
              
              <div style="font-weight: 700; margin-bottom: 6px; color: #fff;">📋 Plano de Ação Recomendado:</div>
              <div style="white-space: pre-wrap; font-size: 13px; line-height: 1.5; color: #cbd5e1;">${ins.action_plan}</div>
            </div>

            <p style="font-size: 14px; color: #9ca3af;">Você pode acompanhar a implementação deste plano de ação diretamente no painel do assinante.</p>

            <div style="text-align: center; margin-top: 30px;">
              <a href="${process.env['VITE_PORTAL_URL'] || 'http://localhost:5173'}/dashboard" class="btn">Acessar Painel</a>
            </div>
          `

          await emailService.sendEmail(
            tenant.admin_email,
            `[Reputei IA] Insight Prescritivo: ${ins.title}`,
            emailHtml,
            `Insight Prescritivo Recomendado pela IA: ${ins.title} - ${ins.description}`
          )
        }
      }
    }

    logger.info('[prescriptiveAI] Insights calculados com sucesso', { tenantId, count: insights.length })
    return insights

  } catch (err: any) {
    logger.error('[prescriptiveAI] Falha na análise prescritiva do tenant', { tenantId, error: err.message })
    return []
  }
}

/**
 * Job de IA Prescritiva: Executa semanalmente ou sob demanda para todos os tenants ativos.
 */
export async function runPrescriptiveAIJob(): Promise<void> {
  logger.info('[prescriptiveAI] Iniciando job de IA Prescritiva...')

  const { data: tenants, error } = await supabaseAdmin
    .from('tenants')
    .select('id')
    .eq('is_active', true)

  if (error || !tenants) {
    logger.error('[prescriptiveAI] Erro ao buscar tenants ativos para o job', { error: error?.message })
    return
  }

  let analyzedCount = 0
  for (const tenant of tenants) {
    try {
      await calculatePrescriptiveInsights(tenant.id)
      analyzedCount++
    } catch (err: any) {
      logger.error('[prescriptiveAI] Erro no job para tenant', { tenantId: tenant.id, error: err.message })
    }
  }

  logger.info('[prescriptiveAI] Job concluído com sucesso!', { total_tenants: tenants.length, analyzed: analyzedCount })
}
