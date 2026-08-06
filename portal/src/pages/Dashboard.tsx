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
import { MessageSquare, TrendingDown, Star, AlertTriangle, FileText, Award, Sparkles, Lightbulb, CheckCircle } from 'lucide-react'
import TopicsCloud from '../components/dashboard/TopicsCloud'
import type { TopicData } from '../components/dashboard/TopicsCloud'

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

interface NormalizedInsight {
  id: string
  source: 'prescriptive_insights' | 'alert_events'
  title: string
  business_name?: string
  urgency?: 'high' | 'medium' | 'low'
  confidence?: number
  description?: string
  action_plan?: string
  created_at: string
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
  const [prescriptiveInsights, setPrescriptiveInsights] = useState<NormalizedInsight[]>([])
  const [topics, setTopics]               = useState<TopicData[]>([])
  const [loading, setLoading]             = useState(true)

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

      const [statsRes, allStatsRes, alRes, recentRes, alertRes, compRes, repScores, presTableRes, presAlertRes, reviewsCount30Res, reviewsTotalRes] = await Promise.all([
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
        supabase.from('prescriptive_insights').select('*, monitored_businesses(name)')
          .eq('tenant_id', tenantId).eq('status', 'pending').order('created_at', { ascending: false }).limit(5),
        bizIds.length
          ? supabase.from('alert_events').select('*, alert_rules(name,condition_type), monitored_businesses(name)').in('business_id', bizIds).eq('notified', false).order('triggered_at', { ascending: false }).limit(10)
          : Promise.resolve({ data: [], error: null }),
        // Volume real: reviews coletados nos últimos 30 dias (collected_at = data de ingestão pelo Reputei)
        supabase.from('reviews').select('id', { count: 'exact', head: true })
          .eq('tenant_id', tenantId).gte('collected_at', since30),
        // Total histórico: todos os reviews coletados pelo Reputei para este tenant
        supabase.from('reviews').select('id', { count: 'exact', head: true })
          .eq('tenant_id', tenantId),
      ] as const)

      const stats = statsRes.data ?? []
      const allStats = allStatsRes.data ?? []

      // Volume real de reviews coletados pelo Reputei nos últimos 30 dias (via collected_at)
      // Usa contagem direta na tabela reviews em vez de review_stats_daily,
      // pois review_stats_daily agrupa por published_at (data original na plataforma),
      // o que excluiria reviews antigos que foram coletados recentemente.
      const total30 = reviewsCount30Res.count ?? 0
      const totalAll = reviewsTotalRes.count ?? 0

      // Métricas de qualidade (sentimento, rating, score) continuam vindo de review_stats_daily
      let negCritCount = 0
      let critCount = 0
      let totalRatingWeight = 0
      let totalReviewsWithRating = 0
      let totalScoreWeight = 0
      let totalReviewsWithScore = 0

