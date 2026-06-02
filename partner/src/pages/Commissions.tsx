import { useState, useEffect } from 'react'
import type { Session } from '@supabase/supabase-js'
import { DollarSign, Search, FileText, Download } from 'lucide-react'

interface CommissionsProps {
  session: Session
}

export default function Commissions({ session }: CommissionsProps) {
  const [commissions, setCommissions] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [filterStatus, setFilterStatus] = useState<string>('all')

  useEffect(() => {
    fetch(`${import.meta.env.VITE_API_URL}/api/partner/commissions`, {
      headers: { 'Authorization': `Bearer ${session.access_token}` }
    })
    .then(r => r.json())
    .then(data => {
      if (data.ok) setCommissions(data.commissions)
      setLoading(false)
    })
    .catch(() => setLoading(false))
  }, [session])

  const filtered = commissions.filter(c => filterStatus === 'all' || c.status === filterStatus)

  const formatBRL = (v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v)

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 32 }}>
        <div>
          <h1 style={{ fontSize: 32, fontWeight: 800, margin: '0 0 8px 0' }}>Extrato de Comissões</h1>
          <p style={{ color: 'var(--text-muted)', margin: 0, fontSize: 16 }}>
            Acompanhe seus recebimentos e status de pagamento.
          </p>
        </div>
        <button className="btn">
          <Download size={16} /> Exportar CSV
        </button>
      </div>

      <div style={{ display: 'flex', gap: 16, marginBottom: 24 }}>
        <select 
          value={filterStatus}
          onChange={e => setFilterStatus(e.target.value)}
          style={{ 
            padding: '12px 16px', background: 'var(--bg-darker)', border: '1px solid var(--border)', 
            borderRadius: 12, color: 'var(--text-primary)', outline: 'none', cursor: 'pointer', minWidth: 200
          }}
        >
          <option value="all">Todos os Status</option>
          <option value="pending">Pendentes</option>
          <option value="approved">Aprovadas</option>
          <option value="paid">Pagas</option>
          <option value="cancelled">Canceladas</option>
        </select>
      </div>

      <div style={{ background: 'var(--bg-darker)', border: '1px solid var(--border)', borderRadius: 16, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
          <thead>
            <tr style={{ background: 'var(--bg-darkest)', borderBottom: '1px solid var(--border)', color: 'var(--text-muted)', fontSize: 13, textTransform: 'uppercase' }}>
              <th style={{ padding: '16px 24px', fontWeight: 700 }}>Data Referência</th>
              <th style={{ padding: '16px 24px', fontWeight: 700 }}>Cliente</th>
              <th style={{ padding: '16px 24px', fontWeight: 700 }}>Plano / Tipo</th>
              <th style={{ padding: '16px 24px', fontWeight: 700 }}>Valor Base</th>
              <th style={{ padding: '16px 24px', fontWeight: 700 }}>Comissão</th>
              <th style={{ padding: '16px 24px', fontWeight: 700 }}>Status</th>
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
                  <td style={{ padding: '16px 24px' }}>{new Date(c.reference_month).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}</td>
                  <td style={{ padding: '16px 24px', fontWeight: 600 }}>{c.tenants?.name || 'Indefinido'}</td>
                  <td style={{ padding: '16px 24px' }}>
                    <div style={{ textTransform: 'capitalize' }}>{c.plan_name}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{c.is_setup ? 'Adesão (Setup)' : 'Recorrente'}</div>
                  </td>
                  <td style={{ padding: '16px 24px', color: 'var(--text-muted)' }}>{formatBRL(c.plan_value)}</td>
                  <td style={{ padding: '16px 24px', fontWeight: 700, color: '#34d399' }}>{formatBRL(c.commission_value)}</td>
                  <td style={{ padding: '16px 24px' }}>
                    <div style={{ 
                      display: 'inline-block', padding: '4px 10px', borderRadius: 12, fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
                      background: c.status === 'paid' ? 'rgba(16,185,129,0.1)' : c.status === 'approved' ? 'rgba(59,130,246,0.1)' : c.status === 'cancelled' ? 'rgba(239,68,68,0.1)' : 'rgba(245,158,11,0.1)',
                      color: c.status === 'paid' ? '#34d399' : c.status === 'approved' ? '#60a5fa' : c.status === 'cancelled' ? '#f87171' : '#fbbf24'
                    }}>
                      {c.status === 'paid' ? 'Paga' : c.status === 'approved' ? 'Aprovada' : c.status === 'cancelled' ? 'Cancelada' : 'Pendente'}
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
