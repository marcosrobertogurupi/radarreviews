/**
 * Seed de dados demo — versão adaptada
 * Substitui 'critical' por 'negative' para compatibilidade com enum atual
 * enquanto o enum não é atualizado
 */
import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'

const sb = createClient(
  process.env['SUPABASE_URL']!,
  process.env['SUPABASE_SERVICE_ROLE_KEY']!
)

// Verificar os valores válidos do enum
async function checkEnum() {
  // Tentar inserir um review com sentiment='critical' para confirmar o erro
  const { error } = await sb.from('reviews').select('sentiment').limit(1)
  if (error) console.log('Erro sentimento:', error.message)

  // Tentar inserir com negative para ver se funciona
  console.log('Verificando enum de sentimento do banco...')
}

function daysAgo(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() - n)
  d.setHours(Math.floor(Math.random() * 16) + 8)
  d.setMinutes(Math.floor(Math.random() * 60))
  return d.toISOString()
}

// Agora que ALTER TYPE foi executado, 'critical' é válido!
function safeSentiment(s: string): string {
  return s // passar direto
}

async function getOrCreateTenant() {
  const { data } = await sb.from('tenants').select('id').limit(1)
  if (data?.[0]?.id) return data[0].id

  const { data: t, error } = await sb
    .from('tenants')
    .insert({ name: 'Demo Corp', slug: 'demo-corp', plan: 'pro', is_active: true })
    .select('id').single()
  if (error) throw new Error('Falha ao criar tenant: ' + error.message)
  return t!.id
}

async function getOrCreateBusiness(tenantId: string) {
  const { data } = await sb.from('monitored_businesses').select('id').eq('tenant_id', tenantId).limit(1)
  if (data?.[0]?.id) return data[0].id

  const { data: b, error } = await sb
    .from('monitored_businesses')
    .insert({ tenant_id: tenantId, name: 'Empresa Demo Ltda', cnpj: '00000000000100', is_active: true, category: 'varejo' })
    .select('id').single()
  if (error) throw new Error('Falha ao criar business: ' + error.message)
  return b!.id
}

async function getOrCreateConnector(tenantId: string, businessId: string, channel: string) {
  const { data } = await sb.from('channel_connectors').select('id')
    .eq('business_id', businessId).eq('channel', channel).limit(1)
  if (data?.[0]?.id) return data[0].id

  const { data: c, error } = await sb
    .from('channel_connectors')
    .insert({
      // tenant_id não existe em channel_connectors segundo o schema real
      business_id: businessId,
      channel,
      status: 'active',
      external_id: `demo-${channel}`,
      last_sync_at: new Date(Date.now() - Math.random() * 7200000).toISOString(),
      next_sync_at: new Date(Date.now() + Math.random() * 43200000).toISOString(),
      config: { demo: true },
    })
    .select('id').single()
  if (error) throw new Error(`Falha ao criar connector ${channel}: ` + error.message)
  return c!.id
}

