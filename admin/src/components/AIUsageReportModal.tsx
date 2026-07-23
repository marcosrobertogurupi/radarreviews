import { useEffect, useState } from 'react'
import { X, Bot, RefreshCw, Lock, Unlock, Zap, DollarSign } from 'lucide-react'
import { API_URL } from '../lib/utils'
import { supabase } from '../lib/supabase'

interface TenantAIReport {
  id: string
  name: string
  slug: string
  plan: string
  quota_limit: number
  quota_used: number
  ai_blocked: boolean
  is_active: boolean
  total_requests: number
  total_prompt_tokens: number
  total_completion_tokens: number
  total_tokens: number
  estimated_cost_usd: number
}

interface Summary {
  total_tenants: number
  total_requests: number
  total_tokens: number
  total_cost_usd: number
}

interface Props {
  isOpen: boolean
  onClose: () => void
  onUpdateSuccess: () => void
}

export function AIUsageReportModal({ isOpen, onClose, onUpdateSuccess }: Props) {
  const [report, setReport] = useState<TenantAIReport[]>([])
  const [summary, setSummary] = useState<Summary | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const [editingTenant, setEditingTenant] = useState<TenantAIReport | null>(null)
  const [newQuota, setNewQuota] = useState(500000)
  const [newBlocked, setNewBlocked] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (isOpen) fetchReport()
  }, [isOpen])

  async function fetchReport() {
    setLoading(true)
    setError('')
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(`${API_URL}/api/admin/tenants/ai-usage`, {
        headers: { Authorization: `Bearer ${session?.access_token}` },
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setReport(data.report || [])
      setSummary(data.summary || null)
    } catch (err: any) {
      setError(err.message || 'Erro ao carregar relatório de IA')
    } finally {
      setLoading(false)
    }
  }

  async function handleSaveTenantConfig(e: React.FormEvent) {
    e.preventDefault()
    if (!editingTenant) return
    setSaving(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(`${API_URL}/api/admin/tenants/${editingTenant.id}/ai-config`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({
          ai_quota_limit: Number(newQuota),
          ai_blocked: newBlocked,
        }),
      })

      if (!res.ok) throw new Error('Falha ao atualizar cota de IA')
      setEditingTenant(null)
      fetchReport()
      onUpdateSuccess()
    } catch (err: any) {
      alert(err.message || 'Erro ao salvar configuração')
    } finally {
      setSaving(false)
    }
  }

  async function handleResetQuota(tenantId: string) {
    if (!confirm('Deseja realmente zerar a cota de uso de IA deste tenant para o ciclo atual?')) return
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(`${API_URL}/api/admin/tenants/${tenantId}/ai-config`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({ reset_quota: true }),
      })
      if (!res.ok) throw new Error('Erro ao zerar cota')
      fetchReport()
      onUpdateSuccess()
    } catch (err: any) {
      alert(err.message || 'Erro ao zerar cota')
    }
  }

  if (!isOpen) return null

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-content"
        onClick={e => e.stopPropagation()}
        style={{ width: '90%', maxWidth: 1000, maxHeight: '90vh', overflowY: 'auto' }}
      >
        <div className="modal-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Bot size={20} color="#6366f1" /> Relatório Demonstrativo de IA e Gestão de Cotas
          </span>
          <button className="modal-close" onClick={onClose}><X size={18} /></button>
        </div>

        {/* Global Summary Cards */}
        {summary && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginBottom: 20 }}>
            <div style={{ padding: 14, background: 'rgba(99,102,241,0.08)', borderRadius: 8, border: '1px solid rgba(99,102,241,0.2)' }}>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Custo Total Estimado</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: '#10b981', display: 'flex', alignItems: 'center', gap: 4 }}>
                <DollarSign size={18} /> US$ {summary.total_cost_usd.toFixed(4)}
              </div>
            </div>

            <div style={{ padding: 14, background: 'rgba(6,182,212,0.08)', borderRadius: 8, border: '1px solid rgba(6,182,212,0.2)' }}>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Tokens Consumidos</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: '#06b6d4', display: 'flex', alignItems: 'center', gap: 4 }}>
                <Zap size={18} /> {summary.total_tokens.toLocaleString('pt-BR')}
              </div>
            </div>

            <div style={{ padding: 14, background: 'rgba(168,85,247,0.08)', borderRadius: 8, border: '1px solid rgba(168,85,247,0.2)' }}>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Total de Chamadas IA</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: '#a855f7' }}>
                {summary.total_requests.toLocaleString('pt-BR')} reqs
              </div>
            </div>
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
            Consumo individual e permissões de acesso ao Reputei IA por assinante:
          </div>
          <button onClick={fetchReport} className="btn btn-ghost" style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
            <RefreshCw size={14} className={loading ? 'spin' : ''} /> Atualizar
          </button>
        </div>

        {error && (
          <div style={{ color: '#ef4444', padding: 10, background: 'rgba(239,68,68,0.1)', borderRadius: 6, marginBottom: 16 }}>
            {error}
          </div>
        )}

        {/* Table of Tenants */}
        <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: 'var(--bg-darker)', textAlign: 'left', borderBottom: '1px solid var(--border)' }}>
                <th style={{ padding: '10px 12px' }}>Assinante</th>
                <th style={{ padding: '10px 12px' }}>Status IA</th>
                <th style={{ padding: '10px 12px' }}>Uso da Cota (Tokens)</th>
                <th style={{ padding: '10px 12px' }}>Chamadas</th>
                <th style={{ padding: '10px 12px' }}>Custo Est. (USD)</th>
                <th style={{ padding: '10px 12px', textAlign: 'right' }}>Ações</th>
              </tr>
            </thead>
            <tbody>
              {report.map(t => {
                const pct = Math.min(100, Math.round((t.quota_used / Math.max(1, t.quota_limit)) * 100))
                return (
                  <tr key={t.id} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '10px 12px' }}>
                      <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{t.name}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{t.slug} • Plano: {t.plan}</div>
                    </td>
                    <td style={{ padding: '10px 12px' }}>
                      {t.ai_blocked ? (
                        <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 99, background: 'rgba(239,68,68,0.15)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.3)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          <Lock size={12} /> Bloqueado
                        </span>
                      ) : (
                        <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 99, background: 'rgba(16,185,129,0.15)', color: '#10b981', border: '1px solid rgba(16,185,129,0.3)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          <Unlock size={12} /> Ativo
                        </span>
                      )}
                    </td>
                    <td style={{ padding: '10px 12px', minWidth: 180 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 4 }}>
                        <span>{t.quota_used.toLocaleString('pt-BR')} / {t.quota_limit.toLocaleString('pt-BR')}</span>
                        <span>{pct}%</span>
                      </div>
                      <div style={{ height: 6, background: 'rgba(255,255,255,0.06)', borderRadius: 3, overflow: 'hidden' }}>
                        <div style={{
                          height: '100%',
                          width: `${pct}%`,
                          background: pct > 90 ? '#ef4444' : pct > 75 ? '#f59e0b' : '#6366f1',
                          borderRadius: 3
                        }} />
                      </div>
                    </td>
                    <td style={{ padding: '10px 12px' }}>
                      {t.total_requests.toLocaleString('pt-BR')}
                    </td>
                    <td style={{ padding: '10px 12px', fontWeight: 600, color: t.estimated_cost_usd > 0 ? '#10b981' : 'var(--text-muted)' }}>
                      US$ {t.estimated_cost_usd.toFixed(4)}
                    </td>
                    <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
                        <button
                          className="btn btn-ghost"
                          style={{ padding: '4px 8px', fontSize: 11 }}
                          onClick={() => {
                            setEditingTenant(t)
                            setNewQuota(t.quota_limit)
                            setNewBlocked(t.ai_blocked)
                          }}
                        >
                          Editar Cota
                        </button>
                        <button
                          className="btn btn-ghost"
                          style={{ padding: '4px 8px', fontSize: 11, color: '#f59e0b' }}
                          onClick={() => handleResetQuota(t.id)}
                          title="Zerar o uso de tokens no mês"
                        >
                          Zerar
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {/* Modal de Edição de Cota */}
        {editingTenant && (
          <div className="modal-overlay" onClick={() => setEditingTenant(null)}>
            <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: 450 }}>
              <div className="modal-title">
                <span>Editar Cota de IA: {editingTenant.name}</span>
                <button className="modal-close" onClick={() => setEditingTenant(null)}><X size={18} /></button>
              </div>

              <form onSubmit={handleSaveTenantConfig}>
                <div style={{ marginBottom: 16 }}>
                  <label className="modal-label">Limite Mensal de Tokens</label>
                  <input
                    type="number"
                    value={newQuota}
                    onChange={e => setNewQuota(Number(e.target.value))}
                    className="modal-input"
                    style={{ width: '100%', padding: '8px 12px', background: 'var(--bg-darker)', border: '1px solid var(--border)', color: 'white', borderRadius: 4 }}
                    step={50000}
                    min={0}
                  />
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                    Padrão: 500.000 tokens (~$0.05 a $0.40/mês dependendo do modelo)
                  </div>
                </div>

                <div style={{ marginBottom: 20, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input
                    type="checkbox"
                    id="ai_blocked_check"
                    checked={newBlocked}
                    onChange={e => setNewBlocked(e.target.checked)}
                    style={{ width: 16, height: 16, cursor: 'pointer' }}
                  />
                  <label htmlFor="ai_blocked_check" style={{ fontSize: 13, color: 'var(--text-primary)', cursor: 'pointer' }}>
                    Bloquear acesso ao Reputei IA para este assinante
                  </label>
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                  <button type="button" className="btn btn-ghost" onClick={() => setEditingTenant(null)}>
                    Cancelar
                  </button>
                  <button type="submit" className="btn btn-primary" disabled={saving}>
                    {saving ? 'Salvando...' : 'Salvar Alterações'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
