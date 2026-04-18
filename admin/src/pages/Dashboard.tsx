import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Review, AlertEvent, Connector } from '../lib/supabase'
import {
  CHANNEL_LABELS, CHANNEL_ICONS, SENTIMENT_LABELS, SENTIMENT_COLORS,
  timeAgo, scoreToEmoji
} from '../lib/utils'
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, BarChart, Bar, Legend
} from 'recharts'
import { TrendingUp, MessageSquare, AlertTriangle, Activity } from 'lucide-react'
import type { TenantOption } from '../App'

interface Props {
  tenants: TenantOption[]
  selectedTenantId: string
  onTenantChange: (id: string) => void
}

// ──────────────────────────────────────────────────────────────
// KPIs do topo
// ──────────────────────────────────────────────────────────────

interface KPIData {
  totalReviews: number
  negativeRate: number
  criticalCount: number
  activeConnectors: number
  pendingAlerts: number
  avgScore: number
}

// ──────────────────────────────────────────────────────────────
// Tooltip personalizado dos gráficos
// ──────────────────────────────────────────────────────────────

function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className="custom-tooltip">
      <strong style={{ color: '#f0f4ff', display: 'block', marginBottom: 6 }}>{label}</strong>
      {payload.map((p: any) => (
        <div key={p.name} style={{ color: p.color, fontSize: 12 }}>
          {p.name}: <strong>{p.value}</strong>
        </div>
      ))}
    </div>
  )
}

// ──────────────────────────────────────────────────────────────
// Página Dashboard
// ──────────────────────────────────────────────────────────────

