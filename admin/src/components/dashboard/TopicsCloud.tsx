import { TOPIC_LABELS } from '../../lib/utils'
import { ThumbsUp, ThumbsDown, MessageCircle } from 'lucide-react'

export interface TopicData {
  tema: string
  positivo: number
  negativo: number
}

interface Props {
  topics: TopicData[]
  loading?: boolean
}

export default function TopicsCloud({ topics, loading }: Props) {
  if (loading) {
    return (
      <div className="card" style={{ padding: 24 }}>
        <div className="skeleton" style={{ width: 150, height: 20, marginBottom: 20 }} />
        <div className="grid-2" style={{ gap: 12 }}>
          {[...Array(6)].map((_, i) => (
            <div key={i} className="skeleton" style={{ height: 60, borderRadius: 8 }} />
          ))}
        </div>
      </div>
    )
  }

  if (topics.length === 0) {
    return (
      <div className="card" style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)' }}>
        <MessageCircle size={32} style={{ margin: '0 auto 12px', opacity: 0.3 }} />
        <p style={{ fontSize: 13 }}>A IA ainda não processou os temas deste mês.</p>
      </div>
    )
  }

  return (
    <div className="card" style={{ padding: 24 }}>
      <div style={{ marginBottom: 20 }}>
        <h3 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>O que seus clientes mais comentam</h3>
        <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '4px 0 0' }}>
          Principais temas extraídos das avaliações recentes
        </p>
      </div>

      <div style={{ 
        display: 'grid', 
        gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', 
        gap: 12 
      }}>
        {topics.map((item) => {
          const total = item.positivo + item.negativo
          const posPerc = (item.positivo / total) * 100
          const label = TOPIC_LABELS[item.tema] || item.tema

          return (
            <div key={item.tema} style={{ 
              background: 'rgba(255,255,255,0.03)', 
              border: '1px solid var(--border)', 
              borderRadius: 12, 
              padding: 12,
              transition: 'transform 0.2s',
              cursor: 'default'
            }}
            onMouseEnter={e => e.currentTarget.style.transform = 'translateY(-2px)'}
            onMouseLeave={e => e.currentTarget.style.transform = 'none'}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{label}</span>
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{total} menções</span>
              </div>
              
              <div style={{ 
                height: 6, 
                width: '100%', 
                background: 'rgba(239,68,68,0.2)', 
                borderRadius: 3, 
                overflow: 'hidden',
                display: 'flex'
              }}>
                <div style={{ 
                  width: `${posPerc}%`, 
                  height: '100%', 
                  background: '#10b981',
                  transition: 'width 1s ease-out'
                }} />
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: '#10b981' }}>
                  <ThumbsUp size={10} /> {item.positivo}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: '#ef4444' }}>
                  <ThumbsDown size={10} /> {item.negativo}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
