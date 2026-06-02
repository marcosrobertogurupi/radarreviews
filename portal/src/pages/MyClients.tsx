import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Building2, KeyRound } from 'lucide-react'
import { useToast } from '../components/Toast'

interface Tenant {
  id: string
  name: string
  slug: string
  plan?: string
  is_active?: boolean
  plan_status?: string
  trial_ends_at?: string | null
  created_at: string
}

export default function MyClients({ onSelectTenant }: { onSelectTenant: (id: string) => void }) {
  const { toast } = useToast()
  const [tenants, setTenants] = useState<Tenant[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadClients()
  }, [])

  async function loadClients() {
    setLoading(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) return

      // Obter o partner_id deste usuário
      const { data: partner } = await supabase
        .from('partners')
        .select('id')
        .eq('user_id', session.user.id)
        .single()

      if (!partner) {
        setTenants([])
        return
      }

      const { data: tData } = await supabase
        .from('tenants')
        .select('*')
        .eq('partner_id', partner.id)
        .order('created_at', { ascending: false })
      
      setTenants(tData || [])
    } catch (err: any) {
      toast('Erro ao carregar clientes: ' + err.message, 'error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="p-8">
      <div className="page-header mb-8">
        <h1 className="page-title">Meus Clientes</h1>
        <p className="page-subtitle">Gerencie as contas dos clientes que você indicou.</p>
      </div>

      {loading ? (
        <div className="skeleton" style={{ width: '100%', height: 200 }} />
      ) : tenants.length === 0 ? (
        <div className="card empty-state">
          <div className="empty-state-icon">🏢</div>
          <div className="empty-state-text">Nenhum cliente cadastrado ainda.</div>
          <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 8 }}>
            Envie seu link de indicação para seus clientes se cadastrarem.
          </p>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 }}>
          {tenants.map(t => {
            const isActive = t.is_active ?? true
            const trialExpired = t.plan_status === 'trial' && t.trial_ends_at && new Date(t.trial_ends_at) < new Date()
            const trialActive = t.plan_status === 'trial' && (!t.trial_ends_at || new Date(t.trial_ends_at) >= new Date())
            const statusColor = !isActive ? '#ef4444' : (trialExpired ? '#f59e0b' : (trialActive ? '#60a5fa' : '#10b981'))
            const statusBg = !isActive ? 'rgba(239, 68, 68, 0.1)' : (trialExpired ? 'rgba(245, 158, 11, 0.1)' : (trialActive ? 'rgba(96, 165, 250, 0.1)' : 'rgba(16, 185, 129, 0.1)'))
            const statusBorder = !isActive ? 'rgba(239, 68, 68, 0.2)' : (trialExpired ? 'rgba(245, 158, 11, 0.2)' : (trialActive ? 'rgba(96, 165, 250, 0.2)' : 'rgba(16, 185, 129, 0.2)'))
            const label = !isActive ? 'Bloqueado' : (trialExpired ? 'Trial Expirado' : (trialActive ? 'Trial Ativo' : 'Ativo'))
            const emoji = !isActive ? '⚫' : (trialExpired ? '⏰' : (trialActive ? '⏳' : '🟢'))

            return (
              <div key={t.id} className="card" style={{ padding: 20, opacity: isActive ? 1 : 0.6, display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                  <div style={{ background: isActive ? 'rgba(99,102,241,0.1)' : 'rgba(156,163,175,0.1)', padding: 10, borderRadius: 8, flexShrink: 0 }}>
                    <Building2 size={24} color={isActive ? "#a5b4fc" : "#9ca3af"} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <h3 style={{ margin: '0 0 4px 0', fontSize: 16, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {t.name}
                    </h3>
                    <div style={{ 
                      display: 'inline-flex', alignItems: 'center', gap: 4, 
                      fontSize: 11, padding: '2px 8px', borderRadius: 99, 
                      background: statusBg, color: statusColor, border: `1px solid ${statusBorder}`
                    }}>
                      <span>{emoji}</span>
                      {label}
                    </div>
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: '1px solid var(--border)', paddingTop: 16 }}>
                  <div>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700 }}>Plano</span>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginTop: 2 }}>
                      {t.plan?.charAt(0).toUpperCase()}{t.plan?.slice(1) || 'Trial'}
                    </div>
                  </div>
                  <button 
                    onClick={() => onSelectTenant(t.id)}
                    className="btn btn-primary" 
                    style={{ padding: '6px 12px', fontSize: 12 }}
                  >
                    <KeyRound size={14} /> Acessar Painel
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
