import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Review } from '../lib/supabase'
import {
  CHANNEL_LABELS, CHANNEL_ICONS, SENTIMENT_LABELS, SENTIMENT_COLORS,
  TOPIC_LABELS, formatDate, timeAgo, ratingStars, scoreToEmoji
} from '../lib/utils'
import type { SourceChannel, SentimentType } from '../lib/supabase'

// ──────────────────────────────────────────────────────────────
// Modal de detalhes do review
// ──────────────────────────────────────────────────────────────

function ReviewModal({ review, onClose }: { review: Review; onClose: () => void }) {
  const score = review.dissatisfaction_score ?? 0
  const scoreColor = score >= 81 ? '#dc2626' : score >= 56 ? '#ef4444' : score >= 31 ? '#f59e0b' : '#10b981'
  const sr = review.sentiment_result

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()}>
        <div className="modal-title">
          <span>
            {CHANNEL_ICONS[review.channel]} Detalhe do Review
          </span>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="modal-section">
          <div className="modal-label">Classificação da IA</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
            <span className={`badge badge-${review.sentiment}`} style={{ fontSize: 14, padding: '4px 14px' }}>
              {scoreToEmoji(score)} {SENTIMENT_LABELS[review.sentiment]}
            </span>
            {sr?.method && (
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                via {sr.method === 'gemini' ? '🧠 Gemini 2.5 Flash' : sr.method === 'heuristic' ? '⚙️ Heurística' : '⭐ Rating'}
              </span>
            )}
          </div>

          {score > 0 && (
            <div className="score-bar-wrap">
              <span style={{ fontSize: 11, color: 'var(--text-muted)', minWidth: 80 }}>Insatisfação</span>
              <div className="score-bar-bg">
                <div className="score-bar-fill" style={{ width: `${score}%`, background: scoreColor }} />
              </div>
              <div className="score-value" style={{ color: scoreColor }}>{score}</div>
            </div>
          )}
        </div>

        {sr?.alert_reason && (
          <div className="modal-section">
            <div className="modal-label">⚠️ Ação Recomendada</div>
            <div style={{ padding: '10px 14px', background: 'rgba(239,68,68,0.1)', borderRadius: 8, border: '1px solid rgba(239,68,68,0.25)', fontSize: 13, color: '#fca5a5', lineHeight: 1.6 }}>
              {sr.alert_reason}
            </div>
          </div>
        )}

        {review.sentiment_summary && (
          <div className="modal-section">
            <div className="modal-label">💬 Resumo da IA</div>
            <div className="modal-value" style={{ color: 'var(--accent-2)' }}>{review.sentiment_summary}</div>
          </div>
        )}

        {review.sentiment_topics && review.sentiment_topics.length > 0 && (
          <div className="modal-section">
            <div className="modal-label">🏷️ Tópicos detectados</div>
            <div className="review-topics">
              {review.sentiment_topics.map(t => (
                <span key={t} className="topic-tag">{TOPIC_LABELS[t] || t}</span>
              ))}
            </div>
          </div>
        )}

        <div className="modal-section">
          <div className="modal-label">📝 Conteúdo do Review</div>
          {review.title && <div className="modal-value modal-hl" style={{ marginBottom: 6 }}>{review.title}</div>}
          <div className="modal-value">{review.body || '(sem texto)'}</div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div className="modal-section">
            <div className="modal-label">👤 Autor</div>
            <div className="modal-value modal-hl">{review.author_name || '(anônimo)'}</div>
          </div>
          {review.rating && (
            <div className="modal-section">
              <div className="modal-label">⭐ Nota</div>
              <div className="stars" style={{ fontSize: 16 }}>{ratingStars(review.rating)}</div>
            </div>
          )}
          <div className="modal-section">
            <div className="modal-label">📅 Publicado em</div>
            <div className="modal-value">{formatDate(review.published_at)}</div>
          </div>
          <div className="modal-section">
            <div className="modal-label">🏢 Empresa</div>
            <div className="modal-value modal-hl">
              {review.monitored_businesses?.name || '—'}
            </div>
          </div>
          <div className="modal-section">
            <div className="modal-label">📡 Canal</div>
            <div className="modal-value">
              {CHANNEL_ICONS[review.channel]} {CHANNEL_LABELS[review.channel]}
            </div>
          </div>
        </div>

        {review.url && (
          <a
            href={review.url}
            target="_blank"
            rel="noopener noreferrer"
            style={{ display: 'block', marginTop: 8, fontSize: 12, color: 'var(--accent)', textDecoration: 'none' }}
          >
            🔗 Ver review original na plataforma →
          </a>
        )}

        {sr && (
          <div style={{ marginTop: 16, padding: '10px 14px', background: 'rgba(255,255,255,0.03)', borderRadius: 8, fontSize: 11, color: 'var(--text-muted)' }}>
            Confiança da análise: <strong style={{ color: 'var(--text-secondary)' }}>{Math.round((sr.confidence || 0) * 100)}%</strong>
            {' · '}Coletado: {timeAgo(review.published_at)}
          </div>
        )}
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────
// Página Reviews
// ──────────────────────────────────────────────────────────────

