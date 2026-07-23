import { useState, useEffect } from 'react'
import { Plus, Search, Building2, MoreVertical, ShieldCheck, Mail, Phone, Edit, Trash2, XCircle } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { API_URL } from '../lib/utils'

export default function Partners() {
  const [partners, setPartners] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [isModalOpen, setModalOpen] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [editingPartnerId, setEditingPartnerId] = useState<string | null>(null)
  
  // Form para cadastro
  const [form, setForm] = useState({
    name: '',
    email: '',
    password: '',
    phone: '',
    company_name: '',
    partner_type: 'agency',
    commission_setup_rate: 20,
    commission_recurring_rate: 10,
    status: 'active'
  })

  useEffect(() => {
    fetchPartners()
  }, [])

  const fetchPartners = async () => {
    setLoading(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const r = await fetch(`${API_URL}/api/admin/partners`, {
        headers: { 'Authorization': `Bearer ${session?.access_token || ''}` }
      })
      const data = await r.json()
      if (data.ok) setPartners(data.partners)
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  const handlePartnerTypeChange = (type: string) => {
    let setup = 20; let recur = 10;
    if (type === 'consultant') { setup = 25; recur = 12; }
    if (type === 'sales_rep') { setup = 30; recur = 0; }
    
    setForm({
      ...form,
      partner_type: type,
      commission_setup_rate: setup,
      commission_recurring_rate: recur
    })
  }

  const handleEdit = (partner: any) => {
    setEditingPartnerId(partner.id)
    setForm({
      name: partner.name || '',
      email: partner.email || '',
      password: '',
      phone: partner.phone || '',
      company_name: partner.company_name || '',
      partner_type: partner.partner_type || 'agency',
      commission_setup_rate: partner.commission_setup_rate || 20,
      commission_recurring_rate: partner.commission_recurring_rate || 10,
      status: partner.status || 'active'
    })
    setFormError(null)
    setModalOpen(true)
  }

  const handleToggleStatus = async (partner: any) => {
    const newStatus = partner.status === 'active' ? 'suspended' : 'active'
    const confirmMsg = newStatus === 'suspended' 
      ? `Deseja realmente BLOQUEAR o parceiro ${partner.name}? Ele perderá acesso ao painel.`
      : `Deseja ATIVAR o parceiro ${partner.name}?`
      
    if (!window.confirm(confirmMsg)) return

    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(`${API_URL}/api/admin/partners/${partner.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session?.access_token || ''}`
        },
        body: JSON.stringify({ status: newStatus })
      })
      if (!res.ok) {
        const errorData = await res.json()
        throw new Error(errorData.error)
      }
      fetchPartners()
    } catch (err: any) {
      alert(`Erro: ${err.message}`)
    }
  }

  const handleDeletePartner = async (partner: any) => {
    if (!window.confirm(`Deseja realmente EXCLUIR o parceiro ${partner.name}? Esta ação é irreversível e removerá seu acesso definitivamente.`)) return

    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(`${API_URL}/api/admin/partners/${partner.id}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${session?.access_token || ''}`
        }
      })
      if (!res.ok) {
        const errorData = await res.json()
        throw new Error(errorData.error)
      }
      fetchPartners()
    } catch (err: any) {
      alert(`Erro: ${err.message}`)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setFormError(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      
      const url = editingPartnerId 
        ? `${API_URL}/api/admin/partners/${editingPartnerId}`
        : `${API_URL}/api/admin/partners`
        
      const method = editingPartnerId ? 'PUT' : 'POST'
      
      // Se for edição e não digitou senha, não enviamos a senha no body
      const payload = { ...form }
      if (editingPartnerId && !payload.password) {
        delete (payload as any).password
      }

      const res = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session?.access_token || ''}`
        },
        body: JSON.stringify(payload)
      })
      if (!res.ok) {
        let errText = ''
        try {
          const errorData = await res.json()
          errText = errorData.error || errorData.message
        } catch {
          errText = `Erro HTTP ${res.status}: ${res.statusText}`
        }
        throw new Error(errText || 'Erro ao salvar parceiro')
      }
      setModalOpen(false)
      setEditingPartnerId(null)
      fetchPartners()
      setForm({
        name: '', email: '', password: '', phone: '', company_name: '',
        partner_type: 'agency', commission_setup_rate: 20, commission_recurring_rate: 10, status: 'active'
      })
    } catch (err: any) {
      let msg = err.message || 'Erro desconhecido'
      if (msg === 'Failed to fetch' || msg.includes('Failed to fetch')) {
        msg = 'Erro de conexão com o servidor. Verifique se o servidor backend está online.'
      } else if (msg.includes('already been registered')) {
        msg = 'Este e-mail já está em uso por outro parceiro ou usuário.'
      }
      setFormError(msg)
    }
  }

  const filtered = partners.filter(p => 
    p.name.toLowerCase().includes(search.toLowerCase()) || 
    p.email.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 800, margin: '0 0 4px 0' }}>Gestão de Parceiros</h1>
          <p style={{ color: 'var(--text-muted)', margin: 0, fontSize: 14 }}>
            Cadastre e gerencie as contas de parceiros, agências e representantes.
          </p>
        </div>
        <button className="btn btn-primary" onClick={() => { 
          setFormError(null); 
          setEditingPartnerId(null); 
          setForm({
            name: '', email: '', password: '', phone: '', company_name: '',
            partner_type: 'agency', commission_setup_rate: 20, commission_recurring_rate: 10, status: 'active'
          }); 
          setModalOpen(true) 
        }}>
          <Plus size={16} /> Novo Parceiro
        </button>
      </div>

      <div style={{ display: 'flex', gap: 16, marginBottom: 24 }}>
        <div style={{ position: 'relative', flex: 1, maxWidth: 400 }}>
          <Search size={18} style={{ position: 'absolute', left: 16, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input 
            type="text" 
            placeholder="Buscar parceiro..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ 
              width: '100%', padding: '10px 16px 10px 48px', 
              background: 'var(--bg-darker)', border: '1px solid var(--border)', 
              borderRadius: 8, color: 'var(--text-primary)', outline: 'none' 
            }}
          />
        </div>
      </div>

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
          <thead>
            <tr style={{ background: 'var(--bg-darkest)', borderBottom: '1px solid var(--border)', color: 'var(--text-muted)', fontSize: 12, textTransform: 'uppercase' }}>
              <th style={{ padding: '16px 24px', fontWeight: 700 }}>Parceiro</th>
              <th style={{ padding: '16px 24px', fontWeight: 700 }}>Contato</th>
              <th style={{ padding: '16px 24px', fontWeight: 700 }}>Tipo / Taxas</th>
              <th style={{ padding: '16px 24px', fontWeight: 700 }}>Status</th>
              <th style={{ padding: '16px 24px', fontWeight: 700, width: 80 }}>Ações</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>Carregando...</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={5} style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>Nenhum parceiro encontrado.</td></tr>
            ) : (
              filtered.map(p => (
                <tr key={p.id} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '16px 24px' }}>
                    <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{p.name}</div>
                    {p.company_name && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}><Building2 size={12} style={{ display: 'inline', marginRight: 4 }}/>{p.company_name}</div>}
                  </td>
                  <td style={{ padding: '16px 24px' }}>
                    <div style={{ fontSize: 13, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 6 }}><Mail size={12} /> {p.email}</div>
                    {p.phone && <div style={{ fontSize: 13, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}><Phone size={12} /> {p.phone}</div>}
                  </td>
                  <td style={{ padding: '16px 24px' }}>
                    <div style={{ 
                      display: 'inline-block', padding: '2px 8px', borderRadius: 12, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', marginBottom: 6,
                      background: p.partner_type === 'agency' ? 'rgba(99,102,241,0.1)' : p.partner_type === 'consultant' ? 'rgba(16,185,129,0.1)' : 'rgba(245,158,11,0.1)',
                      color: p.partner_type === 'agency' ? '#818cf8' : p.partner_type === 'consultant' ? '#34d399' : '#fbbf24'
                    }}>
                      {p.partner_type === 'agency' ? 'Agência' : p.partner_type === 'consultant' ? 'Consultor' : 'Representante'}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                      Setup: {p.commission_setup_rate}% | Rec: {p.commission_recurring_rate}%
                    </div>
                  </td>
                  <td style={{ padding: '16px 24px' }}>
                    <div style={{ 
                      display: 'inline-block', padding: '4px 10px', borderRadius: 12, fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
                      background: p.status === 'active' ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)',
                      color: p.status === 'active' ? '#34d399' : '#fca5a5'
                    }}>
                      {p.status === 'active' ? 'Ativo' : p.status}
                    </div>
                  </td>
                  <td style={{ padding: '16px 24px' }}>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button 
                        className="btn" 
                        style={{ padding: 6 }} 
                        title="Editar"
                        onClick={() => handleEdit(p)}
                      >
                        <Edit size={14} />
                      </button>
                      <button 
                        className="btn" 
                        style={{ 
                          padding: 6, 
                          color: p.status === 'active' ? '#fbbf24' : '#34d399',
                          background: 'rgba(255,255,255,0.05)'
                        }} 
                        title={p.status === 'active' ? 'Bloquear Parceiro' : 'Ativar Parceiro'}
                        onClick={() => handleToggleStatus(p)}
                      >
                        {p.status === 'active' ? <XCircle size={14} /> : <ShieldCheck size={14} />}
                      </button>
                      <button 
                        className="btn" 
                        style={{ 
                          padding: 6, 
                          color: '#f87171',
                          background: 'rgba(239,68,68,0.1)'
                        }} 
                        title="Excluir Parceiro"
                        onClick={() => handleDeletePartner(p)}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {isModalOpen && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(4px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999
        }}>
          <div className="card" style={{ width: '100%', maxWidth: 600, padding: 32 }}>
            <h2 style={{ marginTop: 0, marginBottom: 24, fontSize: 20 }}>{editingPartnerId ? 'Editar Parceiro' : 'Novo Parceiro'}</h2>
            
            {formError && (
              <div style={{ padding: 12, background: 'rgba(239,68,68,0.1)', color: '#fca5a5', borderRadius: 8, marginBottom: 16, border: '1px solid rgba(239,68,68,0.2)', fontSize: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
                <XCircle size={18} style={{ flexShrink: 0 }} />
                <span>{formError}</span>
              </div>
            )}

            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#fff', marginBottom: 8 }}>Nome Completo *</label>
                  <input required type="text" className="input" value={form.name} onChange={e => setForm({...form, name: e.target.value})} style={{ width: '100%' }} />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#fff', marginBottom: 8 }}>Empresa</label>
                  <input type="text" className="input" value={form.company_name} onChange={e => setForm({...form, company_name: e.target.value})} style={{ width: '100%' }} />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#fff', marginBottom: 8 }}>E-mail (Login) *</label>
                  <input required type="email" className="input" value={form.email} onChange={e => setForm({...form, email: e.target.value})} style={{ width: '100%' }} />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#fff', marginBottom: 8 }}>
                    {editingPartnerId ? 'Alterar Senha (Opcional)' : 'Senha *'}
                  </label>
                  <input 
                    required={!editingPartnerId} 
                    type="password" 
                    className="input" 
                    value={form.password} 
                    onChange={e => setForm({...form, password: e.target.value})} 
                    style={{ width: '100%' }} 
                    placeholder={editingPartnerId ? 'Deixe em branco para manter' : ''}
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: editingPartnerId ? '1fr 1fr' : '1fr', gap: 16 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#fff', marginBottom: 8 }}>Telefone</label>
                  <input type="text" className="input" value={form.phone} onChange={e => setForm({...form, phone: e.target.value})} style={{ width: '100%' }} />
                </div>
                {editingPartnerId && (
                  <div>
                    <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#fff', marginBottom: 8 }}>Status *</label>
                    <select 
                      className="input" 
                      value={form.status} 
                      onChange={e => setForm({...form, status: e.target.value})} 
                      style={{ width: '100%', cursor: 'pointer' }}
                    >
                      <option value="active">Ativo (Acesso Liberado)</option>
                      <option value="suspended">Suspenso (Bloqueado)</option>
                      <option value="inactive">Inativo (Bloqueado)</option>
                    </select>
                  </div>
                )}
              </div>

              <div style={{ padding: 16, background: 'var(--bg-darkest)', borderRadius: 8, border: '1px solid var(--border)' }}>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#fff', marginBottom: 12 }}>Perfil e Comissionamento</label>
                
                <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 12, marginBottom: 16 }}>
                  <select className="input" value={form.partner_type} onChange={e => handlePartnerTypeChange(e.target.value)} style={{ width: '100%', cursor: 'pointer' }}>
                    <option value="agency">Agência Parceira (20% Setup / 10% Recorrente)</option>
                    <option value="consultant">Consultor (25% Setup / 12% Recorrente)</option>
                    <option value="sales_rep">Representante (30% Setup / 0% Recorrente)</option>
                  </select>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                  <div>
                    <label style={{ display: 'block', fontSize: 11, color: '#fff', marginBottom: 4 }}>% Comissão Inicial (Setup)</label>
                    <input type="number" className="input" value={form.commission_setup_rate} onChange={e => setForm({...form, commission_setup_rate: Number(e.target.value)})} style={{ width: '100%' }} />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: 11, color: '#fff', marginBottom: 4 }}>% Comissão Mensal (Recorrente)</label>
                    <input type="number" className="input" value={form.commission_recurring_rate} onChange={e => setForm({...form, commission_recurring_rate: Number(e.target.value)})} style={{ width: '100%' }} />
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 16 }}>
                <button type="button" className="btn" onClick={() => setModalOpen(false)}>Cancelar</button>
                <button type="submit" className="btn btn-primary">Salvar Parceiro</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
