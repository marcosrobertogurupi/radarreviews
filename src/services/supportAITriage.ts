import { GoogleGenerativeAI } from '@google/generative-ai'
import { supabaseAdmin } from '../lib/supabase.js'
import { AI_CONFIG } from '../lib/ai-config.js'
import { logger } from '../lib/logger.js'
import { supportAIAgent } from './supportAIAgent.js'
import { addMinutes } from 'date-fns'

export class SupportAITriageService {
  private genAI: GoogleGenerativeAI

  constructor() {
    const apiKey = process.env['GEMINI_API_KEY']
    if (!apiKey) throw new Error('GEMINI_API_KEY não definida.')
    this.genAI = new GoogleGenerativeAI(apiKey)
  }

  async triage(ticketId: string): Promise<void> {
    try {
      // 1. Busca ticket + tenant + plano + categorias
      const { data: ticket, error: tError } = await supabaseAdmin
        .from('support_tickets')
        .select(`
          *,
          tenants (
            name,
            plan
          ),
          ticket_categories (name)
        `)
        .eq('id', ticketId)
        .single()

      if (tError || !ticket) throw tError || new Error('Ticket não encontrado')

      const { data: categories } = await supabaseAdmin
        .from('ticket_categories')
        .select('name')
        .eq('active', true)

      const categoriesList = (categories || []).map(c => c.name).join(', ')
      
      // Busca detalhes do plano para SLA
      const { data: planDoc } = await supabaseAdmin
        .from('plans')
        .select('id, name')
        .eq('slug', ticket.tenants?.plan || 'basico')
        .single()

      const planName = planDoc?.name || ticket.tenants?.plan || 'Básico'
      const planId = planDoc?.id || null

      // 2. Chama Gemini para triagem
      const model = this.genAI.getGenerativeModel({ 
        model: AI_CONFIG.model,
        generationConfig: { responseMimeType: 'application/json' }
      })

      const prompt = `
Você é um agente de triagem de suporte técnico para a Reputei, uma plataforma SaaS de monitoramento de reputação online.

Analise o ticket abaixo e retorne SOMENTE um JSON válido:

{
  "priority": "low" | "medium" | "high" | "critical",
  "category_name": "<uma das categorias listadas abaixo>",
  "sentiment": "positive" | "neutral" | "negative" | "frustrated",
  "summary": "<resumo em português, máx 120 caracteres>"
}

Ticket:
Assunto: ${ticket.subject}
Descrição: ${ticket.description}
Canal: ${ticket.channel}
Plano do tenant: ${planName}

Categorias disponíveis: ${categoriesList}

Critérios de prioridade:
- critical: sistema totalmente inacessível, perda de dados, impacto financeiro imediato
- high: funcionalidade principal quebrada, SLA de clientes afetado
- medium: funcionalidade degradada, workaround possível
- low: dúvida, melhoria, solicitação sem urgência

JSON:`.trim()

      const response = await model.generateContent(prompt)
      const raw = response.response.text()
      let result: any
      try {
        result = JSON.parse(raw)
      } catch {
        logger.warn('Erro ao parsear JSON de triagem, usando defaults', { raw })
        result = { priority: 'medium', sentiment: 'neutral', summary: 'Triagem falhou' }
      }

      // 3. Busca category_id se necessário
      let categoryId = ticket.category_id
      if (result.category_name) {
        const { data: cat } = await supabaseAdmin
          .from('ticket_categories')
          .select('id')
          .eq('name', result.category_name)
          .single()
        if (cat) categoryId = cat.id
      }

      // 4. Busca regra de SLA
      const priority = result.priority || 'medium'
      
      const { data: slaRule } = await supabaseAdmin
        .from('ticket_sla_rules')
        .select('*')
        .eq('priority', priority)
        .or(`plan_id.eq.${planId},plan_id.is.null`)
        .order('plan_id', { ascending: false }) // Prioriza regra específica do plano
        .limit(1)
        .single()

      const resolutionMins = slaRule?.resolution_mins || 2880 // Default 48h
      const slaDeadline = addMinutes(new Date(), resolutionMins)

      // 5. Atualiza ticket
      const { error: updError } = await supabaseAdmin
        .from('support_tickets')
        .update({
          priority,
          category_id: categoryId,
          ai_sentiment: result.sentiment,
          ai_summary: result.summary,
          status: 'ai_triaged',
          sla_deadline: slaDeadline.toISOString()
        })
        .eq('id', ticketId)

      if (updError) throw updError

      // 6. Auditoria
      await supabaseAdmin.from('ticket_audit_log').insert({
        ticket_id: ticketId,
        action: 'status_changed',
        from_value: 'open',
        to_value: 'ai_triaged',
        actor_role: 'ai',
        metadata: { triage_result: result }
      })

      // 7. Dispara Agente Autônomo
      supportAIAgent.handleNewTicket(ticketId).catch(err => {
        logger.error('Erro ao disparar SupportAIAgent pós-triagem', { ticketId, err })
      })

    } catch (error) {
      logger.error('Erro no SupportAITriageService', { ticketId, error })
    }
  }
}

export const supportAITriageService = new SupportAITriageService()
