import { supabase } from './src/lib/supabase.js'
import { run as runGoogleMaps } from './src/connectors/google_maps/index.js'
import { run as runTripAdvisor } from './src/connectors/tripadvisor.js'

async function testConnectors() {
  const tenantId = '9882e497-3b31-4d05-a67f-156225d22566' // Confort Suites Hotel Goiania
  
  const { data: businesses } = await supabase.from('monitored_businesses').select('*').eq('tenant_id', tenantId)
  const businessIds = (businesses || []).map(b => b.id)

  const { data: connectors } = await supabase.from('channel_connectors').select('*').in('business_id', businessIds)

  for (const conn of connectors || []) {
    console.log(`\n==================================================`)
    console.log(`TESTANDO CONECTOR: ${conn.channel} (${conn.id})`)
    console.log(`External ID: ${conn.external_id}`)
    console.log(`Config:`, conn.config)
    console.log(`==================================================`)

    if (conn.channel === 'google_maps') {
      try {
        const res = await runGoogleMaps(conn)
        console.log('Resultado Google Maps:', res)
      } catch (err) {
        console.error('Erro Google Maps:', err)
      }
    } else if (conn.channel === 'tripadvisor') {
      try {
        const res = await runTripAdvisor(conn)
        console.log('Resultado TripAdvisor:', res)
      } catch (err) {
        console.error('Erro TripAdvisor:', err)
      }
    }
  }
}

testConnectors().catch(console.error)