const REVIEWS = [
  // Google Maps
  { ch: 'google_maps', id: 'gm-001', rating: 5, author: 'Maria Silva', body: 'Atendimento impecável! Fui muito bem atendida, resolveram tudo rapidinho. Super recomendo!', days: 1, sent: 'positive', score: 0, topics: ['atendimento', 'elogio'], summary: 'Elogio ao atendimento impecável e rapidez na resolução.', method: 'gemini', conf: 0.99 },
  { ch: 'google_maps', id: 'gm-002', rating: 2, author: 'Carlos Oliveira', body: 'Atendimento demorado e equipe mal treinada. Fui atendido após 40 minutos de espera sem satisfação alguma.', days: 3, sent: 'negative', score: 72, topics: ['atendimento'], summary: 'Cliente insatisfeito com tempo de espera e qualidade do atendimento.', alert: 'Atendimento abaixo do esperado — revisar processos de fila e treinamento da equipe.', method: 'gemini', conf: 0.95 },
  // TripAdvisor
  { ch: 'tripadvisor', id: 'ta-001', rating: 3, author: 'Ana Rodrigues', title: 'Hotel ok, mas esperava mais', body: 'Hotel ok, nada de especial. Cama confortável mas o café da manhã poderia ser melhor. Custo-benefício mediano.', days: 2, sent: 'neutral', score: 45, topics: ['produto'], summary: 'Experiência mediana — cama confortável mas café da manhã e custo-benefício abaixo do esperado.', method: 'gemini', conf: 0.90 },
  { ch: 'tripadvisor', id: 'ta-002', rating: 5, author: 'Pedro Mendes', title: 'Excelente estadia!', body: 'Tudo perfeito! Equipe super atenciosa, quarto limpo e confortável. Voltarei com certeza!', days: 5, sent: 'positive', score: 2, topics: ['atendimento', 'elogio'], summary: 'Hóspede muito satisfeito com equipe, quarto e pretende retornar.', method: 'gemini', conf: 0.98 },
  // Trustpilot
  { ch: 'trustpilot', id: 'tp-001', rating: 1, author: 'Fernanda Costa', body: 'Comprei o produto e chegou com defeito. Tentei contato 3 vezes e ninguém me respondeu. Produto inutilizável e sem suporte.', days: 1, sent: 'negative', score: 95, topics: ['produto', 'atendimento'], summary: 'Produto chegou com defeito e cliente não obteve resposta após 3 tentativas de contato.', alert: 'Investigar defeito do produto e falha grave no atendimento ao cliente.', method: 'gemini', conf: 0.98 },
  { ch: 'trustpilot', id: 'tp-002', rating: 4, author: 'Rodrigo Lima', body: 'Boa empresa, entrega no prazo e produto de qualidade. Só achei o preço um pouco elevado.', days: 4, sent: 'positive', score: 15, topics: ['produto', 'entrega'], summary: 'Cliente satisfeito com entrega e qualidade, menciona preço elevado.', method: 'gemini', conf: 0.88 },
  // Reclame Aqui
  { ch: 'reclame_aqui', id: 'ra-001', author: 'Lucia Pereira', title: 'COBRANÇA INDEVIDA - POSSÍVEL FRAUDE', body: 'Cobraram R$500 indevidamente no meu cartão sem autorização! Já tentei cancelar 6 vezes e não conseguem resolver. Vou ao Procon e BACEN se não resolverem HOJE.', days: 0, sent: 'negative', score: 98, topics: ['cobrança', 'cancelamento', 'reembolso'], summary: 'Cobrança indevida de R$500, tentativas de cancelamento sem sucesso, ameaça ao Procon e BACEN.', alert: 'Risco jurídico iminente — resolver cobrança indevida imediatamente e contatar cliente.', method: 'gemini', conf: 0.99 },
  { ch: 'reclame_aqui', id: 'ra-002', author: 'Marcos Santos', title: 'Produto chegou errado e sem retorno', body: 'Pedi o produto azul e veio o vermelho. Mandei email há 5 dias e nenhuma resposta. Não vou comprar mais aqui.', days: 2, sent: 'negative', score: 68, topics: ['produto', 'atendimento', 'entrega'], summary: 'Produto entregue incorretamente e falta de resposta por 5 dias gera insatisfação.', alert: 'Responder dentro do prazo do Reclame Aqui para evitar penalidade no índice de reputação.', method: 'gemini', conf: 0.95 },
  { ch: 'reclame_aqui', id: 'ra-003', author: 'Beatriz Alves', title: 'Cancelamento não processado — 45 dias', body: 'Solicitei o cancelamento há 45 dias e continuam me cobrando mensalmente. Já mandei email, WhatsApp, ligação. Ninguém resolve.', days: 1, sent: 'negative', score: 96, topics: ['cancelamento', 'cobrança', 'atendimento'], summary: 'Cancelamento não processado em 45 dias com cobranças indevidas continuando.', alert: 'Cancelamento urgente — cliente em risco de ação judicial por cobrança abusiva.', method: 'gemini', conf: 0.99 },
  // Consumidor.gov
  { ch: 'consumidor_gov', id: 'cg-001', author: 'Roberto Gomes', body: 'Solicitei o cancelamento da assinatura há 45 dias e continuam me cobrando. Não consigo falar com ninguém. Abri reclamação no Consumidor.gov esperando resolução.', days: 3, sent: 'negative', score: 95, topics: ['cancelamento', 'cobrança', 'atendimento'], summary: 'Cliente não consegue cancelar assinatura há 45 dias e continua sendo cobrado.', alert: 'Responder urgentemente ao Consumidor.gov — prazo legal em risco.', method: 'gemini', conf: 0.98 },
  // Reddit
  { ch: 'reddit', id: 'rd-001', author: 'u/usuario_tech', title: 'App de vocês é uma bagunça', body: 'Parabéns por conseguirem piorar o produto a cada update. App trava a cada 5 minutos. Genial.', days: 1, sent: 'negative', score: 78, topics: ['app_plataforma', 'produto'], summary: 'Post sarcástico sobre instabilidade do app após atualizações — alto engajamento negativo.', alert: 'Post viral detectado — monitorar engajamento e comunicar equipe de produto.', method: 'gemini', conf: 0.85, upvotes: 47, comments: 23 },
  { ch: 'reddit', id: 'rd-002', author: 'u/dev_marcos', title: 'Review honesto após 6 meses', body: 'Uso há 6 meses. Prós: suporte rápido, funciona bem. Contras: preço subiu 30% sem aviso. No geral vale a pena.', days: 6, sent: 'neutral', score: 35, topics: ['atendimento', 'produto'], summary: 'Review balanceado: elogia suporte mas critica aumento de preço.', method: 'gemini', conf: 0.88, upvotes: 12 },
  // Facebook
  { ch: 'facebook', id: 'fb-001', rating: 1, author: 'Tatiane Sousa', body: 'Absurdo! Serviço horrível, não entregam o que prometem. Enganam os clientes. CUIDADO!', days: 0, sent: 'negative', score: 92, topics: ['atendimento', 'produto'], summary: 'Review extremamente negativo alertando outros usuários sobre promessas não cumpridas.', alert: 'Review público de 1 estrela — responder para mitigar dano de reputação.', method: 'gemini', conf: 0.96 },
  { ch: 'facebook', id: 'fb-002', rating: 5, author: 'Sandra Nascimento', body: 'Amei o atendimento! Equipe sempre disponível e super prestativa. Produto de qualidade e entrega rápida!', days: 4, sent: 'positive', score: 3, topics: ['atendimento', 'entrega', 'elogio'], summary: 'Elogio ao atendimento, produto e agilidade na entrega.', method: 'gemini', conf: 0.97 },
  // Instagram
  { ch: 'instagram', id: 'ig-001', author: 'influencer_paulista', body: 'Que decepção esse produto... Na foto parecia perfeito mas quando chegou era completamente diferente. Não recomendo 👎', days: 2, sent: 'negative', score: 75, topics: ['produto'], summary: 'Influencer decepcionada com diferença entre foto e produto real — alta visibilidade.', alert: 'Comentário de influencer com alta visibilidade — responder publicamente e oferecer solução.', method: 'gemini', conf: 0.93, upvotes: 89 },
  { ch: 'instagram', id: 'ig-002', author: 'mari_viagens', body: 'Simplesmente perfeito! ✨ Melhor compra do mês sem dúvidas. Já recomendei pra todas as amigas!', days: 1, sent: 'positive', score: 0, topics: ['elogio'], summary: 'Comentário extremamente positivo com alta visibilidade e indicação.', method: 'gemini', conf: 0.99, upvotes: 156 },
]

