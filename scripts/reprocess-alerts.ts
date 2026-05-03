import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import { checkAlerts } from '../src/lib/alerts.js'
import { logger } from '../src/lib/logger.js'

dotenv.config()

const supabaseUrl = process.env.SUPABASE_URL || ''
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const supabaseAdmin = createClient(supabaseUrl, supabaseKey)

async function reprocess() {
  console.log('--- Iniciando Reprocessamento de Alertas (Retroativo 30 dias) ---')
  
  const cutoff = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString()
  
  // 1. Buscar todos os reviews dos últimos 30 dias que podem ser críticos ou negativos
  console.log(`Buscando reviews desde ${cutoff}...`)
  
  const { data: reviews, error } = await supabaseAdmin
    .from('reviews')
    .select('*')
    .gte('published_at', cutoff)
    .in('sentiment', ['negative', 'critical'])
    .order('published_at', { ascending: true })

  if (error) {
    console.error('Erro ao buscar reviews:', error.message)
    return
  }

  if (!reviews || reviews.length === 0) {
    console.log('Nenhum review crítico/negativo encontrado nos últimos 30 dias.')
    return
  }

  console.log(`Encontrados ${reviews.length} reviews potenciais. Agrupando por empresa/canal...`)

  // 2. Agrupar por business_id e channel para processar em lotes
  const groups = new Map<string, any[]>()
  for (const review of reviews) {
    const key = `${review.business_id}:${review.channel}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(review)
  }

  console.log(`Processando ${groups.size} grupos de monitoramento...`)

  for (const [key, batch] of groups.entries()) {
    const [businessId, channel] = key.split(':')
    console.log(`- Processando ${batch.length} reviews para Business: ${businessId}, Canal: ${channel}`)
    
    try {
      // checkAlerts já lida com a busca de regras e criação de eventos
      await checkAlerts(batch as any, businessId, channel as any)
    } catch (err) {
      console.error(`Erro ao processar alertas para ${key}:`, err)
    }
  }

  console.log('--- Reprocessamento concluído! Verifique a aba de Alertas no dashboard. ---')
}

reprocess().catch(console.error)
