// Teste manual do conector Reddit — chama a API real do Reddit
// Uso: npx tsx scripts/test-reddit.ts
//
// Substitua SEARCH_TERMS pelos termos que quer buscar.

import 'dotenv/config'
import { run } from '../src/connectors/reddit/index.js'

const connector = {
  id:          'test-reddit-local',
  tenant_id:   'test-tenant',
  business_id: 'test-business',
  channel:     'reddit',
  status:      'active',
  config: {
    search_terms: ['Nubank', 'iFood'],  // ← altere aqui
    subreddits:   [],                   // [] = busca global; ou ['brasil', 'investimentos']
    limit_per_request: 5,
    delay_ms:  6000,
    since_days: 7,
  },
} as Parameters<typeof run>[0]

console.log('Iniciando teste do conector Reddit...')
console.log('search_terms:', connector.config.search_terms)
console.log('subreddits:', (connector.config as Record<string,unknown>).subreddits)
console.log()

const result = await run(connector)

console.log('\n── Resultado ──────────────────────')
console.log('reviews_fetched:', result.reviews_fetched)
console.log('reviews_new:    ', result.reviews_new)
console.log('reviews_updated:', result.reviews_updated)
if (result.error) console.error('error:', result.error)
