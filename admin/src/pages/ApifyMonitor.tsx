import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import {
  RefreshCw, AlertTriangle, CheckCircle2, Clock, DollarSign,
  Activity, Zap, TrendingUp, ChevronDown, ChevronUp, Bot
} from 'lucide-react'

interface ApifyRun {
  runId: string
  actorId: string
  actorLabel: string
  status: string
  startedAt: string
  finishedAt: string | null
  durationSeconds: number | null
  datasetItemCount: number
  usageTotalUsd: number
  isWaste: boolean
  isExpensive: boolean
}

interface AccountStats {
  currentMonthUsageUsd: number
  planMonthlyUsageLimitUsd: number | null
  availableProxyCount: number
}

interface CostByActor {
  [label: string]: { runs: number; totalUsd: number; totalItems: number }
}

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001'

function statusBadge(status: string, isWaste: boolean, isExpensive: boolean) {
  if (isWaste) return { color: '#ef4444', bg: 'rgba(239,68,68,0.1)', label: '⚠ Desperdício', icon: '🔴' }
  if (isExpensive) return { color: '#f59e0b', bg: 'rgba(245,158,11,0.1)', label: '💸 Caro', icon: '🟡' }
  if (status === 'SUCCEEDED') return { color: '#10b981', bg: 'rgba(16,185,129,0.1)', label: 'Sucesso', icon: '✅' }
  if (status === 'FAILED') return { color: '#ef4444', bg: 'rgba(239,68,68,0.1)', label: 'Falhou', icon: '❌' }
  if (status === 'RUNNING') return { color: '#6366f1', bg: 'rgba(99,102,241,0.1)', label: 'Rodando', icon: '⏳' }
  if (status === 'ABORTED') return { color: '#64748b', bg: 'rgba(100,116,139,0.1)', label: 'Abortado', icon: '⛔' }
  if (status === 'TIMED-OUT') return { color: '#f59e0b', bg: 'rgba(245,158,11,0.1)', label: 'Timeout', icon: '⏱' }
  return { color: '#94a3b8', bg: 'rgba(148,163,184,0.1)', label: status, icon: '❓' }
}

function fmtDuration(secs: number | null) {
  if (secs == null) return '—'
  if (secs < 60) return `${secs}s`
  const m = Math.floor(secs / 60)
  const s = secs % 60
  return `${m}m ${s}s`
}

