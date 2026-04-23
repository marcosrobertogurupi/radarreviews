import { useState, useEffect } from 'react'
import type { ReputationScoreData } from '../../services/reputation'
import { ChevronDown, ChevronUp, Star, TrendingUp, TrendingDown, Minus } from 'lucide-react'

interface Props {
  data: ReputationScoreData
  loading?: boolean
}

export default function ReputationScore({ data, loading }: Props) {
  const [displayScore, setDisplayScore] = useState(0)
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    if (!loading && data.score !== displayScore) {
      const duration = 1000
      const start = displayScore
      const end = data.score
      const startTime = performance.now()

      const animate = (currentTime: number) => {
        const elapsed = currentTime - startTime
        const progress = Math.min(elapsed / duration, 1)
        const current = Math.floor(start + (end - start) * progress)
        
        setDisplayScore(current)

        if (progress < 1) {
          requestAnimationFrame(animate)
        }
      }

      requestAnimationFrame(animate)
    }
  }, [data.score, loading])

  if (loading) {
    return (
      <div className="card" style={{ height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div className="skeleton" style={{ width: 100, height: 60, borderRadius: 8 }} />
      </div>
    )
  }

  const lightColor = `${data.color}20` // Cor da faixa com opacidade

  return (
    <div className="card" style={{ 
      overflow: 'hidden', 
      border: `1px solid ${data.color}40`,
      background: `linear-gradient(135deg, var(--card-bg), ${lightColor})`
    }}>
      <div style={{ padding: '24px 32px', textAlign: 'center' }}>
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 12, marginBottom: 8 }}>
          <span style={{ fontSize: 24 }}>{data.emoji}</span>
          <span style={{ fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: data.color }}>
            {data.label}
          </span>
        </div>

        <div style={{ 
          fontSize: 72, 
          fontWeight: 800, 
          color: 'var(--text-primary)', 
          lineHeight: 1,
          fontFamily: 'Outfit, sans-serif',
          margin: '12px 0'
        }}>
          {displayScore}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, fontSize: 14 }}>
          <span style={{ 
            color: data.change > 0 ? '#10b981' : (data.change < 0 ? '#ef4444' : 'var(--text-muted)'),
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            fontWeight: 600
          }}>
            {data.change > 0 ? <ChevronUp size={16} /> : (data.change < 0 ? <ChevronDown size={16} /> : <Minus size={16} />)}
            {Math.abs(data.change)} pontos
          </span>
          <span style={{ color: 'var(--text-muted)' }}>vs mês passado</span>
        </div>

        <button 
          onClick={() => setExpanded(!expanded)}
          style={{
            marginTop: 20,
            background: 'none',
            border: 'none',
            color: 'var(--text-muted)',
            fontSize: 11,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            margin: '20px auto 0'
          }}
        >
          {expanded ? 'Ocultar detalhes' : 'Ver como é calculado'}
          <ChevronDown size={14} style={{ transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
        </button>
      </div>

      {expanded && (
        <div style={{ 
          padding: '20px 32px', 
          borderTop: '1px solid var(--border)',
          background: 'rgba(0,0,0,0.2)',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
          gap: 16
        }}>
          <div className="score-detail-item">
            <div className="score-detail-label">Média de Notas</div>
            <div className="score-detail-value">
              <Star size={14} fill="#f59e0b" color="#f59e0b" />
              {data.breakdown.avgRating.toFixed(1)}/5
            </div>
            <div className="score-detail-weight">50% do peso</div>
          </div>

          <div className="score-detail-item">
            <div className="score-detail-label">Taxa Positiva</div>
            <div className="score-detail-value">
              {data.breakdown.positiveRate}%
            </div>
            <div className="score-detail-weight">25% do peso</div>
          </div>

          <div className="score-detail-item">
            <div className="score-detail-label">Tendência</div>
            <div className="score-detail-value">
              {data.breakdown.trend === 'improving' ? <TrendingUp size={14} color="#10b981" /> : 
               (data.breakdown.trend === 'worsening' ? <TrendingDown size={14} color="#ef4444" /> : <Minus size={14} />)}
              {data.breakdown.trend === 'improving' ? 'Melhorando' : (data.breakdown.trend === 'worsening' ? 'Caindo' : 'Estável')}
            </div>
            <div className="score-detail-weight">15% do peso</div>
          </div>

          <div className="score-detail-item">
            <div className="score-detail-label">Base de Dados</div>
            <div className="score-detail-value">
              {data.breakdown.totalReviews} reviews
            </div>
            <div className="score-detail-weight">10% do peso</div>
          </div>
        </div>
      )}

      <style>{`
        .score-detail-item {
          display: flex;
          flex-direction: column;
          gap: 4;
        }
        .score-detail-label {
          font-size: 10px;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: var(--text-muted);
        }
        .score-detail-value {
          font-size: 16px;
          font-weight: 700;
          color: var(--text-primary);
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .score-detail-weight {
          font-size: 9px;
          color: var(--text-muted);
          opacity: 0.7;
        }
      `}</style>
    </div>
  )
}
