import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { AlertEvent } from '../lib/supabase'
import { CHANNEL_LABELS, CHANNEL_ICONS, SENTIMENT_LABELS, formatDate, timeAgo, scoreToEmoji } from '../lib/utils'

// ──────────────────────────────────────────────────────────────
// Página Alertas
// ──────────────────────────────────────────────────────────────

const CONDITION_LABELS: Record<string, string> = {
  rating_drop:      '⭐ Nota baixa',
  negative_surge:   '🔴 Sentimento negativo',
  critical_review:  '🚨 Review crítico',
  topic_billing:    '💳 Problema financeiro',
  reclame_aqui_new: '📣 Novo Reclame Aqui',
  keyword:          '🔍 Palavra-chave',
  volume_spike:     '📈 Spike de volume',
}

const CONDITION_URGENCY: Record<string, 'low' | 'medium' | 'high' | 'critical'> = {
  rating_drop:      'medium',
  negative_surge:   'high',
  critical_review:  'critical',
  topic_billing:    'critical',
  reclame_aqui_new: 'high',
  keyword:          'medium',
  volume_spike:     'high',
}

const URGENCY_COLOR: Record<string, string> = {
  low:      '#10b981',
  medium:   '#f59e0b',
  high:     '#ef4444',
  critical: '#dc2626',
}

import type { TenantOption } from '../App'

interface Props {
  tenants: TenantOption[]
  selectedTenantId: string
  onTenantChange: (id: string) => void
}

