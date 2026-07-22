// Conector Consumidor.gov.br — Dados Abertos (CSV / ZIP Mensal)
//
// Comportamento:
// - Baixa a base de dados abertos do Consumidor.gov.br (ZIP ou CSV).
// - Suporta descompactação de ZIPs comprimidos via Deflate64 (método 9) via @zip.js/zip.js.
// - Mapeia dinamicamente os cabeçalhos das colunas (compatível com CSVs oficiais e legados).
// - Filtra por CNPJ ou Nome Fantasia da empresa monitorada.
// - Deduplicação: Hash SHA256 (Identificador + Data + Descrição).

import axios from 'axios'
import { parse } from 'csv-parse/sync'
import iconv from 'iconv-lite'
import { createHash } from 'crypto'
import * as cheerio from 'cheerio'
import { ZipReader, Uint8ArrayWriter, Uint8ArrayReader } from '@zip.js/zip.js'
import { supabase } from '../lib/supabase.js'
import { logger } from '../lib/logger.js'
import { ingestReviews } from '../lib/ingest.js'
import type { ChannelConnector, JobResult } from '../types/connector.js'
import type { NormalizedReview } from '../types/review.js'

const CHANNEL = 'consumidor_gov' as const

interface ColumnIndices {
  DATA: number
  CNPJ: number
  NOME_FANTASIA: number
  ASSUNTO: number
  DESCRICAO: number
  NOTA: number
  RESOLVIDO: number
  TEMPO_RESPOSTA: number
  SEGMENTO: number
  AREA: number
}

