import { supabase } from './supabase.js'
import { logger } from './logger.js'

/**
 * Executa a atualização diária de métricas de concorrentes no Google Maps
 */
export async function runBenchmarkingJob(): Promise<void> {
  logger.info('[ai-jobs] Iniciando Job de Benchmarking de Concorrentes')
  try {
    const { updateCompetitorStats } = await import('../services/ai/benchmarking.js')
    await updateCompetitorStats()
    logger.info('[ai-jobs] Job de Benchmarking finalizado.')
  } catch (err: any) {
    logger.error('[ai-jobs] Falha crítica no Job de Benchmarking:', { error: err.message || err })
  }
}

/**
 * Processa a análise de tópicos recorrentes via Gemini para todas as empresas ativas
 */
export async function runTopicsAnalysisJob(): Promise<void> {
  logger.info('[ai-jobs] Iniciando Job de Análise de Temas Recorrentes (Gemini)')
  try {
    const { data: businesses, error } = await supabase
      .from('monitored_businesses')
      .select('id, name')
      .eq('is_active', true)

    if (error) {
      logger.error('[ai-jobs] Erro ao buscar empresas ativas para tópicos:', { error })
      return
    }

    if (!businesses || businesses.length === 0) {
      logger.debug('[ai-jobs] Nenhuma empresa ativa cadastrada para análise de tópicos.')
      return
    }

    const { processBusinessTopics } = await import('../services/ai/topics.js')
    
    logger.info(`[ai-jobs] Processando nuvem de temas para ${businesses.length} empresa(s).`)
    
    for (const biz of businesses) {
      try {
        logger.debug(`[ai-jobs] Analisando tópicos para: ${biz.name} (${biz.id})`)
        await processBusinessTopics(biz.id)
      } catch (bizErr: any) {
        logger.error(`[ai-jobs] Erro ao analisar tópicos da empresa ${biz.name}:`, { error: bizErr.message || bizErr })
      }
    }
    logger.info('[ai-jobs] Job de Análise de Temas finalizado.')
  } catch (err: any) {
    logger.error('[ai-jobs] Falha crítica no Job de Análise de Temas:', { error: err.message || err })
  }
}
