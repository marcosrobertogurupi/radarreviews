import { chromium } from 'playwright'
import { createClient } from '@supabase/supabase-js'
import { logger } from '../../lib/logger.js'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'

const supabaseAdmin = createClient(
  process.env['SUPABASE_URL']!,
  process.env['SUPABASE_SERVICE_ROLE_KEY']!
)

const CHANNEL_LABELS: Record<string, string> = {
  google_maps: 'Google Maps',
  tripadvisor: 'TripAdvisor',
  booking: 'Booking.com',
  reclame_aqui: 'Reclame Aqui',
  trustpilot: 'Trustpilot',
  reddit: 'Reddit',
  consumidor_gov: 'Consumidor.gov',
  facebook: 'Facebook',
  instagram: 'Instagram',
}

interface ChannelStat {
  name: string
  label: string
  count: number
  avgRating: number
  share: number
}

interface TopicStat {
  label: string
  count: number
  positive: number
  negative: number
  sentiment: 'positive' | 'negative' | 'neutral'
  impact: string
}

interface MarketingInsight {
  title: string
  type: 'opportunity' | 'risk' | 'action'
  description: string
  recommendation: string
}

interface CriticalReviewHighlight {
  author: string
  channel: string
  body: string
  rating: number
  sentiment: string
  rootCause: string
  suggestedResponse: string
}

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
    avgRating: number
  }
  channels: ChannelStat[]
  topics: TopicStat[]
  marketingInsights: MarketingInsight[]
  criticalReviews: CriticalReviewHighlight[]
}