function parseHeaders(headerRow: any[]): ColumnIndices {
  const norm = (s: string) =>
    String(s || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()

  let dataIdx = -1
  let cnpjIdx = -1
  let nomeFantasiaIdx = -1
  let assuntoIdx = -1
  let descIdx = -1
  let notaIdx = -1
  let resolvidoIdx = -1
  let tempoRespostaIdx = -1
  let segmentoIdx = -1
  let areaIdx = -1

  headerRow.forEach((col, i) => {
    const c = norm(col)
    if (c.includes('dataabertura') || c.includes('data finalizacao') || c.includes('data')) {
      if (dataIdx === -1 || c.includes('finalizacao') || c.includes('abertura')) dataIdx = i
    }
    if (c.includes('cnpj')) cnpjIdx = i
    if (c.includes('nome fantasia') || c.includes('empresa')) nomeFantasiaIdx = i
    if (c.includes('assunto')) assuntoIdx = i
    if (c.includes('descricao') || c.includes('problema')) {
      if (descIdx === -1 || c.includes('descricao')) descIdx = i
    }
    if (c.includes('nota')) notaIdx = i
    if (c.includes('resolvido') || c.includes('situacao') || c.includes('avaliacao reclamacao')) resolvidoIdx = i
    if (c.includes('tempo resposta') || c.includes('temporespo')) tempoRespostaIdx = i
    if (c.includes('segmento')) segmentoIdx = i
    if (c.includes('area')) areaIdx = i
  })

  return {
    DATA: dataIdx !== -1 ? dataIdx : 0,
    CNPJ: cnpjIdx !== -1 ? cnpjIdx : 15,
    NOME_FANTASIA: nomeFantasiaIdx !== -1 ? nomeFantasiaIdx : 7,
    ASSUNTO: assuntoIdx !== -1 ? assuntoIdx : 11,
    DESCRICAO: descIdx !== -1 ? descIdx : 21,
    NOTA: notaIdx !== -1 ? notaIdx : 22,
    RESOLVIDO: resolvidoIdx !== -1 ? resolvidoIdx : 27,
    TEMPO_RESPOSTA: tempoRespostaIdx !== -1 ? tempoRespostaIdx : 28,
    SEGMENTO: segmentoIdx !== -1 ? segmentoIdx : 17,
    AREA: areaIdx !== -1 ? areaIdx : 18,
  }
}

export async function run(connector: ChannelConnector): Promise<JobResult> {
  const result: JobResult = {
    reviews_fetched: 0,
    reviews_new: 0,
    reviews_updated: 0,
  }

  try {
    // 1. Obter informações da empresa (CNPJ e Nome Fantasia)
    const { data: business, error: bError } = await supabase
      .from('monitored_businesses')
      .select('name, cnpj')
      .eq('id', connector.business_id)
      .single()

    if (bError || (!business?.cnpj && !business?.name)) {
      throw new Error(`Empresa ${connector.business_id} não possui CNPJ cadastrado.`)
    }

    const targetCnpj = business.cnpj ? business.cnpj.replace(/\D/g, '') : ''
    const targetName = (business.name || '').trim().toLowerCase()

    // 2. Determinar URL do dataset
    const now = new Date()
    const month = now.getMonth() === 0 ? 12 : now.getMonth()
    const year = month === 12 ? now.getFullYear() - 1 : now.getFullYear()

    let csvUrl = connector.config['resource_url'] as string
    if (!csvUrl) {
      let discoverTimeoutHandle: ReturnType<typeof setTimeout> | undefined
      const discoverPromise = discoverLatestUrl(connector.id, year, month)
      const discoverTimeoutPromise = new Promise<never>((_, reject) => {
        discoverTimeoutHandle = setTimeout(() => reject(new Error('Timeout de 30 segundos ao descobrir a URL do CSV')), 30000)
      })
      try {
        csvUrl = await Promise.race([discoverPromise, discoverTimeoutPromise])
      } finally {
        if (discoverTimeoutHandle) clearTimeout(discoverTimeoutHandle)
      }
    }

    logger.info(`[${CHANNEL}] Iniciando processamento de CSV`, {
      connector_id: connector.id,
      cnpj: targetCnpj,
      name: targetName,
      url: csvUrl,
    })

    // 3. Download do dataset (suporta arraybuffer ou stream para compatibilidade com mocks)
    const response = await axios.get(csvUrl, {
      responseType: 'arraybuffer',
      timeout: 120000,
      maxContentLength: 500 * 1024 * 1024,
      maxBodyLength: 500 * 1024 * 1024,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        Referer: 'https://www.consumidor.gov.br/pages/dadosabertos/externo/',
      },
    })

    let rawBuffer: Buffer
    if (Buffer.isBuffer(response.data)) {
      rawBuffer = response.data
    } else if (response.data instanceof ArrayBuffer) {
      rawBuffer = Buffer.from(response.data)
    } else if (typeof response.data === 'string') {
      rawBuffer = Buffer.from(response.data)
    } else if (response.data && typeof response.data.on === 'function') {
      const chunks: Buffer[] = []
      for await (const chunk of response.data) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
      }
      rawBuffer = Buffer.concat(chunks)
    } else {
      rawBuffer = Buffer.from(response.data || '')
    }

    let csvText = ''

    // Verifica se os dados baixados correspondem a um arquivo ZIP (magic bytes "PK")
    if (rawBuffer.length >= 4 && rawBuffer[0] === 0x50 && rawBuffer[1] === 0x4b) {
      logger.info(`[${CHANNEL}] Arquivo ZIP detectado, descompactando...`)
      const zipData = new Uint8Array(rawBuffer)
      const zipReader = new ZipReader(new Uint8ArrayReader(zipData))
      const entries = await zipReader.getEntries()
      const csvEntry = entries.find(e => !e.directory && e.filename.endsWith('.csv')) as any

      if (!csvEntry) {
        await zipReader.close()
        throw new Error('Nenhum arquivo CSV encontrado no pacote ZIP baixado.')
      }

      const csvBuffer = await csvEntry.getData(new Uint8ArrayWriter())
      await zipReader.close()

      csvText = iconv.decode(Buffer.from(csvBuffer), 'utf-8')
      if (csvText.charCodeAt(0) === 0xfeff) {
        csvText = csvText.slice(1) // remove UTF-8 BOM
      }
    } else {
      // Decode direto caso a URL retorne CSV não compactado
      csvText = iconv.decode(rawBuffer, 'latin1')
    }

    // 4. Parse do CSV
    const rows = parse(csvText, {
      delimiter: ';',
      skip_empty_lines: true,
      relax_column_count: true,
    })

    if (rows.length < 2) {
      logger.info(`[${CHANNEL}] CSV vazio ou sem dados suficientes`)
      return result
    }

    const cols = parseHeaders(rows[0])
    const foundReviews: NormalizedReview[] = []
    const lastSync = connector.last_sync_at ? new Date(connector.last_sync_at) : new Date(0)
    const MAX_ROWS = 100_000

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i]
      const rowCnpj = String(row[cols.CNPJ] || '').replace(/\D/g, '')
      const rowCompany = String(row[cols.NOME_FANTASIA] || '').trim().toLowerCase()

      let isMatch = false
      if (targetCnpj && rowCnpj && rowCnpj === targetCnpj) {
        isMatch = true
      } else if (targetName && rowCompany && (rowCompany.includes(targetName) || targetName.includes(rowCompany))) {
        isMatch = true
      }

      if (isMatch) {
        const dataRaw = String(row[cols.DATA] || '')
        if (!dataRaw) continue

        let publishedAt = new Date(0)
        if (dataRaw.includes('-')) {
          publishedAt = new Date(`${dataRaw}T12:00:00Z`)
        } else if (dataRaw.includes('/')) {
          const [d, m, y] = dataRaw.split('/')
          publishedAt = new Date(`${y}-${m}-${d}T12:00:00Z`)
        }

        if (publishedAt <= lastSync) continue

        result.reviews_fetched++
        foundReviews.push(normalize(row, connector, targetCnpj || targetName, cols))

        if (foundReviews.length >= MAX_ROWS) {
          logger.warn(`[${CHANNEL}] Limite de 100.000 novas linhas atingido`)
          break
        }
      }
    }

    logger.info(`[${CHANNEL}] Parsing de CSV concluído`, { totalRows: rows.length - 1, matched: foundReviews.length })

    if (foundReviews.length > 0) {
      const ingest = await ingestReviews(foundReviews, CHANNEL, connector.id, connector.business_id)
      result.reviews_new = ingest.reviews_new
      result.reviews_updated = ingest.reviews_updated
    }

    logger.info(`[${CHANNEL}] Sync finalizado`, {
      connector_id: connector.id,
      fetched: result.reviews_fetched,
      new: result.reviews_new,
    })
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error)
    logger.error(`[${CHANNEL}] Falha no processamento`, { error, connector_id: connector.id })
  }

  return result
}

