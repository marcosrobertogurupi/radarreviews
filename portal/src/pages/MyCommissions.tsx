import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { DollarSign, ExternalLink } from 'lucide-react'
import { useToast } from '../components/Toast'

interface Commission {
  id: string
  reference_month: string
  plan_value: number
  commission_value: number
  status: 'pending' | 'approved' | 'paid'
  is_setup: boolean
  created_at: string
  tenant: { name: string }
}

export default function MyCommissions() {
  const { toast } = useToast()
  const [commissions, setCommissions] = useState<Commission[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadCommissions()
  }, [])

  async function loadCommissions() {
    setLoading(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) return

      const { data: partner } = await supabase
        .from('partners')
        .select('id')
        .eq('user_id', session.user.id)
        .single()

      if (!partner) {
        setCommissions([])
        return
      }

      // TODO: Ajustar a query se o schema da tabela commissions exigir join diferente
      const { data: cData } = await supabase
        .from('commissions')
        .select(`
          id, reference_month, plan_value, commission_value, status, is_setup, created_at,
          tenant:tenants(name)
        `)
        .eq('partner_id', partner.id)
        .order('created_at', { ascending: false })
      
      setCommissions(cData as any || [])
    } catch (err: any) {
      toast('Erro ao carregar comissões: ' + err.message, 'error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="p-8">
      <div className="page-header mb-8">
        <h1 className="page-title">Minhas Comissões</h1>
        <p className="page-subtitle">Extrato financeiro das suas indicações e comissões.</p>
      </div>

      {loading ? (
        <div className="skeleton" style={{ width: '100%', height: 300 }} />
      ) : commissions.length === 0 ? (
        <div className="card empty-state">
          <div className="empty-state-icon">💸</div>
          <div className="empty-state-text">Nenhuma comissão registrada ainda.</div>
          <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 8 }}>
            Assim que seus clientes realizarem o primeiro pagamento, as comissões aparecerão aqui.
          </p>
        </div>
      ) : (
        <div className="card" style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)', textAlign: 'left', color: 'var(--text-muted)' }}>
                <th style={{ padding: '16px' }}>Mês Referência</th>
                <th style={{ padding: '16px' }}>Cliente</th>
                <th style={{ padding: '16px' }}>Tipo</th>
                <th style={{ padding: '16px', textAlign: 'right' }}>Valor Recebido (R$)</th>
                <th style={{ padding: '16px', textAlign: 'right' }}>Sua Comissão (R$)</th>
                <th style={{ padding: '16px', textAlign: 'center' }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {commissions.map(c => {
                const statusColors = {
                  pending: { bg: 'rgba(245, 158, 11, 0.1)', color: '#f59e0b', label: 'Pendente' },
                  approved: { bg: 'rgba(96, 165, 250, 0.1)', color: '#60a5fa', label: 'Aprovada' },
                  paid: { bg: 'rgba(16, 185, 129, 0.1)', color: '#10b981', label: 'Paga' },
                }
                const st = statusColors[c.status] || statusColors.pending

                return (
                  <tr key={c.id} style={{ borderBottom: '1px solid var(--border)', color: 'var(--text-primary)' }}>
                    <td style={{ padding: '16px' }}>
                      {new Date(c.reference_month).toLocaleDateString('pt-BR', { month: 'short', year: 'numeric' })}
                    </td>
                    <td style={{ padding: '16px', fontWeight: 600 }}>{c.tenant?.name || 'Cliente Removido'}</td>
                    <td style={{ padding: '16px' }}>
                      {c.is_setup ? (
                        <span style={{ color: '#a855f7', fontWeight: 600, fontSize: 11, background: 'rgba(168, 85, 247, 0.1)', padding: '2px 8px', borderRadius: 99 }}>Setup</span>
                      ) : (
                        <span style={{ color: '#3b82f6', fontWeight: 600, fontSize: 11, background: 'rgba(59, 130, 246, 0.1)', padding: '2px 8px', borderRadius: 99 }}>Recorrência</span>
                      )}
                    </td>
                    <td style={{ padding: '16px', textAlign: 'right' }}>R$ {c.plan_value.toFixed(2)}</td>
                    <td style={{ padding: '16px', textAlign: 'right', fontWeight: 700, color: '#10b981' }}>R$ {c.commission_value.toFixed(2)}</td>
                    <td style={{ padding: '16px', textAlign: 'center' }}>
                      <span style={{ 
                        fontSize: 11, fontWeight: 600, padding: '4px 8px', borderRadius: 6,
                        background: st.bg, color: st.color, border: `1px solid ${st.color}40`
                      }}>
                        {st.label}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
