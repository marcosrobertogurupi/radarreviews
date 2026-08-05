/**
 * apify-monitor.ts — Monitoramento em tempo real das execuções do Apify
 *
 * Consulta a API REST do Apify para listar runs, calcular custo real e
 * detectar execuções desperdiçadoras (ex: buscar 247 itens, salvar 2).
 */

import axios from 'axios'

const APIFY_API = 'https://api.apify.com/v2'

// Mapa de actor ID → nome amigável (para exibição no Admin)
const ACTOR_LABELS: Record<string, string> = {
  'compass~google-maps-reviews-scraper': 'Google Maps Reviews',
  'gabruck97~reclameaqui':              'Reclame Aqui',
  'viralanalyzer~reclameaqui-scraper':   'Reclame Aqui (Legado)',
  'pear_fight~trustpilot-scraper':       'Trustpilot',
  'compass~tripadvisor-scraper':         'TripAdvisor (Legado)',
  'web_wanderer~tripadvisor-reviews-scraper': 'TripAdvisor',
  'apify~instagram-comment-scraper':     'Instagram Comments',
  'apify~instagram-scraper':             'Instagram',
  'apify~facebook-reviews-scraper':      'Facebook Reviews',
  'voyager~booking-reviews-scraper':     'Booking.com',
}

export interface ApifyRunSummary {
  runId: string
  actorId: string
  actorLabel: string
  status: 'SUCCEEDED' | 'FAILED' | 'ABORTED' | 'TIMED-OUT' | 'RUNNING' | string
  startedAt: string
  finishedAt: string | null
  durationSeconds: number | null
  datasetItemCount: number
  usageTotalUsd: number
  /** true quando o run custou > $0.10 mas salvou 0 itens no dataset */
  isWaste: boolean
  /** true quando custo por item > $0.05 */
  isExpensive: boolean
}

export interface ApifyAccountStats {
  currentMonthUsageUsd: number
  availableProxyCount: number
  planMonthlyUsageLimitUsd: number | null
}

/**
 * Busca os últimos N runs de TODOS os atores da conta Apify
 */
export async function getRecentRuns(limit = 50): Promise<ApifyRunSummary[]> {
  const token = process.env['APIFY_TOKEN']
  if (!token) throw new Error('APIFY_TOKEN não configurado')

  const res = await axios.get(`${APIFY_API}/actor-runs`, {
    params: { token, limit, desc: true },
    timeout: 15_000,
  })

  const runs: any[] = res.data?.data?.items ?? []
  return runs.map(r => mapRun(r))
}

/**
 * Busca runs de um actor específico
 */
export async function getRunsByActor(actorId: string, limit = 20): Promise<ApifyRunSummary[]> {
  const token = process.env['APIFY_TOKEN']
  if (!token) throw new Error('APIFY_TOKEN não configurado')

  const normalized = actorId.replace('/', '~')

  const res = await axios.get(`${APIFY_API}/acts/${normalized}/runs`, {
    params: { token, limit, desc: true },
    timeout: 15_000,
  })

  const runs: any[] = res.data?.data?.items ?? []
  return runs.map(r => mapRun(r, normalized))
}

/**
 * Busca detalhes de um run específico
 */
export async function getRunDetails(runId: string): Promise<ApifyRunSummary | null> {
  const token = process.env['APIFY_TOKEN']
  if (!token) throw new Error('APIFY_TOKEN não configurado')

  try {
    const res = await axios.get(`${APIFY_API}/actor-runs/${runId}`, {
      params: { token },
      timeout: 10_000,
    })
    return mapRun(res.data?.data)
  } catch {
    return null
  }
}

/**
 * Busca estatísticas de uso da conta Apify (custo mensal, plano)
 */
export async function getAccountStats(): Promise<ApifyAccountStats | null> {
  const token = process.env['APIFY_TOKEN']
  if (!token) return null

  try {
    const res = await axios.get(`${APIFY_API}/users/me`, {
      params: { token },
      timeout: 10_000,
    })
    const data = res.data?.data
    if (!data) return null

    return {
      currentMonthUsageUsd: data.monthlyUsage?.total ?? 0,
      availableProxyCount: data.proxy?.groups?.RESIDENTIAL?.availableCount ?? 0,
      planMonthlyUsageLimitUsd: data.plan?.monthlyUsageLimitUsd ?? null,
    }
  } catch {
    return null
  }
}

/**
 * Detecta runs que estão desperdiçando créditos:
 * - SUCCEEDED mas zero itens no dataset
 * - Custo por item > $0.05
 * - Total > $0.50
 */
export async function detectWasteRuns(limit = 100): Promise<ApifyRunSummary[]> {
  const runs = await getRecentRuns(limit)
  return runs.filter(r => r.isWaste || r.isExpensive || r.usageTotalUsd > 0.50)
}

/**
 * Retorna resumo de custo por actor para os últimos N runs
 */
export async function getCostByActor(
  limit = 100
): Promise<Record<string, { runs: number; totalUsd: number; totalItems: number }>> {
  const runs = await getRecentRuns(limit)
  const summary: Record<string, { runs: number; totalUsd: number; totalItems: number }> = {}

  for (const run of runs) {
    const label = run.actorLabel || run.actorId
    if (!summary[label]) {
      summary[label] = { runs: 0, totalUsd: 0, totalItems: 0 }
    }
    summary[label]!.runs++
    summary[label]!.totalUsd += run.usageTotalUsd
    summary[label]!.totalItems += run.datasetItemCount
  }

  return summary
}

// ---------------------------------------------------------------------------
// Helper interno
// ---------------------------------------------------------------------------

function mapRun(raw: any, actorIdHint?: string): ApifyRunSummary {
  const actorId: string = actorIdHint ?? raw.actId ?? raw.actorId ?? 'desconhecido'
  const actorLabel = ACTOR_LABELS[actorId] ?? actorId

  const startedAt: string = raw.startedAt ?? raw.createdAt ?? new Date().toISOString()
  const finishedAt: string | null = raw.finishedAt ?? null

  const durationMs = raw.stats?.durationMillis ?? (
    finishedAt ? new Date(finishedAt).getTime() - new Date(startedAt).getTime() : null
  )
  const durationSeconds = durationMs != null ? Math.round(durationMs / 1000) : null

  const datasetItemCount: number = raw.defaultDatasetItemCount ?? raw.stats?.datasetItemCount ?? 0

  const usageTotalUsd: number =
    raw.stats?.usageTotalUsd ?? raw.usageUsd?.total ?? raw.usageTotalUsd ?? 0

  const status: string = raw.status ?? 'UNKNOWN'

  // Desperdício: run bem-sucedido mas sem itens coletados e com custo
  const isWaste = status === 'SUCCEEDED' && datasetItemCount === 0 && usageTotalUsd > 0.001

  // Caro: custo por item acima de 5 centavos de dólar
  const costPerItem = datasetItemCount > 0 ? usageTotalUsd / datasetItemCount : usageTotalUsd
  const isExpensive = costPerItem > 0.05 && usageTotalUsd > 0.01

  return {
    runId: raw.id ?? 'unknown',
    actorId,
    actorLabel,
    status,
    startedAt,
    finishedAt,
    durationSeconds,
    datasetItemCount,
    usageTotalUsd,
    isWaste,
    isExpensive,
  }
}