/**
 * Normaliza uma linha do CSV para o modelo de Review.
 */
function normalize(
  row: any[],
  connector: ChannelConnector,
  matchKey: string,
  cols: ColumnIndices
): NormalizedReview {
  const dataRaw = String(row[cols.DATA] || '')
  const descricao = String(row[cols.DESCRICAO] || '')
  const assunto = String(row[cols.ASSUNTO] || '')

  let published_at = new Date().toISOString()
  if (dataRaw.includes('-')) {
    published_at = new Date(`${dataRaw}T12:00:00Z`).toISOString()
  } else if (dataRaw.includes('/')) {
    const [d, m, y] = dataRaw.split('/')
    published_at = new Date(`${y}-${m}-${d}T12:00:00Z`).toISOString()
  }

  const external_id = createHash('sha256')
    .update(`${matchKey}-${dataRaw}-${descricao}`)
    .digest('hex')

  const ratingStr = row[cols.NOTA] ? String(row[cols.NOTA]).replace(',', '.') : undefined
  const rating = ratingStr && !isNaN(parseFloat(ratingStr)) ? parseFloat(ratingStr) : undefined
  const is_resolved =
    String(row[cols.RESOLVIDO] || '').toUpperCase() === 'S' ||
    String(row[cols.RESOLVIDO] || '').toLowerCase().includes('resolvid')
  const responseTime = parseInt(String(row[cols.TEMPO_RESPOSTA] || '')) || undefined

  const review: NormalizedReview = {
    tenant_id: connector.tenant_id,
    business_id: connector.business_id,
    connector_id: connector.id,
    channel: CHANNEL,
    external_id,
    published_at,
    sentiment: 'unanalyzed',
    title: assunto || undefined,
    body: descricao || undefined,
    is_resolved,
    ...(responseTime !== undefined && !isNaN(responseTime) ? { response_time_days: responseTime } : {}),
    tags: [row[cols.AREA], row[cols.SEGMENTO]].filter(Boolean),
    raw_data: { csv_row: row } as any,
  }

  const fullText = [assunto, descricao].join(' ')
  const extraTags: string[] = []

  if (/r\$\s*\d|cobr(aram|ança|ado)|d[eé]bito|estorno|reembolso|\d+,\d{2}/i.test(fullText)) {
    extraTags.push('financeiro')
  }
  if (/procon|juizado|judicial|processo|anatel|bacen|banco central|senacon/i.test(fullText)) {
    extraTags.push('ameaca_legal')
  }
  if (/n[aã]o (foi |)respondid|sem retorno|n[aã]o (me |)atend|ignorad|sem resposta/i.test(fullText)) {
    extraTags.push('sem_retorno')
  }

  if (extraTags.length > 0) {
    review.tags = [...(review.tags ?? []), ...extraTags]
  }

  if (rating !== undefined && !isNaN(rating)) {
    review.rating = rating
  }

  return review
}

/**
 * Descobre a URL do dataset mais recente via Portal de Dados Abertos do Consumidor.gov.br.
 */
