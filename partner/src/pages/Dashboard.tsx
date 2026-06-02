import { useState, useEffect } from 'react'
import type { Session } from '@supabase/supabase-js'
import { Users, UserCheck, DollarSign, TrendingUp, AlertCircle, ArrowRight } from 'lucide-react'

interface DashboardProps {
  session: Session
  partner: any
  onNavigate: (page: any) => void
}

export default function Dashboard({ session, partner, onNavigate }: DashboardProps) {
  const [commissions, setCommissions] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

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

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto' }}>
      <div style={{ marginBottom: 32 }}>
        <h1 style={{ fontSize: 32, fontWeight: 800, margin: '0 0 8px 0' }}>Dashboard de Parceiro</h1>
        <p style={{ color: 'var(--text-muted)', margin: 0, fontSize: 16 }}>
          Bem-vindo de volta, {partner.partner_name}. Aqui está o resumo das suas indicações e comissões.
        </p>
      </div>

      {/* KPIs Principais */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 20, marginBottom: 40 }}>
        <div style={{ background: 'var(--bg-darker)', border: '1px solid var(--border)', borderRadius: 16, padding: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
            <div style={{ width: 40, height: 40, borderRadius: 12, background: 'rgba(99,102,241,0.1)', color: '#818cf8', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Users size={20} />
            </div>
            <div style={{ color: 'var(--text-muted)', fontSize: 14, fontWeight: 600 }}>Total de Clientes</div>
          </div>
          <div style={{ fontSize: 36, fontWeight: 800 }}>{partner.total_clients || 0}</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8 }}>{partner.active_clients || 0} ativos · {partner.trial_clients || 0} em trial</div>
        </div>

        <div style={{ background: 'var(--bg-darker)', border: '1px solid var(--border)', borderRadius: 16, padding: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
            <div style={{ width: 40, height: 40, borderRadius: 12, background: 'rgba(16,185,129,0.1)', color: '#34d399', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <DollarSign size={20} />
            </div>
            <div style={{ color: 'var(--text-muted)', fontSize: 14, fontWeight: 600 }}>Comissão Pendente</div>
          </div>
          <div style={{ fontSize: 36, fontWeight: 800, color: '#34d399' }}>
            {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(partner.pending_commission || 0)}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8 }}>Aguardando faturamento / prazo</div>
        </div>

        <div style={{ background: 'var(--bg-darker)', border: '1px solid var(--border)', borderRadius: 16, padding: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
            <div style={{ width: 40, height: 40, borderRadius: 12, background: 'rgba(245,158,11,0.1)', color: '#fbbf24', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <TrendingUp size={20} />
            </div>
            <div style={{ color: 'var(--text-muted)', fontSize: 14, fontWeight: 600 }}>Total Recebido (Histórico)</div>
          </div>
          <div style={{ fontSize: 36, fontWeight: 800 }}>
            {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(partner.total_paid_commission || 0)}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8 }}>Soma de todas comissões pagas</div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 24 }}>
        {/* Comissões Recentes */}
        <div style={{ background: 'var(--bg-darker)', border: '1px solid var(--border)', borderRadius: 16, padding: 24 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
            <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Comissões Recentes</h2>
            <button className="btn" style={{ fontSize: 12, padding: '6px 12px' }} onClick={() => onNavigate('commissions')}>
              Ver todas <ArrowRight size={14} />
            </button>
          </div>

          {loading ? (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>Carregando...</div>
          ) : commissions.length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)', background: 'var(--bg-darkest)', borderRadius: 12 }}>
              Nenhuma comissão registrada ainda.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {commissions.slice(0, 5).map(c => (
                <div key={c.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px', background: 'var(--bg-darkest)', borderRadius: 12, border: '1px solid var(--border)' }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{c.tenants?.name || 'Cliente Indefinido'}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                      {c.is_setup ? 'Taxa de Adesão' : `Mensalidade (${new Date(c.reference_month).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })})`}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontWeight: 700, fontSize: 15, color: '#34d399' }}>
                      {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(c.commission_value)}
                    </div>
                    <div style={{ 
                      display: 'inline-block', marginTop: 4, padding: '2px 8px', borderRadius: 12, fontSize: 10, fontWeight: 600, textTransform: 'uppercase',
                      background: c.status === 'paid' ? 'rgba(16,185,129,0.1)' : c.status === 'approved' ? 'rgba(59,130,246,0.1)' : c.status === 'cancelled' ? 'rgba(239,68,68,0.1)' : 'rgba(245,158,11,0.1)',
                      color: c.status === 'paid' ? '#34d399' : c.status === 'approved' ? '#60a5fa' : c.status === 'cancelled' ? '#f87171' : '#fbbf24'
                    }}>
                      {c.status === 'paid' ? 'Paga' : c.status === 'approved' ? 'Aprovada' : c.status === 'cancelled' ? 'Cancelada' : 'Pendente'}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Links Rápidos */}
        <div style={{ background: 'var(--bg-darker)', border: '1px solid var(--border)', borderRadius: 16, padding: 24, alignSelf: 'start' }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, margin: '0 0 24px 0' }}>Ações Rápidas</h2>
          
          <button 
            className="btn btn-primary" 
            style={{ width: '100%', justifyContent: 'center', marginBottom: 12, padding: 16 }}
            onClick={() => onNavigate('clients_new')}
          >
            <UserCheck size={18} /> Cadastrar Novo Cliente
          </button>
          
          <button 
            className="btn" 
            style={{ width: '100%', justifyContent: 'center', padding: 16 }}
            onClick={() => onNavigate('profile')}
          >
            <User size={18} /> Meu Perfil e Dados Bancários
          </button>

          <div style={{ marginTop: 32, padding: 16, background: 'rgba(99,102,241,0.05)', borderRadius: 12, border: '1px dashed rgba(99,102,241,0.2)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, color: '#818cf8', fontWeight: 600 }}>
              <AlertCircle size={16} /> Regras de Pagamento
            </div>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0, lineHeight: 1.5 }}>
              As comissões são apuradas no último dia útil do mês e pagas até o dia 10 do mês seguinte, via PIX.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
