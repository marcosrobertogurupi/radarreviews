import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { AlertEvent } from '../lib/supabase'
import { CHANNEL_LABELS, CHANNEL_ICONS, timeAgo } from '../lib/utils'
import { CheckCircle, ExternalLink } from 'lucide-react'

const CONDITION_LABELS: Record<string, string> = {
  rating_drop:      '⭐ Nota baixa',
  negative_surge:   '🔴 Aumento de negativos',
  critical_review:  '🚨 Review crítico',
  topic_billing:    '💳 Problema financeiro',
  reclame_aqui_new: '📣 Novo Reclame Aqui',
  keyword:          '🔍 Palavra-chave detectada',
  volume_spike:     '📈 Spike de volume',
}

interface Props { tenantId: string }

export default function Alerts({ tenantId }: Props) {
  const [alerts, setAlerts]   = useState<AlertEvent[]>([])
  const [tab, setTab]         = useState<'pending' | 'resolved'>('pending')
  const [loading, setLoading] = useState(true)
  const [resolving, setResolving] = useState<string | null>(null)

  async function load() {
    if (!tenantId) return
    setLoading(true)

    // alert_events não tem tenant_id direto — filtrar via business_id do tenant
    const { data: bizData } = await supabase
      .from('monitored_businesses')
      .select('id')
      .eq('tenant_id', tenantId)
    const bizIds = (bizData ?? []).map(b => b.id)

    if (bizIds.length === 0) {
      setAlerts([])
      setLoading(false)
      return
    }

    const { data } = await supabase
      .from('alert_events')
      .select('*, alert_rules(name,condition_type), monitored_businesses(name)')
      .in('business_id', bizIds)
      .eq('notified', tab === 'resolved')
      .order('triggered_at', { ascending: false })
      .limit(100)
    setAlerts(data ?? [])
    setLoading(false)
  }

  useEffect(() => { if (tenantId) load() }, [tab, tenantId])
  useEffect(() => { const h = () => load(); window.addEventListener('refresh_data', h); return () => window.removeEventListener('refresh_data', h) }, [tab, tenantId])

  async function resolve(id: string) {
    setResolving(id)
    await supabase.from('alert_events').update({ notified: true }).eq('id', id)
    setAlerts(prev => prev.filter(a => a.id !== id))
    setResolving(null)
  }

  const conditionType = (a: AlertEvent) => a.alert_rules?.condition_type ?? a.detail.condition_type ?? ''
  const isCritical = (a: AlertEvent) => conditionType(a) === 'critical_review' || (a.detail.review_dissatisfaction_score ?? 0) >= 80

  return (
    <div>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1 className="page-title">Alertas</h1>
          <p className="page-subtitle">Notificações de reviews que exigem atenção da sua equipe.</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {(['pending', 'resolved'] as const).map(t => (
            <button
              key={t}
              className={`btn ${tab === t ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setTab(t)}
            >
              {t === 'pending' ? '🔔 Pendentes' : '✅ Resolvidos'}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {Array(4).fill(0).map((_, i) => <div key={i} className="skeleton" style={{ height: 80 }} />)}
        </div>
      ) : alerts.length === 0 ? (
        <div className="card empty-state">
          <div className="empty-state-icon">{tab === 'pending' ? '✅' : '📋'}</div>
          <div className="empty-state-text">
            {tab === 'pending' ? 'Nenhum alerta pendente — ótimo!' : 'Nenhum alerta resolvido ainda.'}
          </div>
        </div>
      ) : (
        <div className="alert-list">
          {alerts.map(a => (
            <div key={a.id} className={`card alert-item ${isCritical(a) ? 'critical' : ''} ${tab === 'resolved' ? 'resolved' : ''}`}>
              <div className="alert-header">
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <span className="alert-rule">{a.alert_rules?.name ?? 'Alerta'}</span>
                  <span style={{ fontSize: 11, background: 'rgba(255,255,255,0.06)', padding: '2px 8px', borderRadius: 99, color: 'var(--text-muted)' }}>
                    {CONDITION_LABELS[conditionType(a)] ?? conditionType(a)}
                  </span>
                  {a.channel && (
                    <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                      {CHANNEL_ICONS[a.channel]} {CHANNEL_LABELS[a.channel]}
                    </span>
                  )}
                  {a.monitored_businesses?.name && (
                    <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>· {a.monitored_businesses.name}</span>
                  )}
                </div>
                <span className="alert-time">{timeAgo(a.triggered_at)}</span>
              </div>

              {/* Resumo do review que disparou */}
              {(a.detail.sentiment_summary || a.detail.review_body_preview) && (
                <div className="alert-reason" style={{ marginBottom: 8 }}>
                  {a.detail.sentiment_summary || a.detail.review_body_preview}
                </div>
              )}

              {/* Ação recomendada */}
              {a.detail.alert_reason && (
                <div style={{ background: 'rgba(239,68,68,0.07)', border: '1px solid rgba(239,68,68,0.15)', borderRadius: 8, padding: '8px 12px', fontSize: 12.5, color: 'var(--text-secondary)', marginBottom: 8 }}>
                  <strong style={{ color: '#fca5a5' }}>Ação recomendada:</strong> {a.detail.alert_reason}
                </div>
              )}

              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                {a.detail.review_author && (
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>👤 {a.detail.review_author}</span>
                )}
                {a.detail.review_url && (
                  <a href={a.detail.review_url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, color: 'var(--accent-2)', display: 'flex', alignItems: 'center', gap: 4, textDecoration: 'none' }}>
                    <ExternalLink size={10} /> Ver review
                  </a>
                )}
                {tab === 'pending' && (
                  <button
                    className="btn btn-ghost"
                    style={{ marginLeft: 'auto', fontSize: 12, padding: '4px 12px', display: 'flex', alignItems: 'center', gap: 6 }}
                    disabled={resolving === a.id}
                    onClick={() => resolve(a.id)}
                  >
                    <CheckCircle size={13} />
                    {resolving === a.id ? 'Resolvendo...' : 'Marcar como resolvido'}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
