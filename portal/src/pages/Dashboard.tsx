import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Review, AlertEvent } from '../lib/supabase'
import {
  CHANNEL_LABELS, CHANNEL_ICONS, SENTIMENT_LABELS, SENTIMENT_COLORS,
  SENTIMENT_BG, TOPIC_LABELS, timeAgo, scoreToEmoji, ratingStars,
} from '../lib/utils'
import {
  AreaChart, Area, XAxis, YAxis, Tooltip,
  PieChart, Pie, Cell, ResponsiveContainer,
} from 'recharts'
import { MessageSquare, Bell, TrendingDown, Star, AlertTriangle } from 'lucide-react'

interface KPI {
  total: number
  negative_rate: number
  critical_count: number
  avg_rating: number
  pending_alerts: number
  avg_score: number
}

export default function Dashboard() {
  const [kpi, setKpi]           = useState<KPI | null>(null)
  const [trend, setTrend]       = useState<Array<{ date: string; pos: number; neg: number; crit: number }>>([])
  const [dist, setDist]         = useState<Array<{ name: string; value: number; color: string }>>([])
  const [recent, setRecent]     = useState<Review[]>([])
  const [alerts, setAlerts]     = useState<AlertEvent[]>([])
  const [loading, setLoading]   = useState(true)

  async function load() {
    setLoading(true)
    const since30 = new Date(Date.now() - 30 * 86400_000).toISOString()
    const since7  = new Date(Date.now() -  7 * 86400_000).toISOString()

    const [rvRes, alRes, recentRes, alertRes] = await Promise.all([
      supabase.from('reviews').select('sentiment, dissatisfaction_score, rating, published_at').gte('published_at', since30),
      supabase.from('alert_events').select('id', { count: 'exact', head: true }).eq('notified', false),
      supabase.from('reviews').select('*, monitored_businesses(name)').order('published_at', { ascending: false }).limit(5),
      supabase.from('alert_events').select('*, alert_rules(name,condition_type), monitored_businesses(name)').eq('notified', false).order('triggered_at', { ascending: false }).limit(3),
    ])

    const reviews = rvRes.data ?? []

    // KPIs
    const total         = reviews.length
    const negCritCount  = reviews.filter(r => r.sentiment === 'negative' || r.sentiment === 'critical').length
    const critCount     = reviews.filter(r => r.sentiment === 'critical').length
    const rated         = reviews.filter(r => r.rating != null)
    const avgRating     = rated.length ? rated.reduce((s, r) => s + (r.rating as number), 0) / rated.length : 0
    const scored        = reviews.filter(r => r.dissatisfaction_score != null)
    const avgScore      = scored.length ? scored.reduce((s, r) => s + (r.dissatisfaction_score as number), 0) / scored.length : 0

    setKpi({
      total,
      negative_rate: total ? Math.round((negCritCount / total) * 100) : 0,
      critical_count: critCount,
      avg_rating: avgRating,
      pending_alerts: alRes.count ?? 0,
      avg_score: Math.round(avgScore),
    })

    // Distribuição de sentimento (pizza)
    const sentCounts: Record<string, number> = {}
    for (const r of reviews) { sentCounts[r.sentiment] = (sentCounts[r.sentiment] ?? 0) + 1 }
    setDist(
      Object.entries(sentCounts)
        .filter(([, v]) => v > 0)
        .map(([k, v]) => ({ name: SENTIMENT_LABELS[k as keyof typeof SENTIMENT_LABELS] ?? k, value: v, color: SENTIMENT_COLORS[k as keyof typeof SENTIMENT_COLORS] ?? '#6b7280' }))
    )

    // Tendência 7 dias
    const days: Array<{ date: string; pos: number; neg: number; crit: number }> = []
    for (let i = 6; i >= 0; i--) {
      const d  = new Date(); d.setDate(d.getDate() - i)
      const ds = d.toISOString().split('T')[0]!
      const dayRevs = reviews.filter(r => r.published_at.startsWith(ds))
      days.push({
        date: d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }),
        pos:  dayRevs.filter(r => r.sentiment === 'positive').length,
        neg:  dayRevs.filter(r => r.sentiment === 'negative').length,
        crit: dayRevs.filter(r => r.sentiment === 'critical').length,
      })
    }
    setTrend(days)

    setRecent(recentRes.data ?? [])
    setAlerts(alertRes.data ?? [])
    setLoading(false)
  }

  useEffect(() => {
    load()
    const handler = () => load()
    window.addEventListener('refresh_data', handler)
    return () => window.removeEventListener('refresh_data', handler)
  }, [])

  if (loading) return (
    <div>
      <div className="page-header"><div className="skeleton" style={{ width: 220, height: 32, marginBottom: 8 }} /><div className="skeleton" style={{ width: 340, height: 18 }} /></div>
      <div className="kpi-grid">{Array(4).fill(0).map((_, i) => <div key={i} className="card kpi-card"><div className="skeleton" style={{ height: 80 }} /></div>)}</div>
    </div>
  )

  const negColor = kpi && kpi.negative_rate >= 30 ? '#ef4444' : kpi && kpi.negative_rate >= 15 ? '#f59e0b' : '#10b981'

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Visão Geral</h1>
        <p className="page-subtitle">Últimos 30 dias de monitoramento de reputação</p>
      </div>

      {/* KPIs */}
      <div className="kpi-grid">
        <div className="card kpi-card" style={{ '--kpi-color': '#6366f1', '--kpi-icon-bg': 'rgba(99,102,241,0.15)' } as React.CSSProperties}>
          <div className="kpi-label">Reviews Coletados</div>
          <div className="kpi-value">{kpi?.total ?? 0}</div>
          <div className="kpi-sub"><MessageSquare size={12} /> últimos 30 dias</div>
          <div className="kpi-icon"><MessageSquare size={18} color="#a5b4fc" /></div>
        </div>

        <div className="card kpi-card" style={{ '--kpi-color': negColor, '--kpi-icon-bg': `${negColor}22` } as React.CSSProperties}>
          <div className="kpi-label">Taxa Negativa</div>
          <div className="kpi-value" style={{ color: negColor }}>{kpi?.negative_rate ?? 0}%</div>
          <div className="kpi-sub"><TrendingDown size={12} /> negativos + críticos</div>
          <div className="kpi-icon"><TrendingDown size={18} color={negColor} /></div>
        </div>

        <div className="card kpi-card" style={{ '--kpi-color': '#dc2626', '--kpi-icon-bg': 'rgba(220,38,38,0.15)' } as React.CSSProperties}>
          <div className="kpi-label">Reviews Críticos</div>
          <div className="kpi-value" style={{ color: kpi && kpi.critical_count > 0 ? '#ff4d4d' : 'var(--text-primary)' }}>{kpi?.critical_count ?? 0}</div>
          <div className="kpi-sub"><AlertTriangle size={12} /> requerem atenção</div>
          <div className="kpi-icon"><AlertTriangle size={18} color="#ff4d4d" /></div>
        </div>

        <div className="card kpi-card" style={{ '--kpi-color': '#f59e0b', '--kpi-icon-bg': 'rgba(245,158,11,0.15)' } as React.CSSProperties}>
          <div className="kpi-label">Nota Média</div>
          <div className="kpi-value" style={{ color: '#f59e0b' }}>
            {kpi && kpi.avg_rating > 0 ? kpi.avg_rating.toFixed(1) : '—'}
          </div>
          <div className="kpi-sub"><Star size={12} /> de 5.0 estrelas</div>
          <div className="kpi-icon"><Star size={18} color="#f59e0b" /></div>
        </div>
      </div>

      <div className="grid-2">
        {/* Tendência */}
        <div className="card" style={{ padding: 20 }}>
          <div className="section-title">📈 Tendência — 7 dias</div>
          <ResponsiveContainer width="100%" height={180}>
            <AreaChart data={trend} margin={{ top: 5, right: 10, bottom: 0, left: -20 }}>
              <defs>
                <linearGradient id="gPos"  x1="0" y1="0" x2="0" y2="1"><stop offset="5%"  stopColor="#10b981" stopOpacity={0.3} /><stop offset="95%" stopColor="#10b981" stopOpacity={0} /></linearGradient>
                <linearGradient id="gNeg"  x1="0" y1="0" x2="0" y2="1"><stop offset="5%"  stopColor="#ef4444" stopOpacity={0.3} /><stop offset="95%" stopColor="#ef4444" stopOpacity={0} /></linearGradient>
                <linearGradient id="gCrit" x1="0" y1="0" x2="0" y2="1"><stop offset="5%"  stopColor="#dc2626" stopOpacity={0.3} /><stop offset="95%" stopColor="#dc2626" stopOpacity={0} /></linearGradient>
              </defs>
              <XAxis dataKey="date" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
              <Tooltip contentStyle={{ background: '#161d2f', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }} />
              <Area type="monotone" dataKey="pos"  name="Positivos" stroke="#10b981" fill="url(#gPos)"  strokeWidth={2} />
              <Area type="monotone" dataKey="neg"  name="Negativos" stroke="#ef4444" fill="url(#gNeg)"  strokeWidth={2} />
              <Area type="monotone" dataKey="crit" name="Críticos"  stroke="#dc2626" fill="url(#gCrit)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Distribuição */}
        <div className="card" style={{ padding: 20 }}>
          <div className="section-title">🥧 Distribuição de Sentimento</div>
          {dist.length === 0 ? (
            <div className="empty-state" style={{ height: 180 }}>
              <div className="empty-state-icon">📊</div>
              <div className="empty-state-text">Sem dados suficientes</div>
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
              <ResponsiveContainer width={160} height={160}>
                <PieChart>
                  <Pie data={dist} cx="50%" cy="50%" innerRadius={44} outerRadius={70} dataKey="value" paddingAngle={2}>
                    {dist.map((e, i) => <Cell key={i} fill={e.color} />)}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {dist.map(d => (
                  <div key={d.name} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                    <div style={{ width: 10, height: 10, borderRadius: '50%', background: d.color, flexShrink: 0 }} />
                    <span style={{ flex: 1, color: 'var(--text-secondary)' }}>{d.name}</span>
                    <span style={{ fontWeight: 600, color: d.color }}>{d.value}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="grid-2">
        {/* Reviews recentes */}
        <div className="card" style={{ padding: 20 }}>
          <div className="section-title">💬 Reviews Recentes</div>
          {recent.length === 0 ? (
            <div className="empty-state"><div className="empty-state-icon">💬</div><div className="empty-state-text">Nenhum review ainda</div></div>
          ) : (
            <div className="review-list">
              {recent.map(r => (
                <div key={r.id} className="card review-item">
                  <div className="review-header">
                    <span className={`badge badge-${r.sentiment}`}>{scoreToEmoji(r.dissatisfaction_score ?? 0)} {SENTIMENT_LABELS[r.sentiment]}</span>
                    <div className="review-meta">
                      <span className="review-channel-tag">{CHANNEL_ICONS[r.channel]} {CHANNEL_LABELS[r.channel]}</span>
                      <span>{timeAgo(r.published_at)}</span>
                      {r.rating != null && <span className="stars">{ratingStars(r.rating)}</span>}
                    </div>
                  </div>
                  <div className="review-body">{r.body || r.title || '(sem texto)'}</div>
                  {r.sentiment_summary && (
                    <div className="review-ai-summary">🤖 {r.sentiment_summary}</div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Alertas ativos */}
        <div className="card" style={{ padding: 20 }}>
          <div className="section-title">
            🚨 Alertas Ativos
            {(kpi?.pending_alerts ?? 0) > 0 && (
              <span style={{ marginLeft: 'auto', background: 'rgba(239,68,68,0.15)', color: '#fca5a5', border: '1px solid rgba(239,68,68,0.3)', padding: '2px 8px', borderRadius: 99, fontSize: 11, fontWeight: 700 }}>
                {kpi?.pending_alerts}
              </span>
            )}
          </div>
          {alerts.length === 0 ? (
            <div className="empty-state"><div className="empty-state-icon">✅</div><div className="empty-state-text">Nenhum alerta pendente</div></div>
          ) : (
            <div className="alert-list">
              {alerts.map(a => (
                <div key={a.id} className={`card alert-item ${a.detail.condition_type === 'critical_review' ? 'critical' : ''}`}>
                  <div className="alert-header">
                    <span className="alert-rule">{a.alert_rules?.name ?? 'Alerta'}</span>
                    <span className="alert-time">{timeAgo(a.triggered_at)}</span>
                  </div>
                  <div className="alert-reason">
                    {a.detail.sentiment_summary || a.detail.review_body_preview || 'Verificar review associado.'}
                    {a.detail.alert_reason && <><br /><strong>{a.detail.alert_reason}</strong></>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
