// Script de validação do motor de sentimento com Gemini real
// Executa: npx tsx scripts/test-sentiment.ts

import 'dotenv/config'
import { analyzeSentiment } from '../src/lib/sentiment.js'
import type { NormalizedReview, SourceChannel } from '../src/types/review.js'

function makeReview(channel: SourceChannel, body: string, rating?: number): NormalizedReview {
  return {
    tenant_id: 'test',
    business_id: 'test',
    connector_id: 'test',
    channel,
    external_id: `test-${Date.now()}`,
    published_at: new Date().toISOString(),
    sentiment: 'unanalyzed',
    body,
    rating,
    raw_data: {},
  }
}

const cases = [
  {
    label: '🟢 POSITIVO — Google Maps (5 estrelas)',
    review: makeReview('google_maps', 'Atendimento impecável! Fui muito bem atendido, resolveram tudo rapidinho. Recomendo demais!', 5),
  },
  {
    label: '🟡 NEUTRO — TripAdvisor (3 estrelas)',
    review: makeReview('tripadvisor', 'Hotel ok, nada de especial. Cama confortável mas o café da manhã poderia ser melhor. Custo-benefício razoável.', 3),
  },
  {
    label: '🔴 NEGATIVO — Trustpilot (2 estrelas)',
    review: makeReview('trustpilot', 'Comprei o produto e chegou com defeito. Tentei contato 3 vezes e ninguém me respondeu. Péssimo atendimento, muito decepcionante.', 2),
  },
  {
    label: '🚨 CRÍTICO — Reclame Aqui (cobrança + fraude)',
    review: makeReview('reclame_aqui', 'Cobraram R$500 indevidamente no meu cartão sem autorização! Já tentei cancelar 6 vezes, ninguém resolve. Vou registrar no Procon e entrar com processo judicial se não devolverem o dinheiro!'),
  },
  {
    label: '🔴 NEGATIVO — Reddit (sarcasmo)',
    review: makeReview('reddit', 'Parabéns para a empresa por conseguir a proeza de piorar o produto a cada update. Realmente impressionante o nível de descaso com o cliente.'),
  },
  {
    label: '🚨 CRÍTICO — Consumidor.gov (cancelamento)',
    review: makeReview('consumidor_gov', 'Solicitei o cancelamento da assinatura há 45 dias e continuam me cobrando. Não consigo cancelar pelo app, pelo telefone fico na fila por horas e o chat fecha sozinho. Situação absurda.'),
  },
]

console.log('\n🧠 Validação do Motor de Sentimento — Gemini Flash\n')
console.log('='.repeat(60))

for (const testCase of cases) {
  console.log(`\n${testCase.label}`)
  console.log(`📝 "${testCase.review.body?.slice(0, 80)}..."`)

  const result = await analyzeSentiment(testCase.review)

  const emoji = {
    positive: '🟢',
    neutral: '🟡',
    negative: '🔴',
    critical: '🚨',
    unanalyzed: '⬜',
  }[result.sentiment]

  console.log(`${emoji} Sentimento: ${result.sentiment.toUpperCase()} (score: ${result.dissatisfaction_score}/100, confiança: ${(result.confidence * 100).toFixed(0)}%)`)
  console.log(`📌 Tópicos: ${result.topics.join(', ')}`)
  console.log(`💬 Resumo: "${result.summary}"`)
  if (result.alert_reason) {
    console.log(`⚠️  Alerta: "${result.alert_reason}"`)
  }
  console.log(`🔧 Método: ${result.method}`)
}

console.log('\n' + '='.repeat(60))
console.log('✅ Validação concluída!\n')