async function discoverLatestUrl(connectorId: string, year: number, month: number): Promise<string> {
  const mm = String(month).padStart(2, '0')
  const term1 = `finalizadas_${year}-${mm}`
  const term2 = `${mm}/${year}`
  const term3 = `${mm}-${year}`

  // 1. Tenta API do CKAN do dados.gov.br (se disponível)
  try {
    const res = await axios.get(`https://dados.gov.br/api/3/action/package_show?id=reclamacoes-consumidor-gov-br`, {
      timeout: 10000,
    })
    const resources = res.data?.result?.resources as any[]
    const resource = resources?.find(r => {
      const name = String(r.name || '').toLowerCase()
      return r.format?.toLowerCase() === 'csv' && name.includes('base completa') && name.includes(term3)
    })
    if (resource?.url) {
      logger.info(`[${CHANNEL}] URL descoberta via CKAN API`, { term: term3, url: resource.url })
      return resource.url
    }
  } catch (err) {
    // Ignora erro da API do CKAN
  }

  // 2. Consulta o portal Consumidor.gov.br (Tabela de Publicações)
  try {
    const pageRes = await axios.get('https://www.consumidor.gov.br/pages/dadosabertos/externo/', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
      timeout: 10000,
    })

    const $ = cheerio.load(pageRes.data)
    let dtScriptUrl = ''
    $('script').each((_, s) => {
      const src = $(s).attr('src') || ''
      if (src.includes('datatablesController') && src.includes('id=publicacoesDT')) {
        dtScriptUrl = src.startsWith('http')
          ? src
          : src.startsWith('//')
            ? 'https:' + src
            : 'https://www.consumidor.gov.br' + src
      }
    })

    if (dtScriptUrl) {
      const dtRes = await axios.get(dtScriptUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          Referer: 'https://www.consumidor.gov.br/pages/dadosabertos/externo/',
        },
        timeout: 10000,
      })

      const match = dtRes.data.match(/sAjaxSource:\s*"([^"]+)"/)
      if (match?.[1]) {
        const jsonPath = match[1]
        const jsonUrl = jsonPath.startsWith('http') ? jsonPath : 'https://www.consumidor.gov.br' + jsonPath

        const jsonRes = await axios.get(jsonUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            Accept: 'application/json, text/javascript, */*; q=0.01',
            'X-Requested-With': 'XMLHttpRequest',
            Referer: 'https://www.consumidor.gov.br/pages/dadosabertos/externo/',
          },
          timeout: 45000,
        })

        const items = (jsonRes.data || []) as any[]
        const found = items.find(p => {
          const fn = String(p.nomeArquivo || '').toLowerCase()
          const title = String(p.titulo || '').toLowerCase()
          return fn.includes(term1) || fn.includes(term3) || title.includes(term2) || title.includes(term1)
        })

        if (found?.codigo) {
          const downloadUrl = `https://www.consumidor.gov.br/pages/publicacao/externo/${found.codigo}/download`
          logger.info(`[${CHANNEL}] URL descoberta via Consumidor.gov API`, { term: term1, url: downloadUrl })
          return downloadUrl
        }

        const latestZip = items.find(
          p => String(p.nomeArquivo || '').endsWith('.zip') || String(p.nomeArquivo || '').includes('finalizadas')
        )
        if (latestZip?.codigo) {
          const downloadUrl = `https://www.consumidor.gov.br/pages/publicacao/externo/${latestZip.codigo}/download`
          logger.info(`[${CHANNEL}] URL fallback (último ZIP) via Consumidor.gov API`, { url: downloadUrl })
          return downloadUrl
        }
      }
    }
  } catch (err) {
    await logSyncJobError(connectorId, 'consumidor_gov_discovery', err, { severity: 'info' })
    logger.info(`[${CHANNEL}] Falha ao consultar API do Consumidor.gov, usando fallback`, {
      error: err instanceof Error ? err.message : String(err),
    })
  }

  // 3. Fallback histórico
  return `https://dados.mj.gov.br/dataset/0182f1bf-e73d-42b1-ae8c-fa94d9ce9451/resource/786a616a-b4fc-4cc0-a09b-098aa06883ba/download/basecompleta${year}-${mm}.csv`
}

/**
 * Registra avisos/erros parciais no sync_job mais recente do conector sem causar falha do job
 */
async function logSyncJobError(
  connectorId: string,
  errorType: string,
  error: any,
  options: { severity: string } = { severity: 'warn' }
) {
  try {
    const { data: job } = await supabase
      .from('sync_jobs')
      .select('id, error_detail')
      .eq('connector_id', connectorId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (job) {
      const currentDetail = (job.error_detail as Record<string, any>) || {}
      await supabase
        .from('sync_jobs')
        .update({
          error_detail: {
            ...currentDetail,
            [errorType]: {
              message: error instanceof Error ? error.message : String(error),
              severity: options.severity,
              timestamp: new Date().toISOString(),
            },
          },
        })
        .eq('id', job.id)
    }
  } catch (err) {
    logger.warn(`[${CHANNEL}] Falha ao registrar erro ${errorType} no sync_job`, { error: err })
  }
}
