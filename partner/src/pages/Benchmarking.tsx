import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { Plus, Trash2, TrendingUp, Star, Users, RefreshCw, CheckCircle2 } from 'lucide-react'

interface CompetitorStats {
  rating: number
  review_count: number
  updated_at: string
  strategy?: string
  recent_reviews?: Array<{
    author?: string
    rating?: number
    text?: string
    published_at?: string
  }>
}

interface Competitor {
  id: string
  name: string
  place_id: string
  created_at: string
  last_stats?: CompetitorStats | null
}

interface Props {
  tenantId: string
}

export default function Benchmarking({ tenantId }: Props) {
  const [competitors, setCompetitors] = useState<Competitor[]>([])
  const [loading, setLoading] = useState(true)
  const [newComp, setNewComp] = useState({ name: '', place_id: '' })
  const [businessId, setBusinessId] = useState('')
  const [myBusiness, setMyBusiness] = useState<{ name: string; rating: number; reviewsCount: number }>({
    name: 'Sua Empresa',
    rating: 0,
    reviewsCount: 0
  })

  useEffect(() => {
    if (tenantId) loadBusiness()
  }, [tenantId])

  useEffect(() => {
    if (!businessId) return
    loadCompetitors(false)
    loadMyStats()

    // Supabase Realtime Subscription para atualizações dinâmicas sem reload
    const channel = supabase
      .channel(`partner:benchmarking:${businessId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'competitor_businesses',
          filter: `business_id=eq.${businessId}`
        },
        () => {
          // Atualização silenciosa em tempo real (sem piscar a tela)
          loadCompetitors(true)
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [businessId])

  async function loadBusiness() {
    const { data } = await supabase
      .from('monitored_businesses')
      .select('id, name')
      .eq('tenant_id', tenantId)
      .limit(1)
      .single()
    
    if (data?.id) {
      setBusinessId(data.id)
      setMyBusiness(prev => ({ ...prev, name: data.name || 'Sua Empresa' }))
    }
  }

  async function loadMyStats() {
    if (!tenantId) return
    const since30 = new Date(Date.now() - 30 * 86400_000).toISOString().split('T')[0]
    const { data: stats } = await supabase
      .from('review_stats_daily')
      .select('avg_rating, total_reviews')
      .eq('tenant_id', tenantId)
      .gte('date', since30)

    const rows = stats ?? []
    const totalReviews = rows.reduce((a, r) => a + (r.total_reviews ?? 0), 0)
    const avgRating = totalReviews > 0
      ? rows.reduce((a, r) => a + (r.avg_rating ?? 0) * (r.total_reviews ?? 0), 0) / totalReviews
      : 0

    setMyBusiness(prev => ({
      ...prev,
      rating: Number(avgRating.toFixed(1)),
      reviewsCount: totalReviews
    }))
  }

  async function loadCompetitors(silent = false) {
    if (!silent) setLoading(true)
    const { data } = await supabase
      .from('competitor_businesses')
      .select('*')
      .eq('business_id', businessId)
      .order('created_at', { ascending: false })
    
    setCompetitors(data || [])
    setLoading(false)
  }

  async function addCompetitor(e: React.FormEvent) {
    e.preventDefault()
    if (!newComp.name || !newComp.place_id || !businessId) return

    const { error } = await supabase
      .from('competitor_businesses')
      .insert({
        business_id: businessId,
        tenant_id: tenantId,
        name: newComp.name,
        place_id: newComp.place_id
      })

    if (error) {
      alert('Erro ao adicionar concorrente: ' + error.message)
    } else {
      setNewComp({ name: '', place_id: '' })
      loadCompetitors(true)
    }
  }

  async function removeCompetitor(id: string) {
    if (!confirm('Deseja remover este concorrente?')) return
    await supabase.from('competitor_businesses').delete().eq('id', id)
    loadCompetitors(true)
  }

  // Ranking completo comparando a empresa com os concorrentes
  const rankingList = [
    { name: myBusiness.name, rating: myBusiness.rating, count: myBusiness.reviewsCount, isMe: true, updatedAt: null },
    ...competitors.map(c => ({
      name: c.name,
      rating: c.last_stats?.rating || 0,
      count: c.last_stats?.review_count || 0,
      isMe: false,
      updatedAt: c.last_stats?.updated_at || null
    }))
  ].sort((a, b) => b.rating - a.rating || b.count - a.count)

  return (
    <div className="page-container">
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1 className="page-title">Benchmarking Local</h1>
          <p className="page-subtitle">Monitore seus principais concorrentes e compare sua performance no Google Maps em tempo real.</p>
        </div>
        <button 
          onClick={() => loadCompetitors(true)} 
          className="btn btn-secondary" 
          title="Atualizar exibição"
          style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'var(--bg-card)', border: '1px solid var(--border)', padding: '8px 14px', borderRadius: 8, cursor: 'pointer', color: 'var(--text-secondary)' }}
        >
          <RefreshCw size={14} /> Atualizar dados
        </button>
      </div>

      <div className="grid-2">
        {/* Formulário de Adicionar Concorrente */}
        <div className="card">
          <div className="section-title"><Plus size={16} /> Adicionar Concorrente</div>
          <form onSubmit={addCompetitor} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div>
              <label className="modal-label" style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>Nome do Concorrente</label>
              <input 
                type="text" 
                className="filter-search" 
                style={{ width: '100%', background: 'var(--bg-darker)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 14px', color: 'var(--text-primary)' }}
                value={newComp.name}
                onChange={e => setNewComp({...newComp, name: e.target.value})}
                placeholder="Ex: Chevrolet Rio Novo Araguaína"
              />
            </div>
            <div>
              <label className="modal-label" style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>Google Place ID</label>
              <div style={{ display: 'flex', gap: 8 }}>
                <input 
                  type="text" 
                  className="filter-search" 
                  style={{ width: '100%', background: 'var(--bg-darker)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 14px', color: 'var(--text-primary)', fontFamily: 'monospace' }}
                  value={newComp.place_id}
                  onChange={e => setNewComp({...newComp, place_id: e.target.value})}
                  placeholder="Ex: ChIJHd1_vOkR2ZIR2owhj9lqpMo"
                />
              </div>
              <p style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 6 }}>
                💡 Encontre o Place ID usando o <a href="https://developers.google.com/maps/documentation/places/web-service/place-id" target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>ID Finder do Google</a>.
              </p>
            </div>
            <button type="submit" className="btn btn-primary" style={{ background: 'var(--accent)', color: 'white', border: 'none', borderRadius: 8, padding: '10px 20px', fontWeight: 600, cursor: 'pointer' }}>
              Salvar Concorrente
            </button>
          </form>
        </div>

        {/* Lista de Concorrentes com Estatísticas em Tempo Real */}
        <div className="card" style={{ padding: 0 }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', fontWeight: 700, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>Concorrentes Monitorados ({competitors.length})</span>
            <span style={{ fontSize: 11, color: '#10b981', display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#10b981' }} /> Sincronização ativa
            </span>
          </div>
          <div className="list">
            {loading && competitors.length === 0 ? (
              <div style={{ padding: 20 }}>Carregando concorrentes...</div>
            ) : competitors.length === 0 ? (
              <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
                Nenhum concorrente cadastrado para sua empresa.
              </div>
            ) : (
              competitors.map(c => {
                const stats = c.last_stats
                const hasStats = stats && (stats.rating > 0 || stats.review_count > 0 || stats.recent_reviews?.length)
                return (
                  <div key={c.id} style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div>
                        <div style={{ fontWeight: 700, color: 'var(--text-primary)', fontSize: 14 }}>{c.name}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'monospace', marginTop: 2 }}>ID: {c.place_id}</div>
                      </div>
                      <button 
                        onClick={() => removeCompetitor(c.id)}
                        className="btn-icon" 
                        title="Remover concorrente"
                        style={{ color: '#ef4444', background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>

                    {/* Métricas do Concorrente */}
                    <div style={{ display: 'flex', gap: 16, marginTop: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'rgba(245,158,11,0.1)', padding: '4px 10px', borderRadius: 6, border: '1px solid rgba(245,158,11,0.2)' }}>
                        <Star size={14} fill="#f59e0b" color="#f59e0b" />
                        <span style={{ fontWeight: 800, color: '#f59e0b', fontSize: 13 }}>
                          {hasStats ? stats.rating.toFixed(1) : '—'}
                        </span>
                        <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>/ 5.0</span>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'rgba(99,102,241,0.1)', padding: '4px 10px', borderRadius: 6, border: '1px solid rgba(99,102,241,0.2)' }}>
                        <Users size={14} color="var(--accent)" />
                        <span style={{ fontWeight: 700, color: 'var(--text-primary)', fontSize: 13 }}>
                          {hasStats ? stats.review_count : '0'}
                        </span>
                        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>reviews</span>
                      </div>

                      {stats?.updated_at && (
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 4, marginLeft: 'auto' }}>
                          <CheckCircle2 size={12} color="#10b981" />
                          Atualizado: {new Date(stats.updated_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                        </div>
                      )}
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </div>
      </div>

      {/* Card Dinâmico de Comparativo de Performance (Ranking) */}
      <div className="card" style={{ marginTop: 24, padding: 20 }}>
        <div className="section-title" style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
          <TrendingUp size={20} color="var(--accent)" />
          Comparação de Performance (Google Maps)
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {rankingList.map((item, idx) => {
            const isWinner = idx === 0 && item.rating > 0
            return (
              <div 
                key={item.name} 
                style={{ 
                  display: 'flex', 
                  alignItems: 'center', 
                  gap: 16, 
                  padding: '14px 18px',
                  background: item.isMe ? 'rgba(99,102,241,0.1)' : 'rgba(255,255,255,0.02)',
                  border: item.isMe ? '1px solid rgba(99,102,241,0.4)' : '1px solid var(--border)',
                  borderRadius: 12,
                  position: 'relative',
                  overflow: 'hidden'
                }}
              >
                {isWinner && (
                  <div style={{ 
                    position: 'absolute', right: -10, top: -10, 
                    background: 'var(--accent)', color: 'white', 
                    fontSize: 9, fontWeight: 800, padding: '14px 14px 4px',
                    transform: 'rotate(45deg)', width: 60, textAlign: 'center'
                  }}>
                    LÍDER
                  </div>
                )}

                <div style={{ flex: 1 }}>
                  <div style={{ 
                    fontWeight: 700, 
                    color: item.isMe ? 'var(--accent-2)' : 'var(--text-primary)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    fontSize: 14
                  }}>
                    {item.name}
                    {item.isMe && <span style={{ fontSize: 10, background: 'var(--accent)', color: 'white', padding: '2px 8px', borderRadius: 10, fontWeight: 700 }}>SUA EMPRESA</span>}
                  </div>
                  <div style={{ display: 'flex', gap: 16, marginTop: 6, color: 'var(--text-muted)', fontSize: 12 }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4, color: '#f59e0b', fontWeight: 600 }}>
                      <Star size={13} fill="#f59e0b" color="#f59e0b" /> {item.rating > 0 ? item.rating.toFixed(1) : '—'}
                    </span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <Users size={13} /> {item.count} reviews
                    </span>
                  </div>
                </div>

                <div style={{ width: 140, background: 'var(--bg-darker)', height: 10, borderRadius: 5, overflow: 'hidden' }}>
                  <div 
                    style={{ 
                      width: `${Math.min(100, (item.rating / 5) * 100)}%`, 
                      height: '100%', 
                      background: item.isMe ? 'var(--accent)' : '#4b5563',
                      borderRadius: 5,
                      transition: 'width 0.5s ease-in-out'
                    }} 
                  />
                </div>
              </div>
            )
          })}
        </div>

        <p style={{ marginTop: 16, fontSize: 11, color: 'var(--text-muted)', textAlign: 'center' }}>
          💡 Atualizado dinamicamente via inteligência de monitoramento do Google Maps.
        </p>
      </div>
    </div>
  )
}

