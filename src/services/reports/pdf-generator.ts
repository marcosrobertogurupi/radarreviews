import { chromium } from 'playwright'
import { createClient } from '@supabase/supabase-js'
import { logger } from '../../lib/logger.js'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'

const supabaseAdmin = createClient(
  process.env['SUPABASE_URL']!,
  process.env['SUPABASE_SERVICE_ROLE_KEY']!
)

interface ReportData {
  tenantName: string
  monthYear: string
  kpis: {
    total: number
    positive: number
    neutral: number
    negative: number
    critical: number
    avgScore: number
  }
  topics: Array<{ label: string; count: number; sentiment: string }>
  reviews: Array<{ author: string; channel: string; body: string; rating: number; sentiment: string }>
}

export async function generateExecutivePDF(data: ReportData): Promise<Buffer> {
  const browser = await chromium.launch({ 
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  })
  const page = await browser.newPage()

  const html = `
    <!DOCTYPE html>
    <html lang="pt-br">
    <head>
      <meta charset="UTF-8">
      <style>
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap');
        body { font-family: 'Inter', sans-serif; color: #1e293b; margin: 0; padding: 0; line-height: 1.5; }
        .page { height: 297mm; padding: 20mm; box-sizing: border-box; page-break-after: always; position: relative; }
        .header { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #6366f1; padding-bottom: 10px; margin-bottom: 40px; }
        .logo { font-size: 24px; font-weight: 800; color: #6366f1; }
        
        /* Capa */
        .cover { display: flex; flex-direction: column; justify-content: center; align-items: center; text-align: center; height: 100%; background: linear-gradient(135deg, #6366f1 0%, #4f46e5 100%); color: white; border: none; }
        .cover h1 { fontSize: 48px; margin-bottom: 10px; }
        .cover h2 { fontSize: 24px; opacity: 0.9; font-weight: 400; }
        .cover-footer { position: absolute; bottom: 40px; fontSize: 14px; opacity: 0.8; }

        /* KPI Cards */
        .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; margin-bottom: 40px; }
        .card { background: #f8fafc; border: 1px solid #e2e8f0; padding: 20px; borderRadius: 12px; text-align: center; }
        .card-val { fontSize: 28px; fontWeight: 700; color: #6366f1; }
        .card-label { fontSize: 12px; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em; margin-top: 4px; }

        /* Progress Bars */
        .sentiment-row { margin-bottom: 15px; }
        .sentiment-label { display: flex; justify-content: space-between; fontSize: 13px; marginBottom: 5px; }
        .bar-bg { height: 8px; background: #e2e8f0; borderRadius: 4px; overflow: hidden; }
        .bar-fill { height: 100%; borderRadius: 4px; }

        /* Table */
        table { width: 100%; border-collapse: collapse; margin-top: 20px; }
        th { text-align: left; background: #f1f5f9; padding: 12px; fontSize: 12px; color: #475569; }
        td { padding: 12px; border-bottom: 1px solid #e2e8f0; fontSize: 13px; }
        .badge { padding: 2px 8px; borderRadius: 12px; fontSize: 11px; fontWeight: 600; }

        h3 { border-left: 4px solid #6366f1; padding-left: 10px; margin-top: 40px; }
      </style>
    </head>
    <body>
      <!-- Capa -->
      <div class="page cover">
        <div>📡</div>
        <h1>Relatório Executivo</h1>
        <h2>${data.tenantName}</h2>
        <div style="margin-top: 20px; fontSize: 18px;">${data.monthYear}</div>
        <div class="cover-footer">Gerado automaticamente por Reputei SaaS</div>
      </div>

      <!-- Resumo Executivo -->
      <div class="page">
        <div class="header">
          <div class="logo">Reputei</div>
          <div style="fontSize: 12px; color: #64748b;">Resumo Executivo • ${data.monthYear}</div>
        </div>

        <h3>Visão Geral da Reputação</h3>
        <div class="grid">
          <div class="card">
            <div class="card-val">${data.kpis.total}</div>
            <div class="card-label">Total de Reviews</div>
          </div>
          <div class="card">
            <div class="card-val">${data.kpis.avgScore}/100</div>
            <div class="card-label">Score de Insatisfação</div>
          </div>
          <div class="card">
            <div class="card-val">${Math.round((data.kpis.positive / data.kpis.total) * 100)}%</div>
            <div class="card-label">Sentimento Positivo</div>
          </div>
        </div>

        <h3>Distribuição de Sentimento</h3>
        <div class="sentiment-row">
          <div class="sentiment-label"><span>Positivo</span><span>${data.kpis.positive}</span></div>
          <div class="bar-bg"><div class="bar-fill" style="width: ${(data.kpis.positive/data.kpis.total)*100}%; background: #10b981;"></div></div>
        </div>
        <div class="sentiment-row">
          <div class="sentiment-label"><span>Neutro</span><span>${data.kpis.neutral}</span></div>
          <div class="bar-bg"><div class="bar-fill" style="width: ${(data.kpis.neutral/data.kpis.total)*100}%; background: #94a3b8;"></div></div>
        </div>
        <div class="sentiment-row">
          <div class="sentiment-label"><span>Negativo/Crítico</span><span>${data.kpis.negative + data.kpis.critical}</span></div>
          <div class="bar-bg"><div class="bar-fill" style="width: ${((data.kpis.negative + data.kpis.critical)/data.kpis.total)*100}%; background: #ef4444;"></div></div>
        </div>

        <h3>Principais Temas Identificados (IA)</h3>
        <table>
          <thead>
            <tr>
              <th>Tema</th>
              <th>Ocorrências</th>
              <th>Impacto</th>
            </tr>
          </thead>
          <tbody>
            ${data.topics.map(t => `
              <tr>
                <td>${t.label}</td>
                <td>${t.count}</td>
                <td><span class="badge" style="background: ${t.sentiment === 'positive' ? '#d1fae5' : '#fee2e2'}; color: ${t.sentiment === 'positive' ? '#065f46' : '#991b1b'};">
                  ${t.sentiment === 'positive' ? 'Positivo' : 'Negativo'}
                </span></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>

      <!-- Detalhes Críticos -->
      <div class="page">
        <div class="header">
          <div class="logo">Reputei</div>
          <div style="fontSize: 12px; color: #64748b;">Destaques Críticos • ${data.monthYear}</div>
        </div>

        <h3>Reviews que Exigem Atenção</h3>
        ${data.reviews.map(r => `
          <div style="border: 1px solid #e2e8f0; padding: 15px; borderRadius: 8px; marginBottom: 15px; background: #fff5f5;">
            <div style="display: flex; justify-content: space-between; marginBottom: 5px;">
              <strong style="fontSize: 14px;">${r.author}</strong>
              <span style="fontSize: 11px; color: #64748b;">${r.channel}</span>
            </div>
            <div style="color: #ef4444; fontSize: 12px; marginBottom: 8px;">★ ${r.rating}/5</div>
            <p style="margin: 0; fontSize: 13px; color: #475569;">"${r.body}"</p>
          </div>
        `).join('')}
      </div>
    </body>
    </html>
  `

  await page.setContent(html)
  const pdf = await page.pdf({
    format: 'A4',
    printBackground: true,
    margin: { top: 0, bottom: 0, left: 0, right: 0 }
  })

  await browser.close()
  return pdf
}

export async function processMonthlyReport(tenantId: string, monthYear: string) {
  try {
    // 1. Coletar dados do tenant
    const { data: tenant } = await supabaseAdmin.from('tenants').select('name').eq('id', tenantId).single()
    if (!tenant) throw new Error('Tenant não encontrado')

    const startOfMonth = new Date(`${monthYear}-01T00:00:00Z`).toISOString()
    const endOfMonth = new Date(new Date(`${monthYear}-01T00:00:00Z`).setMonth(new Date(`${monthYear}-01T00:00:00Z`).getMonth() + 1)).toISOString()

    // 2. Coletar reviews e KPIs
    const { data: reviews } = await supabaseAdmin
      .from('reviews')
      .select('*')
      .eq('tenant_id', tenantId)
      .gte('published_at', startOfMonth)
      .lt('published_at', endOfMonth)

    if (!reviews || reviews.length === 0) {
      logger.info(`[reports] Sem reviews para o tenant ${tenantId} em ${monthYear}`)
      return null
    }

    const kpis = {
      total: reviews.length,
      positive: reviews.filter(r => r.sentiment === 'positive').length,
      neutral: reviews.filter(r => r.sentiment === 'neutral').length,
      negative: reviews.filter(r => r.sentiment === 'negative').length,
      critical: reviews.filter(r => r.sentiment === 'critical').length,
      avgScore: reviews.reduce((acc, r) => acc + (r.dissatisfaction_score || 0), 0) / reviews.length
    }

    // 3. Gerar PDF
    const pdfBuffer = await generateExecutivePDF({
      tenantName: tenant.name,
      monthYear: format(new Date(`${monthYear}-01T12:00:00Z`), "MMMM 'de' yyyy", { locale: ptBR }),
      kpis,
      topics: [], // TODO: Buscar da tabela review_topics se houver
      reviews: reviews
        .filter(r => ['negative', 'critical'].includes(r.sentiment))
        .slice(0, 5)
        .map(r => ({
          author: r.author || 'Anônimo',
          channel: r.channel,
          body: r.body || '',
          rating: r.rating || 0,
          sentiment: r.sentiment
        }))
    })

    // 4. Salvar no Storage
    const fileName = `reports/${tenantId}/${monthYear}_executive_report.pdf`
    const { data: upload, error: upErr } = await supabaseAdmin.storage
      .from('reports')
      .upload(fileName, pdfBuffer, { contentType: 'application/pdf', upsert: true })

    if (upErr) throw upErr

    // 5. Pegar URL pública
    const { data: { publicUrl } } = supabaseAdmin.storage.from('reports').getPublicUrl(fileName)

    // 6. Salvar registro na tabela reports
    await supabaseAdmin.from('reports').insert({
      tenant_id: tenantId,
      month_year: monthYear,
      pdf_url: publicUrl
    })

    return publicUrl
  } catch (err) {
    logger.error('[reports] Falha ao processar relatório:', err)
    throw err
  }
}
