import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { TrendingUp, Users, Star } from 'lucide-react'

interface CompetitorStat {
  id: string
  name: string
  last_stats: {
    rating: number
    review_count: number
    updated_at: string
  }
}

interface Props {
  businessId: string
  myRating: number
  myReviews: number
}

export function CompetitorStats({ businessId, myRating, myReviews }: Props) {
  const [competitors, setCompetitors] = useState<CompetitorStat[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      if (!businessId) return
      setLoading(true)
      const { data } = await supabase
        .from('competitor_businesses')
        .select('*')
        .eq('business_id', businessId)
      
      setCompetitors(data || [])
      setLoading(false)
    }
    load()
  }, [businessId])

  if (loading) return <div className="skeleton" style={{ height: 200 }} />
  if (competitors.length === 0) return null

  // Ordenar: primeiro nós, depois concorrentes por nota
  const all = [
    { name: 'Sua Empresa', rating: myRating, count: myReviews, isMe: true },
    ...competitors.map(c => ({
      name: c.name,
      rating: c.last_stats?.rating || 0,
      count: c.last_stats?.review_count || 0,
      isMe: false
    }))
  ].sort((a, b) => b.rating - a.rating)

  return (
    <div className="card" style={{ padding: 20 }}>
      <div className="section-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <TrendingUp size={18} color="var(--accent)" />
        Benchmarking Local (Google)
      </div>
      
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 16 }}>
        {all.map((item, idx) => {
          const isWinner = idx === 0
          return (
            <div 
              key={item.name} 
              style={{ 
                display: 'flex', 
                alignItems: 'center', 
                gap: 16, 
                padding: '12px 16px',
                background: item.isMe ? 'rgba(99,102,241,0.1)' : 'rgba(255,255,255,0.02)',
                border: item.isMe ? '1px solid rgba(99,102,241,0.3)' : '1px solid var(--border)',
                borderRadius: 12,
                position: 'relative',
                overflow: 'hidden'
              }}
            >
              {isWinner && (
                <div style={{ 
                  position: 'absolute', right: -10, top: -10, 
                  background: 'var(--accent)', color: 'white', 
                  fontSize: 10, fontWeight: 800, padding: '15px 15px 5px',
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
                  gap: 6
                }}>
                  {item.name}
                  {item.isMe && <span style={{ fontSize: 10, background: 'var(--accent)', color: 'white', padding: '1px 6px', borderRadius: 10 }}>VOCÊ</span>}
                </div>
                <div style={{ display: 'flex', gap: 12, marginTop: 4, color: 'var(--text-muted)', fontSize: 12 }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <Star size={12} fill="#f59e0b" color="#f59e0b" /> {item.rating.toFixed(1)}
                  </span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <Users size={12} /> {item.count} reviews
                  </span>
                </div>
              </div>

              <div style={{ width: 100, background: 'var(--bg-darker)', height: 8, borderRadius: 4, overflow: 'hidden' }}>
                <div 
                  style={{ 
                    width: `${(item.rating / 5) * 100}%`, 
                    height: '100%', 
                    background: item.isMe ? 'var(--accent)' : '#4b5563',
                    borderRadius: 4
                  }} 
                />
              </div>
            </div>
          )
        })}
      </div>

      <p style={{ marginTop: 16, fontSize: 11, color: 'var(--text-muted)', textAlign: 'center' }}>
        💡 Dados coletados diretamente do Google Maps. Atualizados a cada 24h.
      </p>
    </div>
  )
}
