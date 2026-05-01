import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Building2, Save, X, Plus, Trash2, Power, Edit, KeyRound } from 'lucide-react'
import { useToast } from '../components/Toast'
import { ConfirmDialog } from '../components/ConfirmDialog'

const PLAN_CONFIG: Record<string, { label: string; color: string; max_channels: number }> = {
  trial:      { label: 'Trial',      color: '#6b7280', max_channels: 3  },
  basico:     { label: 'Básico',     color: '#06b6d4', max_channels: 3  },
  completo:   { label: 'Completo',   color: '#6366f1', max_channels: 8  },
  enterprise: { label: 'Enterprise', color: '#f59e0b', max_channels: 99 },
}

interface Tenant {
  id: string
  name: string
  slug: string
  plan?: string
  is_active?: boolean
  created_at: string
  admin_whatsapp?: string
  admin_email?: string
  critical_alert_hours?: number
  cnpj?: string
  widget_token?: string
  widget_config?: any
  whatsapp_token?: string
  whatsapp_base_url?: string
  whatsapp_limit_monthly?: number
  trial_ends_at?: string | null
  plan_status?: string
}

interface Business {
  id: string
  tenant_id: string
  name: string
  cnpj: string
}

export default function Tenants() {
  const { toast } = useToast()
  const [tenants, setTenants] = useState<Tenant[]>([])
  const [businesses, setBusinesses] = useState<Record<string, Business[]>>({})
  const [loading, setLoading] = useState(true)

  const [showModal, setShowModal] = useState(false)
  const [newTenant, setNewTenant] = useState({ name: '', slug: '', initialBusiness: '', cnpj: '', email: '', password: '' })
  const [saving, setSaving] = useState(false)
  
  const [editingTenant, setEditingTenant] = useState<Tenant | null>(null)
  
  // Edição de empresa específica
  const [editingBusiness, setEditingBusiness] = useState<Business | null>(null)

  const [credentialsTenant, setCredentialsTenant] = useState<Tenant | null>(null)
  const [credentials, setCredentials] = useState({ email: '', password: '' })
  const [savingCreds, setSavingCreds] = useState(false)

  const [confirmDialog, setConfirmDialog] = useState<{
    title: string; message: string; confirmLabel?: string; dangerous?: boolean; onConfirm: () => void
  } | null>(null)

  useEffect(() => {
    loadAll()
    const handleRefresh = () => loadAll()
    window.addEventListener('refresh_data', handleRefresh)
    return () => window.removeEventListener('refresh_data', handleRefresh)
  }, [])

  async function loadAll() {
    setLoading(true)
    
    // Fetch tenants
    const { data: tData } = await supabase.from('tenants').select('*').order('created_at', { ascending: false })
    
    // Fetch businesses
    const { data: bData } = await supabase.from('monitored_businesses').select('*')

    const bMap: Record<string, Business[]> = {}
    for (const b of bData || []) {
      if (!bMap[b.tenant_id]) bMap[b.tenant_id] = []
      bMap[b.tenant_id].push(b)
    }

    setTenants(tData || [])
    setBusinesses(bMap)
    setLoading(false)
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)

    const baseUrl = (import.meta.env.VITE_API_URL ?? 'https://reputei-api.railway.app').replace(/\/+$/, '')

    try {
      const res = await fetch(`${baseUrl}/api/onboarding`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: newTenant.email.trim(),
          password: newTenant.password,
          businessName: newTenant.initialBusiness.trim() || newTenant.name.trim(),
          category: '',
          cnpj: newTenant.cnpj.trim(),
          channels: [],
        }),
      })

      const data = await res.json()
      if (!res.ok) {
        const msg = res.status === 409 ? 'Este e-mail já está cadastrado.' : (data.error ?? 'Erro ao criar assinante')
        return toast(msg, 'error')
      }

      setShowModal(false)
      setNewTenant({ name: '', slug: '', initialBusiness: '', cnpj: '', email: '', password: '' })
      loadAll()
      window.dispatchEvent(new Event('refresh_data'))
      toast('Assinante criado com sucesso!', 'success')
    } catch {
      toast('Não foi possível conectar à API. Verifique se o servidor está online.', 'error')
    } finally {
      setSaving(false)
    }
  }

  async function handleUpdate(e: React.FormEvent) {
    e.preventDefault()
    if (!editingTenant) return

    const baseUrl = (import.meta.env.VITE_API_URL ?? 'https://reputei-api.railway.app').replace(/\/+$/, '')
    try {
      const resp = await fetch(`${baseUrl}/api/admin/tenant/${editingTenant.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: editingTenant.name,
          slug: editingTenant.slug,
          plan: editingTenant.plan || 'trial',
          admin_whatsapp: editingTenant.admin_whatsapp || null,
          admin_email: editingTenant.admin_email || null,
          critical_alert_hours: editingTenant.critical_alert_hours || null,
          business_cnpj: editingTenant.cnpj !== undefined ? (editingTenant.cnpj || null) : undefined,
          whatsapp_token: editingTenant.whatsapp_token,
          whatsapp_base_url: editingTenant.whatsapp_base_url,
          whatsapp_limit_monthly: editingTenant.whatsapp_limit_monthly,
          plan_status: editingTenant.plan_status,
          trial_ends_at: editingTenant.trial_ends_at
        }),
      })

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: resp.statusText }))
        return toast(err.error ?? resp.statusText, 'error')
      }

      toast('Assinante atualizado com sucesso!', 'success')
      setEditingTenant(null)
      loadAll()
    } catch {
      toast('Não foi possível conectar à API. Verifique se o servidor está online.', 'error')
    }
  }

  function toggleActive(t: Tenant) {
    const newVal = !(t.is_active ?? true)
    setConfirmDialog({
      title: newVal ? 'Ativar monitoramento' : 'Desativar monitoramento',
      message: `Deseja realmente ${newVal ? 'ativar' : 'DESATIVAR'} o monitoramento de "${t.name}"?`,
      confirmLabel: newVal ? 'Ativar' : 'Desativar',
      dangerous: !newVal,
      onConfirm: async () => {
        setConfirmDialog(null)
        const baseUrl = (import.meta.env.VITE_API_URL ?? 'https://reputei-api.railway.app').replace(/\/+$/, '')
        try {
          const resp = await fetch(`${baseUrl}/api/admin/tenant/${t.id}/active`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ is_active: newVal }),
          })
          if (!resp.ok) {
            const err = await resp.json().catch(() => ({ error: resp.statusText }))
            return toast('Erro ao alterar status: ' + (err.error ?? resp.statusText), 'error')
          }
          toast(`Assinante ${newVal ? 'ativado' : 'desativado'} com sucesso!`, 'success')
          setTenants(prev => prev.map(x => x.id === t.id ? { ...x, is_active: newVal } : x))
        } catch {
          toast('Não foi possível conectar à API.', 'error')
        }
      },
    })
  }

  function extendTrial(t: Tenant) {
    const currentEnd = t.trial_ends_at ? new Date(t.trial_ends_at) : new Date()
    const newEnd = new Date(currentEnd.getTime() + 7 * 24 * 60 * 60 * 1000)
    setConfirmDialog({
      title: 'Estender Trial',
      message: `Deseja estender o trial de "${t.name}" por +7 dias?\nNova data: ${newEnd.toLocaleDateString()}`,
      confirmLabel: '+7 dias',
      onConfirm: async () => {
        setConfirmDialog(null)
        const baseUrl = (import.meta.env.VITE_API_URL ?? 'https://reputei-api.railway.app').replace(/\/+$/, '')
        try {
          const resp = await fetch(`${baseUrl}/api/admin/tenant/${t.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ trial_ends_at: newEnd.toISOString() }),
          })
          if (!resp.ok) {
            const err = await resp.json().catch(() => ({ error: resp.statusText }))
            return toast('Erro ao estender trial: ' + (err.error ?? resp.statusText), 'error')
          }
          toast('Trial estendido com sucesso!', 'success')
          loadAll()
        } catch {
          toast('Não foi possível conectar à API.', 'error')
        }
      },
    })
  }

  async function handleUpdateCredentials(e: React.FormEvent) {
    e.preventDefault()
    if (!credentialsTenant) return
    if (!credentials.email && !credentials.password) return toast('Informe ao menos e-mail ou senha.', 'info')
    setSavingCreds(true)

    const baseUrl = (import.meta.env.VITE_API_URL ?? 'https://reputei-api.railway.app').replace(/\/+$/, '')
    try {
      const res = await fetch(`${baseUrl}/api/admin/credentials`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantId: credentialsTenant.id,
          ...(credentials.email    ? { email: credentials.email }       : {}),
          ...(credentials.password ? { password: credentials.password } : {}),
        }),
      })
      const data = await res.json()
      if (!res.ok) return toast(data.error ?? 'Erro ao atualizar credenciais', 'error')
      setCredentialsTenant(null)
      setCredentials({ email: '', password: '' })
      toast('Credenciais atualizadas com sucesso!', 'success')
    } catch {
      toast('Não foi possível conectar à API.', 'error')
    } finally {
      setSavingCreds(false)
    }
  }

  async function handleUpdateBusiness(e: React.FormEvent) {
    e.preventDefault()
    if (!editingBusiness) return
    setSaving(true)

    const baseUrl = (import.meta.env.VITE_API_URL ?? 'https://reputei-api.railway.app').replace(/\/+$/, '')
    try {
      const resp = await fetch(`${baseUrl}/api/admin/tenant/${editingBusiness.tenant_id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_name: editingBusiness.name,
          business_cnpj: editingBusiness.cnpj || null,
        }),
      })

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: resp.statusText }))
        toast('Erro ao atualizar empresa: ' + (err.error ?? resp.statusText), 'error')
      } else {
        toast('Empresa atualizada com sucesso!', 'success')
        setEditingBusiness(null)
        loadAll()
      }
    } catch {
      toast('Não foi possível conectar à API.', 'error')
    } finally {
      setSaving(false)
    }
  }

  function handleDelete(t: Tenant) {
    setConfirmDialog({
      title: 'Deletar Permanentemente',
      message: `Isso irá apagar DEFINITIVAMENTE o assinante "${t.name}".\n\nSerá removido em cascata:\n- Todas as empresas associadas\n- Todas as Regras e Alertas\n- TODOS OS REVIEWS\n- Login de acesso do assinante\n\nEsta ação NÃO PODE SER DESFEITA.`,
      confirmLabel: 'Deletar Permanentemente',
      dangerous: true,
      onConfirm: async () => {
        setConfirmDialog(null)
        try {
          const { data: { session } } = await supabase.auth.getSession()
          if (!session) return toast('Sessão expirada. Faça login novamente.', 'error')
          const baseUrl = (import.meta.env.VITE_API_URL ?? 'https://reputei-api.railway.app').replace(/\/+$/, '')
          const resp = await fetch(`${baseUrl}/api/admin/tenant/${t.id}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${session.access_token}` },
          })
          if (!resp.ok) {
            const err = await resp.json().catch(() => ({ error: resp.statusText }))
            toast('Não foi possível excluir: ' + (err.error ?? resp.statusText), 'error')
          } else {
            setTenants(prev => prev.filter(x => x.id !== t.id))
            setBusinesses(prev => { const n = {...prev}; delete n[t.id]; return n; })
            window.dispatchEvent(new Event('refresh_data'))
            toast(`Assinante "${t.name}" removido com sucesso.`, 'success')
          }
        } catch {
          toast('Não foi possível conectar à API.', 'error')
        }
      },
    })
  }

  return (
    <div>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 className="page-title">Assinantes</h1>
          <p className="page-subtitle">Gestão de assinantes (Tenants), status e monitoramento em cascata.</p>
        </div>
        <button className="btn" onClick={() => setShowModal(true)}>
          <Plus size={16} /> Novo Assinante
        </button>
      </div>

      {loading ? (
        <div className="skeleton" style={{ width: '100%', height: 200 }} />
      ) : tenants.length === 0 ? (
        <div className="card empty-state">
          <div className="empty-state-icon">🏢</div>
          <div className="empty-state-text">Nenhum assinante cadastrado</div>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 }}>
          {tenants.map(t => {
            const isActive = t.is_active ?? true
            return (
            <div key={t.id} className="card" style={{ padding: 20, opacity: isActive ? 1 : 0.6 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1, minWidth: 0 }}>
                  <div style={{ background: isActive ? 'rgba(99,102,241,0.1)' : 'rgba(156,163,175,0.1)', padding: 10, borderRadius: 8, flexShrink: 0 }}>
                    <Building2 size={24} color={isActive ? "#a5b4fc" : "#9ca3af"} />
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                      <h3 style={{ margin: 0, fontSize: 16, color: 'var(--text-primary)' }}>{t.name}</h3>
                      {(() => {
                        const trialExpired = t.plan_status === 'trial' && t.trial_ends_at && new Date(t.trial_ends_at) < new Date()
                        const trialActive = t.plan_status === 'trial' && (!t.trial_ends_at || new Date(t.trial_ends_at) >= new Date())
                        const statusColor = !isActive ? '#ef4444' : (trialExpired ? '#f59e0b' : (trialActive ? '#60a5fa' : '#10b981'))
                        const statusBg = !isActive ? 'rgba(239, 68, 68, 0.1)' : (trialExpired ? 'rgba(245, 158, 11, 0.1)' : (trialActive ? 'rgba(96, 165, 250, 0.1)' : 'rgba(16, 185, 129, 0.1)'))
                        const statusBorder = !isActive ? 'rgba(239, 68, 68, 0.2)' : (trialExpired ? 'rgba(245, 158, 11, 0.2)' : (trialActive ? 'rgba(96, 165, 250, 0.2)' : 'rgba(16, 185, 129, 0.2)'))
                        const label = !isActive ? 'Bloqueado' : (trialExpired ? 'Trial Expirado' : (trialActive ? 'Trial Ativo' : 'Ativo'))
                        const emoji = !isActive ? '⚫' : (trialExpired ? '⏰' : (trialActive ? '⏳' : '🟢'))
                        
                        return (
                          <div style={{ 
                            display: 'flex', alignItems: 'center', gap: 4, 
                            fontSize: 11, padding: '2px 8px', borderRadius: 99, 
                            whiteSpace: 'nowrap',
                            background: statusBg,
                            color: statusColor,
                            border: `1px solid ${statusBorder}`
                          }}>
                            <span>{emoji}</span>
                            {label}
                          </div>
                        )
                      })()}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <code style={{ fontSize: 11, color: 'var(--text-muted)' }}>{t.slug}</code>
                      {(() => {
                        const p = PLAN_CONFIG[t.plan ?? 'trial'] ?? PLAN_CONFIG['trial']
                        return (
                          <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 7px', borderRadius: 99, background: `${p.color}22`, color: p.color, border: `1px solid ${p.color}44` }}>
                            {p.label}
                          </span>
                        )
                      })()}
                      {t.plan_status === 'trial' && t.trial_ends_at && (
                        <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                          Expira: {new Date(t.trial_ends_at).toLocaleDateString()}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end', marginLeft: 8, flexShrink: 0 }}>
                  {t.plan_status === 'trial' && (
                    <button onClick={() => extendTrial(t)} className="btn-icon" style={{ padding: 6, opacity: 0.8 }} title="+7 dias de trial">
                      <Plus size={14} color="#f59e0b" />
                    </button>
                  )}
                  <button onClick={() => {
                    const b = businesses[t.id]?.[0]
                    setEditingTenant({ ...t, cnpj: b?.cnpj || '' })
                  }} className="btn-icon" style={{ padding: 6, opacity: 0.8 }} title="Editar assinante">
                    <Edit size={14} color="#60a5fa" />
                  </button>
                  <button onClick={() => { setCredentialsTenant(t); setCredentials({ email: '', password: '' }) }} className="btn-icon" style={{ padding: 6, opacity: 0.8 }} title="Alterar e-mail / senha do portal">
                    <KeyRound size={14} color="#a78bfa" />
                  </button>
                  <button onClick={() => toggleActive(t)} className="btn-icon" style={{ padding: 6, opacity: 0.8 }} title={isActive ? 'Pausar monitoramento' : 'Ativar monitoramento'}>
                    <Power size={14} color={isActive ? "#10b981" : "#ef4444"} />
                  </button>
                  <button onClick={() => handleDelete(t)} className="btn-icon" style={{ padding: 6, opacity: 0.8 }} title="Deletar permanentemente">
                    <Trash2 size={14} color="#fca5a5" />
                  </button>
                </div>

              </div>
              
              <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16 }}>
                <h4 style={{ margin: '0 0 8px 0', fontSize: 11, color: 'var(--text-muted)' }}>Empresas Monitoradas:</h4>
                {businesses[t.id]?.length ? (
                  <ul style={{ margin: 0, paddingLeft: 0, listStyle: 'none', color: 'var(--text-secondary)', fontSize: 13 }}>
                    {businesses[t.id].map(b => (
                      <li key={b.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 0' }}>
                        <div>
                          {b.name} <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>{b.cnpj && `(${b.cnpj})`}</span>
                        </div>
                        <button 
                          onClick={() => setEditingBusiness(b)} 
                          className="btn-icon" 
                          style={{ padding: 4, background: 'rgba(255,255,255,0.03)' }}
                          title="Editar CNPJ / Nome"
                        >
                          <Edit size={12} color="#60a5fa" />
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Nenhuma empresa conectada.</div>
                )}
              </div>
            </div>
          )})}
        </div>
      )}

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-title">
              <span>Novo Assinante (Tenant)</span>
              <button className="modal-close" onClick={() => setShowModal(false)}><X size={18} /></button>
            </div>
            
            <form onSubmit={handleCreate}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 16, padding: '8px 12px', background: 'rgba(99,102,241,0.08)', borderRadius: 6, borderLeft: '3px solid var(--accent)' }}>
                O assinante receberá acesso ao Portal do Assinante com o e-mail e senha definidos abaixo.
              </div>

              <div className="modal-section">
                <label className="modal-label">Nome da Empresa</label>
                <input
                  autoFocus required
                  value={newTenant.initialBusiness}
                  onChange={e => {
                    const v = e.target.value
                    const slug = v.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
                    setNewTenant(prev => ({ ...prev, initialBusiness: v, name: v, slug }))
                  }}
                  style={{ width: '100%', padding: '8px 12px', background: 'var(--bg-darker)', border: '1px solid var(--border)', color: 'white', borderRadius: 4 }}
                  placeholder="Ex: Grupo Boticário"
                />
              </div>

              <div className="modal-section">
                <label className="modal-label">CNPJ (opcional)</label>
                <input
                  value={newTenant.cnpj}
                  onChange={e => setNewTenant(prev => ({ ...prev, cnpj: e.target.value }))}
                  style={{ width: '100%', padding: '8px 12px', background: 'var(--bg-darker)', border: '1px solid var(--border)', color: 'white', borderRadius: 4 }}
                  placeholder="Somente números"
                />
              </div>

              <div style={{ borderTop: '1px dashed var(--border)', margin: '16px 0' }} />

              <div className="modal-section">
                <label className="modal-label">E-mail de acesso ao Portal</label>
                <input
                  required type="email"
                  value={newTenant.email}
                  onChange={e => setNewTenant(prev => ({ ...prev, email: e.target.value }))}
                  style={{ width: '100%', padding: '8px 12px', background: 'var(--bg-darker)', border: '1px solid var(--border)', color: 'white', borderRadius: 4 }}
                  placeholder="email@empresa.com"
                />
              </div>

              <div className="modal-section">
                <label className="modal-label">Senha de acesso ao Portal</label>
                <input
                  required type="password" minLength={6}
                  value={newTenant.password}
                  onChange={e => setNewTenant(prev => ({ ...prev, password: e.target.value }))}
                  style={{ width: '100%', padding: '8px 12px', background: 'var(--bg-darker)', border: '1px solid var(--border)', color: 'white', borderRadius: 4 }}
                  placeholder="Mínimo 6 caracteres"
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 24 }}>
                <button type="button" className="btn" style={{ background: 'transparent' }} onClick={() => setShowModal(false)}>Cancelar</button>
                <button type="submit" disabled={saving} className="btn" style={{ background: 'var(--accent)', opacity: saving ? 0.6 : 1 }}>
                  <Save size={16} /> {saving ? 'Criando...' : 'Criar Assinante'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {credentialsTenant && (
        <div className="modal-overlay" onClick={() => setCredentialsTenant(null)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-title">
              <span>Credenciais — {credentialsTenant.name}</span>
              <button className="modal-close" onClick={() => setCredentialsTenant(null)}><X size={18} /></button>
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 16 }}>
              Deixe o campo em branco para não alterar.
            </div>
            <form onSubmit={handleUpdateCredentials}>
              <div className="modal-section">
                <label className="modal-label">Novo e-mail</label>
                <input
                  type="email"
                  value={credentials.email}
                  onChange={e => setCredentials(prev => ({ ...prev, email: e.target.value }))}
                  style={{ width: '100%', padding: '8px 12px', background: 'var(--bg-darker)', border: '1px solid var(--border)', color: 'white', borderRadius: 4 }}
                  placeholder="novo@email.com"
                />
              </div>
              <div className="modal-section">
                <label className="modal-label">Nova senha</label>
                <input
                  type="password" minLength={6}
                  value={credentials.password}
                  onChange={e => setCredentials(prev => ({ ...prev, password: e.target.value }))}
                  style={{ width: '100%', padding: '8px 12px', background: 'var(--bg-darker)', border: '1px solid var(--border)', color: 'white', borderRadius: 4 }}
                  placeholder="Mínimo 6 caracteres"
                />
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 24 }}>
                <button type="button" className="btn" style={{ background: 'transparent' }} onClick={() => setCredentialsTenant(null)}>Cancelar</button>
                <button type="submit" disabled={savingCreds} className="btn" style={{ background: '#7c3aed', opacity: savingCreds ? 0.6 : 1 }}>
                  <KeyRound size={16} /> {savingCreds ? 'Salvando...' : 'Salvar Credenciais'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {editingBusiness && (
        <div className="modal-overlay" onClick={() => setEditingBusiness(null)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-title">
              <span>Editar Dados da Empresa</span>
              <button className="modal-close" onClick={() => setEditingBusiness(null)}><X size={18} /></button>
            </div>
            
            <form onSubmit={handleUpdateBusiness}>
              <div className="modal-section">
                <label className="modal-label">Nome da Empresa</label>
                <input 
                  autoFocus required
                  value={editingBusiness.name}
                  onChange={e => setEditingBusiness(prev => prev ? { ...prev, name: e.target.value } : null)}
                  style={{ width: '100%', padding: '8px 12px', background: 'var(--bg-darker)', border: '1px solid var(--border)', color: 'white', borderRadius: 4 }}
                />
              </div>

              <div className="modal-section">
                <label className="modal-label">CNPJ (chave do buscador Consumidor.gov)</label>
                <input
                  required
                  value={editingBusiness.cnpj ?? ''}
                  onChange={e => setEditingBusiness(prev => prev ? { ...prev, cnpj: e.target.value } : null)}
                  placeholder="Apenas números"
                  style={{ width: '100%', padding: '8px 12px', background: 'var(--bg-darker)', border: '1px solid var(--border)', color: 'white', borderRadius: 4, fontFamily: 'monospace' }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 24 }}>
                <button type="button" className="btn" style={{ background: 'transparent' }} onClick={() => setEditingBusiness(null)}>Cancelar</button>
                <button type="submit" disabled={saving} className="btn" style={{ background: 'var(--accent)', opacity: saving ? 0.6 : 1 }}>
                   <Save size={16} /> {saving ? 'Salvando...' : 'Salvar Alterações'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {editingTenant && (
        <div className="modal-overlay" onClick={() => setEditingTenant(null)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-title">
              <span>Editar Assinante</span>
              <button className="modal-close" onClick={() => setEditingTenant(null)}><X size={18} /></button>
            </div>
            
            <form onSubmit={handleUpdate}>
              <div className="modal-section">
                <label className="modal-label">Nome da Conta Parente (Tenant)</label>
                <input 
                  autoFocus required
                  value={editingTenant.name}
                  onChange={e => {
                    const name = e.target.value
                    const slug = name.toLowerCase().replace(/[^a-z0-9]/g, '-')
                    setEditingTenant(prev => prev ? { ...prev, name, slug } : null)
                  }}
                  style={{ width: '100%', padding: '8px 12px', background: 'var(--bg-darker)', border: '1px solid var(--border)', color: 'white', borderRadius: 4 }}
                />
              </div>

              <div className="modal-section">
                <label className="modal-label">Slug</label>
                <input
                  required
                  value={editingTenant.slug}
                  onChange={e => setEditingTenant(prev => prev ? { ...prev, slug: e.target.value } : null)}
                  style={{ width: '100%', padding: '8px 12px', background: 'var(--bg-dark)', border: '1px solid var(--border)', color: 'var(--text-muted)', borderRadius: 4, fontFamily: 'monospace' }}
                />
              </div>

              <div className="modal-section">
                <label className="modal-label">CNPJ da Empresa (Principal)</label>
                <input
                  required
                  value={editingTenant.cnpj ?? ''}
                  onChange={e => setEditingTenant(prev => prev ? { ...prev, cnpj: e.target.value } : null)}
                  placeholder="Somente números"
                  style={{ width: '100%', padding: '8px 12px', background: 'var(--bg-darker)', border: '1px solid var(--border)', color: 'white', borderRadius: 4, fontFamily: 'monospace' }}
                />
              </div>

              <div className="modal-section">
                <label className="modal-label">Plano</label>
                <select
                  value={editingTenant.plan ?? 'trial'}
                  onChange={e => setEditingTenant(prev => prev ? { ...prev, plan: e.target.value } : null)}
                  style={{ width: '100%', padding: '8px 12px', background: 'var(--bg-darker)', border: `1px solid ${PLAN_CONFIG[editingTenant.plan ?? 'trial']?.color ?? 'var(--border)'}`, color: 'white', borderRadius: 4 }}
                >
                  {Object.entries(PLAN_CONFIG).map(([id, cfg]) => (
                    <option key={id} value={id}>{cfg.label} — até {cfg.max_channels === 99 ? 'ilimitado' : cfg.max_channels} canal{cfg.max_channels !== 1 ? 'is' : ''}</option>
                  ))}
                </select>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div className="modal-section" style={{ margin: 0 }}>
                  <label className="modal-label">Status do Plano</label>
                  <select
                    value={editingTenant.plan_status ?? 'trial'}
                    onChange={e => setEditingTenant(prev => prev ? { ...prev, plan_status: e.target.value } : null)}
                    style={{ width: '100%', padding: '8px 12px', background: 'var(--bg-darker)', border: '1px solid var(--border)', color: 'white', borderRadius: 4 }}
                  >
                    <option value="trial">Trial</option>
                    <option value="active">Ativo (Pago)</option>
                    <option value="paused">Pausado/Bloqueado</option>
                  </select>
                </div>
                <div className="modal-section" style={{ margin: 0 }}>
                  <label className="modal-label">Data de Fim do Trial</label>
                  <input
                    type="date"
                    value={editingTenant.trial_ends_at ? new Date(editingTenant.trial_ends_at).toISOString().split('T')[0] : ''}
                    onChange={e => setEditingTenant(prev => prev ? { ...prev, trial_ends_at: e.target.value ? new Date(e.target.value).toISOString() : null } : null)}
                    style={{ width: '100%', padding: '8px 12px', background: 'var(--bg-darker)', border: '1px solid var(--border)', color: 'white', borderRadius: 4 }}
                  />
                </div>
              </div>

              <div style={{ borderTop: '1px dashed var(--border)', margin: '16px 0' }} />
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                🔔 Escalada de Alertas Críticos
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div className="modal-section" style={{ margin: 0 }}>
                  <label className="modal-label">WhatsApp do Adm</label>
                  <input
                    type="tel"
                    value={editingTenant.admin_whatsapp ?? ''}
                    onChange={e => setEditingTenant(prev => prev ? { ...prev, admin_whatsapp: e.target.value } : null)}
                    style={{ width: '100%', padding: '8px 12px', background: 'var(--bg-darker)', border: '1px solid var(--border)', color: 'white', borderRadius: 4 }}
                    placeholder="+5511999999999"
                  />
                </div>
                <div className="modal-section" style={{ margin: 0 }}>
                  <label className="modal-label">E-mail do Adm</label>
                  <input
                    type="email"
                    value={editingTenant.admin_email ?? ''}
                    onChange={e => setEditingTenant(prev => prev ? { ...prev, admin_email: e.target.value } : null)}
                    style={{ width: '100%', padding: '8px 12px', background: 'var(--bg-darker)', border: '1px solid var(--border)', color: 'white', borderRadius: 4 }}
                    placeholder="adm@empresa.com"
                  />
                </div>
              </div>

              <div className="modal-section" style={{ marginTop: 12 }}>
                <label className="modal-label">Tempo para Alerta Crítico (horas)</label>
                <input
                  type="number" min={1} max={168}
                  value={editingTenant.critical_alert_hours ?? ''}
                  onChange={e => setEditingTenant(prev => prev ? { ...prev, critical_alert_hours: e.target.value ? parseInt(e.target.value) : undefined } : null)}
                  style={{ width: '100%', padding: '8px 12px', background: 'var(--bg-darker)', border: '1px solid var(--border)', color: 'white', borderRadius: 4 }}
                  placeholder="Ex: 24 (acionar após 24h sem resolução)"
                />
              </div>
              <div style={{ borderTop: '1px dashed var(--border)', margin: '16px 0' }} />
              <div style={{ fontSize: 11, color: 'var(--accent-2)', marginBottom: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                🌐 Widget de Reviews para Site
              </div>

              <div className="modal-section" style={{ background: 'rgba(99,102,241,0.05)', borderRadius: 8, padding: 12 }}>
                <label className="modal-label">Token do Widget</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    readOnly
                    value={editingTenant.widget_token || 'Gerando...'}
                    style={{ flex: 1, padding: '8px 12px', background: 'var(--bg-dark)', border: '1px solid var(--border)', color: 'var(--text-muted)', borderRadius: 4, fontFamily: 'monospace', fontSize: 11 }}
                  />
                  <button type="button" className="btn btn-ghost" style={{ fontSize: 11 }} onClick={() => navigator.clipboard.writeText(editingTenant.widget_token || '')}>Copiar</button>
                </div>
                
                <div style={{ marginTop: 12 }}>
                  <label className="modal-label">Código de Embed (HTML)</label>
                  <textarea
                    readOnly
                    rows={4}
                    value={`<!-- Widget Reputei -->\n<div id="reputei-widget" data-token="${editingTenant.widget_token}"></div>\n<script src="https://radar-views-api.railway.app/static/widget.js" async></script>`}
                    style={{ width: '100%', padding: '8px 12px', background: 'var(--bg-darker)', border: '1px solid var(--border)', color: '#a5b4fc', borderRadius: 4, fontFamily: 'monospace', fontSize: 10, resize: 'none' }}
                  />
                  <p style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 4 }}>
                    Cole este código no local onde deseja que os reviews apareçam no seu site.
                  </p>
                </div>
              </div>

              <div style={{ borderTop: '1px dashed var(--border)', margin: '16px 0' }} />
              <div style={{ fontSize: 11, color: '#10b981', marginBottom: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                🟢 WhatsApp (UAZAPI)
              </div>

              <div className="modal-section">
                <label className="modal-label">Token da Instância (UAZAPI)</label>
                <input
                  type="password"
                  value={editingTenant.whatsapp_token ?? ''}
                  onChange={e => setEditingTenant(prev => prev ? { ...prev, whatsapp_token: e.target.value } : null)}
                  style={{ width: '100%', padding: '8px 12px', background: 'var(--bg-darker)', border: '1px solid var(--border)', color: 'white', borderRadius: 4, fontFamily: 'monospace' }}
                  placeholder="Deixe em branco para não alterar"
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: 12 }}>
                <div className="modal-section" style={{ margin: 0 }}>
                  <label className="modal-label">Base URL</label>
                  <input
                    value={editingTenant.whatsapp_base_url ?? ''}
                    onChange={e => setEditingTenant(prev => prev ? { ...prev, whatsapp_base_url: e.target.value } : null)}
                    style={{ width: '100%', padding: '8px 12px', background: 'var(--bg-darker)', border: '1px solid var(--border)', color: 'white', borderRadius: 4 }}
                    placeholder="https://api.uazapi.com"
                  />
                </div>
                <div className="modal-section" style={{ margin: 0 }}>
                  <label className="modal-label">Limite Mensal</label>
                  <input
                    type="number"
                    value={editingTenant.whatsapp_limit_monthly ?? ''}
                    onChange={e => setEditingTenant(prev => prev ? { ...prev, whatsapp_limit_monthly: e.target.value ? parseInt(e.target.value) : undefined } : null)}
                    style={{ width: '100%', padding: '8px 12px', background: 'var(--bg-darker)', border: '1px solid var(--border)', color: 'white', borderRadius: 4 }}
                    placeholder="30"
                  />
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 24 }}>
                <button type="button" className="btn" style={{ background: 'transparent' }} onClick={() => setEditingTenant(null)}>Cancelar</button>
                <button type="submit" className="btn" style={{ background: 'var(--accent)' }}><Save size={16} /> Atualizar Assinante</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {confirmDialog && (
        <ConfirmDialog
          title={confirmDialog.title}
          message={confirmDialog.message}
          confirmLabel={confirmDialog.confirmLabel}
          dangerous={confirmDialog.dangerous}
          onConfirm={confirmDialog.onConfirm}
          onCancel={() => setConfirmDialog(null)}
        />
      )}
    </div>
  )
}
