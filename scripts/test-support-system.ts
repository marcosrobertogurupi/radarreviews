import 'dotenv/config'
import { supabaseAdmin } from '../src/lib/supabase.js'
import { supportAITriageService } from '../src/services/supportAITriage.js'
import { embeddingService } from '../src/services/embeddingService.js'
import { supportAIAgent } from '../src/services/supportAIAgent.js'
import { knowledgeLearningService } from '../src/services/knowledgeLearningService.js'

async function runTests() {
  console.log('🚀 Iniciando testes do Sistema de Suporte...')

  // 0. Preparação: Buscar um tenant real para os testes
  const { data: tenant } = await supabaseAdmin.from('tenants').select('id, name').limit(1).single()
  if (!tenant) {
    console.error('❌ Nenhum tenant encontrado no banco para testes.')
    return
  }
  const tenantId = tenant.id
  console.log(`Using tenant: ${tenant.name} (${tenantId})`)

  // 1. Teste de Embedding e KB
  console.log('\n--- Teste 1: Base de Conhecimento ---')
  const { data: cat } = await supabaseAdmin.from('ticket_categories').select('id').limit(1).single()
  const { data: doc, error: docErr } = await supabaseAdmin.from('support_knowledge_docs').insert({
    title: 'Como configurar o Google Maps',
    problem_description: 'O usuário não consegue ver os reviews do Google Maps no dashboard.',
    solution_summary: 'É necessário configurar o Place ID no painel administrativo.',
    solution_steps: [
      { step: 1, text: 'Vá em Conectores' },
      { step: 2, text: 'Clique em Google Maps' },
      { step: 3, text: 'Insira o Place ID' }
    ],
    status: 'active',
    category_id: cat?.id
  }).select().single()

  if (docErr) {
    console.error('❌ Erro ao criar documento mock:', docErr)
  } else {
    console.log('✅ Documento mock criado:', doc.title)
    await embeddingService.upsertDocEmbedding(doc.id, `${doc.title} ${doc.problem_description} ${doc.solution_summary}`)
    console.log('✅ Embedding gerado e salvo.')

    const searchResults = await embeddingService.searchKnowledge('meu google maps não funciona')
    console.log(`✅ Busca semântica retornou ${searchResults.length} resultados.`)
    if (searchResults[0]) {
      console.log('   Melhor match:', searchResults[0].title, `(Similarity: ${searchResults[0].similarity.toFixed(4)})`)
    }
  }

  // 2. Teste de Triagem
  console.log('\n--- Teste 2: Triagem de Ticket ---')
  const { data: user } = await supabaseAdmin.from('tenant_users').select('user_id').eq('tenant_id', tenantId).limit(1).single()
  
  const { data: ticket, error: tErr } = await supabaseAdmin.from('support_tickets').insert({
    tenant_id: tenantId,
    created_by: user?.user_id,
    subject: 'Problema urgente com Google Maps',
    description: 'Não estou conseguindo ver meus reviews do Google. Diz que falta configuração.',
    channel: 'portal'
  }).select().single()

  if (tErr) {
    console.error('❌ Erro ao criar ticket:', tErr)
  } else {
    console.log('✅ Ticket criado:', ticket.ticket_number)
    await supportAITriageService.triage(ticket.id)
    
    const { data: triaged } = await supabaseAdmin.from('support_tickets').select('*').eq('id', ticket.id).single()
    console.log('✅ Triagem concluída:')
    console.log('   Prioridade:', triaged.priority)
    console.log('   Sentimento:', triaged.ai_sentiment)
    console.log('   Resumo:', triaged.ai_summary)
  }

  // 3. Teste do Agente Autônomo
  console.log('\n--- Teste 3: Agente Autônomo ---')
  if (ticket) {
    await supportAIAgent.handleNewTicket(ticket.id)
    const { data: updatedTicket } = await supabaseAdmin.from('support_tickets').select('*').eq('id', ticket.id).single()
    const { data: messages } = await supabaseAdmin.from('ticket_messages').select('*').eq('ticket_id', ticket.id)
    
    console.log('✅ Agente processou o ticket.')
    console.log('   Status final:', updatedTicket.status)
    if (messages?.length) {
      console.log('   Resposta da IA enviada!')
    } else if (updatedTicket.ai_draft_response) {
      console.log('   Rascunho gerado (confiança média).')
    } else {
      console.log('   IA decidiu por encaminhamento humano.')
    }
  }

  // 4. Teste de Aprendizado
  console.log('\n--- Teste 4: Fila de Aprendizado ---')
  if (ticket) {
    await knowledgeLearningService.queueTicket(ticket.id)
    console.log('✅ Ticket enviado para fila de aprendizado.')
    
    const { data: queueItem } = await supabaseAdmin.from('support_learning_queue').select('*').eq('ticket_id', ticket.id).single()
    console.log('   Status na fila:', queueItem ? 'Presente' : 'Ausente')
  }

  console.log('\n✨ Testes finalizados.')
}

runTests().catch(console.error)
