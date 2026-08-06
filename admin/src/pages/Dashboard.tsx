import { useEffect, useState, useRef, useMemo } from 'react'
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
import { TrendingUp, MessageSquare, AlertTriangle, Activity, RefreshCw } from 'lucide-react'
import type { TenantOption } from '../App'

// Novos Componentes e Serviços (Fase 1)
import ReputationScore from '../components/dashboard/ReputationScore'
import ReputationTimeline from '../components/dashboard/ReputationTimeline'
import TopicsCloud from '../components/dashboard/TopicsCloud'
import { getReputationData } from '../services/reputation'
import type { ReputationScoreData, TimelinePoint } from '../services/reputation'
import type { TopicData } from '../components/dashboard/TopicsCloud'

interface Props {
  tenants: TenantOption[]
  selectedTenantId: string
  onTenantChange: (id: string) => void
}

// Helper para só atualizar o estado se o valor bruto realmente mudou
function setIfChanged<T>(setter: React.Dispatch<React.SetStateAction<T>>, nextVal: T) {
  setter((prevVal: T) => {
    if (JSON.stringify(prevVal) === JSON.stringify(nextVal)) {
      return prevVal
    }
    return nextVal
  })
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

interface TopVolumeTenant {
  id: string
  name: string
  count: number
  topChannel: string | null
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
  const [sentimentDist, setSentimentDist] = useState<any[]>([])
  const [rankingData, setRankingData] = useState<any[]>([])
  const [topVolumeTenants, setTopVolumeTenants] = useState<TopVolumeTenant[]>([])
  
  // Estados da Fase 1
  const [reputation, setReputation] = useState<ReputationScoreData | null>(null)
  const [timeline, setTimeline] = useState<TimelinePoint[]>([])
  const [topics, setTopics] = useState<TopicData[]>([])
  const [business, setBusiness] = useState<any | null>(null)
  const [systemNotifications, setSystemNotifications] = useState<any[]>([])

  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const isInitialMount = useRef(true)

  // Memoizações para evitar que o Recharts reinicie animações ou renderize desnecessariamente
  const memoizedTrendData = useMemo(() => trendData, [trendData])
  const memoizedSentimentDist = useMemo(() => sentimentDist, [sentimentDist])
  const memoizedChannelData = useMemo(() => channelData, [channelData])
  const memoizedTimeline = useMemo(() => timeline, [timeline])

  useEffect(() => {
    const isFirst = isInitialMount.current
    if (isFirst) {
      isInitialMount.current = false
      loadAll(false)
    } else {
      // Troca de tenant ou atualização subsequente: atualiza suavemente em segundo plano
      loadAll(true)
    }

    const handleRefresh = () => loadAll(true)
    window.addEventListener('refresh_data', handleRefresh)

    // Atualiza silenciosamente quando o usuário volta à aba
    const handleVisibility = () => { if (document.visibilityState === 'visible') loadAll(true) }
    document.addEventListener('visibilitychange', handleVisibility)

    // Realtime — escutadores granulares por tabela
    const channelId = `admin-dash-${Math.random().toString(36).substring(7)}`
    const dashChannel = supabase
      .channel(channelId)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'reviews' }, (payload: any) => {
        const r = payload.new as Review
        if (selectedTenantId && r?.tenant_id && r.tenant_id !== selectedTenantId) return
        loadKPIs()
        loadRecentReviews()
        loadTrend()
        loadChannelData()
        loadRanking()
        loadTopVolumeTenants()
        loadReputation()
        loadTopics()
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'alert_events' }, (payload: any) => {
        const a = payload.new as any
        if (selectedTenantId && a?.tenant_id && a.tenant_id !== selectedTenantId) return
        loadAlerts()
        loadKPIs()
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'channel_connectors' }, () => {
        loadKPIs()
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'system_notifications' }, () => {
        loadSystemNotifications()
      })
      .subscribe()

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility)
      window.removeEventListener('refresh_data', handleRefresh)
      supabase.removeChannel(dashChannel)
    }
  }, [selectedTenantId, tenants])

  async function loadAll(silent = false) {
    // Só exibe skeleton completo se ainda não houver nenhum dado carregado
    if (!silent && kpis === null) setLoading(true)
    else setRefreshing(true)

    try {
      await Promise.all([
        loadKPIs(),
        loadRecentReviews(),
        loadAlerts(),
        loadTrend(),
        loadChannelData(),
        loadRanking(),
        loadReputation(),
        loadTopics(),
        loadBusinessInfo(),
        loadSystemNotifications(),
        loadTopVolumeTenants(),
      ])
    } catch (err) {
      console.error('Erro ao carregar dados do dashboard:', err)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  async function loadKPIs() {
    const since30 = new Date(Date.now() - 30 * 86400_000).toISOString()

    try {
      // 1. Buscar agregados diários (30 dias)
      let qStats = supabase.from('review_stats_daily')
        .select('total_reviews, positive_count, neutral_count, negative_count, critical_count, unanalyzed_count, avg_dissatisfaction_score')
        .gte('date', since30.split('T')[0])
      if (selectedTenantId) qStats = qStats.eq('tenant_id', selectedTenantId)
      const { data: stats } = await qStats

      let totalCount = 0
      let negCritCount = 0
      let critCount = 0
      let totalScoreWeight = 0
      let totalReviewsWithScore = 0

      for (const s of stats || []) {
        totalCount += s.total_reviews ?? 0
        negCritCount += (s.negative_count ?? 0) + (s.critical_count ?? 0)
        critCount += s.critical_count ?? 0
        if (s.avg_dissatisfaction_score != null && s.total_reviews > 0) {
          totalScoreWeight += Number(s.avg_dissatisfaction_score) * s.total_reviews
          totalReviewsWithScore += s.total_reviews
        }
      }

      const avg = totalReviewsWithScore ? Math.round(totalScoreWeight / totalReviewsWithScore) : 0

      // 5. Conectores Ativos e Alertas Pendentes
      let activeConnectors = 0
      let pendingAlerts = 0

      if (selectedTenantId) {
        const { data: bizIds } = await supabase.from('monitored_businesses').select('id').eq('tenant_id', selectedTenantId)
        const ids = (bizIds || []).map(b => b.id)

        if (ids.length > 0) {
          const { count: cCount } = await supabase.from('channel_connectors').select('id', { count: 'exact', head: true }).eq('status', 'active').in('business_id', ids)
          const { count: aCount } = await supabase.from('alert_events').select('id', { count: 'exact', head: true }).is('resolved_at', null).in('business_id', ids)
          activeConnectors = cCount ?? 0
          pendingAlerts = aCount ?? 0
        }
      } else {
        const { count: cCount } = await supabase.from('channel_connectors').select('id', { count: 'exact', head: true }).eq('status', 'active')
        const { count: aCount } = await supabase.from('alert_events').select('id', { count: 'exact', head: true }).is('resolved_at', null)
        activeConnectors = cCount ?? 0
        pendingAlerts = aCount ?? 0
      }

      setIfChanged<KPIData | null>(setKpis, {
        totalReviews: totalCount,
        negativeRate: totalCount ? Math.round((negCritCount / totalCount) * 100) : 0,
        criticalCount: critCount,
        activeConnectors,
        pendingAlerts,
        avgScore: avg,
      })

      // 7. Distribuição de sentimento (30 dias)
      const dist = { positive: 0, neutral: 0, negative: 0, critical: 0, unanalyzed: 0 }
      for (const s of stats || []) {
        dist.positive += s.positive_count ?? 0
        dist.neutral += s.neutral_count ?? 0
        dist.negative += s.negative_count ?? 0
        dist.critical += s.critical_count ?? 0
        dist.unanalyzed += s.unanalyzed_count ?? 0
      }

      const newSentimentDist = Object.entries(dist)
        .filter(([, v]) => v > 0)
        .map(([name, value]) => ({
          name: SENTIMENT_LABELS[name as keyof typeof SENTIMENT_LABELS] || name,
          value,
          color: SENTIMENT_COLORS[name as keyof typeof SENTIMENT_COLORS] || '#6b7280',
        }))

      setIfChanged(setSentimentDist, newSentimentDist)
    } catch (err) {
      console.error('Erro ao carregar KPIs:', err)
    }
  }

  async function loadRecentReviews() {
    let q = supabase.from('reviews')
      .select('*, monitored_businesses(name)')
      .order('published_at', { ascending: false })
      .limit(5)
    if (selectedTenantId) q = q.eq('tenant_id', selectedTenantId)
    const { data } = await q

    setIfChanged(setRecentReviews, data ?? [])
  }

  async function loadAlerts() {
    let q = supabase.from('alert_events').select('*, alert_rules(name, condition_type)')
      .is('resolved_at', null).order('created_at', { ascending: false }).limit(5)
    if (selectedTenantId) q = q.eq('tenant_id', selectedTenantId)
    const { data } = await q
    setIfChanged(setRecentAlerts, data ?? [])
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

    let q = supabase.from('review_stats_daily')
      .select('date, positive_count, neutral_count, negative_count, critical_count')
      .gte('date', days[0].day)
    if (selectedTenantId) q = q.eq('tenant_id', selectedTenantId)
    const { data } = await q

    for (const r of data ?? []) {
      const bucket = days.find(d => d.day === r.date)
      if (!bucket) continue
      bucket.positivo += r.positive_count ?? 0
      bucket.neutro += r.neutral_count ?? 0
      bucket.negativo += r.negative_count ?? 0
      bucket.crítico += r.critical_count ?? 0
    }

    setIfChanged(setTrendData, days)
  }

  async function loadChannelData() {
    let q = supabase.from('review_stats_daily')
      .select('channel, total_reviews')
    if (selectedTenantId) q = q.eq('tenant_id', selectedTenantId)
    const { data } = await q

    const counts: Record<string, number> = {}
    for (const r of data ?? []) {
      counts[r.channel] = (counts[r.channel] || 0) + (r.total_reviews ?? 0)
    }

    const newChannelData = Object.entries(counts).map(([channel, count]) => ({
      channel: CHANNEL_LABELS[channel as keyof typeof CHANNEL_LABELS] || channel,
      icon: CHANNEL_ICONS[channel as keyof typeof CHANNEL_ICONS] || '📱',
      count,
    })).sort((a, b) => b.count - a.count)

    setIfChanged(setChannelData, newChannelData)
  }
  
  async function loadRanking() {
    const since30 = new Date(Date.now() - 30 * 86400_000).toISOString().split('T')[0]

    let { data: reviews } = await supabase
      .from('reviews')
      .select('tenant_id, sentiment, dissatisfaction_score')
      .gte('published_at', since30)
      .in('sentiment', ['negative', 'critical'])

    const tenantsIn30 = new Set(reviews?.map(r => r.tenant_id).filter(Boolean))

    if (!reviews || tenantsIn30.size < 5) {
      const { data: allReviews } = await supabase
        .from('reviews')
        .select('tenant_id, sentiment, dissatisfaction_score')
        .in('sentiment', ['negative', 'critical'])

      reviews = allReviews ?? []
    }

    if (!reviews || reviews.length === 0) {
      setIfChanged<any[]>(setRankingData, [])
      return
    }

    let tenantList = tenants
    if (!tenantList || tenantList.length === 0) {
      const { data: tData } = await supabase.from('tenants').select('id, name').order('name')
      if (tData) tenantList = (tData ?? []).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' }))
    }

    const groups: Record<string, { totalScore: number; negCount: number }> = {}
    for (const r of reviews) {
      if (!r.tenant_id) continue
      if (!groups[r.tenant_id]) groups[r.tenant_id] = { totalScore: 0, negCount: 0 }
      groups[r.tenant_id].totalScore += Number(r.dissatisfaction_score ?? (r.sentiment === 'critical' ? 85 : 65))
      groups[r.tenant_id].negCount++
    }

    const ranking = Object.entries(groups).map(([tid, g]) => ({
      id: tid,
      name: tenantList.find(t => t.id === tid)?.name || 'Desconhecido',
      avgScore: Math.round(g.totalScore / g.negCount),
      count: g.negCount,
    }))

    setIfChanged(setRankingData, ranking.sort((a, b) => b.avgScore - a.avgScore || b.count - a.count).slice(0, 5))
  }

  async function loadTopVolumeTenants() {
    // Usa collected_at (data de ingestão pelo Reputei) em vez de published_at
    // (data original na plataforma). Isso garante que o widget mostre
    // reviews efetivamente monitorados nos últimos 30 dias, independentemente
    // de quando foram publicados originalmente no canal.
    const since30Date = new Date(Date.now() - 30 * 86400_000)

    let qRev = supabase
      .from('reviews')
      .select('tenant_id, channel')
      .gte('collected_at', since30Date.toISOString())

    if (selectedTenantId) {
      qRev = qRev.eq('tenant_id', selectedTenantId)
    }

    const { data: revs, error } = await qRev

    if (error) {
      console.error('[loadTopVolumeTenants] Erro ao consultar reviews:', error.message)
      return
    }

    const tenantMap: Record<string, { total: number; channels: Record<string, number> }> = {}

    for (const r of revs || []) {
      if (!r.tenant_id) continue
      if (!tenantMap[r.tenant_id]) {
        tenantMap[r.tenant_id] = { total: 0, channels: {} }
      }
      tenantMap[r.tenant_id].total += 1
      if (r.channel) {
        tenantMap[r.tenant_id].channels[r.channel] = (tenantMap[r.tenant_id].channels[r.channel] || 0) + 1
      }
    }

    let tenantList = tenants
    if (!tenantList || tenantList.length === 0) {
      const { data: tData } = await supabase.from('tenants').select('id, name')
      if (tData) tenantList = tData
    }

    const result: TopVolumeTenant[] = Object.entries(tenantMap).map(([tid, data]) => {
      let topChannel: string | null = null
      let maxChannelCount = -1
      for (const [ch, chCount] of Object.entries(data.channels)) {
        if (chCount > maxChannelCount) {
          maxChannelCount = chCount
          topChannel = ch
        }
      }

      const tenantObj = tenantList.find(t => t.id === tid)
      return {
        id: tid,
        name: tenantObj ? tenantObj.name : 'Desconhecido',
        count: data.total,
        topChannel,
      }
    })

    result.sort((a, b) => b.count - a.count)
    setIfChanged(setTopVolumeTenants, result.slice(0, 5))
  }

  async function loadReputation() {
    const data = await getReputationData(selectedTenantId)
    setIfChanged<ReputationScoreData | null>(setReputation, data.current)
    setIfChanged<TimelinePoint[]>(setTimeline, data.timeline)
  }

  async function loadTopics() {
    try {
      let cachedTopics: TopicData[] = []

      let q = supabase.from('review_topics')
        .select('topics, business_id')
        .order('generated_at', { ascending: false })
      
      if (selectedTenantId) {
        const { data: biz } = await supabase.from('monitored_businesses')
          .select('id').eq('tenant_id', selectedTenantId)
        const bizIds = (biz || []).map(b => b.id)
        if (bizIds.length > 0) {
          q = q.in('business_id', bizIds)
        }
      }

      const { data, error } = await q.limit(20)
      if (!error && data && data.length > 0) {
        const topicMap: Record<string, { positivo: number; negativo: number }> = {}
        for (const row of data) {
          const rowTopics = row.topics as TopicData[] | undefined
          if (Array.isArray(rowTopics)) {
            for (const item of rowTopics) {
              if (!item.tema) continue
              const key = item.tema.toLowerCase().trim()
              if (!topicMap[key]) topicMap[key] = { positivo: 0, negativo: 0 }
              topicMap[key].positivo += Number(item.positivo || 0)
              topicMap[key].negativo += Number(item.negativo || 0)
            }
          }
        }
        cachedTopics = Object.entries(topicMap).map(([tema, c]) => ({
          tema,
          positivo: c.positivo,
          negativo: c.negativo,
        })).sort((a, b) => (b.positivo + b.negativo) - (a.positivo + a.negativo))
      }

      if (cachedTopics.length > 0) {
        setIfChanged<TopicData[]>(setTopics, cachedTopics)
        return
      }

      let qRev = supabase.from('reviews')
        .select('sentiment_topics, sentiment, body')
        .order('published_at', { ascending: false })
        .limit(200)

      if (selectedTenantId) {
        qRev = qRev.eq('tenant_id', selectedTenantId)
      }

      const { data: reviewsData } = await qRev

      if (reviewsData && reviewsData.length > 0) {
        const topicMap: Record<string, { positivo: number; negativo: number }> = {}
        const KEYWORD_MAP: Record<string, string[]> = {
          atendimento: ['atendimento', 'atendente', 'recepcao', 'recepção', 'vendedor', 'equipe', 'suporte', 'atencioso', 'prestativo', 'educado'],
          limpeza: ['limpeza', 'limpo', 'sujo', 'sujeira', 'higiene', 'higienizado', 'cheiro', 'organizado'],
          preço: ['preço', 'preco', 'valor', 'caro', 'barato', 'cobrança', 'cobranca', 'taxa', 'custo'],
          qualidade: ['qualidade', 'bom', 'otimo', 'ótimo', 'excelente', 'defeito', 'ruim', 'pessimo', 'péssimo'],
          entrega: ['entrega', 'envio', 'prazo', 'atraso', 'atrasou', 'chegou', 'demorou', 'rapidez', 'frete'],
          espera: ['espera', 'fila', 'demora', 'tempo de espera', 'aguardo'],
          ambiente: ['ambiente', 'espaço', 'espaco', 'local', 'estacionamento', 'ar condicionado', 'estrutura'],
          produto: ['produto', 'peça', 'peca', 'veiculo', 'veículo', 'carro', 'serviço', 'servico'],
        }

        for (const r of reviewsData) {
          const isPos = r.sentiment === 'positive'
          const isNeg = r.sentiment === 'negative' || r.sentiment === 'critical'
          let foundTopics = new Set<string>()

          if (Array.isArray(r.sentiment_topics) && r.sentiment_topics.length > 0) {
            for (const t of r.sentiment_topics) {
              if (t && typeof t === 'string' && t !== 'outro') foundTopics.add(t.toLowerCase().trim())
            }
          }

          if (foundTopics.size === 0) {
            const bodyLower = (r.body || '').toLowerCase()
            for (const [topicKey, keywords] of Object.entries(KEYWORD_MAP)) {
              if (keywords.some(kw => bodyLower.includes(kw))) {
                foundTopics.add(topicKey)
              }
            }
          }

          for (const t of foundTopics) {
            if (!topicMap[t]) topicMap[t] = { positivo: 0, negativo: 0 }
            if (isPos) topicMap[t].positivo++
            if (isNeg) topicMap[t].negativo++
            if (!isPos && !isNeg) topicMap[t].positivo++
          }
        }

        const fallbackTopics: TopicData[] = Object.entries(topicMap)
          .map(([tema, c]) => ({
            tema,
            positivo: c.positivo,
            negativo: c.negativo,
          }))
          .sort((a, b) => (b.positivo + b.negativo) - (a.positivo + a.negativo))
          .slice(0, 8)

        setIfChanged<TopicData[]>(setTopics, fallbackTopics)
        return
      }

      setIfChanged<TopicData[]>(setTopics, [])
    } catch (err) {
      console.warn('Erro ao carregar tópicos:', err)
      setIfChanged<TopicData[]>(setTopics, [])
    }
  }

  async function loadBusinessInfo() {
    if (!selectedTenantId) return
    const { data } = await supabase
      .from('monitored_businesses')
      .select('*')
      .eq('tenant_id', selectedTenantId)
      .limit(1)
    
    setIfChanged(setBusiness, data && data.length > 0 ? data[0] : null)
  }

  async function loadSystemNotifications() {
    let q = supabase
      .from('system_notifications')
      .select('*')
      .in('status', ['pendente', 'auto_resolvido'])
      .order('created_at', { ascending: false })
      .limit(10)
    
    if (selectedTenantId) q = q.eq('tenant_id', selectedTenantId)
    const { data } = await q
    setIfChanged(setSystemNotifications, data || [])
  }

  // ── Skeleton (apenas no carregamento inicial se não houver KPIs) ────────────
  if (loading && kpis === null) {
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
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 24, marginBottom: 24 }}>
        {reputation && <ReputationScore data={reputation} />}
        
        <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(2, 1fr)', gap: 16 }}>
          <div className="card kpi-card card-glow" style={{ '--kpi-color': '#6366f1' } as any}>
            <div className="kpi-icon" style={{ '--kpi-icon-bg': 'rgba(99,102,241,0.15)' } as any}>
              <MessageSquare size={18} color="#a5b4fc" />
            </div>
            <div className="kpi-label">Total de Reviews</div>
            <div className="kpi-value">{kpis?.totalReviews.toLocaleString('pt-BR')}</div>
            <div className="kpi-sub"><TrendingUp size={12} /> últimos 30 dias</div>
          </div>

          <div className="card kpi-card" style={{ '--kpi-color': '#ef4444' } as any}>
            <div className="kpi-icon" style={{ '--kpi-icon-bg': 'rgba(239,68,68,0.15)' } as any}>
              <AlertTriangle size={18} color="#f87171" />
            </div>
            <div className="kpi-label">Taxa Negativa</div>
            <div className="kpi-value">{kpis?.negativeRate}%</div>
            <div className="kpi-sub">🚨 {kpis?.criticalCount} críticos</div>
          </div>

          <div className="card kpi-card" style={{ '--kpi-color': '#f59e0b' } as any}>
            <div className="kpi-icon" style={{ '--kpi-icon-bg': 'rgba(245,158,11,0.15)' } as any}>
              <Activity size={18} color="#fbbf24" />
            </div>
            <div className="kpi-label">Score de Insatisfação</div>
            <div className="kpi-value">{kpis?.avgScore}/100</div>
            <div className="kpi-sub">0 feliz · 100 furioso</div>
          </div>

          <div className="card kpi-card" style={{ '--kpi-color': '#06b6d4' } as any}>
            <div className="kpi-icon" style={{ '--kpi-icon-bg': 'rgba(6,182,212,0.15)' } as any}>
              <RefreshCw size={18} color="#22d3ee" className={refreshing ? 'animate-spin' : ''} />
            </div>
            <div className="kpi-label">Alertas Ativos</div>
            <div className="kpi-value">{kpis?.pendingAlerts}</div>
            <div className="kpi-sub">{kpis?.activeConnectors} canais ativos</div>
          </div>
        </div>
      </div>

      {/* ── Ranking + Tópicos ────────────────── */}
      <div className="grid-2" style={{ marginBottom: 24 }}>
        <div className="card" style={{ padding: 20 }}>
          <div className="section-title">🏆 Ranking de Insatisfação (Top 5)</div>
          <p style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 16 }}>Assinantes com maior score médio de insatisfação nos últimos 30 dias</p>
          {rankingData.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon">🏆</div>
              <div className="empty-state-text">Dados insuficientes para o ranking</div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {rankingData.map((item, idx) => (
                <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', background: 'rgba(255,255,255,0.03)', borderRadius: 8, border: '1px solid var(--border)' }}>
                  <div style={{ width: 24, height: 24, borderRadius: '50%', background: idx === 0 ? '#dc2626' : idx === 1 ? '#ef4444' : '#f59e0b', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700 }}>
                    {idx + 1}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{item.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{item.count} reviews negativos</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 18, fontWeight: 800, color: scoreColor(item.avgScore) }}>{item.avgScore}</div>
                    <div style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)' }}>Score Médio</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        <TopicsCloud topics={topics} />
      </div>

      {/* ── Fase 1: Timeline ────────────────────── */}
      <div style={{ marginBottom: 24 }}>
        <ReputationTimeline data={memoizedTimeline} />
      </div>

      {/* ── Gráficos ─────────────────────────────────────────── */}
      <div className="grid-2">
        {/* Trend 7 dias */}
        <div className="card" style={{ padding: 20 }}>
          <div className="section-title">📈 Tendência de Sentimento (7 dias)</div>
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={memoizedTrendData} margin={{ top: 5, right: 0, left: -20, bottom: 0 }}>
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
                <Pie data={memoizedSentimentDist} cx="50%" cy="50%" innerRadius={45} outerRadius={70} dataKey="value" paddingAngle={3}>
                  {memoizedSentimentDist.map((entry, i) => (
                    <Cell key={i} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip content={<CustomTooltip />} />
              </PieChart>
            </ResponsiveContainer>
            <div style={{ flex: 1 }}>
              {memoizedSentimentDist.map(s => (
                <div key={s.name} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <div style={{ width: 10, height: 10, borderRadius: '50%', background: s.color, flexShrink: 0 }} />
                  <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{s.name}</span>
                  <span style={{ marginLeft: 'auto', fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{s.value}</span>
                </div>
              ))}
            </div>
          </div>
          <div style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid var(--border)', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>🟢 <strong>Positivo:</strong> 0 a 30</div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>🟡 <strong>Neutro:</strong> 31 a 55</div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>🟠 <strong>Negativo:</strong> 56 a 80</div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>🔴 <strong>Crítico:</strong> 81 a 100</div>
          </div>
        </div>
      </div>

      {/* Reviews por canal — largura total */}
      <div className="card" style={{ padding: 20, marginBottom: 24 }}>
        <div className="section-title">📊 Distribuição por Canal</div>
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={memoizedChannelData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="channel" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip content={<CustomTooltip />} />
            <Bar dataKey="count" name="Reviews" fill="#6366f1" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Reviews recentes + Alertas */}
      <div className="grid-2">
        {/* Notificações do Sistema (Consumo de API, etc) */}
        {systemNotifications.length > 0 && (
          <div style={{ gridColumn: '1 / -1', marginBottom: 24 }}>
            <div className="section-title">🛡️ Alertas de Infraestrutura e Consumo</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16 }}>
              {systemNotifications.map(n => {
                const isAutocura = n.status === 'auto_resolvido' || n.type === 'transient_error'
                const badgeColor = isAutocura ? '#f59e0b' : '#ef4444'
                const badgeLabel = isAutocura ? 'AUTOCURA' : 'CRÍTICO'
                const glowColor = isAutocura ? 'rgba(245, 158, 11, 0.08)' : 'rgba(239, 68, 68, 0.1)'
                return (
                <div key={n.id} className="card card-glow" style={{ border: `1px solid ${badgeColor}`, padding: 16, '--glow-color': glowColor, opacity: isAutocura ? 0.85 : 1 } as any}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                    <div style={{ background: badgeColor, color: '#fff', borderRadius: 4, padding: '2px 6px', fontSize: 10, fontWeight: 700 }}>{badgeLabel}</div>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{timeAgo(n.created_at)}</span>
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--text-primary)', lineHeight: 1.5 }}>{n.message}</div>
                  <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
                    {isAutocura ? (
                      <span style={{ fontSize: 11, color: '#f59e0b' }}>⚙️ Resolvido automaticamente</span>
                    ) : (
                      <button 
                        onClick={async () => {
                          await supabase.from('system_notifications').update({ status: 'resolvido' }).eq('id', n.id)
                          loadSystemNotifications()
                        }}
                        style={{ fontSize: 11, background: 'var(--border)', color: 'var(--text-primary)', border: 'none', padding: '4px 8px', borderRadius: 4, cursor: 'pointer' }}
                      >
                        Marcar como lido
                      </button>
                    )}
                  </div>
                </div>
              )})}
            </div>
          </div>
        )}

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
                      {scoreToEmoji(r.dissatisfaction_score, r.sentiment)} {SENTIMENT_LABELS[r.sentiment]}
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

        {/* Coluna da direita: Top 5 Volume de Reviews + Alertas */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          {/* Top 5 Assinantes em Volume (últimos 30 dias) */}
          <div className="card" style={{ padding: 20 }}>
            <div className="section-title">📊 Top 5 Assinantes por Volume (30 dias)</div>
            <p style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 16 }}>
              Assinantes com maior volume de avaliações coletadas nos últimos 30 dias
            </p>

            {topVolumeTenants.length === 0 ? (
              <div className="empty-state">
                <div className="empty-state-icon">📈</div>
                <div className="empty-state-text">Nenhum dado de volume nos últimos 30 dias</div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {topVolumeTenants.map((item, idx) => (
                  <div
                    key={item.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '10px 14px',
                      background: 'rgba(255,255,255,0.03)',
                      borderRadius: 8,
                      border: '1px solid var(--border)',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                      <div
                        style={{
                          width: 24,
                          height: 24,
                          borderRadius: '50%',
                          background: idx === 0 ? '#6366f1' : idx === 1 ? '#8b5cf6' : idx === 2 ? '#ec4899' : 'var(--border)',
                          color: '#fff',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: 11,
                          fontWeight: 700,
                          flexShrink: 0,
                        }}
                      >
                        #{idx + 1}
                      </div>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {item.name}
                        </div>
                        {item.topChannel && (
                          <div style={{ fontSize: 11, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 4, marginTop: 2 }}>
                            <span>Canal principal:</span>
                            <span style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>
                              {CHANNEL_ICONS[item.topChannel as keyof typeof CHANNEL_ICONS] || '📱'} {CHANNEL_LABELS[item.topChannel as keyof typeof CHANNEL_LABELS] || item.topChannel}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right', flexShrink: 0, marginLeft: 12 }}>
                      <div style={{ fontSize: 16, fontWeight: 800, color: '#6366f1' }}>
                        {item.count.toLocaleString('pt-BR')}
                      </div>
                      <div style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)' }}>
                        reviews (30d)
                      </div>
                    </div>
                  </div>
                ))}
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
    </div>
  )
}
