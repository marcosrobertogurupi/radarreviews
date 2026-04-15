import 'dotenv/config'

const url = process.env['SUPABASE_URL']!
const key = process.env['SUPABASE_SERVICE_ROLE_KEY']!

// Usar a API REST do PostgREST para descobrir o schema via HEAD request
// O PostgREST retorna o schema completo no header "Content-Range" e no body de OPTIONS
// Mas a melhor forma é ler o swagger spec que o PostgREST expõe

const res = await fetch(`${url}/rest/v1/`, {
  headers: {
    'apikey': key,
    'Authorization': `Bearer ${key}`,
    'Accept': 'application/openapi+json',
  }
})

if (res.ok) {
  const spec = await res.json() as any
  const tables = Object.keys(spec?.definitions ?? {})
  console.log('Tabelas no schema:')
  for (const t of tables) {
    const def = spec.definitions[t]
    const cols = Object.entries(def?.properties ?? {}).map(([k, v]: any) => `${k}:${v.type || v.format || 'unknown'}`)
    console.log(`\n📋 ${t}:`)
    console.log('  ', cols.join(', '))
  }
} else {
  console.log('Status:', res.status)
  const text = await res.text()
  console.log(text.slice(0, 500))
}
