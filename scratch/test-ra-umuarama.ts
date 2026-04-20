import 'dotenv/config'
import { run } from '../src/connectors/reclame-aqui.js'
import type { ChannelConnector } from '../src/types/connector.js'

const connector: ChannelConnector = {
  id: '5d713bd5-4dd8-4404-991c-faacf6aee63a',
  tenant_id: 'test',
  business_id: 'test',
  channel: 'reclame_aqui',
  external_id: 'umuarama-volkswagen-palmas-to',
  status: 'active',
  config: { timeout_ms: 45000, max_pages: 3, fetch_body: false },
  error_count: 0,
  first_error_at: null,
}

console.log('Iniciando teste para umuarama-volkswagen-palmas-to...')
const result = await run(connector)
console.log('Resultado:', JSON.stringify(result, null, 2))
