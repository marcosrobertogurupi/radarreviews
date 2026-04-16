import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Connector, SourceChannel } from '../lib/supabase'
import { CHANNEL_LABELS, CHANNEL_ICONS, formatDate, timeAgo } from '../lib/utils'

// ──────────────────────────────────────────────────────────────
// Página Conectores
// ──────────────────────────────────────────────────────────────

const STATUS_LABEL: Record<string, string> = {
  active: 'Ativo',
  paused: 'Pausado',
  error:  'Erro',
  pending: 'Aguardando',
}

const STATUS_DOT: Record<string, string> = {
  active:  '🟢',
  paused:  '⚫',
  error:   '🔴',
  pending: '🟡',
}

// Todos os 8 canais suportados pelo sistema
const ALL_CHANNELS = [
  'google_maps', 'tripadvisor', 'trustpilot', 'reclame_aqui',
  'consumidor_gov', 'reddit', 'facebook', 'instagram'
]

interface ConnectorStats {
  channel: string
  total: number
  last30: number
  negativeRate: number
  avgScore: number
}

export default function Connectors() {
  const [connectors, setConnectors] = useState<Connector[]>([])
  const [stats, setStats] = useState<Record<string, ConnectorStats>>({})
  const [businesses, setBusinesses] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<Connector | null>(null)
  const [editingConfig, setEditingConfig] = useState(false)
  const [intervalMinutes, setIntervalMinutes] = useState(60)
  const [editingExternalId, setEditingExternalId] = useState('')
  const [editingConfigJson, setEditingConfigJson] = useState('')

  // Filtros da tabela
  const [filterChannel, setFilterChannel] = useState('')
  const [filterBusiness, setFilterBusiness] = useState('')

  // Estados do novo conector
  const [allBusinesses, setAllBusinesses] = useState<{id: string, name: string}[]>([])
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [newConn, setNewConn] = useState({ business_id: '', channel: 'google_maps', external_id: '' })

  useEffect(() => {
    loadAll()
    const handleRefresh = () => loadAll()
    window.addEventListener('refresh_data', handleRefresh)
    
    // ──────────────────────────────────────────────────────────────
    // Supabase Realtime - Atualizar status sem F5
    // ──────────────────────────────────────────────────────────────
    const channel = supabase
      .channel('public:channel_connectors')
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'channel_connectors' },
        (payload) => {
          console.log('[Realtime] Mudança detectada no conector:', payload.new)
          const updated = payload.new as Connector
          
          setConnectors(current => 
            current.map(c => {
              if (c.id === updated.id) {
                // Preservar joins (monitored_businesses) que não vêm no payload do realtime
                return { ...c, ...updated }
              }
              return c
            })
          )
        }
      )
      .subscribe()

    return () => {
      window.removeEventListener('refresh_data', handleRefresh)
      supabase.removeChannel(channel)
    }
  }, [])

  useEffect(() => {
    if (selected) {
      setIntervalMinutes((selected.config?.interval_minutes as number) || 60)
      setEditingExternalId(selected.external_id || '')
      
      const { interval_minutes, ...restConfig } = selected.config || {}
      setEditingConfigJson(Object.keys(restConfig).length > 0 ? JSON.stringify(restConfig, null, 2) : '')
      
      setEditingConfig(false)
    }
  }, [selected])

  async function updateConfig() {
    if (!selected) return
    let parsedConfig = selected.config || {}
    try {
      if (editingConfigJson.trim()) {
        parsedConfig = JSON.parse(editingConfigJson)
      }
    } catch (e) {
      alert('Formato JSON inválido na Configuração Avançada.')
      return
    }

    const newConfig = { ...parsedConfig, interval_minutes: intervalMinutes }
    await supabase.from('channel_connectors')
      // Quando salva as configuracoes reativa o motor (clear do status de error) 
      // para rodar o sync ou evitar um falso negativo 
      .update({ config: newConfig, external_id: editingExternalId, status: 'active' })
      .eq('id', selected.id)
    setSelected({ ...selected, config: newConfig, external_id: editingExternalId, status: 'active' })
    setEditingConfig(false)
    loadAll()
  }

  async function forceSync() {
    if (!selected) return
    const now = new Date().toISOString()
    await supabase.from('channel_connectors').update({ 
      next_sync_at: now,
      status: 'active' 
    }).eq('id', selected.id)
    setSelected({ ...selected, next_sync_at: now, status: 'active' })
    loadAll()
  }

  async function saveNewConnector(e: React.FormEvent) {
    e.preventDefault()
    const { error } = await supabase.from('channel_connectors').insert({
      business_id: newConn.business_id,
      channel: newConn.channel,
      external_id: newConn.external_id,
      status: 'active',
      config: { interval_minutes: 60 }
    })
    if (error) return alert('Erro ao salvar: ' + error.message)
    setShowCreateModal(false)
    setNewConn({ ...newConn, external_id: '' })
    loadAll()
  }

  async function loadAll() {
    setLoading(true)
    await Promise.all([loadConnectors(), loadStats()])
    setLoading(false)
  }

  async function loadConnectors() {
    const { data } = await supabase
      .from('channel_connectors')
      .select('*, monitored_businesses(name, cnpj)')
      .order('channel')

    setConnectors(data ?? [])

    const { data: bData } = await supabase.from('monitored_businesses').select('id, name')
    setAllBusinesses(bData || [])
    if (bData && bData.length > 0 && !newConn.business_id) {
      setNewConn(prev => ({ ...prev, business_id: bData[0].id }))
    }

    // Mapa business_id → nome
    const bmap: Record<string, string> = {}
    for (const c of data ?? []) {
      if (c.monitored_businesses?.name) {
        bmap[c.business_id] = c.monitored_businesses.name
      }
    }
    setBusinesses(bmap)
  }

  async function loadStats() {
    const { data } = await supabase
      .from('reviews')
      .select('channel, sentiment, dissatisfaction_score, published_at')

    if (!data) return

    const now = Date.now()
    const ms30 = 30 * 24 * 60 * 60 * 1000

    const statsMap: Record<string, ConnectorStats> = {}
    for (const channel of ALL_CHANNELS) {
      const rows = data.filter(r => r.channel === channel)
      const recent = rows.filter(r => now - new Date(r.published_at).getTime() < ms30)
      const neg = rows.filter(r => r.sentiment === 'negative' || r.sentiment === 'critical')
      const scores = rows.filter(r => r.dissatisfaction_score != null).map(r => r.dissatisfaction_score as number)
      statsMap[channel] = {
        channel,
        total: rows.length,
        last30: recent.length,
        negativeRate: rows.length ? Math.round((neg.length / rows.length) * 100) : 0,
        avgScore: scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0,
      }
    }
    setStats(statsMap)
  }

  // Filtro da tabela
  const visibleConnectors = connectors.filter(c => {
    if (filterChannel  && c.channel     !== filterChannel)  return false
    if (filterBusiness && c.business_id !== filterBusiness) return false
    return true
  })

  // Agrupar conectores por canal
  const connectorsByChannel: Record<string, Connector[]> = {}
  for (const c of connectors) {
    if (!connectorsByChannel[c.channel]) connectorsByChannel[c.channel] = []
    connectorsByChannel[c.channel].push(c)
  }

  // Canais sem conector configurado
  const unconfigured = ALL_CHANNELS.filter(ch => !connectorsByChannel[ch])

  const totalActive = connectors.filter(c => c.status === 'active').length
  const totalError = connectors.filter(c => c.status === 'error').length

  return (
    <div>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 className="page-title">Conectores</h1>
          <p className="page-subtitle">
            Status dos 8 canais de coleta · {totalActive} ativos
            {totalError > 0 && <span style={{ color: '#ef4444' }}> · {totalError} com erro</span>}
          </p>
        </div>
        <button className="btn" onClick={() => setShowCreateModal(true)}>+ Novo Conector</button>
      </div>

      {/* ── Cards de status por canal ─────────────────────────── */}
      {loading ? (
        <div className="connector-grid">
          {ALL_CHANNELS.map(ch => (
            <div key={ch} className="card connector-card">
              <div className="skeleton" style={{ width: 40, height: 40, borderRadius: '50%', margin: '0 auto 10px' }} />
              <div className="skeleton" style={{ width: 100, height: 14, margin: '0 auto 8px' }} />
              <div className="skeleton" style={{ width: 60, height: 20, margin: '0 auto' }} />
            </div>
          ))}
        </div>
      ) : (
        <div className="connector-grid" style={{ marginBottom: 32 }}>
          {ALL_CHANNELS.map(channel => {
            const channelConns = connectorsByChannel[channel] || []
            const primaryConn = channelConns.find(c => c.status === 'active') || channelConns[0]
            const st = stats[channel]

            if (!primaryConn) {
              // Não configurado
              return (
                <div key={channel} className="card connector-card" style={{ opacity: 0.5 }}>
                  <div className="connector-icon">{CHANNEL_ICONS[channel as SourceChannel] || '📱'}</div>
                  <div className="connector-name">{CHANNEL_LABELS[channel as SourceChannel] || channel}</div>
                  <div className="connector-status status-pending">⬜ Não configurado</div>
                </div>
              )
            }

            return (
              <div
                key={channel}
                className="card connector-card"
                style={{ cursor: 'pointer' }}
                onClick={() => setSelected(primaryConn)}
              >
                <div className="connector-icon">{CHANNEL_ICONS[channel as SourceChannel] || '📱'}</div>
                <div className="connector-name">{CHANNEL_LABELS[channel as SourceChannel] || channel}</div>

                <div className={`connector-status status-${primaryConn.status}`}>
                  {STATUS_DOT[primaryConn.status]} {STATUS_LABEL[primaryConn.status]}
                </div>

                {primaryConn.last_sync_at && (
                  <div className="connector-last-sync">
                    Sync: {timeAgo(primaryConn.last_sync_at)}
                  </div>
                )}

                {primaryConn.status === 'error' && primaryConn.error_message && (
                  <div className="connector-error" title={primaryConn.error_message}>
                    ⚠️ {primaryConn.error_message}
                  </div>
                )}

                {st && st.total > 0 && (
                  <div style={{ marginTop: 10, borderTop: '1px solid var(--border)', paddingTop: 10 }}>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>
                      📦 {st.total} reviews · {st.last30} últimos 30d
                    </div>
                    <div style={{ fontSize: 11, display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
                      <span style={{ color: st.negativeRate > 30 ? '#ef4444' : '#10b981' }}>
                        {st.negativeRate}% neg.
                      </span>
                      <span style={{ color: 'var(--text-muted)' }}>·</span>
                      <span style={{ color: 'var(--text-muted)' }}>score ~{st.avgScore}</span>
                    </div>
                  </div>
                )}

                {channelConns.length > 1 && (
                  <div style={{ fontSize: 10, color: 'var(--accent)', marginTop: 6 }}>
                    +{channelConns.length - 1} empresa{channelConns.length > 2 ? 's' : ''}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* ── Detalhes dos conectores em tabela ─────────────────── */}
      {connectors.length > 0 && (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
            <div className="section-title" style={{ marginBottom: 0 }}>
              📋 Todos os conectores configurados
              <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--text-muted)', marginLeft: 8 }}>
                ({visibleConnectors.length} de {connectors.length})
              </span>
            </div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <select
                value={filterChannel}
                onChange={e => setFilterChannel(e.target.value)}
                style={{ padding: '6px 12px', background: 'var(--bg-darker)', border: '1px solid var(--border)', color: 'var(--text-primary)', borderRadius: 6, fontSize: 12, cursor: 'pointer' }}
              >
                <option value=''>Todos os canais</option>
                {ALL_CHANNELS.map(ch => (
                  <option key={ch} value={ch}>{CHANNEL_ICONS[ch as SourceChannel]} {CHANNEL_LABELS[ch as SourceChannel] || ch}</option>
                ))}
              </select>
              <select
                value={filterBusiness}
                onChange={e => setFilterBusiness(e.target.value)}
                style={{ padding: '6px 12px', background: 'var(--bg-darker)', border: '1px solid var(--border)', color: 'var(--text-primary)', borderRadius: 6, fontSize: 12, cursor: 'pointer' }}
              >
                <option value=''>Todos os assinantes</option>
                {allBusinesses.map(b => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            </div>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  {['Canal', 'Empresa', 'Status', 'Último Sync', 'Próximo Sync', 'ID Externo'].map(h => (
                    <th key={h} style={{ padding: '10px 20px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visibleConnectors.length === 0 ? (
                  <tr><td colSpan={6} style={{ padding: '24px 20px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>Nenhum conector encontrado com os filtros selecionados.</td></tr>
                ) : visibleConnectors.map(c => (
                  <tr
                    key={c.id}
                    style={{
                      borderBottom: '1px solid var(--border)',
                      cursor: 'pointer',
                      transition: 'background 0.15s',
                    }}
                    onClick={() => setSelected(c)}
                    onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.03)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                  >
                    <td style={{ padding: '12px 20px', fontSize: 13 }}>
                      {CHANNEL_ICONS[c.channel]} {CHANNEL_LABELS[c.channel]}
                    </td>
                    <td style={{ padding: '12px 20px', fontSize: 13, color: 'var(--text-secondary)' }}>
                      {businesses[c.business_id] || '—'}
                    </td>
                    <td style={{ padding: '12px 20px' }}>
                      <span className={`connector-status status-${c.status}`}>
                        {STATUS_DOT[c.status]} {STATUS_LABEL[c.status]}
                      </span>
                    </td>
                    <td style={{ padding: '12px 20px', fontSize: 12, color: 'var(--text-muted)' }}>
                      {c.last_sync_at ? timeAgo(c.last_sync_at) : '—'}
                    </td>
                    <td style={{ padding: '12px 20px', fontSize: 12, color: 'var(--text-muted)' }}>
                      {c.next_sync_at ? timeAgo(c.next_sync_at) : '—'}
                    </td>
                    <td style={{ padding: '12px 20px', fontSize: 11, color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                      {c.external_id?.slice(0, 30) || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Modal de detalhes do conector ───────────── */}
      {selected && (
        <div className="modal-overlay" onClick={() => setSelected(null)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-title">
              <span>{CHANNEL_ICONS[selected.channel]} {CHANNEL_LABELS[selected.channel]}</span>
              <button className="modal-close" onClick={() => setSelected(null)}>✕</button>
            </div>

            <div className="modal-section" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <div className="modal-label">Status</div>
                <div className={`connector-status status-${selected.status}`} style={{ display: 'inline-flex', fontSize: 13, padding: '4px 14px' }}>
                  {STATUS_DOT[selected.status]} {STATUS_LABEL[selected.status]}
                </div>
              </div>
              <button className="btn" style={{ background: 'rgba(99,102,241,0.1)', color: '#a5b4fc', border: '1px solid rgba(99,102,241,0.2)' }} onClick={forceSync}>
                Forçar Busca
              </button>
            </div>

            {businesses[selected.business_id] && (
              <div className="modal-section">
                <div className="modal-label">Empresa</div>
                <div className="modal-value modal-hl">{businesses[selected.business_id]}</div>
              </div>
            )}

            {!editingConfig ? (
              selected.external_id && (
                <div className="modal-section">
                  <div className="modal-label">ID Externo</div>
                  <div className="modal-value" style={{ fontFamily: 'monospace', fontSize: 12, wordBreak: 'break-all' }}>
                    {selected.external_id}
                  </div>
                </div>
              )
            ) : (
              <div className="modal-section" style={{ background: 'rgba(255,255,255,0.03)', borderRadius: 8, padding: 12 }}>
                <label className="modal-label">ID Externo do Canal</label>
                <input 
                  type="text" 
                  value={editingExternalId}
                  onChange={e => setEditingExternalId(e.target.value)}
                  style={{ width: '100%', padding: '6px 10px', marginTop: 4, background: 'var(--bg-dark)', border: '1px solid var(--border)', color: 'white', borderRadius: 4, fontFamily: 'monospace' }}
                  placeholder="Ex: nubank, place_id..."
                />
                <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginTop: 8 }}>
                  O código rastreador da empresa na URL ou base oficial da plataforma.
                </div>
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <div className="modal-section">
                <div className="modal-label">Último Sync</div>
                <div className="modal-value">{selected.last_sync_at ? formatDate(selected.last_sync_at) : 'Nunca'}</div>
              </div>
              <div className="modal-section">
                <div className="modal-label">Próximo Sync</div>
                <div className="modal-value">{selected.next_sync_at ? formatDate(selected.next_sync_at) : '—'}</div>
              </div>
            </div>

            {selected.error_message && (
              <div className="modal-section">
                <div className="modal-label">Erro</div>
                <div style={{ padding: '10px 14px', background: 'rgba(239,68,68,0.1)', borderRadius: 8, fontSize: 12, color: '#fca5a5', fontFamily: 'monospace', lineHeight: 1.6 }}>
                  {selected.error_message}
                </div>
              </div>
            )}

            {stats[selected.channel] && (
              <div className="modal-section">
                <div className="modal-label">Estatísticas de reviews</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
                  {[
                    { label: 'Total coletado', value: stats[selected.channel].total },
                    { label: 'Últimos 30 dias', value: stats[selected.channel].last30 },
                    { label: 'Taxa negativa', value: `${stats[selected.channel].negativeRate}%` },
                    { label: 'Score médio', value: `${stats[selected.channel].avgScore}/100` },
                  ].map(({ label, value }) => (
                    <div key={label} style={{ background: 'rgba(255,255,255,0.04)', borderRadius: 8, padding: '10px 14px' }}>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>{label}</div>
                      <div style={{ fontSize: 18, fontWeight: 700, fontFamily: 'Outfit, sans-serif', color: 'var(--text-primary)' }}>{value}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="modal-section" style={{ borderTop: '1px solid var(--border)', paddingTop: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <div className="modal-label" style={{ margin: 0 }}>Configuração do Motor</div>
                {!editingConfig ? (
                  <button className="btn" style={{ padding: '4px 8px', fontSize: 11 }} onClick={() => setEditingConfig(true)}>Editar Configurações</button>
                ) : (
                  <button className="btn" style={{ padding: '4px 8px', fontSize: 11, background: 'var(--accent)' }} onClick={updateConfig}>Salvar</button>
                )}
              </div>
              
              {editingConfig ? (
                <div style={{ background: 'rgba(255,255,255,0.03)', borderRadius: 8, padding: 12 }}>
                  <label style={{ fontSize: 11, color: 'var(--text-muted)' }}>Intervalo de Busca (minutos)</label>
                  <input 
                    type="number" min="5" step="5"
                    value={intervalMinutes}
                    onChange={e => setIntervalMinutes(Number(e.target.value))}
                    style={{ width: '100%', padding: '6px 10px', marginTop: 4, background: 'var(--bg-dark)', border: '1px solid var(--border)', color: 'white', borderRadius: 4 }}
                  />
                  <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginTop: 8 }}>
                    Define de quanto em quanto tempo o motor visita a API para buscar reivews.
                  </div>

                  <div style={{ marginTop: 12 }}>
                    <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'flex', justifyContent: 'space-between' }}>
                      <span>Configuração Avançada (Objeto JSON)</span>
                      <span style={{color: '#f59e0b'}}>{editingConfigJson.trim() ? '' : 'Opcional'}</span>
                    </label>
                    <textarea 
                      value={editingConfigJson}
                      onChange={e => setEditingConfigJson(e.target.value)}
                      style={{ 
                        width: '100%', padding: '8px 10px', marginTop: 4, 
                        background: 'rgba(0,0,0,0.3)', border: '1px solid var(--border)', 
                        color: '#a5b4fc', borderRadius: 4, fontFamily: 'monospace', 
                        fontSize: 11, minHeight: 80, resize: 'vertical',
                        whiteSpace: 'pre'
                      }}
                      placeholder='{&#10;  "keywords": ["SuaMarca"]&#10;}'
                    />
                    <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginTop: 4, lineHeight: 1.4 }}>
                      Ex Node: Para Reddit insira <span style={{color:'white'}}>&#123;"keywords": ["SuaMarca"]&#125;</span><br/>
                      Para ConsumidorGov insira <span style={{color:'white'}}>&#123;"resource_url": "URL_DO_CSV"&#125;</span>
                    </div>
                  </div>
                </div>
              ) : (
                <div style={{ background: 'rgba(255,255,255,0.03)', borderRadius: 8, padding: '10px 14px', display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>Frequência de Atualização:</span>
                  <span style={{ fontSize: 13, fontWeight: 'bold' }}>A cada {intervalMinutes} min</span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Modal de Novo Conector ───────────── */}
      {showCreateModal && (
        <div className="modal-overlay" onClick={() => setShowCreateModal(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-title">
              <span>Configurar Novo Conector</span>
              <button className="modal-close" onClick={() => setShowCreateModal(false)}>✕</button>
            </div>
            <form onSubmit={saveNewConnector}>
              <div className="modal-section">
                <label className="modal-label">Empresa Cliente</label>
                <select required value={newConn.business_id} onChange={e => setNewConn({...newConn, business_id: e.target.value})} style={{ width: '100%', padding: '10px 14px', background: 'var(--bg-dark)', border: '1px solid var(--border)', color: 'white', borderRadius: 6 }}>
                  <option value="" disabled>Selecione uma empresa...</option>
                  {allBusinesses.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </div>
              <div className="modal-section">
                <label className="modal-label">Canal Fonte</label>
                <select required value={newConn.channel} onChange={e => setNewConn({...newConn, channel: e.target.value})} style={{ width: '100%', padding: '10px 14px', background: 'var(--bg-dark)', border: '1px solid var(--border)', color: 'white', borderRadius: 6 }}>
                  {ALL_CHANNELS.map(c => <option key={c} value={c}>{CHANNEL_LABELS[c as SourceChannel] || c}</option>)}
                </select>
              </div>
              <div className="modal-section">
                <label className="modal-label">ID Externo / URL Slug</label>
                <input required value={newConn.external_id} onChange={e => setNewConn({...newConn, external_id: e.target.value})} placeholder="ex: localiza-rent-a-car" style={{ width: '100%', padding: '10px 14px', background: 'var(--bg-dark)', border: '1px solid var(--border)', color: 'white', borderRadius: 6 }} />
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>O identificador da empresa na url do canal.</div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 24 }}>
                <button type="button" className="btn" style={{ background: 'transparent' }} onClick={() => setShowCreateModal(false)}>Cancelar</button>
                <button type="submit" className="btn" style={{ background: 'var(--accent)' }}>Salvar Conector</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