const SENTIMENTS: SentimentType[] = ['positive', 'neutral', 'negative', 'critical', 'unanalyzed']
const CHANNELS: SourceChannel[] = ['google_maps', 'facebook', 'instagram', 'reclame_aqui', 'consumidor_gov', 'tripadvisor', 'trustpilot', 'reddit']

import type { TenantOption } from '../App'

interface Props {
  tenants: TenantOption[]
  selectedTenantId: string
  onTenantChange: (id: string) => void
}

export default function Reviews({ tenants, selectedTenantId, onTenantChange }: Props) {
  const [reviews, setReviews] = useState<Review[]>([])
  const [filtered, setFiltered] = useState<Review[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<Review | null>(null)

  // Filtros
  const [sentiment, setSentiment] = useState('')
  const [channel, setChannel] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const PAGE_SIZE = 20

  useEffect(() => {
    loadReviews()
    const handleRefresh = () => loadReviews()
    window.addEventListener('refresh_data', handleRefresh)
    return () => window.removeEventListener('refresh_data', handleRefresh)
  }, [sentiment, channel, selectedTenantId])

  useEffect(() => {
    applySearch()
  }, [search, reviews])

  async function loadReviews() {
    setLoading(true)
    setPage(0)

    let query = supabase
      .from('reviews')
      .select('*, monitored_businesses(name)')
      .order('published_at', { ascending: false })
      .limit(200)

    if (sentiment)         query = query.eq('sentiment', sentiment)
    if (channel)           query = query.eq('channel', channel)
    if (selectedTenantId)  query = query.eq('tenant_id', selectedTenantId)

    const { data } = await query
    setReviews(data ?? [])
    setLoading(false)
  }

  function applySearch() {
    if (!search) { setFiltered(reviews); return }
    const term = search.toLowerCase()
    setFiltered(
      reviews.filter(r =>
        r.body?.toLowerCase().includes(term) ||
        r.title?.toLowerCase().includes(term) ||
        r.author_name?.toLowerCase().includes(term) ||
        r.sentiment_summary?.toLowerCase().includes(term)
      )
    )
  }

  const paginated = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE)

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Reviews</h1>
        <p className="page-subtitle">
          {filtered.length.toLocaleString('pt-BR')} reviews encontrados
        </p>
        <select
          value={selectedTenantId}
          onChange={e => onTenantChange(e.target.value)}
          style={{ marginTop: 10, padding: '6px 12px', background: 'var(--bg-darker)', border: '1px solid var(--border)', color: 'var(--text-primary)', borderRadius: 6, fontSize: 13, cursor: 'pointer' }}
        >
          <option value=''>Todos os assinantes</option>
          {tenants.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </div>

      {/* Filtros */}
      <div className="filters">
        <select className="filter-select" value={sentiment} onChange={e => { setSentiment(e.target.value) }}>
          <option value="">Todos os sentimentos</option>
          {SENTIMENTS.map(s => (
            <option key={s} value={s}>{SENTIMENT_LABELS[s]}</option>
          ))}
        </select>

        <select className="filter-select" value={channel} onChange={e => { setChannel(e.target.value) }}>
          <option value="">Todos os canais</option>
          {CHANNELS.map(c => (
            <option key={c} value={c}>{CHANNEL_ICONS[c]} {CHANNEL_LABELS[c]}</option>
          ))}
        </select>

        <input
          className="filter-search"
          placeholder="🔍 Buscar por texto, autor, resumo..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      {loading ? (
        <div className="review-list">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="card" style={{ padding: 16 }}>
              <div className="skeleton" style={{ width: 120, height: 22, marginBottom: 10 }} />
              <div className="skeleton" style={{ width: '90%', height: 14, marginBottom: 6 }} />
              <div className="skeleton" style={{ width: '70%', height: 14 }} />
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="card empty-state">
          <div className="empty-state-icon">🔍</div>
          <div className="empty-state-text">Nenhum review encontrado com esses filtros</div>
        </div>
      ) : (
        <>
          <div className="review-list">
            {paginated.map(r => (
              <div key={r.id} className="card review-item" onClick={() => setSelected(r)}>
                <div className="review-header">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span className={`badge badge-${r.sentiment}`}>
                      {scoreToEmoji(r.dissatisfaction_score ?? 0)} {SENTIMENT_LABELS[r.sentiment]}
                    </span>
                    {r.dissatisfaction_score != null && r.dissatisfaction_score > 0 && (
                      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                        score: {r.dissatisfaction_score}
                      </span>
                    )}
                  </div>
                  <div className="review-meta">
                    {r.rating && <span className="stars">{ratingStars(r.rating)}</span>}
                    <div style={{ display: 'flex', gap: 6 }}>
                      <span className="review-channel-tag">
                        {CHANNEL_ICONS[r.channel]} {CHANNEL_LABELS[r.channel]}
                      </span>
                      {r.monitored_businesses?.name && (
                        <span className="review-channel-tag" style={{ background: 'rgba(99,102,241,0.1)', color: '#a5b4fc', border: '1px solid rgba(99,102,241,0.2)' }}>
                          🏢 {r.monitored_businesses.name}
                        </span>
                      )}
                    </div>
                    <span style={{ color: 'var(--text-muted)' }}>{timeAgo(r.published_at)}</span>
                  </div>
                </div>

                {r.author_name && (
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>
                    👤 {r.author_name}
                  </div>
                )}

                {(r.title || r.body) && (
                  <div className="review-body">{r.title ? `${r.title}: ` : ''}{r.body}</div>
                )}

                {r.sentiment_summary && (
                  <div className="review-ai-summary">
                    🤖 {r.sentiment_summary}
                  </div>
                )}

                {r.sentiment_topics && r.sentiment_topics.length > 0 && (
                  <div className="review-topics">
                    {r.sentiment_topics.map(t => (
                      <span key={t} className="topic-tag">{TOPIC_LABELS[t] || t}</span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Paginação */}
          {totalPages > 1 && (
            <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 20 }}>
              <button
                className="btn-refresh"
                disabled={page === 0}
                onClick={() => setPage(p => p - 1)}
              >
                ← Anterior
              </button>
              <span style={{ padding: '8px 16px', color: 'var(--text-secondary)', fontSize: 13 }}>
                {page + 1} / {totalPages}
              </span>
              <button
                className="btn-refresh"
                disabled={page + 1 >= totalPages}
                onClick={() => setPage(p => p + 1)}
              >
                Próximo →
              </button>
            </div>
          )}
        </>
      )}

      {selected && <ReviewModal review={selected} onClose={() => setSelected(null)} />}
    </div>
  )
}
