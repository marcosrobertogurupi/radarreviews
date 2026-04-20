import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Building2, Save, X, Plus, Trash2, Power, Edit, KeyRound } from 'lucide-react'

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
}

interface Business {
  id: string
  tenant_id: string
  name: string
  cnpj: string
}

export default function Tenants() {
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
        return alert(msg)
      }

      setShowModal(false)
      setNewTenant({ name: '', slug: '', initialBusiness: '', cnpj: '', email: '', password: '' })
      loadAll()
      // Atualiza o combobox de tenants no App.tsx (e demais páginas que dependem da lista)
      window.dispatchEvent(new Event('refresh_data'))
    } catch {
      alert('Não foi possível conectar à API. Verifique se o servidor está online.')
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
        }),
      })

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: resp.statusText }))
        return alert(err.error ?? resp.statusText)
      }

      alert('Assinante atualizado com sucesso!')
      setEditingTenant(null)
      loadAll()
    } catch {
      alert('Não foi possível conectar à API. Verifique se o servidor está online.')
    }
  }

  async function toggleActive(t: Tenant) {
    const newVal = !(t.is_active ?? true)
    if (!confirm(`Deseja realmente ${newVal ? 'ativar' : 'DESATIVAR'} o monitoramento de ${t.name}?`)) return
    
    const baseUrl = (import.meta.env.VITE_API_URL ?? 'https://reputei-api.railway.app').replace(/\/+$/, '')
    try {
      const resp = await fetch(`${baseUrl}/api/admin/tenant/${t.id}/active`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: newVal }),
      })
      
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: resp.statusText }))
        return alert('Erro ao alterar status: ' + (err.error ?? resp.statusText))
      }

      alert(`Assinante ${newVal ? 'ativado' : 'desativado'} com sucesso!`)
      // Atualiza locamente para imediato visual feedback
      setTenants(prev => prev.map(x => x.id === t.id ? { ...x, is_active: newVal } : x))
    } catch {
      alert('Não foi possível conectar à API.')
    }
  }

  async function handleUpdateCredentials(e: React.FormEvent) {
    e.preventDefault()
    if (!credentialsTenant) return
    if (!credentials.email && !credentials.password) return alert('Informe ao menos e-mail ou senha.')
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
      if (!res.ok) return alert(data.error ?? 'Erro ao atualizar credenciais')
      setCredentialsTenant(null)
      setCredentials({ email: '', password: '' })
      alert('Credenciais atualizadas com sucesso!')
    } catch {
      alert('Não foi possível conectar à API.')
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
        alert('Erro ao atualizar empresa: ' + (err.error ?? resp.statusText))
      } else {
        alert('Empresa atualizada com sucesso!')
        setEditingBusiness(null)
        loadAll()
      }
    } catch {
      alert('Não foi possível conectar à API.')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(t: Tenant) {
    const pass = confirm(`⚠️ CUIDADO: Deletar Permanentemente?\n\nIsso irá apagar DEFINITIVAMENTE o assinante "${t.name}".\nIsso apagará em cascata:\n- Todas as empresas associadas\n- Todos as Regras e Alertas\n- TODOS OS REVIEWS.\n- Login de acesso do assinante.\n\nEsta ação NÃO PODE SER DESFEITA.`)
    if (!pass) return

    const baseUrl = (import.meta.env.VITE_API_URL ?? 'https://reputei-api.railway.app').replace(/\/+$/, '')
    const resp = await fetch(`${baseUrl}/api/admin/tenant/${t.id}`, { method: 'DELETE' })
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ error: resp.statusText }))
      alert('Falha ao deletar: ' + (err.error ?? resp.statusText))
    } else {
      setTenants(prev => prev.filter(x => x.id !== t.id))
      setBusinesses(prev => { const n = {...prev}; delete n[t.id]; return n; })
      window.dispatchEvent(new Event('refresh_data'))
    }
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
                
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ background: isActive ? 'rgba(99,102,241,0.1)' : 'rgba(156,163,175,0.1)', padding: 10, borderRadius: 8 }}>
                    <Building2 size={24} color={isActive ? "#a5b4fc" : "#9ca3af"} />
                  </div>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                      <h3 style={{ margin: 0, fontSize: 16, color: 'var(--text-primary)' }}>{t.name}</h3>
                      <div style={{ 
                        display: 'flex', alignItems: 'center', gap: 4, 
                        fontSize: 11, padding: '2px 8px', borderRadius: 99, 
                        background: isActive ? 'rgba(16, 185, 129, 0.1)' : 'rgba(156, 163, 175, 0.1)',
                        color: isActive ? '#10b981' : '#9ca3af',
                        border: `1px solid ${isActive ? 'rgba(16, 185, 129, 0.2)' : 'rgba(156, 163, 175, 0.2)'}`
                      }}>
                        <span>{isActive ? '🟢' : '⚫'}</span>
                        {isActive ? 'Ativo' : 'Desativado'}
                      </div>
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
                    </div>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 8 }}>
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

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 24 }}>
                <button type="button" className="btn" style={{ background: 'transparent' }} onClick={() => setEditingTenant(null)}>Cancelar</button>
                <button type="submit" className="btn" style={{ background: 'var(--accent)' }}><Save size={16} /> Atualizar Assinante</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
