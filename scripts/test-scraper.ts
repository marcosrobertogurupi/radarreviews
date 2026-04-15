import 'dotenv/config'
import { run } from '../src/connectors/reclame-aqui.js'
import type { ChannelConnector } from '../src/types/connector.js'

async function test() {
  const dummy: ChannelConnector = {
    id: 'dummy',
    business_id: 'dummy_bus',
    tenant_id: 'dummy_tenant',
    channel: 'reclame_aqui',
    external_id: 'nubank',
    status: 'active',
    config: {},
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  }

  const result = await run(dummy)
  console.log('Result:', result)
}

test()
