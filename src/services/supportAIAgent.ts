import { GoogleGenerativeAI } from '@google/generative-ai'
import { supabaseAdmin } from '../lib/supabase.js'
import { AI_CONFIG } from '../lib/ai-config.js'
import { logger } from '../lib/logger.js'
import { embeddingService } from './embeddingService.js'
import { emailService } from './emailService.js'

export class SupportAIAgent {
  private genAI: GoogleGenerativeAI

  constructor() {
    const apiKey = process.env['GEMINI_API_KEY']
    if (!apiKey) throw new Error('GEMINI_API_KEY não definida.')
    this.genAI = new GoogleGenerativeAI(apiKey)
  }
  async handleNewTicket(ticketId: string): Promise<void> {
    try {
      const { data: ticket, error: tError } = await supabaseAdmin
        .from('support_tickets')
        .select(`
          *,
          tenants (name),
          ticket_categories (name)
        `)
        .eq('id', ticketId)
        .single()

      if (tError || !ticket) return

      // Incrementa tentativa de IA
      const attempt = (ticket.ai_attempt_count || 0) + 1
      if (attempt > 3) {
        logger.info('Agente desistiu após 3 tentativas', { ticketId })
        return
      }

      // 1. Busca semântica na KB com threshold 0.0 para obter similaridade exata
      const query = `${ticket.subject} ${ticket.description}`
      const searchResults = await embeddingService.searchKnowledge(query, {
        categoryId: ticket.category_id,
        threshold: 0.0
      })

      const bestMatch = searchResults[0]
      const similarity = bestMatch ? bestMatch.similarity : 0

      // Definir Tier programaticamente
      let tier: 'T1' | 'T2' | 'T3'
      if (similarity >= 0.85) {
        tier = 'T1'
      } else if (similarity >= 0.65) {
        tier = 'T2'
      } else {
        tier = 'T3'
      }

      if (tier === 'T3') {
        // T3: Encaminhamento direto para fila humana sem chamar Gemini
        await supabaseAdmin.from('ticket_ai_interactions').insert({
          ticket_id: ticketId,
          interaction_type: 'autonomous_response',
          query_text: query,
          matched_doc_ids: bestMatch ? [bestMatch.docId] : [],
          top_similarity: similarity,
          confidence_tier: 'T3',
          generated_response: null,
          model_used: AI_CONFIG.model,
          outcome: 'routed_to_human'
        })

        await supabaseAdmin.from('support_tickets').update({
          ai_attempt_count: attempt,
          ai_confidence: similarity,
          ai_doc_used_id: bestMatch?.docId || null,
          status: 'needs_human'
        }).eq('id', ticketId)

        await supabaseAdmin.from('ticket_audit_log').insert({
          ticket_id: ticketId,
          action: 'status_changed',
          from_value: ticket.status || 'open',
          to_value: 'needs_human',
          actor_role: 'ai',
          metadata: { reason: 'Busca semântica sem correspondência relevante (T3)' }
        })

        return
      }

      // T1/T2: Chama Gemini para gerar resposta usando o contexto da KB
      const kbContext = bestMatch 
        ? `Documento de Conhecimento Relevante:
           Título: ${bestMatch.title}
           Resumo: ${bestMatch.solutionSummary}
           Passos: ${JSON.stringify(bestMatch.solutionSteps)}`
        : 'Nenhum documento exato encontrado na Base de Conhecimento.'

      const model = this.genAI.getGenerativeModel({ model: AI_CONFIG.model })
      
      const prompt = `
Você é o Assistente Autônomo da Reputei. Seu objetivo é ajudar o cliente de forma rápida e precisa.

Ticket:
Assunto: ${ticket.subject}
Descrição: ${ticket.description}
Categoria: ${ticket.ticket_categories?.name || 'Geral'}

Contexto KB:
${kbContext}

Instruções:
1. Gere uma resposta direta, educada e útil em português para o cliente com base no contexto KB fornecido.
2. Não invente informações fora do contexto KB.
3. Retorne a resposta e a justificativa no JSON especificado.

Retorne JSON:
{
  "response_body": "<texto da resposta em português>",
  "reasoning": "<breve explicação técnica da decisão>"
}

JSON:`.trim()

      const genResult = await model.generateContent(prompt)
      const raw = genResult.response.text()
      let aiResult: any
      try {
        aiResult = JSON.parse(raw.replace(/```json|```/g, '').trim())
      } catch {
        logger.warn('Erro ao parsear resposta do Agente IA', { raw })
        return
      }

      const responseBody = aiResult.response_body || ''

      if (tier === 'T1') {
        // T1: Resposta automática e transições de estado
        await supabaseAdmin.from('ticket_ai_interactions').insert({
          ticket_id: ticketId,
          interaction_type: 'autonomous_response',
          query_text: query,
          matched_doc_ids: bestMatch ? [bestMatch.docId] : [],
          top_similarity: similarity,
          confidence_tier: 'T1',
          generated_response: responseBody,
          model_used: AI_CONFIG.model,
          outcome: 'sent_autonomously'
        })

        // Atualiza para ai_responding
        await supabaseAdmin.from('support_tickets').update({
          ai_attempt_count: attempt,
          ai_confidence: similarity,
          ai_doc_used_id: bestMatch ? bestMatch.docId : null,
          status: 'ai_responding'
        }).eq('id', ticketId)

        await supabaseAdmin.from('ticket_audit_log').insert({
          ticket_id: ticketId,
          action: 'status_changed',
          from_value: ticket.status || 'ai_triaged',
          to_value: 'ai_responding',
          actor_role: 'ai',
          metadata: { reason: 'Confiança alta na resposta (T1)' }
        })

        // Envia mensagem
        await supabaseAdmin.from('ticket_messages').insert({
          ticket_id: ticketId,
          author_role: 'ai',
          body: responseBody
        })

        // Transiciona para ai_resolved
        await supabaseAdmin.from('support_tickets').update({
          status: 'ai_resolved'
        }).eq('id', ticketId)

        await supabaseAdmin.from('ticket_audit_log').insert({
          ticket_id: ticketId,
          action: 'resolved',
          from_value: 'ai_responding',
          to_value: 'ai_resolved',
          actor_role: 'ai',
          metadata: { reason: 'Mensagem autônoma enviada com sucesso' }
        })

        // Notificar por e-mail sobre a resposta automática da IA
        supabaseAdmin.auth.admin.getUserById(ticket.created_by).then((res: any) => {
          const email = res.data?.user?.email
          if (email) {
            emailService.sendTicketReplyEmail(email, { ...ticket, status: 'ai_resolved' }, responseBody, 'Assistente IA')
              .catch((err: any) => logger.error('Erro ao notificar resposta autônoma por e-mail', { ticketId, err }))
          }
        }).catch((err: any) => {
          logger.error('Erro ao obter usuário para notificação de e-mail de IA', { userId: ticket.created_by, err })
        })
      } else {
        // T2: Gera rascunho de resposta mantendo o status em ai_triaged
        await supabaseAdmin.from('ticket_ai_interactions').insert({
          ticket_id: ticketId,
          interaction_type: 'autonomous_response',
          query_text: query,
          matched_doc_ids: bestMatch ? [bestMatch.docId] : [],
          top_similarity: similarity,
          confidence_tier: 'T2',
          generated_response: responseBody,
          model_used: AI_CONFIG.model,
          outcome: 'draft_shown'
        })

        await supabaseAdmin.from('support_tickets').update({
          ai_attempt_count: attempt,
          ai_confidence: similarity,
          ai_doc_used_id: bestMatch ? bestMatch.docId : null,
          ai_draft_response: responseBody
        }).eq('id', ticketId)
      }

    } catch (error) {
      logger.error('Erro no SupportAIAgent', { ticketId, error })
    }
  }
}

export const supportAIAgent = new SupportAIAgent()
