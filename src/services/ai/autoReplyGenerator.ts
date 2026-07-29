import 'dotenv/config'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { getRelevantReplyExamples, recordApprovedReply } from './learningService.js'
import { sendDirectResponse } from './responder.js'
import { callGeminiWithRetry } from '../../lib/gemini-rate-limiter.js'
import { AI_CONFIG } from '../../lib/ai-config.js'
import { supabaseAdmin } from '../../lib/supabase.js'
import { logger } from '../../lib/logger.js'
import type { AutoReplySettings, GeneratedReplyResult } from '../../types/autoReply.js'
import type { NormalizedReview, SourceChannel } from '../../types/review.js'

function getGenAI(): GoogleGenerativeAI {
  const key = process.env['GEMINI_API_KEY']
  if (!key) throw new Error('GEMINI_API_KEY não configurada no ambiente.')
  return new GoogleGenerativeAI(key)
}

/**
 * Canal-specific instructions for reply framing
 */
function getChannelStyleGuide(channel: SourceChannel): string {
  switch (channel) {
    case 'tripadvisor':
      return 'Canal TripAdvisor: Resposta hospitaleira, elegante, cordialmente assinada, valorizando a experiência da estadia/visita e convidando para retorno.'
    case 'google_maps':
      return 'Canal Google Maps: Resposta corporativa, direta, amigável e profissional. Otimizada para SEO local e reputação da marca.'
    case 'reclame_aqui':
      return 'Canal Reclame Aqui: Resposta resolutiva, extremamente empática, transparente, mostrando compromisso imediato de solução e canal direto de ouvidoria.'
    case 'consumidor_gov':
      return 'Canal Consumidor.gov: Resposta institucional, formal, precisa, informando protocolo de atendimento e solução dentro das diretrizes do CDC.'
    case 'facebook':
    case 'instagram':
      return 'Canal Social (Meta): Resposta engajadora, próxima, descontraída e calorosa. Pode usar emojis com moderação.'
    case 'trustpilot':
      return 'Canal Trustpilot: Resposta global, transparente, valorizando o feedback construtivo e a confiança do cliente na marca.'
    case 'reddit':
      return 'Canal Reddit: Resposta autêntica, humanizada, objetiva, sem jargões corporativos excessivos.'
    default:
      return 'Resposta profissional, cordial e atenciosa.'
  }
}

/**
 * Gera uma resposta otimizada por IA com base na persona do cliente e exemplos de aprendizado prévio
 */
