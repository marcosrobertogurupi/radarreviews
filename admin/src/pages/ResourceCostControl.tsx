import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import {
  DollarSign, AlertTriangle, TrendingUp, Cpu, Bot, Flame, ShieldAlert,
  Server, RefreshCw, BarChart2, Filter, Settings, CheckCircle2, ChevronRight
} from 'lucide-react'
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar, Cell, Legend
} from 'recharts'

interface ResourceLog {
  id: string
  tenant_id: string
  provider: string
  metric_type: string
  metric_quantity: number
  estimated_cost_usd: number
  created_at: string
}

interface TenantCostSummary {
  tenantId: string
  tenantName: string
  planSlug: string
  planPriceBrl: number
  costUsd: number
  costBrl: number
  geminiCostBrl: number
  apifyCostBrl: number
  railwayCostBrl: number
  grossMarginPct: number
  isBleeding: boolean
}

interface AnomalyAlert {
  id: string
  tenantName: string
  provider: string
  reason: string
  costUsd: number
  severity: 'high' | 'medium'
}

const USD_TO_BRL = 5.60 // Cotação de referência BRL

export default function ResourceCostControl() {
  const [loading, setLoading] = useState(true)
  const [timeRange, setTimeRange] = useState<'7d' | '30d' | 'month'>('30d')
  const [logs, setLogs] = useState<ResourceLog[]>([])
  const [tenantsSummary, setTenantsSummary] = useState<TenantCostSummary[]>([])
  const [anomalies, setAnomalies] = useState<AnomalyAlert[]>([])
  const [selectedTenantId, setSelectedTenantId] = useState<string>('all')

  // Totais globais
  const [totalCostUsd, setTotalCostUsd] = useState(0)
  const [geminiCostUsd, setGeminiCostUsd] = useState(0)
  const [apifyCostUsd, setApifyCostUsd] = useState(0)
  const [firecrawlCostUsd, setFirecrawlCostUsd] = useState(0)
  const [railwayCostUsd, setRailwayCostUsd] = useState(0)

  // Gráficos
  const [chartDailyData, setChartDailyData] = useState<any[]>([])

  useEffect(() => {
    loadFinOpsData()
  }, [timeRange, selectedTenantId])

  async function loadFinOpsData() {
    setLoading(true)
    try {
      // 1. Data inicial baseada no filtro
      const now = new Date()
      let startDate = new Date()
      if (timeRange === '7d') {
        startDate.setDate(now.getDate() - 7)
      } else if (timeRange === 'month') {
        startDate.setDate(1)
        startDate.setHours(0, 0, 0, 0)
      } else {
        startDate.setDate(now.getDate() - 30)
      }

      // 2. Buscar logs de recursos
      let query = supabase
        .from('resource_usage_logs')
        .select('*')
        .gte('created_at', startDate.toISOString())
        .order('created_at', { ascending: true })

      if (selectedTenantId !== 'all') {
        query = query.eq('tenant_id', selectedTenantId)
      }

      const { data: rawLogs, error: logsErr } = await query
      if (logsErr) throw logsErr

      const logItems: ResourceLog[] = rawLogs ?? []
      setLogs(logItems)

      // 3. Buscar tenants e planos para cruzar tickets
      const { data: tenantsData } = await supabase.from('tenants').select('id, name, plan').order('name')
      const { data: plansData } = await supabase.from('plans').select('slug, price_monthly')

      const planPrices: Record<string, number> = {}
      ;(plansData ?? []).forEach(p => {
        planPrices[p.slug] = Number(p.price_monthly)
      })

      // 4. Calcular totais globais por provedor
      let gUsd = 0, aUsd = 0, fUsd = 0, rUsd = 0, tUsd = 0

      const tenantCostMap: Record<string, { gemini: number; apify: number; railway: number; firecrawl: number; total: number }> = {}

      logItems.forEach(item => {
        const cost = Number(item.estimated_cost_usd) || 0
        tUsd += cost

        if (!tenantCostMap[item.tenant_id]) {
          tenantCostMap[item.tenant_id] = { gemini: 0, apify: 0, railway: 0, firecrawl: 0, total: 0 }
        }
        tenantCostMap[item.tenant_id]!.total += cost

        if (item.provider === 'gemini') {
          gUsd += cost
          tenantCostMap[item.tenant_id]!.gemini += cost
        } else if (item.provider === 'apify') {
          aUsd += cost
          tenantCostMap[item.tenant_id]!.apify += cost
        } else if (item.provider === 'firecrawl') {
          fUsd += cost
          tenantCostMap[item.tenant_id]!.firecrawl += cost
        } else if (item.provider === 'railway') {
          rUsd += cost
          tenantCostMap[item.tenant_id]!.railway += cost
        }
      })

      setTotalCostUsd(tUsd)
      setGeminiCostUsd(gUsd)
      setApifyCostUsd(aUsd)
      setFirecrawlCostUsd(fUsd)
      setRailwayCostUsd(rUsd)

      // 5. Montar dados para o gráfico de evolução diária
      const dailyMap: Record<string, { date: string; railway: number; apify: number; gemini: number; firecrawl: number }> = {}
      logItems.forEach(item => {
        const dayStr = new Date(item.created_at).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
        if (!dailyMap[dayStr]) {
          dailyMap[dayStr] = { date: dayStr, railway: 0, apify: 0, gemini: 0, firecrawl: 0 }
        }
        const costBrl = (Number(item.estimated_cost_usd) || 0) * USD_TO_BRL
        if (item.provider === 'railway') dailyMap[dayStr].railway += costBrl
        else if (item.provider === 'apify') dailyMap[dayStr].apify += costBrl
        else if (item.provider === 'gemini') dailyMap[dayStr].gemini += costBrl
        else if (item.provider === 'firecrawl') dailyMap[dayStr].firecrawl += costBrl
      })
      setChartDailyData(Object.values(dailyMap))

      // 6. Resumo por Tenant com Margem de Lucro e Detecção de Sangria
      const summaryList: TenantCostSummary[] = (tenantsData ?? []).map(tenant => {
        const planPriceBrl = planPrices[tenant.plan] ?? 139
        const costInfo = tenantCostMap[tenant.id] ?? { gemini: 0, apify: 0, railway: 0, firecrawl: 0, total: 0 }
        const costUsd = costInfo.total
        const costBrl = costUsd * USD_TO_BRL
        const geminiCostBrl = costInfo.gemini * USD_TO_BRL
        const apifyCostBrl = costInfo.apify * USD_TO_BRL
        const railwayCostBrl = costInfo.railway * USD_TO_BRL

        // Margem bruta = ((Receita - Custos de Infra) / Receita) * 100
        const grossMarginPct = planPriceBrl > 0 ? ((planPriceBrl - costBrl) / planPriceBrl) * 100 : 0
        // Sangria desnecessária = Custo de infra > 35% do valor da assinatura
        const isBleeding = planPriceBrl > 0 && costBrl > (planPriceBrl * 0.35)

        return {
          tenantId: tenant.id,
          tenantName: tenant.name,
          planSlug: tenant.plan,
          planPriceBrl,
          costUsd,
          costBrl,
          geminiCostBrl,
          apifyCostBrl,
          railwayCostBrl,
          grossMarginPct,
          isBleeding
        }
      })

      // Ordenar por maior custo
      summaryList.sort((a, b) => b.costBrl - a.costBrl)
      setTenantsSummary(summaryList)

      // 7. Gerar Alertas de Anomalia / Sangria
      const detectedAnomalies: AnomalyAlert[] = []
      summaryList.filter(s => s.isBleeding).forEach(s => {
        detectedAnomalies.push({
          id: s.tenantId,
          tenantName: s.tenantName,
          provider: s.apifyCostBrl > s.geminiCostBrl ? 'Apify Scraper' : 'IA Gemini / Compute',
          reason: `Custo acumulado (R$ ${s.costBrl.toFixed(2)}) ultrapassa 35% da assinatura (R$ ${s.planPriceBrl.toFixed(2)}).`,
          costUsd: s.costUsd,
          severity: s.costBrl > (s.planPriceBrl * 0.6) ? 'high' : 'medium'
        })
      })
      setAnomalies(detectedAnomalies)

    } catch (err) {
      console.error('[FinOps] Erro ao carregar telemetria:', err)
    } finally {
      setLoading(false)
    }
  }

  const bleedingCount = tenantsSummary.filter(t => t.isBleeding).length

  return (
    <div style={{ padding: '24px 32px', color: '#f8fafc', fontFamily: 'Inter, system-ui, sans-serif' }}>
      {/* Header com Filtros */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 28 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
            <DollarSign style={{ color: '#10b981' }} size={28} />
            Controle de Custos & Recursos (FinOps)
          </h1>
          <p style={{ color: '#94a3b8', fontSize: 14, marginTop: 4 }}>
            Monitoramento de consumo e prevenções de estouro de orçamento por assinante
          </p>
        </div>

        <div style={{ display: 'flex', gap: 12 }}>
          <select
            value={timeRange}
            onChange={e => setTimeRange(e.target.value as any)}
            style={{
              background: '#1e293b', color: '#f8fafc', border: '1px solid #334155',
              borderRadius: 8, padding: '8px 12px', fontSize: 13, cursor: 'pointer'
            }}
          >
            <option value="7d">Últimos 7 Dias</option>
            <option value="30d">Últimos 30 Dias</option>
            <option value="month">Mês Atual</option>
          </select>

          <button
            onClick={loadFinOpsData}
            style={{
              background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 8,
              padding: '8px 16px', fontWeight: 600, fontSize: 13, display: 'flex',
              alignItems: 'center', gap: 6, cursor: 'pointer'
            }}
          >
            <RefreshCw size={14} /> Atualizar
          </button>
        </div>
      </div>

      {/* Alerta de Sangria em Destaque (Se houver) */}
      {bleedingCount > 0 && (
        <div style={{
          background: 'linear-gradient(90deg, rgba(239, 68, 68, 0.15) 0%, rgba(185, 28, 28, 0.05) 100%)',
          border: '1px solid rgba(239, 68, 68, 0.4)', borderRadius: 12, padding: '16px 20px',
          marginBottom: 24, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Flame style={{ color: '#ef4444' }} size={24} />
            <div>
              <h4 style={{ margin: 0, color: '#fca5a5', fontSize: 15, fontWeight: 700 }}>
                🚨 Alerta de Sangria de Recursos! ({bleedingCount} Assinante(s) em Risco)
              </h4>
              <p style={{ margin: '2px 0 0', color: '#cbd5e1', fontSize: 13 }}>
                Identificamos clientes onde os custos de infraestrutura excedem 35% do valor da mensalidade paga.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Cards de KPIs Principais */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16, marginBottom: 28 }}>
        {/* Total Geral */}
        <div style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 12, padding: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: '#94a3b8', fontSize: 12, fontWeight: 600 }}>
            <span>CUSTO TOTAL ACUMULADO</span>
            <DollarSign size={16} style={{ color: '#10b981' }} />
          </div>
          <div style={{ fontSize: 24, fontWeight: 800, color: '#f8fafc', marginTop: 8 }}>
            US$ {totalCostUsd.toFixed(2)}
          </div>
          <div style={{ fontSize: 12, color: '#10b981', marginTop: 4, fontWeight: 500 }}>
            ≈ R$ {(totalCostUsd * USD_TO_BRL).toFixed(2)} BRL
          </div>
        </div>

        {/* Gemini IA */}
        <div style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 12, padding: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: '#94a3b8', fontSize: 12, fontWeight: 600 }}>
            <span>IA GEMINI 2.5 FLASH</span>
            <Bot size={16} style={{ color: '#818cf8' }} />
          </div>
          <div style={{ fontSize: 24, fontWeight: 800, color: '#f8fafc', marginTop: 8 }}>
            US$ {geminiCostUsd.toFixed(2)}
          </div>
          <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>
            Análises + Copilot
          </div>
        </div>

        {/* Apify & Scrapers */}
        <div style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 12, padding: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: '#94a3b8', fontSize: 12, fontWeight: 600 }}>
            <span>APIFY & FIRECRAWL</span>
            <Flame size={16} style={{ color: '#f59e0b' }} />
          </div>
          <div style={{ fontSize: 24, fontWeight: 800, color: '#f8fafc', marginTop: 8 }}>
            US$ {(apifyCostUsd + firecrawlCostUsd).toFixed(2)}
          </div>
          <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>
            Fallback de Scrapers
          </div>
        </div>

        {/* Railway Compute */}
        <div style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 12, padding: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: '#94a3b8', fontSize: 12, fontWeight: 600 }}>
            <span>RAILWAY COMPUTE</span>
            <Server size={16} style={{ color: '#38bdf8' }} />
          </div>
          <div style={{ fontSize: 24, fontWeight: 800, color: '#f8fafc', marginTop: 8 }}>
            US$ {railwayCostUsd.toFixed(2)}
          </div>
          <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>
            Playwright & Containers
          </div>
        </div>
      </div>

      {/* Gráfico de Evolução Diária */}
      <div style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 12, padding: 24, marginBottom: 28 }}>
        <h3 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 16px', display: 'flex', alignItems: 'center', gap: 8 }}>
          <BarChart2 size={18} style={{ color: '#3b82f6' }} />
          Evolução do Custo Diário por Provedor (R$)
        </h3>

        <div style={{ height: 280, width: '100%' }}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartDailyData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis dataKey="date" stroke="#64748b" fontSize={12} />
              <YAxis stroke="#64748b" fontSize={12} tickFormatter={val => `R$ ${val.toFixed(1)}`} />
              <Tooltip formatter={(value: any) => [`R$ ${Number(value).toFixed(2)}`, 'Custo']} />
              <Legend />
              <Area type="monotone" dataKey="railway" name="Railway Compute" stackId="1" stroke="#38bdf8" fill="#38bdf8" />
              <Area type="monotone" dataKey="apify" name="Apify Scrapers" stackId="1" stroke="#f59e0b" fill="#f59e0b" />
              <Area type="monotone" dataKey="gemini" name="Gemini IA" stackId="1" stroke="#818cf8" fill="#818cf8" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Tabela de Assinantes e Detalhamento de Custos / Margem */}
      <div style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 12, padding: 24 }}>
        <h3 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 16px', display: 'flex', alignItems: 'center', gap: 8 }}>
          <Cpu size={18} style={{ color: '#10b981' }} />
          Consumo de Recursos por Assinante (Análise de Margem Bruta)
        </h3>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, textAlign: 'left' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #1e293b', color: '#64748b', textTransform: 'uppercase', fontSize: 11, letterSpacing: '0.05em' }}>
                <th style={{ padding: '12px 16px' }}>Assinante</th>
                <th style={{ padding: '12px 16px' }}>Plano</th>
                <th style={{ padding: '12px 16px' }}>Ticket (R$)</th>
                <th style={{ padding: '12px 16px' }}>Custo Infra (R$)</th>
                <th style={{ padding: '12px 16px' }}>Gemini IA</th>
                <th style={{ padding: '12px 16px' }}>Apify/Scrapers</th>
                <th style={{ padding: '12px 16px' }}>Margem Bruta %</th>
                <th style={{ padding: '12px 16px' }}>Status FinOps</th>
              </tr>
            </thead>
            <tbody>
              {tenantsSummary.map(t => (
                <tr key={t.tenantId} style={{ borderBottom: '1px solid #1e293b' }}>
                  <td style={{ padding: '14px 16px', fontWeight: 600, color: '#f8fafc' }}>
                    {t.tenantName}
                  </td>
                  <td style={{ padding: '14px 16px', textTransform: 'capitalize', color: '#94a3b8' }}>
                    {t.planSlug}
                  </td>
                  <td style={{ padding: '14px 16px', color: '#cbd5e1' }}>
                    R$ {t.planPriceBrl.toFixed(2)}
                  </td>
                  <td style={{ padding: '14px 16px', fontWeight: 700, color: t.isBleeding ? '#ef4444' : '#f8fafc' }}>
                    R$ {t.costBrl.toFixed(2)}
                  </td>
                  <td style={{ padding: '14px 16px', color: '#818cf8' }}>
                    R$ {t.geminiCostBrl.toFixed(2)}
                  </td>
                  <td style={{ padding: '14px 16px', color: '#f59e0b' }}>
                    R$ {t.apifyCostBrl.toFixed(2)}
                  </td>
                  <td style={{ padding: '14px 16px', fontWeight: 700, color: t.grossMarginPct < 50 ? '#ef4444' : '#10b981' }}>
                    {t.grossMarginPct.toFixed(1)}%
                  </td>
                  <td style={{ padding: '14px 16px' }}>
                    {t.isBleeding ? (
                      <span style={{
                        background: 'rgba(239, 68, 68, 0.15)', color: '#fca5a5',
                        padding: '4px 8px', borderRadius: 6, fontSize: 11, fontWeight: 700,
                        border: '1px solid rgba(239, 68, 68, 0.3)', display: 'inline-flex', alignItems: 'center', gap: 4
                      }}>
                        <AlertTriangle size={12} /> Sangria de Recursos
                      </span>
                    ) : (
                      <span style={{
                        background: 'rgba(16, 185, 129, 0.15)', color: '#6ee7b7',
                        padding: '4px 8px', borderRadius: 6, fontSize: 11, fontWeight: 700,
                        border: '1px solid rgba(16, 185, 129, 0.3)', display: 'inline-flex', alignItems: 'center', gap: 4
                      }}>
                        <CheckCircle2 size={12} /> Operação Saúdavel
                      </span>
                    )}
                  </td>
                </tr>
              ))}
              {tenantsSummary.length === 0 && (
                <tr>
                  <td colSpan={8} style={{ padding: 24, textAlign: 'center', color: '#64748b' }}>
                    Nenhum registro de consumo de recursos encontrado no período.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
