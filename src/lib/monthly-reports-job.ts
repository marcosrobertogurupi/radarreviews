import { supabase } from './supabase.js'
import { logger } from './logger.js'
import { processMonthlyReport } from '../services/reports/pdf-generator.js'
import { format, subMonths } from 'date-fns'

/**
 * Verifica e gera relatórios para todos os tenants ativos no primeiro dia do mês.
 */
export async function runMonthlyReportsJob(): Promise<void> {
  const now = new Date()
  
  // Só roda se for dia 1 entre 00h e 04h (janela de execução)
  if (now.getDate() !== 1 || now.getHours() > 4) {
    return
  }

  const monthYear = format(subMonths(now, 1), 'yyyy-MM') // Relatório do mês que passou
  logger.info(`[monthly-job] Iniciando geração de relatórios para ${monthYear}`)

  try {
    // 1. Buscar todos os tenants ativos
    const { data: tenants } = await supabase
      .from('tenants')
      .select('id, name')
      .eq('is_active', true)

    if (!tenants) return

    for (const tenant of tenants) {
      try {
        // 2. Verificar se já existe relatório para este mês (evitar duplicidade no re-run)
        const { data: existing } = await supabase
          .from('reports')
          .select('id')
          .eq('tenant_id', tenant.id)
          .eq('month_year', monthYear)
          .single()

        if (existing) {
          logger.debug(`[monthly-job] Relatório já existe para ${tenant.name} (${monthYear})`)
          continue
        }

        // 3. Gerar e salvar
        await processMonthlyReport(tenant.id, monthYear)
        logger.info(`[monthly-job] Relatório gerado com sucesso: ${tenant.name}`)

      } catch (err) {
        logger.error(`[monthly-job] Falha ao gerar relatório para ${tenant.name}:`, err)
      }
    }

    logger.info(`[monthly-job] Ciclo concluído para ${monthYear}`)
  } catch (err) {
    logger.error('[monthly-job] Erro geral no job de relatórios:', err)
  }
}