export default function Alerts({ tenants, selectedTenantId, onTenantChange }: Props) {
  const [alerts, setAlerts] = useState<AlertEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'pending' | 'resolved'>('pending')
  const [resolving, setResolving] = useState<string | null>(null)

  useEffect(() => {
    loadAlerts()
    const handleRefresh = () => loadAlerts()
    window.addEventListener('refresh_data', handleRefresh)
    return () => window.removeEventListener('refresh_data', handleRefresh)
  }, [tab, selectedTenantId])

  async function loadAlerts() {
    setLoading(true)

    let query = supabase
      .from('alert_events')
      .select('*, alert_rules(name, condition_type), monitored_businesses(name)')
      .order('triggered_at', { ascending: false })
      .limit(100)

    if (tab === 'pending') query = query.eq('notified', false)
    else                   query = query.eq('notified', true)

    if (selectedTenantId) query = query.eq('tenant_id', selectedTenantId)

    const { data } = await query
    setAlerts(data ?? [])
    setLoading(false)
  }

  async function markResolved(id: string) {
    setResolving(id)
    await supabase
      .from('alert_events')
      .update({ notified: true })
      .eq('id', id)

    setAlerts(prev => prev.filter(a => a.id !== id))
    setResolving(null)
  }

  // ── Stats ────────────────────────────────────────────────────
  const criticalCount = alerts.filter(a => {
    const ct = a.alert_rules?.condition_type || a.detail?.condition_type
    return CONDITION_URGENCY[ct || ''] === 'critical'
  }).length

  const highCount = alerts.filter(a => {
    const ct = a.alert_rules?.condition_type || a.detail?.condition_type
    return CONDITION_URGENCY[ct || ''] === 'high'
  }).length

  return (
    <div>
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <h1 className="page-title">Central de Alertas</h1>
            <p className="page-subtitle">Monitore e responda a reviews críticos rapidamente</p>
            <select
              value={selectedTenantId}
              onChange={e => onTenantChange(e.target.value)}
              style={{ marginTop: 10, padding: '6px 12px', background: 'var(--bg-darker)', border: '1px solid var(--border)', color: 'var(--text-primary)', borderRadius: 6, fontSize: 13, cursor: 'pointer' }}
            >
              <option value=''>Todos os assinantes</option>
              {tenants.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          {tab === 'pending' && alerts.length > 0 && (
            <div style={{ display: 'flex', gap: 12 }}>
              {criticalCount > 0 && (
                <div className="card" style={{ padding: '10px 16px', borderColor: 'rgba(220,38,38,0.4)' }}>
                  <span style={{ color: '#ff4d4d', fontWeight: 700, fontSize: 24, lineHeight: 1 }}>{criticalCount}</span>
                  <br />
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>críticos</span>
                </div>
              )}
              {highCount > 0 && (
                <div className="card" style={{ padding: '10px 16px', borderColor: 'rgba(239,68,68,0.3)' }}>
                  <span style={{ color: '#ef4444', fontWeight: 700, fontSize: 24, lineHeight: 1 }}>{highCount}</span>
                  <br />
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>urgentes</span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 2, marginBottom: 20, background: 'rgba(255,255,255,0.03)', padding: 4, borderRadius: 10, width: 'fit-content' }}>
        {(['pending', 'resolved'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              padding: '8px 20px',
              borderRadius: 8,
              border: 'none',
              cursor: 'pointer',
              fontFamily: 'Inter, sans-serif',
              fontSize: 13,
              fontWeight: 500,
              transition: 'all 0.2s',
              background: tab === t ? 'rgba(99,102,241,0.2)' : 'transparent',
              color: tab === t ? '#a5b4fc' : 'var(--text-muted)',
            }}
          >
            {t === 'pending' ? '🔔 Pendentes' : '✅ Resolvidos'}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="alert-list">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="card" style={{ padding: 16 }}>
              <div className="skeleton" style={{ width: '60%', height: 16, marginBottom: 10 }} />
              <div className="skeleton" style={{ width: '90%', height: 13 }} />
            </div>
          ))}
        </div>
      ) : alerts.length === 0 ? (
        <div className="card empty-state">
          <div className="empty-state-icon">{tab === 'pending' ? '✅' : '📭'}</div>
          <div className="empty-state-text">
            {tab === 'pending' ? 'Nenhum alerta pendente! Tudo tranquilo.' : 'Nenhum alerta resolvido ainda.'}
          </div>
        </div>
      ) : (
        <div className="alert-list">
          {alerts.map(alert => {
            const ct = alert.alert_rules?.condition_type || alert.detail?.condition_type || ''
            const urgency = CONDITION_URGENCY[ct] || 'low'
            const urgencyColor = URGENCY_COLOR[urgency]
            const isCritical = urgency === 'critical'
            const score = alert.detail?.review_dissatisfaction_score

            return (
              <div
                key={alert.id}
                className={`card alert-item ${isCritical ? 'critical' : ''}`}
                style={{ borderLeftColor: urgencyColor }}
              >
                <div className="alert-header">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{
                      fontSize: 11, fontWeight: 700, padding: '2px 8px',
                      borderRadius: 99, background: `${urgencyColor}20`,
                      color: urgencyColor, border: `1px solid ${urgencyColor}40`
                    }}>
                      {CONDITION_LABELS[ct] || ct}
                    </span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                        {CHANNEL_ICONS[alert.channel]} {CHANNEL_LABELS[alert.channel]}
                      </span>
                      {alert.monitored_businesses?.name && (
                        <>
                          <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>•</span>
                          <span style={{ fontSize: 11, color: '#a5b4fc', fontWeight: 600 }}>
                            🏢 {alert.monitored_businesses.name}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span className="alert-time">{timeAgo(alert.triggered_at)}</span>
                    {tab === 'pending' && (
                      <button
                        onClick={() => markResolved(alert.id)}
                        disabled={resolving === alert.id}
                        style={{
                          background: 'rgba(16,185,129,0.12)',
                          border: '1px solid rgba(16,185,129,0.25)',
                          color: '#10b981',
                          padding: '3px 10px',
                          borderRadius: 6,
                          fontSize: 11,
                          cursor: 'pointer',
                          fontFamily: 'Inter, sans-serif',
                        }}
                      >
                        {resolving === alert.id ? '...' : '✓ Resolver'}
                      </button>
                    )}
                  </div>
                </div>

                {alert.alert_rules?.name && (
                  <div className="alert-rule" style={{ marginBottom: 6 }}>{alert.alert_rules.name}</div>
                )}

                {alert.detail?.alert_reason && (
                  <div className="alert-reason" style={{ marginBottom: 8 }}>
                    <strong>⚠️ Ação recomendada:</strong> {alert.detail.alert_reason}
                  </div>
                )}

                {alert.detail?.sentiment_summary && (
                  <div style={{ fontSize: 12, color: 'var(--accent-2)', marginBottom: 8, lineHeight: 1.5 }}>
                    🤖 {alert.detail.sentiment_summary}
                  </div>
                )}

                {alert.detail?.review_body_preview && (
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', fontStyle: 'italic', lineHeight: 1.5, marginBottom: 8 }}>
                    "{alert.detail.review_body_preview.slice(0, 150)}..."
                  </div>
                )}

                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
                  {alert.detail?.review_sentiment && (
                    <span className={`badge badge-${alert.detail.review_sentiment}`}>
                      {scoreToEmoji(score, alert.detail.review_sentiment as any)} {SENTIMENT_LABELS[alert.detail.review_sentiment as keyof typeof SENTIMENT_LABELS] || alert.detail.review_sentiment}
                    </span>
                  )}
                  {score != null && (
                    <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>score: {score}/100</span>
                  )}
                  {alert.detail?.review_author && (
                    <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                      👤 {alert.detail.review_author}
                    </span>
                  )}
                  {alert.detail?.review_url && (
                    <a
                      href={alert.detail.review_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ fontSize: 11, color: 'var(--accent)', textDecoration: 'none' }}
                    >
                      🔗 Ver original
                    </a>
                  )}
                  {tab === 'resolved' && (
                    <span style={{ fontSize: 11, color: '#10b981', marginLeft: 'auto' }}>
                      ✅ Resolvido
                    </span>
                  )}
                </div>

                <div style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: 8 }}>
                  {formatDate(alert.triggered_at)} · {alert.detail?.analysis_method === 'gemini' ? '🧠 Analisado por Gemini' : '⚙️ Análise heurística'}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
