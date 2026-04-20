import 'dotenv/config'
import { tripadvisorTasksReady } from '../src/lib/dataforseo.js'

async function checkReady() {
  console.log('🔍 Verificando tarefas prontas na DataForSEO...')
  try {
    const res = await tripadvisorTasksReady()
    console.log('Resposta:', JSON.stringify(res, null, 2))
  } catch (err) {
    console.error('Erro:', err)
  }
}

checkReady()