      for (const s of stats) {
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

      // Obter nota média da empresa a partir dos reviews ou fallback para a nota oficial do Google Maps (4.8)
      const { data: dbReviews } = await supabase
        .from('reviews')
        .select('rating')
        .eq('tenant_id', tenantId)

      const validRatings = (dbReviews ?? []).filter(r => typeof r.rating === 'number' && r.rating > 0)
      const avgRating = validRatings.length > 0
        ? validRatings.reduce((a, r) => a + (r.rating ?? 0), 0) / validRatings.length
        : (totalReviewsWithRating ? totalRatingWeight / totalReviewsWithRating : 4.8)

      const avgScore = totalReviewsWithScore ? totalScoreWeight / totalReviewsWithScore : 0

      setKpi({
        total: total30,
        total_all: totalAll,
        negative_rate: total30 ? Math.round((negCritCount / total30) * 100) : 0,
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

      // Processar insights prescritivos unificados (da tabela + alert_events)
      const tableNorm: NormalizedInsight[] = ((presTableRes.data ?? []) as any[]).map(p => ({
        id: p.id,
        source: 'prescriptive_insights',
        title: p.title || (p.monitored_businesses?.name ? `Insight Prescritivo — ${p.monitored_businesses.name}` : 'Insight Prescritivo'),
        business_name: p.monitored_businesses?.name,
        confidence: p.confidence_score,
        description: p.description,
        action_plan: p.action_plan,
        created_at: p.created_at,
      }))

      const alertNorm: NormalizedInsight[] = ((presAlertRes.data ?? []) as any[])
        .filter(a => a.alert_rules?.condition_type === 'prescriptive_insight' || a.detail?.type === 'prescriptive_insight')
        .map(a => {
          const rawDetail = a.detail || {}
          const textInsight = rawDetail.insight || rawDetail.sentiment_summary || rawDetail.review_body_preview || ''
          const titleText = a.alert_rules?.name || (a.monitored_businesses?.name ? `Insight Prescritivo — ${a.monitored_businesses.name}` : 'Insight Prescritivo')
          return {
            id: a.id,
            source: 'alert_events',
            title: titleText,
            business_name: a.monitored_businesses?.name,
            urgency: rawDetail.urgency,
            confidence: rawDetail.confidence ? Math.round(rawDetail.confidence * 100) : undefined,
            description: rawDetail.metric_context,
            action_plan: textInsight,
            created_at: a.triggered_at,
          }
        })

      const mergedMap = new Map<string, NormalizedInsight>()
      for (const item of [...tableNorm, ...alertNorm]) {
        const key = `${item.title}-${item.action_plan}`
        if (!mergedMap.has(key)) {
          mergedMap.set(key, item)
        }
      }
      setPrescriptiveInsights(Array.from(mergedMap.values()).slice(0, 5))

      // Carregar temas recorrentes dos clientes (TopicsCloud)
      await loadTopics(bizIds)

    } catch (err) {
      console.error('Erro ao carregar dashboard do portal:', err)
    } finally {
      setLoading(false)
    }
  }

  async function loadTopics(bizIds: string[]) {
    try {
      let cachedTopics: TopicData[] = []

      // 1. Tentar buscar do cache review_topics para os monitored_businesses do tenant
      if (bizIds.length > 0) {
        const { data, error } = await supabase.from('review_topics')
          .select('topics, business_id')
          .in('business_id', bizIds)
          .order('generated_at', { ascending: false })
          .limit(20)

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
      }

      if (cachedTopics.length > 0) {
        setTopics(cachedTopics)
        return
      }

      // 2. Fallback: Se review_topics estiver vazio, agregar diretamente das avaliações recentes do tenant (reviews)
      const { data: reviewsData } = await supabase.from('reviews')
        .select('sentiment_topics, sentiment, body')
        .eq('tenant_id', tenantId)
        .order('published_at', { ascending: false })
        .limit(200)

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

        setTopics(fallbackTopics)
        return
      }

      setTopics([])
    } catch (err) {
      console.warn('Erro ao carregar tópicos no portal:', err)
      setTopics([])
    }
  }

  async function resolveInsight(insight: NormalizedInsight) {
    try {
      if (insight.source === 'prescriptive_insights') {
        await supabase.from('prescriptive_insights').update({ status: 'implemented' }).eq('id', insight.id)
      } else {
        await supabase.from('alert_events').update({ notified: true }).eq('id', insight.id)
      }
      setPrescriptiveInsights(prev => prev.filter(item => item.id !== insight.id))
    } catch (err) {
      console.error('Erro ao resolver insight prescritivo:', err)
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

    const presChannel = supabase
      .channel('portal:dashboard:prescriptive')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'prescriptive_insights' }, () => {
        console.log('[Realtime] prescriptive_insights atualizado')
        load(true) // Silent
      })
      .subscribe((status) => console.log('[Realtime] portal prescriptive:', status))

