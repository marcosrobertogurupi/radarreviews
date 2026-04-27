import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import type { Review } from '../lib/supabase'
import {
  CHANNEL_LABELS, CHANNEL_ICONS, SENTIMENT_LABELS, SENTIMENT_COLORS,
  TOPIC_LABELS, formatDate, timeAgo, scoreToEmoji, scoreToColor, ratingStars, API_URL,
  downloadCSV,
} from '../lib/utils'
import { X, ExternalLink, Lightbulb, Loader, MessageCircle, FileDown } from 'lucide-react'

interface Props { tenantId: string; onNavigateCopilot: () => void }

export default function Reviews({ tenantId, onNavigateCopilot }: Props) {
  const [reviews, setReviews]       = useState<Review[]>([])
  const [filtered, setFiltered]     = useState<Review[]>([])
  const [selected, setSelected]     = useState<Review | null>(null)
  const [loading, setLoading]       = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  // Filtros
  const [sentiment, setSentiment]   = useState('')
  const [channel, setChannel]       = useState('')
  const [search, setSearch]         = useState('')
  const [type, setType]             = useState('') // '' | 'review' | 'social'

  // Suggest response
  const [suggesting, setSuggesting]   = useState(false)
  const [suggestion, setSuggestion]   = useState('')
  const [responding, setResponding]   = useState(false)
  const [responseText, setResponseText] = useState('')

  async function load(silent = false) {
    if (!tenantId) return
    if (!silent) setLoading(true)
    else setRefreshing(true)
    const { data } = await supabase
      .from('reviews')
      .select('*, monitored_businesses(name)')
      .eq('tenant_id', tenantId)
      .order('published_at', { ascending: false })
      .limit(300)
    setReviews(data ?? [])
    setLoading(false)
    setRefreshing(false)
  }

  useEffect(() => {
    if (tenantId) load()
    const h = () => load(true)
    window.addEventListener('refresh_data', h)

    // Assinatura em tempo real para novos reviews
    const channel = supabase
      .channel('portal:reviews')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'reviews' },
        (payload) => {
          console.log('[Realtime] Novo review detectado no portal:', payload.new)
          load(true) // Silent refresh
        }
      )
      .subscribe()

    return () => {
      window.removeEventListener('refresh_data', h)
      supabase.removeChannel(channel)
    }
  }, [tenantId])

  // Aplicar filtros
  useEffect(() => {
    let list = reviews
    if (sentiment) list = list.filter(r => r.sentiment === sentiment)
    if (channel)   list = list.filter(r => r.channel === channel)
    if (type) {
      if (type === 'social') list = list.filter(r => r.tags?.includes('social_listening'))
      else list = list.filter(r => !r.tags?.includes('social_listening'))
    }
    if (search) {
      const q = search.toLowerCase()
      list = list.filter(r =>
        r.body?.toLowerCase().includes(q) ||
        r.title?.toLowerCase().includes(q) ||
        r.author_name?.toLowerCase().includes(q) ||
        r.sentiment_summary?.toLowerCase().includes(q)
      )
    }
    setFiltered(list)
  }, [reviews, sentiment, channel, search])

  async function suggestResponse(review: Review) {
    setSuggesting(true)
    setSuggestion('')
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      const res = await fetch(`${API_URL}/api/copilot`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({
          message: `Sugira uma resposta profissional e empática para este review de cliente:\n\nCanal: ${CHANNEL_LABELS[review.channel]}\nNota: ${review.rating ? `${review.rating}/5` : 'sem nota'}\nTítulo: ${review.title || '—'}\nTexto: ${review.body || '(sem texto)'}\n\nClassificação IA: ${SENTIMENT_LABELS[review.sentiment]}${review.sentiment_summary ? `\nResumo IA: ${review.sentiment_summary}` : ''}\n\nResponda APENAS com o texto da resposta sugerida, sem introduções.`,
          history: [],
        }),
      })
      const json = await res.json() as { reply?: string; error?: string }
      setSuggestion(json.reply ?? json.error ?? 'Erro ao gerar sugestão.')
    } catch {
      setSuggestion('Não foi possível conectar ao servidor de IA. Verifique se o servidor está rodando.')
    }
    setSuggesting(false)
  }

  function openDetail(r: Review) { 
    setSelected(r)
    setSuggestion('')
    setResponseText(r.response_text || '')
  }
  function closeDetail() { setSelected(null); setSuggestion(''); setResponseText('') }

  async function sendResponse() {
    if (!selected || !responseText.trim()) return
    setResponding(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      const res = await fetch(`${API_URL}/api/reviews/${selected.id}/respond`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ message: responseText }),
      })
      const json = await res.json() as { ok?: boolean; error?: string }
      if (json.ok) {
        alert('Resposta enviada com sucesso!')
        load(true)
        closeDetail()
      } else {
        alert(`Erro ao enviar: ${json.error}`)
      }
    } catch {
      alert('Erro de conexão ao enviar resposta.')
    }
    setResponding(false)
  }

  const isActionable = (r: Review) => r.sentiment === 'negative' || r.sentiment === 'critical'

  function handleExport() {
    const dataToExport = filtered.map(r => ({
      Data: formatDate(r.published_at),
      Canal: CHANNEL_LABELS[r.channel],
      Autor: r.author_name || 'Anônimo',
      Nota: r.rating ?? 'N/A',
      Sentimento: SENTIMENT_LABELS[r.sentiment],
      'Score IA': r.dissatisfaction_score ?? 0,
      Resumo: r.sentiment_summary || '',
      Texto: r.body || r.title || '',
      URL: r.url || ''
    }))
    downloadCSV(`reviews_reputei_${new Date().toISOString().split('T')[0]}.csv`, dataToExport)
  }

  return (
    <div>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1 className="page-title">Reviews</h1>
          <p className="page-subtitle">Todos os feedbacks coletados — clique para ver análise da IA e próximos passos.</p>
        </div>
        <button className="btn" onClick={handleExport} disabled={filtered.length === 0}>
          <FileDown size={16} /> Exportar CSV
        </button>
      </div>

      <div className="filters">
        <select className="filter-select" value={sentiment} onChange={e => setSentiment(e.target.value)}>
          <option value="">Todos os sentimentos</option>
          <option value="critical">🚨 Crítico</option>
          <option value="negative">🔴 Negativo</option>
          <option value="neutral">🟡 Neutro</option>
          <option value="positive">🟢 Positivo</option>
          <option value="unanalyzed">⚪ Não analisado</option>
        </select>
        <select className="filter-select" value={channel} onChange={e => setChannel(e.target.value)}>
          <option value="">Todos os canais</option>
          {(['google_maps','tripadvisor','trustpilot','reclame_aqui','consumidor_gov','facebook','instagram','reddit'] as const).map(c => (
            <option key={c} value={c}>{CHANNEL_ICONS[c]} {CHANNEL_LABELS[c]}</option>
          ))}
        </select>
        <select className="filter-select" value={type} onChange={e => setType(e.target.value)}>
          <option value="">Todos os tipos</option>
          <option value="review">💬 Reviews Diretos</option>
          <option value="social">📱 Social Listening</option>
        </select>
        <input
          className="filter-search"
          placeholder="Buscar por texto, autor ou resumo..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <span style={{ fontSize: 12, color: 'var(--text-muted)', marginLeft: 'auto' }}>
          {filtered.length} review{filtered.length !== 1 ? 's' : ''}
        </span>
      </div>

      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {Array(5).fill(0).map((_, i) => <div key={i} className="skeleton" style={{ height: 90 }} />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="card empty-state"><div className="empty-state-icon">💬</div><div className="empty-state-text">Nenhum review encontrado</div></div>
      ) : (
        <div className="review-list">
          {filtered.map(r => (
            <div key={r.id} className="card review-item" onClick={() => openDetail(r)}>
              <div className="review-header">
                <span className={`badge badge-${r.sentiment}`}>{scoreToEmoji(r.dissatisfaction_score ?? 0)} {SENTIMENT_LABELS[r.sentiment]}</span>
                <div className="review-meta">
                  {r.tags?.includes('social_listening') && (
                    <span className="badge" style={{ background: 'rgba(99,102,241,0.15)', color: '#a5b4fc', borderColor: 'rgba(99,102,241,0.3)', fontSize: 10 }}>
                      SOCIAL LISTENING
                    </span>
                  )}
                  <span className="review-channel-tag">{CHANNEL_ICONS[r.channel]} {CHANNEL_LABELS[r.channel]}</span>
                  {r.author_name && <span>{r.author_name}</span>}
                  {r.rating != null && <span className="stars">{ratingStars(r.rating)}</span>}
                  <span>{timeAgo(r.published_at)}</span>
                </div>
              </div>
              {r.title && <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-primary)', marginBottom: 4 }}>{r.title}</div>}
              <div className="review-body">{r.body || '(sem texto)'}</div>
              {r.sentiment_summary && (
                <div className="review-ai-summary">🤖 {r.sentiment_summary}</div>
              )}
              {/* Destaque: next step se actionável */}
              {isActionable(r) && r.sentiment_result?.alert_reason && (
                <div className={`next-steps-box ${r.sentiment === 'critical' ? 'critical' : ''}`} style={{ marginTop: 10 }}>
                  <div className="next-steps-title"><Lightbulb size={12} /> Próximo Passo</div>
                  <div className="next-steps-text">{r.sentiment_result.alert_reason}</div>
                </div>
              )}
              {r.sentiment_topics && r.sentiment_topics.length > 0 && (
                <div className="review-topics">
                  {r.sentiment_topics.map(t => (
                    <span key={t} className="topic-tag">{TOPIC_LABELS[t] ?? t}</span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Modal de detalhe */}
      {selected && (
        <div className="modal-overlay" onClick={closeDetail}>
          <div className="modal-content wide" onClick={e => e.stopPropagation()}>
            <div className="modal-title">
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span>{CHANNEL_ICONS[selected.channel]}</span>
                <span style={{ fontSize: 16 }}>{CHANNEL_LABELS[selected.channel]}</span>
                <span className={`badge badge-${selected.sentiment}`}>{scoreToEmoji(selected.dissatisfaction_score ?? 0)} {SENTIMENT_LABELS[selected.sentiment]}</span>
              </div>
              <button className="modal-close" onClick={closeDetail}><X size={18} /></button>
            </div>

            {/* Análise IA */}
            {selected.sentiment !== 'unanalyzed' && (
              <div style={{ background: 'rgba(99,102,241,0.06)', border: '1px solid rgba(99,102,241,0.2)', borderRadius: 10, padding: 16, marginBottom: 20 }}>
                <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#a5b4fc', marginBottom: 12 }}>
                  🤖 Análise da IA {selected.sentiment_result?.method === 'gemini' ? '· Gemini' : selected.sentiment_result?.method === 'heuristic' ? '· Heurística' : ''}
                </div>

                {selected.dissatisfaction_score != null && (
                  <div className="modal-section">
                    <div className="modal-label">Score de Insatisfação</div>
                    <div className="score-bar-wrap">
                      <div className="score-bar-bg">
                        <div className="score-bar-fill" style={{ width: `${selected.dissatisfaction_score}%`, background: scoreToColor(selected.dissatisfaction_score) }} />
                      </div>
                      <div className="score-value" style={{ color: scoreToColor(selected.dissatisfaction_score) }}>
                        {selected.dissatisfaction_score}
                      </div>
                    </div>
                  </div>
                )}

                {selected.sentiment_summary && (
                  <div className="modal-section">
                    <div className="modal-label">Resumo da IA</div>
                    <div className="modal-value">{selected.sentiment_summary}</div>
                  </div>
                )}

                {selected.sentiment_topics && selected.sentiment_topics.length > 0 && (
                  <div className="modal-section">
                    <div className="modal-label">Tópicos Detectados</div>
                    <div className="review-topics">
                      {selected.sentiment_topics.map(t => (
                        <span key={t} className="topic-tag">{TOPIC_LABELS[t] ?? t}</span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Próximos passos para negativos/críticos */}
            {isActionable(selected) && (
              <div className={`next-steps-box ${selected.sentiment === 'critical' ? 'critical' : ''}`} style={{ marginBottom: 20 }}>
                <div className="next-steps-title">
                  <Lightbulb size={13} />
                  Próximos Passos Recomendados
                </div>
                {selected.sentiment_result?.alert_reason ? (
                  <div className="next-steps-text">{selected.sentiment_result.alert_reason}</div>
                ) : (
                  <div className="next-steps-text">
                    {selected.sentiment === 'critical'
                      ? 'Este review é crítico. Responda publicamente com empatia e ofereça solução imediata. Registre o caso internamente.'
                      : 'Responda ao cliente reconhecendo o problema. Ofereça canal privado para resolução e registre internamente.'}
                  </div>
                )}
              </div>
            )}

            {/* Conteúdo do review */}
            <div className="modal-section">
              <div className="modal-label">Conteúdo</div>
              {selected.title && <div className="modal-value" style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: 6 }}>{selected.title}</div>}
              <div className="modal-value">{selected.body || '(sem texto)'}</div>
            </div>

            {/* Metadados */}
            <div className="grid-2" style={{ gap: 12, marginBottom: 16 }}>
              {selected.author_name && (
                <div><div className="modal-label">Autor</div><div className="modal-value modal-hl">{selected.author_name}</div></div>
              )}
              {selected.rating != null && (
                <div><div className="modal-label">Nota</div><div className="modal-value"><span className="stars">{ratingStars(selected.rating)}</span> {selected.rating}/5</div></div>
              )}
              <div><div className="modal-label">Publicado em</div><div className="modal-value">{formatDate(selected.published_at)}</div></div>
              {selected.monitored_businesses?.name && (
                <div><div className="modal-label">Empresa</div><div className="modal-value modal-hl">{selected.monitored_businesses.name}</div></div>
              )}
            </div>

            {/* Ações */}
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', paddingTop: 16, borderTop: '1px solid var(--border)' }}>
              {selected.url && (
                <a href={selected.url} target="_blank" rel="noopener noreferrer" className="btn">
                  <ExternalLink size={14} /> Ver Original
                </a>
              )}
              {isActionable(selected) && (
                <button
                  className="btn btn-primary"
                  onClick={() => suggestResponse(selected)}
                  disabled={suggesting}
                >
                  {suggesting ? <><Loader size={14} style={{ animation: 'spin 0.7s linear infinite' }} /> Gerando...</> : <><Lightbulb size={14} /> Sugerir Resposta</>}
                </button>
              )}
              <button
                className="btn"
                style={{ marginLeft: 'auto' }}
                onClick={() => { closeDetail(); onNavigateCopilot() }}
              >
                <MessageCircle size={14} /> Perguntar à IA
              </button>
            </div>

            {/* Resposta sugerida */}
            {suggestion && (
              <div style={{ marginTop: 16, background: 'rgba(6,182,212,0.07)', border: '1px solid rgba(6,182,212,0.2)', borderRadius: 10, padding: 16 }}>
                <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--accent-2)', marginBottom: 10 }}>
                  💬 Resposta Sugerida pela IA (Claude)
                </div>
                <div style={{ fontSize: 13.5, color: 'var(--text-secondary)', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>{suggestion}</div>
                <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                  <button
                    className="btn btn-ghost"
                    style={{ fontSize: 12 }}
                    onClick={() => navigator.clipboard.writeText(suggestion)}
                  >
                    📋 Copiar
                  </button>
                  <button
                    className="btn btn-ghost"
                    style={{ fontSize: 12, color: 'var(--accent-2)' }}
                    onClick={() => setResponseText(suggestion)}
                  >
                    ✍️ Usar esta resposta
                  </button>
                </div>
              </div>
            )}

            {/* Campo de Resposta Direta */}
            <div style={{ marginTop: 24, paddingTop: 24, borderTop: '2px solid var(--border)' }}>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12, color: 'var(--text-primary)' }}>
                Responder agora
              </div>
              <textarea
                className="filter-search"
                style={{ width: '100%', height: 120, padding: 12, borderRadius: 8, fontSize: 13, resize: 'vertical' }}
                placeholder="Escreva sua resposta para o cliente..."
                value={responseText}
                onChange={e => setResponseText(e.target.value)}
                disabled={responding || (selected.responded_at != null)}
              />
              {selected.responded_at ? (
                <div style={{ marginTop: 8, fontSize: 11, color: '#10b981', display: 'flex', alignItems: 'center', gap: 4 }}>
                  ✓ Respondido em {formatDate(selected.responded_at)}
                </div>
              ) : (
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
                  <button
                    className="btn btn-primary"
                    onClick={sendResponse}
                    disabled={responding || !responseText.trim()}
                    style={{ padding: '10px 24px' }}
                  >
                    {responding ? 'Enviando...' : 'Enviar Resposta Oficial'}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}
