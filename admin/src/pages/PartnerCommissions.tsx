import { useState, useEffect } from 'react'
import { DollarSign, Search, CheckCircle, XCircle } from 'lucide-react'

export default function PartnerCommissions() {
  const [commissions, setCommissions] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState<string>('all')

  useEffect(() => {
    fetchCommissions()
  }, [])

  const fetchCommissions = () => {
    setLoading(true)
    fetch(`${import.meta.env.VITE_API_URL}/api/admin/commissions`, {
      headers: { 'Authorization': `Bearer ${localStorage.getItem('supabase.auth.token') || ''}` }
    })
    .then(r => r.json())
    .then(data => {
      if (data.ok) setCommissions(data.commissions)
      setLoading(false)
    })
    .catch(() => setLoading(false))
  }

  const handleUpdateStatus = async (id: string, status: string) => {
    if (!confirm(`Deseja alterar o status para ${status}?`)) return
    
    try {
      const res = await fetch(`${import.meta.env.VITE_API_URL}/api/admin/commissions/${id}/status`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('supabase.auth.token') || ''}`
        },
        body: JSON.stringify({ status })
      })
      if (!res.ok) throw new Error('Erro ao atualizar status')
      fetchCommissions()
    } catch (err: any) {
      alert(`Erro: ${err.message}`)
    }
  }

  const formatBRL = (v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v)

  const filtered = commissions.filter(c => {
    const matchStatus = filterStatus === 'all' || c.status === filterStatus
    const matchSearch = c.partners?.name?.toLowerCase().includes(search.toLowerCase()) || 
                        c.tenants?.name?.toLowerCase().includes(search.toLowerCase())
    return matchStatus && matchSearch
  })

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 800, margin: '0 0 4px 0' }}>Comissões de Parceiros</h1>
          <p style={{ color: 'var(--text-muted)', margin: 0, fontSize: 14 }}>
            Controle de apuração e pagamentos de comissões.
          </p>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 16, marginBottom: 24 }}>
        <div style={{ position: 'relative', flex: 1, maxWidth: 300 }}>
          <Search size={18} style={{ position: 'absolute', left: 16, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input 
            type="text" 
            placeholder="Buscar por parceiro ou cliente..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ 
              width: '100%', padding: '10px 16px 10px 48px', 
              background: 'var(--bg-darker)', border: '1px solid var(--border)', 
              borderRadius: 8, color: 'var(--text-primary)', outline: 'none' 
            }}
          />
        </div>
        
        <select 
          className="input"
          value={filterStatus}
          onChange={e => setFilterStatus(e.target.value)}
          style={{ width: 200, cursor: 'pointer' }}
        >
          <option value="all">Todos os Status</option>
          <option value="pending">Pendentes</option>
          <option value="approved">Aprovadas</option>
          <option value="paid">Pagas</option>
          <option value="cancelled">Canceladas</option>
        </select>
      </div>

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
          <thead>
            <tr style={{ background: 'var(--bg-darkest)', borderBottom: '1px solid var(--border)', color: 'var(--text-muted)', fontSize: 12, textTransform: 'uppercase' }}>
              <th style={{ padding: '16px 24px', fontWeight: 700 }}>Data Referência</th>
              <th style={{ padding: '16px 24px', fontWeight: 700 }}>Parceiro</th>
              <th style={{ padding: '16px 24px', fontWeight: 700 }}>Cliente Gerador</th>
              <th style={{ padding: '16px 24px', fontWeight: 700 }}>Valores</th>
              <th style={{ padding: '16px 24px', fontWeight: 700 }}>Status</th>
              <th style={{ padding: '16px 24px', fontWeight: 700 }}>Ações</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>Carregando...</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={6} style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>Nenhuma comissão encontrada.</td></tr>
            ) : (
              filtered.map(c => (
                <tr key={c.id} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '16px 24px', fontSize: 13 }}>
                    {new Date(c.reference_month).toLocaleDateString('pt-BR', { month: 'short', year: 'numeric' })}
                  </td>
                  <td style={{ padding: '16px 24px' }}>
                    <div style={{ fontWeight: 600 }}>{c.partners?.name}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{c.partners?.email}</div>
                  </td>
                  <td style={{ padding: '16px 24px' }}>
                    <div style={{ fontSize: 13, fontWeight: 500 }}>{c.tenants?.name}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                      {c.plan_name} ({c.is_setup ? 'Adesão' : 'Mensalidade'})
                    </div>
                  </td>
                  <td style={{ padding: '16px 24px' }}>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Base: {formatBRL(c.plan_value)}</div>
                    <div style={{ fontWeight: 700, color: '#34d399', fontSize: 14 }}>{formatBRL(c.commission_value)}</div>
                  </td>
                  <td style={{ padding: '16px 24px' }}>
                    <div style={{ 
                      display: 'inline-block', padding: '4px 10px', borderRadius: 12, fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
                      background: c.status === 'paid' ? 'rgba(16,185,129,0.1)' : c.status === 'approved' ? 'rgba(59,130,246,0.1)' : c.status === 'cancelled' ? 'rgba(239,68,68,0.1)' : 'rgba(245,158,11,0.1)',
                      color: c.status === 'paid' ? '#34d399' : c.status === 'approved' ? '#60a5fa' : c.status === 'cancelled' ? '#f87171' : '#fbbf24'
                    }}>
                      {c.status === 'paid' ? 'Paga' : c.status === 'approved' ? 'Aprovada' : c.status === 'cancelled' ? 'Cancelada' : 'Pendente'}
                    </div>
                  </td>
                  <td style={{ padding: '16px 24px' }}>
                    <div style={{ display: 'flex', gap: 8 }}>
                      {c.status === 'pending' && (
                        <button className="btn" style={{ padding: '4px 8px', fontSize: 12 }} onClick={() => handleUpdateStatus(c.id, 'approved')}>
                          <CheckCircle size={14} style={{ color: '#60a5fa' }} /> Aprovar
                        </button>
                      )}
                      {c.status === 'approved' && (
                        <button className="btn" style={{ padding: '4px 8px', fontSize: 12 }} onClick={() => handleUpdateStatus(c.id, 'paid')}>
                          <DollarSign size={14} style={{ color: '#34d399' }} /> Pagar
                        </button>
                      )}
                      {['pending', 'approved'].includes(c.status) && (
                        <button className="btn" style={{ padding: '4px 8px', fontSize: 12 }} onClick={() => handleUpdateStatus(c.id, 'cancelled')}>
                          <XCircle size={14} style={{ color: '#f87171' }} /> Cancelar
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
