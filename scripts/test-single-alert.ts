import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import { checkAlerts } from '../src/lib/alerts.js'

dotenv.config()

const supabaseUrl = process.env.SUPABASE_URL || ''
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const supabaseAdmin = createClient(supabaseUrl, supabaseKey)

async function testSingle() {
  console.log('--- Testando um único alerta crítico ---')
  
  // Pegar um review crítico recente do Confort Suites
  const { data: reviews, error } = await supabaseAdmin
    .from('reviews')
    .select('*')
    .eq('tenant_id', '9882e497-3b31-4d05-a67f-156225d22566')
    .eq('sentiment', 'critical')
    .limit(1)

  if (error || !reviews || reviews.length === 0) {
    console.error('Nenhum review crítico encontrado para teste.')
    return
  }

  const review = reviews[0]
  console.log(`Disparando alerta para o review de ${review.author_name}...`)

  // Deletar evento anterior se existir para não dar erro de duplicata no teste (se houver constraint)
  // No caso checkAlerts apenas insere.
  
  await checkAlerts([review] as any, review.business_id, review.channel as any)
  
  console.log('Alerta disparado! Verifique seu WhatsApp.')
}

testSingle().catch(console.error)
