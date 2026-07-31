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
      <div className="card" style={{ padding: 24, marginBottom: 24 }}>
        <div className="skeleton" style={{ width: 220, height: 22, marginBottom: 8 }} />
        <div className="skeleton" style={{ width: 300, height: 14, marginBottom: 20 }} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12 }}>
          {[...Array(6)].map((_, i) => (
            <div key={i} className="skeleton" style={{ height: 74, borderRadius: 12 }} />
          ))}
        </div>
      </div>
    )
  }

  if (topics.length === 0) {
    return (
      <div className="card" style={{ padding: 24, marginBottom: 24, textAlign: 'center', color: 'var(--text-muted)' }}>
        <MessageCircle size={32} style={{ margin: '0 auto 12px', opacity: 0.4, color: 'var(--accent)' }} />
        <h3 style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)', margin: '0 0 4px' }}>
          O que seus clientes mais comentam
        </h3>
        <p style={{ fontSize: 13, margin: 0 }}>
          Conforme novos reviews forem coletados, nossa IA identificará automaticamente os temas mais citados pelos seus clientes.
        </p>
      </div>
    )
  }

  return (
    <div className="card" style={{ padding: 24, marginBottom: 24 }}>
      <div style={{ marginBottom: 20 }}>
        <h3 style={{ fontSize: 16, fontWeight: 700, margin: 0, color: 'var(--text-primary)', fontFamily: 'Outfit, sans-serif' }}>
          💬 O que seus clientes mais comentam
        </h3>
        <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '4px 0 0' }}>
          Principais temas e assuntos extraídos das avaliações recentes dos seus clientes
        </p>
      </div>

      <div style={{ 
        display: 'grid', 
        gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', 
        gap: 12 
      }}>
        {topics.map((item) => {
          const total = item.positivo + item.negativo
          const posPerc = total > 0 ? (item.positivo / total) * 100 : 100
          const label = TOPIC_LABELS[item.tema] || item.tema

          return (
            <div key={item.tema} style={{ 
              background: 'rgba(255,255,255,0.03)', 
              border: '1px solid var(--border)', 
              borderRadius: 12, 
              padding: 14,
              transition: 'all 0.2s ease-in-out',
              cursor: 'default'
            }}
            onMouseEnter={e => {
              e.currentTarget.style.transform = 'translateY(-2px)'
              e.currentTarget.style.borderColor = 'rgba(99,102,241,0.4)'
            }}
            onMouseLeave={e => {
              e.currentTarget.style.transform = 'none'
              e.currentTarget.style.borderColor = 'var(--border)'
            }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', textTransform: 'capitalize' }}>
                  {label}
                </span>
                <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 500 }}>
                  {total} {total === 1 ? 'menção' : 'menções'}
                </span>
              </div>
              
              {/* Barra de Proporção Positivo vs Negativo */}
              <div style={{ 
                height: 6, 
                width: '100%', 
                background: 'rgba(239,68,68,0.25)', 
                borderRadius: 3, 
                overflow: 'hidden',
                display: 'flex'
              }}>
                <div style={{ 
                  width: `${posPerc}%`, 
                  height: '100%', 
                  background: '#10b981',
                  transition: 'width 0.8s ease-out'
                }} />
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: '#10b981', fontWeight: 600 }}>
                  <ThumbsUp size={12} /> {item.positivo}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: '#ef4444', fontWeight: 600 }}>
                  <ThumbsDown size={12} /> {item.negativo}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