export default function Dashboard({ tenants, selectedTenantId, onTenantChange }: Props) {
  const [kpis, setKpis] = useState<KPIData | null>(null)
  const [recentReviews, setRecentReviews] = useState<Review[]>([])
  const [recentAlerts, setRecentAlerts] = useState<AlertEvent[]>([])
  const [trendData, setTrendData] = useState<any[]>([])
  const [channelData, setChannelData] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  useEffect(() => {
    loadAll()
    const handleRefresh = () => loadAll(true)
    window.addEventListener('refresh_data', handleRefresh)

    const channelId = `admin-dash-${Math.random().toString(36).substring(7)}`
    console.log(`[Realtime] Iniciando conexão no canal: ${channelId}`)

    const dashChannel = supabase
      .channel(channelId)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'reviews' },
        (payload) => {
          console.log('[Realtime] Review alterado!', payload)
          loadAll(true) // Silent refresh
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'alert_events' },
        () => {
          console.log('[Realtime] Alerta alterado!')
          loadAll(true) // Silent refresh
        }
      )
      .subscribe((status) => {
        console.log(`[Realtime] Status do canal ${channelId}:`, status)
      })

    return () => {
      window.removeEventListener('refresh_data', handleRefresh)
      supabase.removeChannel(dashChannel)
    }
  }, [selectedTenantId])

  async function loadAll(silent = false) {
    if (!silent) setLoading(true)
    else setRefreshing(true)

    await Promise.all([
      loadKPIs(),
      loadRecentReviews(),
      loadAlerts(),
      loadTrend(),
      loadChannelData(),
    ])
    
    setLoading(false)
    setRefreshing(false)
  }

  async function loadKPIs() {
    // 1. Contagem Total de Reviews
    let qTotal = supabase.from('reviews').select('id', { count: 'exact', head: true })
    if (selectedTenantId) qTotal = qTotal.eq('tenant_id', selectedTenantId)
    const { count: totalCount } = await qTotal

    // 2. Contagem de Negativos/Críticos
    let qNeg = supabase.from('reviews').select('id', { count: 'exact', head: true })
      .in('sentiment', ['negative', 'critical'])
    if (selectedTenantId) qNeg = qNeg.eq('tenant_id', selectedTenantId)
    const { count: negCount } = await qNeg

    // 3. Contagem de Críticos
    let qCrit = supabase.from('reviews').select('id', { count: 'exact', head: true })
      .eq('sentiment', 'critical')
    if (selectedTenantId) qCrit = qCrit.eq('tenant_id', selectedTenantId)
    const { count: critCount } = await qCrit

    // 4. Score Médio (aqui ainda precisamos de alguns dados, mas podemos limitar)
    let qScore = supabase.from('reviews').select('dissatisfaction_score').not('dissatisfaction_score', 'is', null)
    if (selectedTenantId) qScore = qScore.eq('tenant_id', selectedTenantId)
    const { data: scoresData } = await qScore.limit(1000)
    const scores = (scoresData || []).map(r => r.dissatisfaction_score as number)
    const avg = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0

    const { count: connCount } = await supabase
      .from('channel_connectors')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'active')

    const { count: alertCount } = await supabase
      .from('alert_events')
      .select('id', { count: 'exact', head: true })
      .is('resolved_at', null)

    setKpis({
      totalReviews: totalCount ?? 0,
      negativeRate: totalCount ? Math.round(((negCount ?? 0) / totalCount) * 100) : 0,
      criticalCount: critCount ?? 0,
      activeConnectors: connCount ?? 0,
      pendingAlerts: alertCount ?? 0,
      avgScore: avg,
    })

    // 5. Distribuição de sentimento (buscar apenas uma amostra recente para a pizza)
    let qDist = supabase.from('reviews').select('sentiment')
    if (selectedTenantId) qDist = qDist.eq('tenant_id', selectedTenantId)
    const { data: distData } = await qDist.limit(1000)
    
    const dist: Record<string, number> = {}
    for (const r of distData ?? []) {
      dist[r.sentiment] = (dist[r.sentiment] || 0) + 1
    }

    setSentimentDist(
      Object.entries(dist).map(([name, value]) => ({
        name: SENTIMENT_LABELS[name as keyof typeof SENTIMENT_LABELS] || name,
        value,
        color: SENTIMENT_COLORS[name as keyof typeof SENTIMENT_COLORS] || '#6b7280',
      }))
    )
  }

  async function loadRecentReviews() {
    let q = supabase.from('reviews')
      .select('*, monitored_businesses(name)')
      .order('published_at', { ascending: false })
      .limit(5)
    if (selectedTenantId) q = q.eq('tenant_id', selectedTenantId)
    const { data } = await q

    setRecentReviews(data ?? [])
  }

  async function loadAlerts() {
    let q = supabase.from('alert_events').select('*, alert_rules(name, condition_type)')
      .is('resolved_at', null).order('created_at', { ascending: false }).limit(5)
    if (selectedTenantId) q = q.eq('tenant_id', selectedTenantId)
    const { data } = await q
    setRecentAlerts(data ?? [])
  }

  async function loadTrend() {
    const days: any[] = []
    for (let i = 6; i >= 0; i--) {
      const d = new Date()
      d.setDate(d.getDate() - i)
      const label = d.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit' })
      const dayStr = d.toISOString().split('T')[0]
      days.push({ label, day: dayStr, positivo: 0, neutro: 0, negativo: 0, crítico: 0 })
    }

    let q = supabase.from('reviews').select('sentiment, published_at').gte('published_at', days[0].day)
    if (selectedTenantId) q = q.eq('tenant_id', selectedTenantId)
    const { data } = await q

    for (const r of data ?? []) {
      const day = new Date(r.published_at).toISOString().split('T')[0]
      const bucket = days.find(d => d.day === day)
      if (!bucket) continue
      const s = r.sentiment
      if (s === 'positive') bucket.positivo++
      else if (s === 'neutral') bucket.neutro++
      else if (s === 'negative') bucket.negativo++
      else if (s === 'critical') bucket.crítico++
    }

    setTrendData(days)
  }

  async function loadChannelData() {
    let q = supabase.from('reviews').select('channel')
    if (selectedTenantId) q = q.eq('tenant_id', selectedTenantId)
    const { data } = await q

    const counts: Record<string, number> = {}
    for (const r of data ?? []) {
      counts[r.channel] = (counts[r.channel] || 0) + 1
    }

    setChannelData(
      Object.entries(counts).map(([channel, count]) => ({
        channel: CHANNEL_LABELS[channel as keyof typeof CHANNEL_LABELS] || channel,
        icon: CHANNEL_ICONS[channel as keyof typeof CHANNEL_ICONS] || '📱',
        count,
      })).sort((a, b) => b.count - a.count)
    )
  }

  // ── Skeleton ────────────────────────────────────────────────
  if (loading) {
    return (
      <div>
        <div className="page-header">
          <div className="skeleton" style={{ width: 200, height: 28, marginBottom: 6 }} />
          <div className="skeleton" style={{ width: 300, height: 16 }} />
        </div>
        <div className="kpi-grid">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="card kpi-card">
              <div className="skeleton" style={{ width: 80, height: 12, marginBottom: 12 }} />
              <div className="skeleton" style={{ width: 60, height: 32, marginBottom: 8 }} />
              <div className="skeleton" style={{ width: 120, height: 12 }} />
            </div>
          ))}
        </div>
      </div>
    )
  }

  const scoreColor = (score: number) =>
    score >= 81 ? '#dc2626' : score >= 56 ? '#ef4444' : score >= 31 ? '#f59e0b' : '#10b981'

  return (
    <div>
      {/* ── Header ───────────────────────────────────────────── */}
      <div className="page-header">
        <h1 className="page-title">Dashboard</h1>
        <p className="page-subtitle">Visão geral da reputação monitorada em tempo real</p>
        <select
          value={selectedTenantId}
          onChange={e => onTenantChange(e.target.value)}
          style={{ marginTop: 10, padding: '6px 12px', background: 'var(--bg-darker)', border: '1px solid var(--border)', color: 'var(--text-primary)', borderRadius: 6, fontSize: 13, cursor: 'pointer' }}
        >
          <option value=''>Todos os assinantes</option>
          {tenants.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </div>

      {/* ── KPIs ─────────────────────────────────────────────── */}
      <div className="kpi-grid">
        <div className="card kpi-card card-glow" style={{ '--kpi-color': '#6366f1' } as any}>
          <div className="kpi-icon" style={{ '--kpi-icon-bg': 'rgba(99,102,241,0.15)' } as any}>
            <MessageSquare size={18} color="#a5b4fc" />
          </div>
          <div className="kpi-label">Total de Reviews</div>
          <div className="kpi-value">{kpis?.totalReviews.toLocaleString('pt-BR')}</div>
          <div className="kpi-sub"><TrendingUp size={12} /> coletados via 8 canais</div>
        </div>

        <div className="card kpi-card" style={{ '--kpi-color': '#ef4444' } as any}>
          <div className="kpi-icon" style={{ '--kpi-icon-bg': 'rgba(239,68,68,0.15)' } as any}>
            <AlertTriangle size={18} color="#f87171" />
          </div>
          <div className="kpi-label">Taxa Negativa / Crítica</div>
          <div className="kpi-value" style={{ color: kpis && kpis.negativeRate > 30 ? '#ef4444' : '#f0f4ff' }}>
            {kpis?.negativeRate}%
          </div>
          <div className="kpi-sub">
            <span style={{ color: '#ff4d4d' }}>🚨 {kpis?.criticalCount} críticos</span>
          </div>
        </div>

        <div className="card kpi-card" style={{ '--kpi-color': '#f59e0b' } as any}>
          <div className="kpi-icon" style={{ '--kpi-icon-bg': 'rgba(245,158,11,0.15)' } as any}>
            <Activity size={18} color="#fbbf24" />
          </div>
          <div className="kpi-label">Score Médio de Insatisfação</div>
          <div className="kpi-value" style={{ color: scoreColor(kpis?.avgScore ?? 0) }}>
            {kpis?.avgScore}/100
          </div>
          <div className="kpi-sub">0 = feliz · 100 = furioso</div>
        </div>

        <div className="card kpi-card" style={{ '--kpi-color': '#06b6d4' } as any}>
          <div className="kpi-icon" style={{ '--kpi-icon-bg': 'rgba(6,182,212,0.15)' } as any}>
            <Activity size={18} color="#22d3ee" />
          </div>
          <div className="kpi-label">Alertas Pendentes</div>
          <div className="kpi-value" style={{ color: (kpis?.pendingAlerts ?? 0) > 0 ? '#ef4444' : '#10b981' }}>
            {kpis?.pendingAlerts}
          </div>
          <div className="kpi-sub">{kpis?.activeConnectors} conectores ativos</div>
        </div>
      </div>

      {/* ── Gráficos ─────────────────────────────────────────── */}
      <div className="grid-2">
        {/* Trend 7 dias */}
        <div className="card" style={{ padding: 20 }}>
          <div className="section-title">📈 Tendência de Sentimento (7 dias)</div>
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={trendData} margin={{ top: 5, right: 0, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="gPos" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="gNeg" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#ef4444" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip content={<CustomTooltip />} />
              <Area type="monotone" dataKey="positivo" stroke="#10b981" fill="url(#gPos)" strokeWidth={2} />
              <Area type="monotone" dataKey="negativo" stroke="#ef4444" fill="url(#gNeg)" strokeWidth={2} />
              <Area type="monotone" dataKey="crítico" stroke="#dc2626" fill="none" strokeWidth={2} strokeDasharray="4 2" />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Distribuição de sentimento */}
        <div className="card" style={{ padding: 20 }}>
          <div className="section-title">🎯 Distribuição de Sentimento</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <ResponsiveContainer width={160} height={160}>
              <PieChart>
                <Pie data={sentimentDist} cx="50%" cy="50%" innerRadius={45} outerRadius={70} dataKey="value" paddingAngle={3}>
                  {sentimentDist.map((entry, i) => (
                    <Cell key={i} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip content={<CustomTooltip />} />
              </PieChart>
            </ResponsiveContainer>
            <div style={{ flex: 1 }}>
              {sentimentDist.map(s => (
                <div key={s.name} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <div style={{ width: 10, height: 10, borderRadius: '50%', background: s.color, flexShrink: 0 }} />
                  <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{s.name}</span>
                  <span style={{ marginLeft: 'auto', fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{s.value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Reviews por canal */}
      {channelData.length > 0 && (
        <div className="card" style={{ padding: 20, marginBottom: 24 }}>
          <div className="section-title">📊 Reviews por Canal</div>
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={channelData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="channel" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip content={<CustomTooltip />} />
              <Bar dataKey="count" name="Reviews" fill="#6366f1" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Reviews recentes + Alertas */}
      <div className="grid-2">
        {/* Reviews recentes */}
        <div>
          <div className="section-title">🕐 Reviews Recentes</div>
          {recentReviews.length === 0 ? (
            <div className="card empty-state">
              <div className="empty-state-icon">📭</div>
              <div className="empty-state-text">Nenhum review ainda</div>
            </div>
          ) : (
            <div className="review-list">
              {recentReviews.map(r => {
                const tenantName = tenants.find(t => t.id === r.tenant_id)?.name
                return (
                <div key={r.id} className="card review-item">
                  <div className="review-header">
                    <span className={`badge badge-${r.sentiment}`}>
                      {scoreToEmoji(r.dissatisfaction_score ?? 0)} {SENTIMENT_LABELS[r.sentiment]}
                    </span>
                    <div className="review-meta">
                      <span className="review-channel-tag">
                        {CHANNEL_ICONS[r.channel]} {CHANNEL_LABELS[r.channel]}
                      </span>
                      <span>{timeAgo(r.published_at)}</span>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 12, marginBottom: 6, flexWrap: 'wrap' }}>
                    {r.author_name && (
                      <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                        👤 {r.author_name}
                      </span>
                    )}
                    {tenantName && (
                      <span style={{ fontSize: 12, color: '#6366f1', fontWeight: 600 }}>
                        🏢 {tenantName}
                      </span>
                    )}
                    {r.monitored_businesses?.name && (
                      <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                        · {r.monitored_businesses.name}
                      </span>
                    )}
                  </div>
                  {r.body && (
                    <div className="review-body">{r.body}</div>
                  )}
                  {r.sentiment_summary && (
                    <div className="review-ai-summary">
                      🤖 {r.sentiment_summary}
                    </div>
                  )}
                </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Alertas recentes */}
        <div>
          <div className="section-title">🚨 Alertas Ativos</div>
          {recentAlerts.length === 0 ? (
            <div className="card empty-state">
              <div className="empty-state-icon">✅</div>
              <div className="empty-state-text">Nenhum alerta pendente</div>
            </div>
          ) : (
            <div className="alert-list">
              {recentAlerts.map(a => (
                <div
                  key={a.id}
                  className={`card alert-item ${a.detail?.review_sentiment === 'critical' ? 'critical' : ''}`}
                >
                  <div className="alert-header">
                    <span className="alert-rule">
                      {CHANNEL_ICONS[a.channel]} {a.alert_rules?.name || a.detail?.triggered_by_rule || 'Alerta'}
                    </span>
                    <span className="alert-time">{timeAgo(a.triggered_at)}</span>
                  </div>
                  {a.detail?.alert_reason ? (
                    <div className="alert-reason">⚠️ {a.detail.alert_reason}</div>
                  ) : (
                    <div className="alert-reason" style={{ color: 'var(--text-muted)' }}>
                      {a.detail?.review_body_preview?.slice(0, 100)}...
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