export async function generateExecutivePDF(data: ReportData): Promise<Buffer> {
  const browser = await chromium.launch({ 
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  })
  const page = await browser.newPage()

  const positivePercent = data.kpis.total > 0 ? Math.round((data.kpis.positive / data.kpis.total) * 100) : 0
  const negativePercent = data.kpis.total > 0 ? Math.round(((data.kpis.negative + data.kpis.critical) / data.kpis.total) * 100) : 0
  const neutralPercent  = data.kpis.total > 0 ? Math.round((data.kpis.neutral / data.kpis.total) * 100) : 0

  const html = `
    <!DOCTYPE html>
    <html lang="pt-br">
    <head>
      <meta charset="UTF-8">
      <title>Relatório Executivo de Reputação - ${data.tenantName}</title>
      <style>
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
        
        * { box-sizing: border-box; }
        body { font-family: 'Inter', sans-serif; color: #0f172a; margin: 0; padding: 0; line-height: 1.5; -webkit-print-color-adjust: exact; }
        
        .page { width: 210mm; height: 297mm; padding: 18mm 20mm; box-sizing: border-box; page-break-after: always; position: relative; background: #ffffff; }
        
        /* Cabeçalho de páginas internas */
        .header { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #6366f1; padding-bottom: 12px; margin-bottom: 24px; }
        .logo { font-size: 22px; font-weight: 800; color: #4f46e5; letter-spacing: -0.5px; display: flex; align-items: center; gap: 6px; }
        .header-meta { font-size: 11px; color: #64748b; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; }

        /* Rodapé de páginas internas */
        .page-footer { position: absolute; bottom: 15mm; left: 20mm; right: 20mm; display: flex; justify-content: space-between; border-top: 1px solid #e2e8f0; padding-top: 8px; font-size: 10px; color: #94a3b8; }
        
        /* Capa */
        .cover { display: flex; flex-direction: column; justify-content: space-between; align-items: center; text-align: center; height: 100%; background: linear-gradient(135deg, #4f46e5 0%, #3730a3 100%); color: white; border: none; padding: 40mm 20mm 20mm 20mm; }
        .cover-badge { background: rgba(255,255,255,0.15); border: 1px solid rgba(255,255,255,0.25); padding: 6px 16px; border-radius: 20px; font-size: 12px; font-weight: 600; letter-spacing: 1px; text-transform: uppercase; margin-bottom: 20px; }
        .cover h1 { font-size: 42px; font-weight: 800; margin: 0 0 12px 0; letter-spacing: -1px; line-height: 1.1; }
        .cover h2 { font-size: 26px; opacity: 0.95; font-weight: 500; margin: 0; color: #e0e7ff; }
        .cover-period { margin-top: 24px; font-size: 18px; background: rgba(0,0,0,0.2); padding: 8px 24px; border-radius: 8px; font-weight: 600; color: #f1f5f9; }
        .cover-footer { font-size: 12px; opacity: 0.75; letter-spacing: 0.5px; }

        /* Títulos de seção */
        h3 { font-size: 15px; font-weight: 700; color: #1e293b; margin: 24px 0 12px 0; display: flex; align-items: center; gap: 8px; border-left: 4px solid #4f46e5; padding-left: 10px; }

        /* Grid de KPIs */
        .grid-kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 24px; }
        .kpi-card { background: #f8fafc; border: 1px solid #e2e8f0; padding: 14px 12px; border-radius: 10px; text-align: center; }
        .kpi-val { font-size: 24px; font-weight: 800; color: #4f46e5; line-height: 1.2; }
        .kpi-label { font-size: 10px; color: #64748b; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; margin-top: 4px; }

        /* Barras de Sentimento */
        .sentiment-container { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 16px; margin-bottom: 24px; }
        .sentiment-row { margin-bottom: 12px; }
        .sentiment-row:last-child { margin-bottom: 0; }
        .sentiment-label { display: flex; justify-content: space-between; font-size: 12px; font-weight: 600; color: #334155; margin-bottom: 4px; }
        .bar-bg { height: 10px; background: #e2e8f0; border-radius: 5px; overflow: hidden; }
        .bar-fill { height: 100%; border-radius: 5px; }

        /* Tabelas */
        table { width: 100%; border-collapse: collapse; margin-top: 8px; font-size: 12px; }
        th { text-align: left; background: #f1f5f9; padding: 10px 12px; font-size: 11px; color: #475569; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 1px solid #cbd5e1; }
        td { padding: 10px 12px; border-bottom: 1px solid #e2e8f0; color: #334155; }
        tr:nth-child(even) td { background: #fafafa; }
        .badge { padding: 3px 8px; border-radius: 12px; font-size: 10px; font-weight: 700; text-transform: uppercase; }

        /* Cards de Insights de Marketing */
        .insight-card { border-radius: 10px; padding: 14px 16px; margin-bottom: 14px; border-left: 5px solid #4f46e5; background: #f8fafc; border-top: 1px solid #e2e8f0; border-right: 1px solid #e2e8f0; border-bottom: 1px solid #e2e8f0; }
        .insight-card.opportunity { border-left-color: #10b981; background: #f0fdf4; }
        .insight-card.risk { border-left-color: #ef4444; background: #fef2f2; }
        .insight-card.action { border-left-color: #3b82f6; background: #eff6ff; }
        .insight-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; }
        .insight-title { font-size: 13px; font-weight: 700; color: #0f172a; }
        .insight-tag { font-size: 10px; font-weight: 700; text-transform: uppercase; padding: 2px 8px; border-radius: 4px; }
        .insight-tag.opportunity { background: #d1fae5; color: #065f46; }
        .insight-tag.risk { background: #fee2e2; color: #991b1b; }
        .insight-tag.action { background: #dbeafe; color: #1e40af; }
        .insight-desc { font-size: 12px; color: #475569; margin: 0 0 6px 0; }
        .insight-rec { font-size: 12px; font-weight: 600; color: #1e293b; background: rgba(255,255,255,0.7); padding: 8px 10px; border-radius: 6px; border: 1px dashed rgba(0,0,0,0.1); margin-top: 6px; }

        /* Critical Review Highlight */
        .critical-box { border: 1px solid #fee2e2; border-radius: 10px; padding: 16px; margin-bottom: 16px; background: #ffffff; box-shadow: 0 1px 3px rgba(0,0,0,0.05); }
        .critical-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; border-bottom: 1px solid #fecaca; padding-bottom: 8px; }
        .critical-author { font-weight: 700; font-size: 13px; color: #991b1b; }
        .critical-meta { font-size: 11px; color: #7f1d1d; background: #fee2e2; padding: 2px 8px; border-radius: 4px; font-weight: 600; }
        .critical-body { font-size: 12px; color: #334155; font-style: italic; margin-bottom: 12px; line-height: 1.4; background: #fff5f5; padding: 10px; border-radius: 6px; border-left: 3px solid #ef4444; }
        .root-cause { font-size: 11px; color: #991b1b; background: #fef2f2; padding: 8px 10px; border-radius: 6px; margin-bottom: 8px; border: 1px solid #fecaca; }
        .suggested-response { font-size: 11px; color: #1e293b; background: #f0fdf4; padding: 10px; border-radius: 6px; border: 1px solid #bbf7d0; line-height: 1.4; }
        .suggested-response-title { font-weight: 700; color: #166534; margin-bottom: 4px; text-transform: uppercase; font-size: 10px; letter-spacing: 0.5px; }
      </style>
    </head>
    <body>
      <!-- CAPA -->
      <div class="page cover">
        <div style="display: flex; flex-direction: column; align-items: center;">
          <div class="cover-badge">Radar de Reputação Online</div>
          <h1>Relatório Executivo & Insights de Marketing</h1>
          <h2>${data.tenantName}</h2>
          <div class="cover-period">${data.monthYear}</div>
        </div>
        <div class="cover-footer">
          Gerado automaticamente pela Inteligência de Reputação Reputei<br>
          Documento Confidencial • Uso Estratégico Interno
        </div>
      </div>

      <!-- PÁGINA 1: VISÃO GERAL & CANAIS -->
      <div class="page">
        <div class="header">
          <div class="logo">📡 Reputei</div>
          <div class="header-meta">Resumo Executivo • ${data.monthYear}</div>
        </div>

        <h3>Visão Geral da Reputação</h3>
        <div class="grid-kpis">
          <div class="kpi-card">
            <div class="kpi-val">${data.kpis.total}</div>
            <div class="kpi-label">Total de Reviews</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-val" style="color: #10b981;">★ ${data.kpis.avgRating.toFixed(1)}</div>
            <div class="kpi-label">Nota Média (0–5)</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-val" style="color: #10b981;">${positivePercent}%</div>
            <div class="kpi-label">Sentimento Positivo</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-val" style="color: ${data.kpis.avgScore > 20 ? '#ef4444' : '#6366f1'};">${data.kpis.avgScore}/100</div>
            <div class="kpi-label">Score Insatisfação</div>
          </div>
        </div>

        <h3>Distribuição de Sentimento</h3>
        <div class="sentiment-container">
          <div class="sentiment-row">
            <div class="sentiment-label">
              <span>Positivo</span>
              <span>${data.kpis.positive} reviews (${positivePercent}%)</span>
            </div>
            <div class="bar-bg"><div class="bar-fill" style="width: ${positivePercent}%; background: #10b981;"></div></div>
          </div>
          <div class="sentiment-row">
            <div class="sentiment-label">
              <span>Neutro</span>
              <span>${data.kpis.neutral} reviews (${neutralPercent}%)</span>
            </div>
            <div class="bar-bg"><div class="bar-fill" style="width: ${neutralPercent}%; background: #94a3b8;"></div></div>
          </div>
          <div class="sentiment-row">
            <div class="sentiment-label">
              <span>Negativo / Crítico</span>
              <span>${data.kpis.negative + data.kpis.critical} reviews (${negativePercent}%)</span>
            </div>
            <div class="bar-bg"><div class="bar-fill" style="width: ${negativePercent}%; background: #ef4444;"></div></div>
          </div>
        </div>

        <h3>Desempenho por Canal de Coleta (Onde Estão Seus Clientes)</h3>
        <table>
          <thead>
            <tr>
              <th>Canal de Monitoramento</th>
              <th>Volume de Reviews</th>
              <th>Participação (%)</th>
              <th>Nota Média no Canal</th>
            </tr>
          </thead>
          <tbody>
            ${data.channels.length > 0 ? data.channels.map(c => `
              <tr>
                <td><strong>${c.label}</strong></td>
                <td>${c.count} reviews</td>
                <td>${c.share}%</td>
                <td><strong style="color: #10b981;">★ ${c.avgRating > 0 ? c.avgRating.toFixed(1) : 'N/A'}</strong></td>
              </tr>
            `).join('') : `
              <tr>
                <td colspan="4" style="text-align: center; color: #94a3b8;">Nenhum dado de canal registrado no período.</td>
              </tr>
            `}
          </tbody>
        </table>

        <div class="page-footer">
          <span>Reputei — Inteligência de Reputação</span>
          <span>Página 1 de 3</span>
        </div>
      </div>

      <!-- PÁGINA 2: ANÁLISE DE TEMAS & INSIGHTS DE MARKETING -->
      <div class="page">
        <div class="header">
          <div class="logo">📡 Reputei</div>
          <div class="header-meta">Inteligência de Marketing • ${data.monthYear}</div>
        </div>

        <h3>Principais Temas Identificados nos Reviews (IA)</h3>
        <table>
          <thead>
            <tr>
              <th>Tema Analisado</th>
              <th>Total Menções</th>
              <th>Balanço (Positivo / Negativo)</th>
              <th>Impacto na Percepção</th>
            </tr>
          </thead>
          <tbody>
            ${data.topics.length > 0 ? data.topics.map(t => `
              <tr>
                <td><strong>${t.label}</strong></td>
                <td>${t.count} menções</td>
                <td>
                  <span style="color: #10b981; font-weight: 700;">${t.positive}👍</span>
                  ${t.negative > 0 ? `<span style="color: #ef4444; font-weight: 700; margin-left: 8px;">${t.negative}👎</span>` : ''}
                </td>
                <td>
                  <span class="badge" style="
                    background: ${t.sentiment === 'positive' ? '#d1fae5' : t.sentiment === 'negative' ? '#fee2e2' : '#f1f5f9'};
                    color: ${t.sentiment === 'positive' ? '#065f46' : t.sentiment === 'negative' ? '#991b1b' : '#475569'};
                  ">
                    ${t.impact}
                  </span>
                </td>
              </tr>
            `).join('') : `
              <tr>
                <td colspan="4" style="text-align: center; color: #94a3b8;">Nenhum tema pré-categorizado no período.</td>
              </tr>
            `}
          </tbody>
        </table>

        <h3>Recomendações Estratégicas para Ação de Marketing e Operações</h3>
        ${data.marketingInsights.map(m => `
          <div class="insight-card ${m.type}">
            <div class="insight-header">
              <div class="insight-title">💡 ${m.title}</div>
              <div class="insight-tag ${m.type}">
                ${m.type === 'opportunity' ? 'Oportunidade de Marketing' : m.type === 'risk' ? 'Alerta Operacional' : 'Estratégia de Canais'}
              </div>
            </div>
            <div class="insight-desc">${m.description}</div>
            <div class="insight-rec">🎯 <strong>Ação Recomendada:</strong> ${m.recommendation}</div>
          </div>
        `).join('')}

        <div class="page-footer">
          <span>Reputei — Inteligência de Reputação</span>
          <span>Página 2 de 3</span>
        </div>
      </div>

      <!-- PÁGINA 3: DESTAQUES CRÍTICOS & SUGESTÕES DE RESPOSTA -->
      <div class="page">
        <div class="header">
          <div class="logo">📡 Reputei</div>
          <div class="header-meta">Destaques Críticos & Respostas • ${data.monthYear}</div>
        </div>

        <h3>Reviews Críticos & Sugestão de Resposta Pública Oficial</h3>
        <p style="font-size: 11px; color: #64748b; margin-top: -6px; margin-bottom: 16px;">
          Respostas rápidas e empáticas a avaliações negativas protegem a reputação da marca e demonstram compromisso aos novos clientes potenciais.
        </p>

        ${data.criticalReviews.length > 0 ? data.criticalReviews.map(r => `
          <div class="critical-box">
            <div class="critical-header">
              <span class="critical-author">👤 ${r.author}</span>
              <span class="critical-meta">Plataforma: ${r.channel} • Nota: ★ ${r.rating}/5</span>
            </div>
            <div class="critical-body">"${r.body}"</div>
            
            <div class="root-cause">
              <strong>🔍 Causa Raiz Identificada:</strong> ${r.rootCause}
            </div>
            
            <div class="suggested-response">
              <div class="suggested-response-title">✍️ Sugestão de Resposta Oficial (Pronta para uso):</div>
              "${r.suggestedResponse}"
            </div>
          </div>
        `).join('') : `
          <div style="padding: 30px; text-align: center; background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 10px; color: #166534;">
            <div style="font-size: 24px; margin-bottom: 6px;">🎉</div>
            <strong>Nenhum review crítico no período!</strong>
            <p style="font-size: 12px; margin: 4px 0 0 0;">Parabéns! Sua empresa manteve alto padrão de satisfação dos clientes no período.</p>
          </div>
        `}

        <div class="page-footer">
          <span>Reputei — Inteligência de Reputação</span>
          <span>Página 3 de 3</span>
        </div>
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

export async function processMonthlyReport(tenantId: string, monthYear: string, startDate?: string, endDate?: string) {
  try {
    // 1. Coletar dados do tenant
    const { data: tenant } = await supabaseAdmin.from('tenants').select('name').eq('id', tenantId).single()
    if (!tenant) throw new Error('Tenant não encontrado')

    const startAt = startDate ? new Date(startDate).toISOString() : new Date(`${monthYear}-01T00:00:00Z`).toISOString()
    const endAt = endDate ? new Date(endDate).toISOString() : new Date(new Date(`${monthYear}-01T00:00:00Z`).setMonth(new Date(`${monthYear}-01T00:00:00Z`).getMonth() + 1)).toISOString()

    const label = startDate && endDate 
      ? `${format(new Date(startDate), 'dd/MM/yy')} a ${format(new Date(endDate), 'dd/MM/yy')}`
      : format(new Date(`${monthYear}-01T12:00:00Z`), "MMMM 'de' yyyy", { locale: ptBR })

    // 2. Coletar reviews e KPIs do período via collected_at
    const { data: reviews } = await supabaseAdmin
      .from('reviews')
      .select('*')
      .eq('tenant_id', tenantId)
      .gte('collected_at', startAt)
      .lt('collected_at', endAt)

    if (!reviews || reviews.length === 0) {
      logger.info(`[reports] Sem reviews para o tenant ${tenantId} em ${monthYear}`)
      return null
    }

    const total = reviews.length
    const positive = reviews.filter(r => r.sentiment === 'positive').length
    const neutral  = reviews.filter(r => r.sentiment === 'neutral').length
    const negative = reviews.filter(r => r.sentiment === 'negative').length
    const critical = reviews.filter(r => r.sentiment === 'critical').length
    
    const ratedReviews = reviews.filter(r => typeof r.rating === 'number' && r.rating > 0)
    const avgRating = ratedReviews.length > 0 
      ? Number((ratedReviews.reduce((sum, r) => sum + r.rating, 0) / ratedReviews.length).toFixed(1))
      : 5.0

    const avgScore = Math.round(reviews.reduce((acc, r) => acc + (r.dissatisfaction_score || 0), 0) / total)

    const kpis = {
      total,
      positive,
      neutral,
      negative,
      critical,
      avgScore,
      avgRating
    }

    // 3. Breakdown por Canal de Coleta
    const channelMap: Record<string, { count: number; ratingSum: number; ratingCount: number }> = {}
    for (const r of reviews) {
      const ch = r.channel || 'outros'
      if (!channelMap[ch]) channelMap[ch] = { count: 0, ratingSum: 0, ratingCount: 0 }
      channelMap[ch].count++
      if (typeof r.rating === 'number' && r.rating > 0) {
        channelMap[ch].ratingSum += r.rating
        channelMap[ch].ratingCount++
      }
    }

    const channels: ChannelStat[] = Object.entries(channelMap).map(([ch, data]) => {
      const chAvgRating = data.ratingCount > 0 ? Number((data.ratingSum / data.ratingCount).toFixed(1)) : 0
      return {
        name: ch,
        label: CHANNEL_LABELS[ch] || ch,
        count: data.count,
        avgRating: chAvgRating,
        share: Math.round((data.count / total) * 100)
      }
    }).sort((a, b) => b.count - a.count)

    // 4. Extração Dinâmica de Temas (Heurística nos Textos)
    const topicKeywords: Record<string, string[]> = {
      'Atendimento & Recepcional': ['atendimento', 'atendente', 'recepção', 'recepcionista', 'equipe', 'funcionário', 'trato', 'cordial', 'simpático', 'educado', 'rúpido', 'reserva', 'gerente'],
      'Acomodação & Quartos': ['quarto', 'cama', 'colchão', 'travesseiro', 'ar condicionado', 'chuveiro', 'banheiro', 'instalação', 'acomodação', 'suíte'],
      'Alimentação & Café da Manhã': ['café', 'comida', 'refeição', 'restaurante', 'almoço', 'jantar', 'gastronomia', 'delicioso', 'cardápio', 'suco', 'fruta'],
      'Limpeza & Higiene': ['limpo', 'limpeza', 'cheiro', 'higiene', 'organizado', 'toalha', 'lençol', 'impecável'],
      'Localização & Acesso': ['localização', 'local', 'centro', 'perto', 'fácil acesso', 'bairro', 'estacionamento', 'praia', 'rua'],
      'Preço & Condições de Pagamento': ['preço', 'valor', 'caro', 'barato', 'custo', 'benefício', 'paguei', 'cobrança', 'pagamento', 'pix', 'cartão', 'reembolso']
    }

    const topics: TopicStat[] = []
    for (const [topicLabel, keywords] of Object.entries(topicKeywords)) {
      let count = 0
      let pos = 0
      let neg = 0

      for (const r of reviews) {
        const text = `${r.title || ''} ${r.body || ''} ${(r.sentiment_topics || []).join(' ')}`.toLowerCase()
        if (keywords.some(kw => text.includes(kw))) {
          count++
          if (r.sentiment === 'positive') pos++
          if (r.sentiment === 'negative' || r.sentiment === 'critical') neg++
        }
      }

      if (count > 0) {
        let sent: 'positive' | 'negative' | 'neutral' = 'positive'
        let impact = 'Altamente Positivo'
        if (neg > pos) {
          sent = 'negative'
          impact = 'Exige Atenção Operacional'
        } else if (neg > 0) {
          sent = 'neutral'
          impact = 'Ponto de Melhoria'
        }

        topics.push({
          label: topicLabel,
          count,
          positive: pos,
          negative: neg,
          sentiment: sent,
          impact
        })
      }
    }

    topics.sort((a, b) => b.count - a.count)

    // 5. Geração de Insights Prescritivos para Marketing & Operações
    const marketingInsights: MarketingInsight[] = []

    // Encontrar ponto mais forte para Prova Social
    const topPositiveTopic = topics.find(t => t.sentiment === 'positive')
    if (topPositiveTopic) {
      marketingInsights.push({
        title: `Impulso de Vendas com Prova Social (${topPositiveTopic.label})`,
        type: 'opportunity',
        description: `O pilar de "${topPositiveTopic.label}" teve ${topPositiveTopic.positive} avaliações altamente positivas no período. Isso representa um dos maiores diferenciais percebidos pelos clientes.`,
        recommendation: `Destacar depoimentos reais sobre ${topPositiveTopic.label.toLowerCase()} em campanhas no Instagram/Facebook e na página inicial do site para aumentar a conversão de reservas diretas.`
      })
    }

    // Canal mais forte vs Canal com oportunidade
    if (channels.length > 0) {
      const topChannel = channels[0]!
      marketingInsights.push({
        title: `Estratégia de Presença Digital (${topChannel.label})`,
        type: 'action',
        description: `O canal ${topChannel.label} concentrou ${topChannel.share}% do volume de reviews coletados no período, com nota média de ★ ${topChannel.avgRating.toFixed(1)}.`,
        recommendation: `Manter engajamento ativo neste canal e incluir QRs ou mensagens de incentivo a avaliações no check-out/pós-venda para reforçar a liderança local.`
      })
    }

    // Alerta de ponto fraco se houver
    const topNegativeTopic = topics.find(t => t.negative > 0)
    if (topNegativeTopic) {
      marketingInsights.push({
        title: `Alerta de Experiência do Cliente (${topNegativeTopic.label})`,
        type: 'risk',
        description: `Foram identificadas ${topNegativeTopic.negative} menções negativas ou críticas relacionadas a "${topNegativeTopic.label}".`,
        recommendation: `Realizar alinhamento com a equipe operacional responsável por ${topNegativeTopic.label.toLowerCase()} para ajustar procedimentos e evitar que insatisfações gerem novas avaliações baixas.`
      })
    }

    // 6. Reviews Críticos & Sugestão de Resposta Pública
    const criticalReviewsRaw = reviews
      .filter(r => ['negative', 'critical'].includes(r.sentiment) || (typeof r.rating === 'number' && r.rating <= 2))
      .slice(0, 3)

    const criticalReviews: CriticalReviewHighlight[] = criticalReviewsRaw.map(r => {
      const textLower = (r.body || '').toLowerCase()
      let rootCause = 'Atendimento ao cliente e comunicação inicial.'
      let responseBody = 'Agradecemos por compartilhar sua experiência. Lamentamos sinceramente que o atendimento recebido não tenha atingido suas expectativas. Já alinhamos com nossa equipe responsável para revisar nossos processos internos e garantir um padrão de excelência em todas as interações. Esperamos ter a oportunidade de recebê-lo novamente para uma experiência plenamente satisfatória.'

      if (textLower.includes('pix') || textLower.includes('pagamento') || textLower.includes('reserva') || textLower.includes('telefone')) {
        rootCause = 'Divergência nas condições de reserva/pagamento e tom do atendimento telefônico.'
        responseBody = `Olá ${r.author_name || 'Hóspede'}, agradecemos por nos alertar sobre ocorrido em seu contato de reserva. Pedimos sinceras desculpas pelo transtorno e pela postura inadequada relatada. Prezamos pela transparência e cordialidade em todo atendimento. Já orientamos nossa equipe de reservas sobre opções flexíveis de pagamento e treinamentos de conduta. Caso deseje, entre em contato diretamente com nossa gerência para cuidarmos pessoalmente de sua solicitação.`
      } else if (textLower.includes('limpeza') || textLower.includes('quarto') || textLower.includes('banheiro')) {
        rootCause = 'Padrão de governança, higienização das acomodações ou manutenção.'
        responseBody = `Olá ${r.author_name || 'Hóspede'}, pedimos desculpas pela falha identificada em sua acomodação. Nosso padrão de governança é rigoroso e este caso isolado já foi repassado à supervisão de limpeza para correção imediata. Agradecemos seu feedback para constante aprimoramento.`
      }

      return {
        author: r.author_name || 'Cliente / Hóspede',
        channel: CHANNEL_LABELS[r.channel] || r.channel,
        body: r.body || r.title || 'Avaliação sem comentário por extenso.',
        rating: r.rating || 1,
        sentiment: r.sentiment,
        rootCause,
        suggestedResponse: responseBody
      }
    })

    // 7. Gerar PDF
    const pdfBuffer = await generateExecutivePDF({
      tenantName: tenant.name,
      monthYear: label,
      kpis,
      channels,
      topics,
      marketingInsights,
      criticalReviews
    })

    // 8. Salvar no Storage
    const safeLabel = label.replace(/[^a-z0-9]/gi, '_').toLowerCase()
    const fileName = `reports/${tenantId}/${safeLabel}_executive_report.pdf`
    const { error: upErr } = await supabaseAdmin.storage
      .from('reports')
      .upload(fileName, pdfBuffer, { contentType: 'application/pdf', upsert: true })

    if (upErr) throw upErr

    // 9. Obter URL pública
    const { data: { publicUrl } } = supabaseAdmin.storage.from('reports').getPublicUrl(fileName)

    // 10. Salvar registro na tabela reports
    await supabaseAdmin.from('reports').insert({
      tenant_id: tenantId,
      month_year: startDate && endDate ? `${startDate}_${endDate}` : monthYear,
      pdf_url: publicUrl
    })

    return publicUrl
  } catch (err) {
    logger.error('[reports] Falha ao processar relatório:', { error: err })
    throw err
  }
}
