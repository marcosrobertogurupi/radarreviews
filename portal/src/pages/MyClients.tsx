import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Building2, KeyRound, Plus, Users } from 'lucide-react'
import { useToast } from '../components/Toast'
import RegisterClient from './RegisterClient'

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

const PLAN_COLORS: Record<string, string> = {
  basico:     '#06b6d4',
  completo:   '#6366f1',
  enterprise: '#f59e0b',
  trial:      '#6b7280',
}

export default function MyClients({ onSelectTenant }: { onSelectTenant: (id: string) => void }) {
  const { toast } = useToast()
  const [tenants, setTenants] = useState<Tenant[]>([])
  const [loading, setLoading] = useState(true)
  const [showRegister, setShowRegister] = useState(false)

  useEffect(() => {
    loadClients()
  }, [])

  async function loadClients() {
    setLoading(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) return

      const { data: partner } = await supabase
        .from('partners')
        .select('id')
        .eq('user_id', session.user.id)
        .single()

      if (!partner) { setTenants([]); return }

      const { data: tData } = await supabase
        .from('tenants')
        .select('*')
        .eq('partner_id', partner.id)
        .order('name', { ascending: true })

      const sortedTenants = (tData || []).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' }))
      setTenants(sortedTenants)
    } catch (err: any) {
      toast('Erro ao carregar clientes: ' + err.message, 'error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ padding: '32px 40px', maxWidth: 1200 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 32 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 28, fontWeight: 800, color: 'var(--text-primary)' }}>Meus Clientes</h1>
          <p style={{ margin: '6px 0 0', color: 'var(--text-muted)', fontSize: 14 }}>
            Gerencie as contas dos clientes da sua carteira.
          </p>
        </div>
        <button
          className="btn btn-primary"
          onClick={() => setShowRegister(true)}
          style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 20px' }}
        >
          <Plus size={16} />
          Cadastrar Novo Cliente
        </button>
      </div>

      {/* Stats bar */}
      {tenants.length > 0 && (
        <div style={{
          display: 'flex', gap: 24, padding: '16px 20px',
          background: 'rgba(99,102,241,0.06)', border: '1px solid rgba(99,102,241,0.15)',
          borderRadius: 12, marginBottom: 24
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Users size={18} color="#818cf8" />
            <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>Total: <strong style={{ color: 'var(--text-primary)' }}>{tenants.length}</strong></span>
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
            Ativos: <strong style={{ color: '#10b981' }}>{tenants.filter(t => (t.is_active ?? true) && t.plan_status !== 'paused').length}</strong>
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
            Em trial: <strong style={{ color: '#60a5fa' }}>{tenants.filter(t => t.plan_status === 'trial').length}</strong>
          </div>
        </div>
      )}

      {/* Content */}
      {loading ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 }}>
          {[1,2,3].map(i => <div key={i} className="skeleton" style={{ height: 160, borderRadius: 16 }} />)}
        </div>
      ) : tenants.length === 0 ? (
        <div style={{
          textAlign: 'center', padding: '60px 40px',
          background: 'var(--bg-dark)', border: '1px dashed var(--border)',
          borderRadius: 20
        }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>🏢</div>
          <h3 style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 8 }}>
            Nenhum cliente cadastrado ainda
          </h3>
          <p style={{ color: 'var(--text-muted)', fontSize: 14, marginBottom: 24, maxWidth: 380, margin: '0 auto 24px' }}>
            Cadastre um cliente diretamente aqui ou envie seu link de indicação para que ele se cadastre sozinho.
          </p>
          <button
            className="btn btn-primary"
            onClick={() => setShowRegister(true)}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '12px 24px' }}
          >
            <Plus size={16} />
            Cadastrar Primeiro Cliente
          </button>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 }}>
          {tenants.map(t => {
            const isActive = t.is_active ?? true
            const trialExpired = t.plan_status === 'trial' && t.trial_ends_at && new Date(t.trial_ends_at) < new Date()
            const trialActive  = t.plan_status === 'trial' && (!t.trial_ends_at || new Date(t.trial_ends_at) >= new Date())
            const isPaused     = t.plan_status === 'paused' || !isActive

            const statusColor  = isPaused ? '#ef4444' : trialExpired ? '#f59e0b' : trialActive ? '#60a5fa' : '#10b981'
            const statusBg     = isPaused ? 'rgba(239,68,68,0.1)' : trialExpired ? 'rgba(245,158,11,0.1)' : trialActive ? 'rgba(96,165,250,0.1)' : 'rgba(16,185,129,0.1)'
            const statusBorder = isPaused ? 'rgba(239,68,68,0.2)' : trialExpired ? 'rgba(245,158,11,0.2)' : trialActive ? 'rgba(96,165,250,0.2)' : 'rgba(16,185,129,0.2)'
            const label        = isPaused ? 'Bloqueado' : trialExpired ? 'Trial Expirado' : trialActive ? 'Trial Ativo' : 'Ativo'
            const emoji        = isPaused ? '⚫' : trialExpired ? '⏰' : trialActive ? '⏳' : '🟢'
            const planColor    = PLAN_COLORS[t.plan ?? 'trial'] ?? '#6b7280'
            const planLabel    = t.plan ? t.plan.charAt(0).toUpperCase() + t.plan.slice(1) : 'Trial'

            return (
              <div
                key={t.id}
                className="card"
                style={{
                  padding: 20, opacity: isActive ? 1 : 0.65,
                  display: 'flex', flexDirection: 'column', gap: 16,
                  transition: 'transform 0.15s, box-shadow 0.15s',
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.transform = 'translateY(-2px)' }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.transform = '' }}
              >
                {/* Top row */}
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                  <div style={{ background: isActive ? 'rgba(99,102,241,0.1)' : 'rgba(156,163,175,0.1)', padding: 10, borderRadius: 10, flexShrink: 0 }}>
                    <Building2 size={22} color={isActive ? '#a5b4fc' : '#9ca3af'} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <h3 style={{ margin: '0 0 6px', fontSize: 15, color: 'var(--text-primary)', fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {t.name}
                    </h3>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      <div style={{
                        display: 'inline-flex', alignItems: 'center', gap: 4,
                        fontSize: 11, padding: '2px 8px', borderRadius: 99,
                        background: statusBg, color: statusColor, border: `1px solid ${statusBorder}`,
                        fontWeight: 600
                      }}>
                        {emoji} {label}
                      </div>
                      <span style={{
                        fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 99,
                        background: `${planColor}22`, color: planColor, border: `1px solid ${planColor}44`
                      }}>
                        {planLabel}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Trial info */}
                {t.trial_ends_at && t.plan_status === 'trial' && (
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', background: 'var(--bg-darker)', padding: '6px 10px', borderRadius: 6 }}>
                    {trialExpired
                      ? `⏰ Trial expirou em ${new Date(t.trial_ends_at).toLocaleDateString('pt-BR')}`
                      : `⏳ Trial até ${new Date(t.trial_ends_at).toLocaleDateString('pt-BR')} · ${Math.max(0, Math.ceil((new Date(t.trial_ends_at).getTime() - Date.now()) / 86_400_000))} dias restantes`
                    }
                  </div>
                )}

                {/* Actions */}
                <div style={{ borderTop: '1px solid var(--border)', paddingTop: 14, display: 'flex', justifyContent: 'flex-end' }}>
                  <button
                    onClick={() => onSelectTenant(t.id)}
                    className="btn btn-primary"
                    style={{ padding: '7px 16px', fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}
                  >
                    <KeyRound size={14} />
                    Acessar Painel
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Modal de cadastro */}
      {showRegister && (
        <RegisterClient
          onClose={() => setShowRegister(false)}
          onSuccess={() => {
            setShowRegister(false)
            loadClients()
          }}
        />
      )}
    </div>
  )
}