export async function generateAutoReply(params: {
  review: NormalizedReview
  settings: AutoReplySettings
  businessName: string
}): Promise<GeneratedReplyResult> {
  const { review, settings, businessName } = params

  try {
    // 1. Recupera exemplos de aprendizado prévio do tenant (Few-Shot RAG)
    const examples = await getRelevantReplyExamples(review.tenant_id, review.body || review.title || '', 3)

    // 2. Monta o contexto de aprendizado em poucos disparos (Few-Shot)
    let examplesContext = ''
    if (examples.length > 0) {
      examplesContext = `\n\nEXEMPLOS DE RESPOSTAS ANTERIORES APROVADAS PELO GESTOR DA EMPRESA (APRENDA ESTE ESTILO):\n` +
        examples.map((ex, idx) => `
Exemplo ${idx + 1}:
Review do Cliente: "${ex.review_text}"
Resposta Oficial Aprovada: "${ex.user_approved_text}"
`).join('\n')
    }

    // 3. Monta o prompt detalhado para o Gemini 2.5 Flash
    const channelGuide = getChannelStyleGuide(review.channel)
    const systemPrompt = `
Você é o assistente oficial de reputação da empresa "${businessName}".
Sua função é redigir a resposta oficial para uma avaliação de cliente recebida no canal ${review.channel.toUpperCase()}.

${channelGuide}

DIRETRIZES DA EMPRESA:
- Assinatura oficial: ${settings.signature}
- Tom de Voz desejado: ${settings.tone_of_voice}
- Mencionar nomes de funcionários se elogiados no texto: ${settings.mention_staff_names ? 'SIM' : 'NÃO'}
${settings.custom_rules ? `- Regras Personalizadas da Empresa: ${settings.custom_rules}` : ''}
${examplesContext}

REGRAS DE RESPOSTA:
1. Responda em Português do Brasil com excelente gramática.
2. Seja sempre educado e acolhedor.
3. Se o cliente citou nomes de colaboradores específicos (ex: Karine, Sueli, Marcos), AGRADEÇA especificamente o atendimento desses colaboradores se mention_staff_names for verdadeiro.
4. Mantenha a resposta concisa e marcante (entre 3 e 6 frases).
5. Assine no final com a Assinatura oficial fornecida.
6. Retorne estritamente um JSON no formato especificado.

FORMATO DE SAÍDA EXIGIDO (JSON puro):
{
  "reply_text": "Texto completo da resposta oficial...",
  "confidence": 0.95,
  "mentioned_staff": ["Karine", "Sueli"],
  "reasoning": "Agradeceu os elogios ao café da manhã e citou a Karine e a Sueli conforme solicitado."
}
`

    const userPrompt = `
AVALIAÇÃO A SER RESPONDIDA:
- Canal: ${review.channel}
- Cliente: ${review.author_name || 'Cliente'}
- Nota: ${review.rating ? `${review.rating}/5` : 'Sem nota quantitativa'}
- Título: ${review.title || 'Sem título'}
- Texto: ${review.body || 'Sem texto'}
`

    // 4. Invoca o Gemini 2.5 Flash via rate limiter
    const genAI = getGenAI()
    const model = genAI.getGenerativeModel({
      model: AI_CONFIG.model,
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0.4,
      },
    })

    const rawResponse = await callGeminiWithRetry(async () => {
      const result = await model.generateContent([
        { text: systemPrompt },
        { text: userPrompt },
      ])
      return result.response.text()
    })

    // 5. Parse do resultado JSON
    const parsed = JSON.parse(rawResponse)

    return {
      reply_text: parsed.reply_text || '',
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.9,
      reasoning: parsed.reasoning || '',
      examples_used_count: examples.length,
      mentioned_staff: Array.isArray(parsed.mentioned_staff) ? parsed.mentioned_staff : [],
    }
  } catch (err) {
    logger.error('[autoReplyGenerator] Erro ao gerar resposta autônoma via Gemini:', { error: err })
    const fallbackSignature = settings.signature || 'Equipe de Atendimento'
    const author = review.author_name ? ` ${review.author_name}` : ''
    return {
      reply_text: `Prezado(a)${author}, agradecemos por compartilhar sua opinião conosco. Valorizamos muito seus comentários e estamos constantemente trabalhando para oferecer a melhor experiência possível.\n\nAtenciosamente,\n${fallbackSignature}`,
      confidence: 0.6,
      reasoning: 'Fallback de emergência gerado devido a erro temporário na IA.',
      examples_used_count: 0,
      mentioned_staff: [],
    }
  }
}

/**
 * Processador autônomo acionado após ingestão de novos reviews
 */
export async function processAutonomousAutoReplies(
  reviews: NormalizedReview[],
  businessId: string
): Promise<void> {
  try {
    const { data: business } = await supabaseAdmin
      .from('monitored_businesses')
      .select('name, auto_reply_settings')
      .eq('id', businessId)
      .single()

    const settings: AutoReplySettings = business?.auto_reply_settings
    if (!business || !settings || !settings.enabled) return

    for (const review of reviews) {
      if (settings.channels && !settings.channels.includes(review.channel)) {
        continue
      }

      // Buscar review_id persistido no Supabase
      const { data: dbReview } = await supabaseAdmin
        .from('reviews')
        .select('id')
        .eq('channel', review.channel)
        .eq('external_id', review.external_id)
        .single()

      if (!dbReview) continue

      const fullReview = { ...review, id: dbReview.id }
      const generated = await generateAutoReply({
        review: fullReview,
        settings,
        businessName: business.name,
      })

      const rating = review.rating ?? 5
      const shouldAutoPublish =
        settings.mode === 'autopilot' ||
        (settings.mode === 'hybrid' && rating >= (settings.auto_publish_min_rating || 4))

      if (shouldAutoPublish && generated.confidence >= 0.7) {
        // Envio 100% autônomo ao canal
        const dispatch = await sendDirectResponse(dbReview.id, generated.reply_text)
        if (dispatch.success) {
          await recordApprovedReply({
            tenantId: review.tenant_id,
            businessId: review.business_id,
            reviewId: dbReview.id,
            channel: review.channel,
            rating: review.rating,
            reviewText: review.body || review.title || '',
            userApprovedText: generated.reply_text,
            wasEditedByUser: false,
          })
        }
      } else {
        // Salva rascunho para revisão em 1 clique
        await supabaseAdmin
          .from('reviews')
          .update({
            response_text: generated.reply_text,
            response_status: 'pending_approval',
          })
          .eq('id', dbReview.id)
      }
    }
  } catch (err) {
    logger.error('[autoReplyGenerator] Erro no processamento autônomo pós-ingestão:', { error: err })
  }
}