function fmtDate(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

export default function ApifyMonitor() {
  const [runs, setRuns] = useState<ApifyRun[]>([])
  const [account, setAccount] = useState<AccountStats | null>(null)
  const [costByActor, setCostByActor] = useState<CostByActor>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filterWaste, setFilterWaste] = useState(false)
  const [sortDesc, setSortDesc] = useState(true)
  const [limit, setLimit] = useState(50)

  const fetchData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      const headers = { Authorization: `Bearer ${token}` }

      const [runsRes, accountRes, costRes] = await Promise.all([
        fetch(`${API_URL}/api/apify/runs?limit=${limit}`, { headers }),
        fetch(`${API_URL}/api/apify/account`, { headers }),
        fetch(`${API_URL}/api/apify/cost-by-actor?limit=${limit}`, { headers }),
      ])

      if (!runsRes.ok) throw new Error(`Erro ao buscar runs: ${runsRes.status}`)
      const runsData = await runsRes.json()
      setRuns(runsData.data ?? [])

      if (accountRes.ok) {
        const accData = await accountRes.json()
        setAccount(accData.data)
      }

      if (costRes.ok) {
        const costData = await costRes.json()
        setCostByActor(costData.data ?? {})
      }
    } catch (err: any) {
      setError(err.message ?? 'Erro ao carregar dados do Apify')
    } finally {
      setLoading(false)
    }
  }, [limit])

  useEffect(() => { fetchData() }, [fetchData])

  const displayed = (filterWaste ? runs.filter(r => r.isWaste || r.isExpensive) : runs)
    .sort((a, b) => sortDesc
      ? new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
      : new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime()
    )

  const totalCostMonth = Object.values(costByActor).reduce((s, v) => s + v.totalUsd, 0)
  const totalRuns = runs.length
  const wasteCount = runs.filter(r => r.isWaste).length
  const expensiveCount = runs.filter(r => r.isExpensive).length

  return (
    <div style={{ padding: '32px', fontFamily: 'Inter, sans-serif', background: '#0d0f18', minHeight: '100vh', color: '#e2e8f0' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 32 }}>
        <div style={{ width: 44, height: 44, background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Bot size={22} color="#fff" />
        </div>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: '#f1f5f9' }}>Apify Monitor</h1>
          <p style={{ margin: 0, fontSize: 13, color: '#64748b' }}>Monitoramento de execuções e custos dos scrapers</p>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 10, alignItems: 'center' }}>
          <select value={limit} onChange={e => setLimit(Number(e.target.value))}
            style={{ background: '#1e2235', border: '1px solid #2d3550', color: '#e2e8f0', borderRadius: 8, padding: '6px 12px', fontSize: 13 }}>
            <option value={20}>Últimas 20</option>
            <option value={50}>Últimas 50</option>
            <option value={100}>Últimas 100</option>
            <option value={200}>Últimas 200</option>
          </select>
          <button onClick={fetchData} disabled={loading}
            style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#6366f1', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 16px', cursor: 'pointer', fontSize: 13 }}>
            <RefreshCw size={14} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} />
            Atualizar
          </button>
        </div>
      </div>

      {error && (
        <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 12, padding: '16px 20px', marginBottom: 24, color: '#fca5a5' }}>
          <AlertTriangle size={16} style={{ marginRight: 8 }} />{error}
        </div>
      )}

      {/* KPI Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16, marginBottom: 28 }}>
        {[
          { label: 'Runs analisados', value: totalRuns, icon: Activity, color: '#6366f1' },
          { label: 'Custo total (amostra)', value: `$${totalCostMonth.toFixed(4)}`, icon: DollarSign, color: '#10b981' },
          { label: 'Runs desperdiçadores', value: wasteCount, icon: AlertTriangle, color: '#ef4444' },
          { label: 'Runs caros', value: expensiveCount, icon: TrendingUp, color: '#f59e0b' },
          ...(account ? [{ label: 'Uso mensal Apify', value: `$${account.currentMonthUsageUsd.toFixed(2)}`, icon: Zap, color: '#8b5cf6' }] : []),
        ].map((k, i) => (
          <div key={i} style={{ background: '#13162a', border: '1px solid #1e2235', borderRadius: 14, padding: '20px 22px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <k.icon size={16} color={k.color} />
              <span style={{ fontSize: 12, color: '#64748b' }}>{k.label}</span>
            </div>
            <div style={{ fontSize: 24, fontWeight: 700, color: k.color }}>{k.value}</div>
          </div>
        ))}
      </div>

      {/* Custo por Actor */}
      {Object.keys(costByActor).length > 0 && (
        <div style={{ background: '#13162a', border: '1px solid #1e2235', borderRadius: 14, padding: '20px 22px', marginBottom: 28 }}>
          <h3 style={{ margin: '0 0 16px', fontSize: 14, fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            Custo por Actor (amostra {limit} runs)
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {Object.entries(costByActor)
              .sort((a, b) => b[1].totalUsd - a[1].totalUsd)
              .map(([actor, data]) => {
                const pct = totalCostMonth > 0 ? (data.totalUsd / totalCostMonth) * 100 : 0
                const costPerItem = data.totalItems > 0 ? data.totalUsd / data.totalItems : data.totalUsd
                return (
                  <div key={actor} style={{ display: 'grid', gridTemplateColumns: '220px 1fr 80px 100px 100px', alignItems: 'center', gap: 12 }}>
                    <span style={{ fontSize: 13, color: '#e2e8f0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{actor}</span>
                    <div style={{ background: '#1e2235', borderRadius: 4, height: 6, overflow: 'hidden' }}>
                      <div style={{ width: `${pct}%`, height: '100%', background: 'linear-gradient(90deg,#6366f1,#8b5cf6)', borderRadius: 4 }} />
                    </div>
                    <span style={{ fontSize: 12, color: '#64748b', textAlign: 'right' }}>{data.runs} runs</span>
                    <span style={{ fontSize: 12, color: '#f59e0b', textAlign: 'right' }}>${data.totalUsd.toFixed(4)}</span>
                    <span style={{ fontSize: 12, color: costPerItem > 0.05 ? '#ef4444' : '#10b981', textAlign: 'right' }}>${costPerItem.toFixed(5)}/item</span>
                  </div>
                )
              })}
          </div>
        </div>
      )}

      {/* Tabela de Runs */}
      <div style={{ background: '#13162a', border: '1px solid #1e2235', borderRadius: 14, overflow: 'hidden' }}>
        <div style={{ padding: '16px 22px', borderBottom: '1px solid #1e2235', display: 'flex', alignItems: 'center', gap: 12 }}>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: '#f1f5f9' }}>Execuções Recentes</h3>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 'auto', fontSize: 13, color: '#94a3b8', cursor: 'pointer' }}>
            <input type="checkbox" checked={filterWaste} onChange={e => setFilterWaste(e.target.checked)} />
            Só desperdícios/caros
          </label>
          <button onClick={() => setSortDesc(d => !d)}
            style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'transparent', border: '1px solid #2d3550', color: '#94a3b8', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontSize: 12 }}>
            {sortDesc ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
            {sortDesc ? 'Mais recente' : 'Mais antigo'}
          </button>
        </div>

        {loading ? (
          <div style={{ padding: 48, textAlign: 'center', color: '#64748b' }}>Carregando runs do Apify...</div>
        ) : displayed.length === 0 ? (
          <div style={{ padding: 48, textAlign: 'center', color: '#64748b' }}>
            {filterWaste ? 'Nenhum run problemático encontrado ✅' : 'Nenhum run encontrado'}
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: '#0d0f18' }}>
                {['Actor', 'Status', 'Iniciado', 'Duração', 'Itens', 'Custo (USD)', '$$/item'].map(h => (
                  <th key={h} style={{ padding: '10px 16px', textAlign: 'left', color: '#64748b', fontWeight: 500, fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {displayed.map((run, i) => {
                const badge = statusBadge(run.status, run.isWaste, run.isExpensive)
                const costPerItem = run.datasetItemCount > 0 ? run.usageTotalUsd / run.datasetItemCount : null
                return (
                  <tr key={run.runId} style={{ borderTop: '1px solid #1a1f35', background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.01)' }}>
                    <td style={{ padding: '10px 16px', color: '#e2e8f0', fontWeight: 500 }}>{run.actorLabel}</td>
                    <td style={{ padding: '10px 16px' }}>
                      <span style={{ background: badge.bg, color: badge.color, borderRadius: 6, padding: '3px 10px', fontSize: 12, fontWeight: 600 }}>
                        {badge.icon} {badge.label}
                      </span>
                    </td>
                    <td style={{ padding: '10px 16px', color: '#94a3b8' }}>{fmtDate(run.startedAt)}</td>
                    <td style={{ padding: '10px 16px', color: '#94a3b8' }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <Clock size={12} /> {fmtDuration(run.durationSeconds)}
                      </span>
                    </td>
                    <td style={{ padding: '10px 16px', color: run.datasetItemCount === 0 ? '#ef4444' : '#10b981', fontWeight: 600 }}>
                      {run.datasetItemCount}
                    </td>
                    <td style={{ padding: '10px 16px', color: run.usageTotalUsd > 0.10 ? '#f59e0b' : '#94a3b8', fontWeight: run.usageTotalUsd > 0.10 ? 600 : 400 }}>
                      {run.usageTotalUsd > 0 ? `$${run.usageTotalUsd.toFixed(5)}` : '—'}
                    </td>
                    <td style={{ padding: '10px 16px', color: costPerItem != null && costPerItem > 0.05 ? '#ef4444' : '#64748b', fontSize: 12 }}>
                      {costPerItem != null ? `$${costPerItem.toFixed(5)}` : '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  )
}