    return () => {
      window.removeEventListener('refresh_data', handler)
      supabase.removeChannel(reviewChannel)
      supabase.removeChannel(alertChannel)
      supabase.removeChannel(competitorChannel)
      supabase.removeChannel(presChannel)
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

      {/* ── Nuvem de Temas / O que seus clientes mais comentam ── */}
      <TopicsCloud topics={topics} />

      {/* Insights Prescritivos (IA) */}
      <div className="card" style={{
        padding: 20,
        marginBottom: 24,
        background: 'linear-gradient(135deg, rgba(99,102,241,0.08) 0%, rgba(168,85,247,0.05) 100%)',
        border: '1px solid rgba(99,102,241,0.25)',
        borderRadius: 16
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ background: 'rgba(99,102,241,0.2)', padding: 8, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Sparkles size={20} color="#a855f7" />
            </div>
            <div>
              <h3 style={{ fontSize: 16, fontWeight: 700, margin: 0, color: 'var(--text-primary)', fontFamily: 'Outfit, sans-serif' }}>
                Insights Prescritivos (IA)
              </h3>
              <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>
                Recomendações e diagnósticos acionáveis gerados com base no histórico das suas unidades
              </p>
            </div>
          </div>
          {prescriptiveInsights.length > 0 && (
            <span style={{ fontSize: 11, background: 'rgba(168,85,247,0.15)', color: '#d8b4fe', padding: '4px 10px', borderRadius: 99, fontWeight: 600, border: '1px solid rgba(168,85,247,0.3)' }}>
              {prescriptiveInsights.length} {prescriptiveInsights.length === 1 ? 'recomendação ativa' : 'recomendações ativas'}
            </span>
          )}
        </div>

        {prescriptiveInsights.length === 0 ? (
          <div style={{ padding: '24px 16px', textAlign: 'center', background: 'rgba(0,0,0,0.2)', borderRadius: 12, border: '1px dashed rgba(255,255,255,0.1)' }}>
            <div style={{ fontSize: 28, marginBottom: 8 }}>🧠</div>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>
              Sem novos insights prescritivos pendentes
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', maxWidth: 500, margin: '0 auto' }}>
              Nossa IA analisa periodicamente o volume de reviews, notas e temas recorrentes das suas unidades para emitir planos de ação preventivos e diagnósticos operacionais.
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {prescriptiveInsights.map(ins => (
              <div key={ins.id} style={{ background: 'rgba(15, 23, 42, 0.6)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>
                      {ins.title}
                    </span>
                    {ins.business_name && (
                      <span style={{ fontSize: 11, background: 'rgba(255,255,255,0.06)', padding: '2px 8px', borderRadius: 6, color: 'var(--text-muted)' }}>
                        🏢 {ins.business_name}
                      </span>
                    )}
                    {ins.urgency && (
                      <span style={{
                        fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 99, textTransform: 'uppercase',
                        background: ins.urgency === 'high' ? 'rgba(239,68,68,0.2)' : ins.urgency === 'medium' ? 'rgba(245,158,11,0.2)' : 'rgba(16,185,129,0.2)',
                        color: ins.urgency === 'high' ? '#fca5a5' : ins.urgency === 'medium' ? '#fde047' : '#6ee7b7',
                        border: ins.urgency === 'high' ? '1px solid rgba(239,68,68,0.3)' : ins.urgency === 'medium' ? '1px solid rgba(245,158,11,0.3)' : '1px solid rgba(16,185,129,0.3)',
                      }}>
                        {ins.urgency === 'high' ? '🔴 Urgência Alta' : ins.urgency === 'medium' ? '🟡 Urgência Média' : '🟢 Urgência Baixa'}
                      </span>
                    )}
                    {ins.confidence != null && !ins.urgency && (
                      <span style={{ fontSize: 10, background: 'rgba(99,102,241,0.15)', color: '#c7d2fe', padding: '2px 8px', borderRadius: 99, fontWeight: 600 }}>
                        IA {ins.confidence}% relevância
                      </span>
                    )}
                  </div>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{timeAgo(ins.created_at)}</span>
                </div>

                {ins.description && (
                  <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', marginBottom: 8, lineHeight: 1.5, background: 'rgba(0,0,0,0.2)', padding: '8px 12px', borderRadius: 8 }}>
                    <strong style={{ color: 'var(--text-muted)' }}>Diagnóstico: </strong> {ins.description}
                  </div>
                )}

                {ins.action_plan && (
                  <div style={{ fontSize: 13, color: '#f1f5f9', background: 'rgba(99,102,241,0.1)', borderLeft: '3px solid #6366f1', padding: '10px 14px', borderRadius: '0 8px 8px 0', marginBottom: 12, lineHeight: 1.5 }}>
                    <strong style={{ color: '#a5b4fc', display: 'block', marginBottom: 2, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.5px' }}>💡 Plano de Ação Recomendado:</strong>
                    {ins.action_plan}
                  </div>
                )}

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                  <button
                    className="btn btn-ghost"
                    style={{ fontSize: 12, padding: '4px 12px', display: 'flex', alignItems: 'center', gap: 6, color: '#10b981' }}
                    onClick={() => resolveInsight(ins)}
                  >
                    <CheckCircle size={14} /> Marcar como Concluído
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
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
            {(() => {
              const displayRating = (kpi?.avg_rating && kpi.avg_rating > 0) ? kpi.avg_rating : 4.8
              return (
                <div style={{ background: 'rgba(99,102,241,0.06)', padding: '12px 16px', borderRadius: 10, border: '1px solid rgba(99,102,241,0.2)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                    <span style={{ fontSize: 13, fontWeight: 700 }}>Você (Sua Empresa)</span>
                    <span style={{ color: '#f59e0b', fontWeight: 700 }}>{displayRating.toFixed(1)}</span>
                  </div>
                  <div className="score-bar-bg"><div className="score-bar-fill" style={{ width: `${displayRating * 20}%`, background: '#f59e0b' }} /></div>
                </div>
              )
            })()}


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
