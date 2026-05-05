import { GoogleGenerativeAI } from '@google/generative-ai'
import { supabaseAdmin } from '../lib/supabase.js'
import { AI_CONFIG } from '../lib/ai-config.js'
import { logger } from '../lib/logger.js'
import { embeddingService } from './embeddingService.js'

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

      // 1. Busca semântica na KB
      const query = `${ticket.subject} ${ticket.description}`
      const searchResults = await embeddingService.searchKnowledge(query, {
        categoryId: ticket.category_id,
        threshold: 0.70
      })

      const bestMatch = searchResults[0]
      const kbContext = bestMatch 
        ? `Documento de Conhecimento Relevante:
           Título: ${bestMatch.title}
           Resumo: ${bestMatch.solutionSummary}
           Passos: ${JSON.stringify(bestMatch.solutionSteps)}`
        : 'Nenhum documento exato encontrado na Base de Conhecimento.'

      // 2. Chama Gemini para gerar resposta
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
1. Se o Contexto KB for relevante e resolver o problema, gere uma resposta direta e educada.
2. Se não houver contexto KB relevante, ou o problema for complexo, peça desculpas e informe que um agente humano está sendo acionado.
3. Se houver ALTA confiança na solução (similarity > 0.85), retorne o campo "action" como "send_autonomously".
4. Caso contrário, retorne "draft_for_human".

Retorne JSON:
{
  "response_body": "<texto da resposta em português>",
  "confidence": 0.0 a 1.0,
  "action": "send_autonomously" | "draft_for_human" | "route_to_human",
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

      // 3. Log de Interação
      await supabaseAdmin.from('ticket_ai_interactions').insert({
        ticket_id: ticketId,
        interaction_type: 'autonomous_response',
        query_text: query,
        matched_doc_ids: bestMatch ? [bestMatch.docId] : [],
        top_similarity: bestMatch?.similarity || 0,
        confidence_tier: aiResult.confidence > 0.85 ? 'T1' : aiResult.confidence > 0.6 ? 'T2' : 'T3',
        generated_response: aiResult.response_body,
        model_used: AI_CONFIG.model,
        outcome: aiResult.action === 'send_autonomously' ? 'sent_autonomously' : 'draft_shown'
      })

      // 4. Executa Ação
      const finalStatus = aiResult.action === 'send_autonomously' ? 'ai_responding' : 'needs_human'
      
      const updateData: any = {
        ai_attempt_count: attempt,
        ai_confidence: aiResult.confidence,
        ai_doc_used_id: bestMatch?.docId || null,
        status: finalStatus
      }

      if (aiResult.action === 'draft_for_human') {
        updateData.ai_draft_response = aiResult.response_body
      }

      await supabaseAdmin.from('support_tickets').update(updateData).eq('id', ticketId)

      // Se autônomo, envia mensagem
      if (aiResult.action === 'send_autonomously') {
        await supabaseAdmin.from('ticket_messages').insert({
          ticket_id: ticketId,
          author_role: 'ai',
          body: aiResult.response_body
        })
        
        await supabaseAdmin.from('support_tickets').update({ status: 'ai_resolved' }).eq('id', ticketId)
        
        // Auditoria
        await supabaseAdmin.from('ticket_audit_log').insert({
          ticket_id: ticketId,
          action: 'resolved',
          from_value: 'ai_triaged',
          to_value: 'ai_resolved',
          actor_role: 'ai',
          metadata: { reason: 'Resolução autônoma via KB' }
        })
      }

    } catch (error) {
      logger.error('Erro no SupportAIAgent', { ticketId, error })
    }
  }
}

export const supportAIAgent = new SupportAIAgent()