async function seed() {
  console.log('🌱 Iniciando seed de dados demo...\n')

  const tenantId = await getOrCreateTenant()
  const businessId = await getOrCreateBusiness(tenantId)
  console.log(`✅ tenant=${tenantId.slice(0,8)}... business=${businessId.slice(0,8)}...`)

  const channels = [...new Set(REVIEWS.map(r => r.ch))]
  const connectorMap: Record<string, string> = {}
  for (const ch of channels) {
    connectorMap[ch] = await getOrCreateConnector(tenantId, businessId, ch)
  }
  console.log(`✅ ${channels.length} conectores criados/verificados`)

  const rows = REVIEWS.map(r => ({
    tenant_id: tenantId,
    business_id: businessId,
    connector_id: connectorMap[r.ch],
    channel: r.ch,
    external_id: r.id,
    rating: (r as any).rating,
    author_name: r.author,
    title: (r as any).title,
    body: r.body,
    upvotes: (r as any).upvotes,
    comment_count: (r as any).comments,
    url: `https://demo.example.com/reviews/${r.id}`,
    language: 'pt',
    published_at: daysAgo((r as any).days),
    sentiment: safeSentiment(r.sent),     // ← 'critical' → 'negative' temporariamente
    dissatisfaction_score: r.score,
    sentiment_topics: r.topics,
    sentiment_summary: r.summary,
    sentiment_result: {
      sentiment: r.sent,                   // ← aqui mantemos o valor real para exibição
      dissatisfaction_score: r.score,
      confidence: r.conf,
      topics: r.topics,
      summary: r.summary,
      alert_reason: (r as any).alert,
      method: r.method,
    },
    raw_data: { demo: true },
  }))

  const { data, error } = await sb
    .from('reviews')
    .upsert(rows, { onConflict: 'channel,external_id', ignoreDuplicates: false })
    .select('id, channel, sentiment, dissatisfaction_score')

  if (error) {
    console.error('❌ Erro:', error.message)
    return
  }

  console.log(`\n✅ ${data?.length} reviews inseridos!\n`)
  console.log('📊 Distribuição:')
  const dist: Record<string, number> = {}
  for (const r of data ?? []) dist[r.sentiment] = (dist[r.sentiment] || 0) + 1
  for (const [s, n] of Object.entries(dist)) {
    console.log(`   ${s === 'negative' ? '🔴' : s === 'neutral' ? '🟡' : '🟢'} ${s}: ${n}`)
  }

  // Alertas para reviews de alto score
  const highScore = rows.filter(r => r.dissatisfaction_score >= 68)
  console.log(`\n🔔 Criando ${highScore.length} alertas...`)

  // Buscar/criar regra
  let ruleId: string | null = null
  const { data: existingRule } = await sb.from('alert_rules').select('id').eq('business_id', businessId).limit(1)
  if (existingRule?.[0]?.id) {
    ruleId = existingRule[0].id
  } else {
    const { data: nr, error: rErr } = await sb.from('alert_rules').insert({
      tenant_id: tenantId,
      business_id: businessId,
      name: 'Review Crítico — IA',
      condition_type: 'critical_review',
      threshold: 68,
      is_active: true,
      channel: 'reclame_aqui',   // campo obrigatório; criamos uma regra geral
      notify_webhook: null,
      notify_email: false,
    }).select('id').single()
    if (rErr) console.warn('Regra:', rErr.message)
    ruleId = nr?.id ?? null
  }

  if (ruleId) {
    const alerts = highScore.map(r => ({
      rule_id: ruleId,
      business_id: businessId,
      channel: r.channel,
      triggered_at: r.published_at,  // campo real é triggered_at
      notified: false,                // campo real, não resolved_at
      detail: {
        condition_type: 'critical_review',
        review_external_id: r.external_id,
        review_channel: r.channel,
        review_rating: r.rating,
        review_sentiment: r.sentiment_result?.sentiment ?? r.sentiment,
        review_dissatisfaction_score: r.dissatisfaction_score,
        review_body_preview: (r.body || '').slice(0, 200),
        review_author: r.author_name,
        review_url: r.url,
        review_published_at: r.published_at,
        triggered_by_rule: 'critical_review',
        sentiment_score: r.dissatisfaction_score,
        sentiment_topics: r.sentiment_topics,
        sentiment_summary: r.sentiment_summary,
        alert_reason: r.sentiment_result?.alert_reason,
        analysis_method: r.sentiment_result?.method,
      }
    }))

    const { error: aErr } = await sb.from('alert_events').insert(alerts)
    if (aErr) console.warn('⚠️ Alertas:', aErr.message)
    else console.log(`✅ ${alerts.length} alertas criados!`)
  }

  console.log('\n🎉 Seed concluído! Acesse: http://localhost:5173')
  console.log('\n⚠️  Nota: Para habilitar "critical" como sentimento separado,')
  console.log('   execute este SQL no Supabase:')
  console.log('   ALTER TYPE sentiment_type ADD VALUE \'critical\' AFTER \'negative\';')
}

seed().catch(console.error)
