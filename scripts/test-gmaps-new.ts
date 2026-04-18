import 'dotenv/config'
import { run } from '../src/connectors/google_maps/index.js'
import { logger } from '../src/lib/logger.js'

async function test() {
  const connector = {
    id: 'test-gmaps-scraper',
    tenant_id: 'test-tenant',
    business_id: 'test-business',
    channel: 'google_maps',
    external_id: 'ChIJN1t_tDeuEmsRUsoyG83frY4', // Place ID real (Sydney Opera House para teste)
    config: {
      mode: 'scraping',
      max_reviews: 10,
      since_days: 365
    },
    status: 'active'
  }

  logger.info('Iniciando teste do novo conector Google Maps...')
  
  try {
    const result = await run(connector as any)
    console.log('\n--- RESULTADO ---')
    console.log(JSON.stringify(result, null, 2))
    console.log('-----------------\n')
  } catch (error) {
    console.error('Falha no teste:', error)
  }
}

test()
