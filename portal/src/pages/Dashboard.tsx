import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Review, AlertEvent } from '../lib/supabase'
import {
  CHANNEL_LABELS, CHANNEL_ICONS, SENTIMENT_LABELS, SENTIMENT_COLORS,
  timeAgo, scoreToEmoji, ratingStars, API_URL,
} from '../lib/utils'
import {
  AreaChart, Area, XAxis, YAxis, Tooltip,
  PieChart, Pie, Cell, ResponsiveContainer,
} from 'recharts'
import { MessageSquare, TrendingDown, Star, AlertTriangle, FileText, Award } from 'lucide-react'

interface KPI {
  total: number       // últimos 30 dias
  total_all: number   // todo o histórico
  negative_rate: number
  critical_count: number
  avg_rating: number
  pending_alerts: number
  avg_score: number
}

interface ReputationScore {
  score: number
  component_rating: number
  component_sentiment: number
  component_volume: number
  component_response: number
  component_reclame: number
  component_consumidor: number
  component_trend: number
  reviews_analyzed: number
  calculated_at: string
  reputation_score_history?: Array<{ score: number; snapshot_date: string }>
}

interface Props { tenantId: string }

export default function Dashboard({ tenantId }: Props) {
  const [kpi, setKpi]           = useState<KPI | null>(null)
  const [trend, setTrend]       = useState<Array<{ date: string; pos: number; neg: number; crit: number }>>([])
  const [dist, setDist]         = useState<Array<{ name: string; value: number; color: string }>>([])
  const [recent, setRecent]     = useState<Review[]>([])
  const [alerts, setAlerts]     = useState<AlertEvent[]>([])
  const [competitors, setCompetitors] = useState<any[]>([])
  const [repScore, setRepScore] = useState<ReputationScore | null>(null)
  const [loading, setLoading]     = useState(true)

  async function load(silent = false) {
    if (!silent) setLoading(true)

    // Sem tenant ainda carregado, não buscar nada
    if (!tenantId) {
      setLoading(false)
      return
    }

    try {
      const since30 = new Date(Date.now() - 30 * 86400_000).toISOString()

      // Obter business_ids do tenant para filtrar alert_events (que não tem tenant_id direto)
      const { data: bizData } = await supabase
        .from('monitored_businesses')
        .select('id')
        .eq('tenant_id', tenantId)
      const bizIds = (bizData ?? []).map(b => b.id)

      const API_BASE = API_URL
      const token = (await supabase.auth.getSession()).data.session?.access_token
      const repScorePromise: Promise<ReputationScore[]> = token
        ? fetch(`${API_BASE}/api/reputation-score`, { headers: { Authorization: `Bearer ${token}` } })
            .then(r => r.ok ? r.json() : [])
            .catch(() => [])
        : Promise.resolve([])

      const [statsRes, allStatsRes, alRes, recentRes, alertRes, compRes, repScores] = await Promise.all([
        supabase.from('review_stats_daily').select('positive_count, neutral_count, negative_count, critical_count, unanalyzed_count, avg_rating, avg_dissatisfaction_score, total_reviews, date')
          .eq('tenant_id', tenantId).gte('date', since30.split('T')[0]),
        supabase.from('review_stats_daily').select('total_reviews')
          .eq('tenant_id', tenantId),
        bizIds.length
          ? supabase.from('alert_events').select('id', { count: 'exact', head: true }).eq('notified', false).in('business_id', bizIds)
          : Promise.resolve({ count: 0, data: null, error: null }),
        supabase.from('reviews').select('*, monitored_businesses(name)')
          .eq('tenant_id', tenantId).order('published_at', { ascending: false }).limit(5),
        bizIds.length
          ? supabase.from('alert_events').select('*, alert_rules(name,condition_type), monitored_businesses(name)').eq('notified', false).in('business_id', bizIds).order('triggered_at', { ascending: false }).limit(3)
          : Promise.resolve({ data: [], error: null }),
        bizIds.length
          ? supabase.from('competitor_businesses').select('*').in('business_id', bizIds).order('name', { ascending: true })
          : Promise.resolve({ data: [], error: null }),
        repScorePromise,
      ] as const)

      const stats = statsRes.data ?? []
      const allStats = allStatsRes.data ?? []

      // KPIs a partir do review_stats_daily
      let total = 0
      let negCritCount = 0
      let critCount = 0
      let totalRatingWeight = 0
      let totalReviewsWithRating = 0
      let totalScoreWeight = 0
      let totalReviewsWithScore = 0

      for (const s of stats) {
        total += s.total_reviews ?? 0
        negCritCount += (s.negative_count ?? 0) + (s.critical_count ?? 0)
        critCount += s.critical_count ?? 0

        if (s.avg_rating != null && s.total_reviews > 0) {
          totalRatingWeight += Number(s.avg_rating) * s.total_reviews
          totalReviewsWithRating += s.total_reviews
        }

        if (s.avg_dissatisfaction_score != null && s.total_reviews > 0) {
          totalScoreWeight += Number(s.avg_dissatisfaction_score) * s.total_reviews
          totalReviewsWithScore += s.total_reviews
        }
      }

      const totalAll = allStats.reduce((acc, curr) => acc + (curr.total_reviews ?? 0), 0)
      const avgRating = totalReviewsWithRating ? totalRatingWeight / totalReviewsWithRating : 0
      const avgScore = totalReviewsWithScore ? totalScoreWeight / totalReviewsWithScore : 0

      setKpi({
        total,
        total_all: totalAll,
        negative_rate: total ? Math.round((negCritCount / total) * 100) : 0,
        critical_count: critCount,
        avg_rating: avgRating,
        pending_alerts: alRes.count ?? 0,
        avg_score: Math.round(avgScore),
      })

      // Distribuição de sentimento (pizza)
      const sentCounts = { positive: 0, neutral: 0, negative: 0, critical: 0, unanalyzed: 0 }
      for (const s of stats) {
        sentCounts.positive += s.positive_count ?? 0
        sentCounts.neutral += s.neutral_count ?? 0
        sentCounts.negative += s.negative_count ?? 0
        sentCounts.critical += s.critical_count ?? 0
        sentCounts.unanalyzed += s.unanalyzed_count ?? 0
      }

      setDist(
        Object.entries(sentCounts)
          .filter(([, v]) => v > 0)
          .map(([k, v]) => ({
            name: SENTIMENT_LABELS[k as keyof typeof SENTIMENT_LABELS] ?? k,
            value: v,
            color: SENTIMENT_COLORS[k as keyof typeof SENTIMENT_COLORS] ?? '#6b7280'
          }))
      )

      // Tendência 7 dias
      const days: Array<{ date: string; pos: number; neg: number; crit: number }> = []
      for (let i = 6; i >= 0; i--) {
        const d  = new Date(); d.setDate(d.getDate() - i)
        const ds = d.toISOString().split('T')[0]!
        const dayStats = stats.filter(s => s.date === ds)
        days.push({
          date: d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }),
          pos:  dayStats.reduce((acc, curr) => acc + (curr.positive_count ?? 0), 0),
          neg:  dayStats.reduce((acc, curr) => acc + (curr.negative_count ?? 0), 0),
          crit: dayStats.reduce((acc, curr) => acc + (curr.critical_count ?? 0), 0),
        })
      }
      setTrend(days)

      setRecent(recentRes.data ?? [])
      setAlerts(alertRes.data ?? [])
      setCompetitors(compRes.data ?? [])
      setRepScore((repScores as ReputationScore[])[0] ?? null)

    } catch (err) {
      console.error('Erro ao carregar dashboard do portal:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (tenantId) load()
    const handler = () => load(true)
    window.addEventListener('refresh_data', handler)

    // Realtime via WebSocket
    const reviewChannel = supabase
      .channel('portal:dashboard:reviews')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'reviews' }, () => {
        console.log('[Realtime] reviews atualizado')
        load(true) // Silent
      })
      .subscribe((status) => console.log('[Realtime] portal reviews:', status))

    const alertChannel = supabase
      .channel('portal:dashboard:alerts')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'alert_events' }, () => {
        console.log('[Realtime] alertas atualizado')
        load(true) // Silent
      })
      .subscribe((status) => console.log('[Realtime] portal alerts:', status))

    const competitorChannel = supabase
      .channel('portal:dashboard:competitors')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'competitor_businesses' }, () => {
        console.log('[Realtime] competitor_businesses atualizado')
        load(true) // Silent
      })
      .subscribe((status) => console.log('[Realtime] portal competitors:', status))

    return () => {
      window.removeEventListener('refresh_data', handler)
      supabase.removeChannel(reviewChannel)
      supabase.removeChannel(alertChannel)
      supabase.removeChannel(competitorChannel)
    }

  }, [tenantId])

  if (loading) return (
    <div>
      <div className="page-header"><div className="skeleton" style={{ width: 220, height: 32, marginBottom: 8 }} /><div className="skeleton" style={{ width: 340, height: 18 }} /></div>
      <div className="kpi-grid">{Array(4).fill(0).map((_, i) => <div key={i} className="card kpi-card"><div className="skeleton" style={{ height: 80 }} /></div>)}</div>
    </div>
  )

  const negColor = kpi && kpi.negative_rate >= 30 ? '#ef4444' : kpi && kpi.negative_rate >= 15 ? '#f59e0b' : '#10b981'

  return (
    <div>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1 className="page-title">Visão Geral</h1>
          <p className="page-subtitle">Últimos 30 dias de monitoramento de reputação</p>
        </div>
        <button className="btn btn-primary no-print" onClick={() => window.print()}>
          <FileText size={16} /> Exportar PDF (Relatório)
        </button>
      </div>

      {/* Mensagem de Boas-vindas para novos usuários */}
      {kpi?.total_all === 0 && (
        <div className="card" style={{ 
          padding: '24px 32px', 
          marginBottom: 24, 
          background: 'linear-gradient(135deg, rgba(99,102,241,0.1), rgba(6,182,212,0.1))',
          border: '1px solid rgba(99,102,241,0.3)',
          borderRadius: 16,
          display: 'flex',
          alignItems: 'center',
          gap: 24,
        }}>
          <div style={{ 
            fontSize: 48, 
            background: 'rgba(255,255,255,0.1)', 
            width: 80, height: 80, 
            borderRadius: '50%', 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'center',
            boxShadow: '0 8px 32px rgba(0,0,0,0.2)'
          }}>
            🚀
          </div>
          <div style={{ flex: 1 }}>
            <h2 style={{ fontFamily: 'Outfit', fontSize: 22, fontWeight: 700, marginBottom: 8, color: 'var(--text-primary)' }}>
              Seja bem-vindo ao Reputei!
            </h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: 15, lineHeight: 1.6, maxWidth: 600 }}>
              Estamos configurando seus canais de monitoramento. Nos próximos minutos, nossa inteligência artificial começará a coletar e analisar os reviews do seu negócio.
              <br />
              <strong>Fique tranquilo, logo mais seus dados aparecerão aqui automaticamente.</strong>
            </p>
          </div>
          <div className="no-print" style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 11, color: 'var(--accent)', fontWeight: 700, textTransform: 'uppercase', marginBottom: 4 }}>Status do Sistema</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#10b981', fontSize: 13, fontWeight: 600 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#10b981' }} />
              Configurando Conectores
            </div>
          </div>
        </div>
      )}

      {/* KPIs */}
      <div className="kpi-grid">
        <div className="card kpi-card" style={{ '--kpi-color': '#6366f1', '--kpi-icon-bg': 'rgba(99,102,241,0.15)' } as React.CSSProperties}>
          <div className="kpi-label">Reviews nos últimos 30 dias</div>
          <div className="kpi-value">{kpi?.total ?? 0}</div>
          <div className="kpi-sub">
            {kpi?.total_all === 0 ? (
              <span style={{ color: '#6366f1', fontWeight: 600 }}>✨ Coletando seus primeiros dados...</span>
            ) : (
              <><MessageSquare size={12} /> {kpi?.total_all ?? 0} coletados no histórico</>
            )}
          </div>
          <div className="kpi-icon"><MessageSquare size={18} color="#a5b4fc" /></div>
        </div>

        <div className="card kpi-card" style={{ '--kpi-color': negColor, '--kpi-icon-bg': `${negColor}22` } as React.CSSProperties}>
          <div className="kpi-label">Taxa Negativa</div>
          <div className="kpi-value" style={{ color: negColor }}>{kpi?.negative_rate ?? 0}%</div>
          <div className="kpi-sub">
            <TrendingDown size={12} /> {(kpi?.critical_count ?? 0) > 0 ? `${kpi?.critical_count} críticos` : 'negativos + críticos'}
          </div>
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

      {/* Reputation Score — F12-E8-T4 */}
      {repScore && (
        <div className="card" style={{ padding: 20, marginBottom: 24 }}>
          <div className="section-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Award size={18} color="#f59e0b" />
            Reputation Score
            <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-muted)', fontWeight: 400 }}>
              Calculado em {new Date(repScore.calculated_at).toLocaleDateString('pt-BR')}
            </span>
          </div>

          {/* Score principal */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 32, marginBottom: 20, marginTop: 8 }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{
                fontSize: 56, fontWeight: 800, lineHeight: 1,
                color: repScore.score >= 700 ? '#10b981' : repScore.score >= 400 ? '#f59e0b' : '#ef4444',
                fontFamily: 'Outfit, sans-serif',
              }}>
                {repScore.score}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>de 1000</div>
              <div style={{ fontSize: 11, fontWeight: 600, marginTop: 6, color: repScore.score >= 700 ? '#10b981' : repScore.score >= 400 ? '#f59e0b' : '#ef4444' }}>
                {repScore.score >= 700 ? '🌟 Excelente' : repScore.score >= 400 ? '📈 Regular' : '⚠️ Precisa melhorar'}
              </div>
            </div>

            {/* Barra de componentes */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 7 }}>
              {[
                { label: 'Nota média (30%)',       val: repScore.component_rating,    color: '#6366f1' },
                { label: 'Sentimento positivo (20%)', val: repScore.component_sentiment, color: '#10b981' },
                { label: 'Volume de reviews (10%)',val: repScore.component_volume,    color: '#06b6d4' },
                { label: 'Taxa de resposta (10%)', val: repScore.component_response,  color: '#8b5cf6' },
                { label: 'Reclame Aqui (10%)',     val: repScore.component_reclame,   color: '#f59e0b' },
                { label: 'Consumidor.gov (10%)',   val: repScore.component_consumidor,color: '#ec4899' },
                { label: 'Tendência 90d (10%)',    val: repScore.component_trend,     color: '#14b8a6' },
              ].map(c => (
                <div key={c.label}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 3 }}>
                    <span style={{ color: 'var(--text-secondary)' }}>{c.label}</span>
                    <span style={{ fontWeight: 600, color: c.color }}>{Math.round(Number(c.val))}pts</span>
                  </div>
                  <div className="score-bar-bg">
                    <div className="score-bar-fill" style={{ width: `${Math.round(Number(c.val))}%`, background: c.color }} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div style={{ fontSize: 11, color: 'var(--text-muted)', borderTop: '1px solid var(--border)', paddingTop: 10 }}>
            Baseado em {repScore.reviews_analyzed} reviews · Fórmula: nota (30%) + sentimento (20%) + volume (10%) + resposta (10%) + Reclame Aqui (10%) + Consumidor.gov (10%) + tendência (10%)
          </div>
        </div>
      )}

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
          <div style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid var(--border)', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>🟢 <strong>Positivo:</strong> 0 a 30</div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>🟡 <strong>Neutro:</strong> 31 a 55</div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>🟠 <strong>Negativo:</strong> 56 a 80</div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>🔴 <strong>Crítico:</strong> 81 a 100</div>
          </div>
        </div>
      </div>

      <div className="grid-2">
        {/* Reviews recentes */}
        <div className="card" style={{ padding: 20 }}>
          <div className="section-title">💬 Reviews Recentes</div>
          {recent.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon">🛰️</div>
              <div className="empty-state-text">
                {kpi?.total_all === 0 
                  ? 'Seja bem-vindo! Estamos preparando seus conectores para buscar os primeiros reviews.' 
                  : 'Nenhum review recente encontrado.'}
              </div>
            </div>
          ) : (
            <div className="review-list">
              {recent.map(r => (
                <div key={r.id} className="card review-item">
                  <div className="review-header">
                    <span className={`badge badge-${r.sentiment}`}>{scoreToEmoji(r.dissatisfaction_score, r.sentiment)} {SENTIMENT_LABELS[r.sentiment]}</span>
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
                  {r.sentiment_suggestion && (
                    <div style={{ fontSize: 11, color: '#10b981', marginTop: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                      💡 <span style={{ opacity: 0.9 }}>{r.sentiment_suggestion}</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="grid-2">
        {/* Benchmarking */}
        <div className="card" style={{ padding: 20 }}>
          <div className="section-title">📊 Benchmarking (Nota Média)</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {/* Empresa do Usuário */}
            <div style={{ background: 'rgba(99,102,241,0.06)', padding: '12px 16px', borderRadius: 10, border: '1px solid rgba(99,102,241,0.2)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{ fontSize: 13, fontWeight: 700 }}>Você (Sua Empresa)</span>
                <span style={{ color: '#f59e0b', fontWeight: 700 }}>{kpi?.avg_rating.toFixed(1)}</span>
              </div>
              <div className="score-bar-bg"><div className="score-bar-fill" style={{ width: `${(kpi?.avg_rating ?? 0) * 20}%`, background: '#f59e0b' }} /></div>
            </div>

            {/* Concorrentes */}
            {competitors.length === 0 ? (
              <div className="empty-state" style={{ padding: '20px 0' }}>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Nenhum concorrente cadastrado.</div>
              </div>
            ) : (
              competitors.map(c => {
                const rating = c.last_stats?.rating || 0
                return (
                  <div key={c.id} style={{ padding: '8px 16px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                      <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{c.name}</span>
                      <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>{rating.toFixed(1)}</span>
                    </div>
                    <div className="score-bar-bg"><div className="score-bar-fill" style={{ width: `${rating * 20}%`, background: 'var(--text-muted)', opacity: 0.5 }} /></div>
                  </div>
                )
              })
            )}
          </div>
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
