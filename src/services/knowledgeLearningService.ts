import { GoogleGenerativeAI } from '@google/generative-ai'
import { supabaseAdmin } from '../lib/supabase.js'
import { AI_CONFIG } from '../lib/ai-config.js'
import { logger } from '../lib/logger.js'
import { embeddingService } from './embeddingService.js'

export class KnowledgeLearningService {
  private genAI: GoogleGenerativeAI

  constructor() {
    const apiKey = process.env['GEMINI_API_KEY']
    if (!apiKey) throw new Error('GEMINI_API_KEY não definida.')
    this.genAI = new GoogleGenerativeAI(apiKey)
  }

  /**
   * Adiciona um ticket à fila de aprendizado
   */
  async queueTicket(ticketId: string): Promise<void> {
    try {
      await supabaseAdmin.from('support_learning_queue').upsert({
        ticket_id: ticketId,
        priority: 5,
        scheduled_at: new Date().toISOString()
      })
    } catch (error) {
      logger.error('Erro ao enfileirar ticket para aprendizado', { ticketId, error })
    }
  }

  /**
   * Processa a fila de aprendizado
   */
  async processQueue(limit = 5): Promise<void> {
    const { data: queue, error } = await supabaseAdmin
      .from('support_learning_queue')
      .select('*, support_tickets(*, ticket_messages(*))')
      .is('processed_at', null)
      .lte('scheduled_at', new Date().toISOString())
      .order('priority', { ascending: false })
      .limit(limit)

    if (error || !queue) return

    for (const item of queue) {
      try {
        await this.learnFromTicket(item.support_tickets)
        await supabaseAdmin.from('support_learning_queue')
          .update({ processed_at: new Date().toISOString() })
          .eq('id', item.id)
      } catch (err) {
        logger.error('Erro ao aprender com ticket', { ticketId: item.ticket_id, err })
        await supabaseAdmin.from('support_learning_queue')
          .update({ 
            attempts: item.attempts + 1,
            last_error: err instanceof Error ? err.message : String(err)
          })
          .eq('id', item.id)
      }
    }
  }

  private async learnFromTicket(ticket: any): Promise<void> {
    // 1. Verifica se a resolução foi bem sucedida (ex: mensagens do agente/sistema)
    const messages = ticket.ticket_messages || []
    if (messages.length < 2) return // Precisa de pelo menos a pergunta e a resposta

    // 2. Chama Gemini para extrair conhecimento
    const model = this.genAI.getGenerativeModel({ 
      model: AI_CONFIG.model,
      generationConfig: { responseMimeType: 'application/json' }
    })

    const thread = messages
      .map((m: any) => `${m.author_role}: ${m.body}`)
      .join('\n\n')

    const prompt = `
Analise esta conversa de suporte e extraia conhecimento estruturado se houver uma solução clara e repetível.

Conversa:
${thread}

Ticket original:
Assunto: ${ticket.subject}
Descrição: ${ticket.description}

Se a conversa contiver uma solução útil, retorne JSON:
{
  "should_learn": true,
  "title": "<título claro do problema>",
  "problem_description": "<descrição técnica do problema>",
  "solution_summary": "<resumo da solução>",
  "solution_steps": [
    {"step": 1, "text": "...", "code": "... (opcional)"}
  ],
  "keywords": ["tag1", "tag2"],
  "confidence": 0.0 a 1.0
}

Caso contrário:
{"should_learn": false}

JSON:`.trim()

    const result = await model.generateContent(prompt)
    const aiResult = JSON.parse(result.response.text().replace(/```json|```/g, '').trim())

    if (!aiResult.should_learn || aiResult.confidence < 0.7) return

    // 3. Salva novo documento na KB (em rascunho)
    const { data: newDoc, error: docError } = await supabaseAdmin
      .from('support_knowledge_docs')
      .insert({
        category_id: ticket.category_id,
        title: aiResult.title,
        problem_description: aiResult.problem_description,
        solution_summary: aiResult.solution_summary,
        solution_steps: aiResult.solution_steps,
        keywords: aiResult.keywords,
        source_ticket_ids: [ticket.id],
        confidence_score: aiResult.confidence,
        status: 'draft'
      })
      .select()
      .single()

    if (docError) throw docError

    // 4. Gera embedding
    const contentToEmbed = `${aiResult.title}\n${aiResult.problem_description}\n${aiResult.solution_summary}`
    await embeddingService.upsertDocEmbedding(newDoc.id, contentToEmbed)

    logger.info('Novo conhecimento extraído e enfileirado para revisão', { ticketId: ticket.id, docId: newDoc.id })
    
    // Log de Interação
    await supabaseAdmin.from('ticket_ai_interactions').insert({
      ticket_id: ticket.id,
      interaction_type: 'learning_extraction',
      outcome: 'knowledge_extracted',
      model_used: AI_CONFIG.model
    })
  }
}

export const knowledgeLearningService = new KnowledgeLearningService()
