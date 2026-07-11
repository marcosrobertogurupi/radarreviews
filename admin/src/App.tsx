import { useState, useEffect } from 'react'
import type { ReactElement } from 'react'
import { supabase } from './lib/supabase'
import type { Session } from '@supabase/supabase-js'
import {
  LayoutDashboard, MessageSquare, Bell, Radio,
  Building2, RefreshCw, ChevronRight, LogOut, ShieldCheck, CreditCard, LifeBuoy,
  Target, Briefcase
} from 'lucide-react'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Reviews from './pages/Reviews'
import Alerts from './pages/Alerts'
import Connectors from './pages/Connectors'
import Tenants from './pages/Tenants'
import Audit from './pages/Audit'
import Plans from './pages/Plans'
import SupportCenter from './pages/SupportCenter'
import Prospects from './pages/Prospects'
import Commercial from './pages/Commercial'
import Partners from './pages/Partners'
import PartnerCommissions from './pages/PartnerCommissions'


type Page = 'dashboard' | 'reviews' | 'alerts' | 'connectors' | 'tenants' | 'plans' | 'audit' | 'support' | 'prospects' | 'commercial' | 'partners' | 'partner_commissions'


export interface TenantOption { id: string; name: string }

const NAV = [
  { id: 'dashboard' as Page,   label: 'Dashboard',   icon: LayoutDashboard },
  { id: 'commercial' as Page,  label: 'Comercial',   icon: Briefcase },
  { id: 'prospects' as Page,   label: 'Prospecção',  icon: Target },
  { id: 'partners' as Page,    label: 'Parceiros',   icon: Building2 },
  { id: 'partner_commissions' as Page, label: 'Comissões', icon: CreditCard },
  { id: 'reviews' as Page,     label: 'Reviews',     icon: MessageSquare },
  { id: 'alerts' as Page,      label: 'Alertas',     icon: Bell },
  { id: 'connectors' as Page,  label: 'Conectores',  icon: Radio },
  { id: 'tenants' as Page,     label: 'Assinantes',  icon: Building2 },
  { id: 'plans' as Page,       label: 'Planos',      icon: CreditCard },
  { id: 'audit' as Page,       label: 'Auditoria',   icon: ShieldCheck },
  { id: 'support' as Page,     label: 'Suporte',     icon: LifeBuoy },
]

export default function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [loadingSession, setLoadingSession] = useState(true)
  const [authError, setAuthError] = useState<string | null>(null)
  const [page, setPage] = useState<Page>('dashboard')
  const [tenants, setTenants] = useState<TenantOption[]>([])
  const [selectedTenantId, setSelectedTenantId] = useState('')
  const [isValidated, setIsValidated] = useState(false)
  const [criticalErrorCount, setCriticalErrorCount] = useState(0)

  async function fetchCriticalErrors() {
    try {
      const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString()
      const { data, error } = await supabase
        .from('channel_connectors')
        .select('id')
        .eq('status', 'error')
        .lte('first_error_at', threeDaysAgo)
      
      if (!error) {
        setCriticalErrorCount(data?.length || 0)
      }
    } catch (err) {
      console.error('Erro ao buscar falhas críticas de 3 dias:', err)
    }
  }

  async function validateProfile(session: Session, retry = true): Promise<boolean> {
    // Se já validamos este usuário nesta carga de página, não precisamos validar de novo
    if (isValidated) return true

    console.log('[Auth] Validando perfil...')
    try {
      const queryPromise = supabase
        .from('usuarios')
        .select('perfil, ativo')
        .eq('id', session.user.id)
        .maybeSingle()

      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('TIMEOUT')), 15000)
      )

      const result = await Promise.race([queryPromise, timeoutPromise]) as any
      const { data, error } = result

      if (error) {
        console.error('[Auth] Erro na consulta:', error)
        if (retry) {
          await new Promise(r => setTimeout(r, 2000))
          return validateProfile(session, false)
        }
        // Em caso de erro de conexão, se já tínhamos uma sessão, vamos mantê-la temporariamente
        return !!session 
      }

      if (!data) {
        if (retry) {
          await new Promise(r => setTimeout(r, 2000))
          return validateProfile(session, false)
        }
        setAuthError('Perfil não localizado.')
        return false
      }

      if (!data.ativo || !['admin', 'operador'].includes(data.perfil)) {
        await supabase.auth.signOut()
        setAuthError(data.ativo ? 'Acesso restrito.' : 'Conta desativada.')
        return false
      }

      setAuthError(null)
      setIsValidated(true)
      return true
    } catch (err: any) {
      // Se for timeout, mantemos a sessão para não interromper o trabalho do user
      if (err.message === 'TIMEOUT') {
        console.warn('[Auth] Timeout na validação, mantendo sessão atual.')
        return !!session
      }
      return false
    }
  }

  useEffect(() => {
    // Carregar sessão inicial com tratamento robusto de erros para evitar tela de carregamento travada
    supabase.auth.getSession()
      .then(async ({ data: { session } }) => {
        try {
          if (session) {
            const ok = await validateProfile(session)
            if (ok) {
              setSession(session)
              loadTenants()
              fetchCriticalErrors()
            }
          }
        } catch (err) {
          console.error('[Auth] Erro ao validar perfil na carga inicial:', err)
        } finally {
          setLoadingSession(false)
        }
      })
      .catch((err) => {
        console.error('[Auth] Erro ao carregar sessão inicial:', err)
        setLoadingSession(false)
      })

    const authSub = supabase.auth.onAuthStateChange(async (event, session) => {
      console.log('Auth Event:', event)
      
      if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
        if (session) {
          try {
            const ok = await validateProfile(session)
            if (ok) {
              setSession(session)
              fetchCriticalErrors()
            }
          } catch (err) {
            console.error('[Auth] Erro ao validar perfil no evento de auth:', err)
          }
        }
      } else if (event === 'SIGNED_OUT') {
        setSession(null)
        setIsValidated(false)
        setAuthError(null)
        setCriticalErrorCount(0)
      }
    })

    async function loadTenants() {
      try {
        const { data, error } = await supabase.from('tenants').select('id, name').order('name')
        if (error) throw error
        setTenants(data ?? [])
      } catch (err) {
        console.error('Erro ao carregar tenants:', err)
      }
    }

    const handleRefresh = () => {
      loadTenants()
      fetchCriticalErrors()
    }
    window.addEventListener('refresh_data', handleRefresh)

    // Antena Real-Time global para toda a schema 'public'
    let debounceTimer: ReturnType<typeof setTimeout>
    const dbSub = supabase.channel('global-db-changes')
      .on('postgres_changes', { event: '*', schema: 'public' }, () => {
        clearTimeout(debounceTimer)
        debounceTimer = setTimeout(() => {
          window.dispatchEvent(new Event('refresh_data'))
        }, 1000)
      })
      .subscribe()

    return () => {
      authSub.data.subscription.unsubscribe()
      window.removeEventListener('refresh_data', handleRefresh)
      dbSub.unsubscribe()
    }
  }, [])

  function refresh() { window.dispatchEvent(new Event('refresh_data')) }

  async function handleLogout() {
    await supabase.auth.signOut()
  }

  if (loadingSession) {
    return (
      <div style={{
        height: '100vh',
        background: '#090a0f',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        fontFamily: 'Inter, system-ui, sans-serif',
        color: '#ffffff',
        gap: 20
      }}>
        <style>{`
          @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
          @keyframes pulse {
            0%, 100% { opacity: 0.6; transform: scale(0.98); }
            50% { opacity: 1; transform: scale(1); }
          }
          .premium-spinner {
            width: 50px;
            height: 50px;
            border: 3px solid rgba(99, 102, 241, 0.1);
            border-top: 3px solid #6366f1;
            border-right: 3px solid #818cf8;
            border-radius: 50%;
            animation: spin 1s linear infinite;
            box-shadow: 0 0 15px rgba(99, 102, 241, 0.3);
          }
          .premium-loading-text {
            font-size: 16px;
            font-weight: 500;
            letter-spacing: 0.05em;
            color: #e2e8f0;
            animation: pulse 2s ease-in-out infinite;
            text-align: center;
          }
          .premium-loading-subtext {
            font-size: 12px;
            color: #64748b;
            margin-top: -8px;
          }
        `}</style>
        <div className="premium-spinner" />
        <div className="premium-loading-text">
          Acessando painel admin. Aguarde!!!
        </div>
        <div className="premium-loading-subtext">📡 Conectando ao Reputei Cloud...</div>
      </div>
    )
  }

  if (!session) {
    return <Login externalError={authError} />
  }


  const filterProps = { tenants, selectedTenantId, onTenantChange: setSelectedTenantId }

  const pages: Record<Page, ReactElement> = {
    dashboard:  <Dashboard  {...filterProps} />,
    commercial: <Commercial />,
    prospects:  <Prospects />,
    reviews:    <Reviews    {...filterProps} />,
    alerts:     <Alerts     {...filterProps} />,
    connectors: <Connectors />,
    tenants:    <Tenants />,
    plans:      <Plans />,
    partners:   <Partners />,
    partner_commissions: <PartnerCommissions />,
    audit:      <Audit />,
    support:    <SupportCenter />,
  }

  return (
    <div className="app-layout">
      {/* ── Sidebar ───────────────────────────────────── */}
      <aside className="sidebar">
        <div className="sidebar-logo">
          <img className="sidebar-logo-icon" src="/logo-reputei.png" alt="Reputei" />
          <div className="sidebar-logo-text">Reputei</div>
        </div>
        <div style={{ padding: '0 16px 16px' }}>
          <div style={{
            fontSize: 10, fontWeight: 700, letterSpacing: '0.08em',
            textTransform: 'uppercase', color: '#f59e0b',
            background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.25)',
            borderRadius: 6, padding: '4px 8px',
            display: 'inline-block'
          }}>
            Painel Admin
          </div>
        </div>

        <div className="sidebar-section">
          <div className="sidebar-label">Menu</div>
          {NAV.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              className={`nav-item ${page === id ? 'active' : ''}`}
              onClick={() => setPage(id)}
            >
              <Icon size={16} />
              <span className="nav-label">{label}</span>
              {page === id && <ChevronRight size={12} className="nav-chevron" style={{ marginLeft: 'auto' }} />}
            </button>
          ))}
        </div>

        <div className="sidebar-footer" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <button className="btn-refresh" style={{ width: '100%', justifyContent: 'center' }} onClick={refresh}>
            <RefreshCw size={14} style={{ flexShrink: 0 }} />
            <span className="btn-sidebar-label">Atualizar dados</span>
          </button>
          <button className="btn" style={{ width: '100%', justifyContent: 'center', background: 'rgba(239, 68, 68, 0.1)', color: '#fca5a5', border: '1px solid rgba(239, 68, 68, 0.2)' }} onClick={handleLogout}>
            <LogOut size={14} style={{ flexShrink: 0 }} />
            <span className="btn-sidebar-label">Sair</span>
          </button>
          <p className="sidebar-footer-text" style={{ marginTop: 4 }}>
            Reputei · v1.0.0
          </p>
        </div>
      </aside>

      {/* ── Main Content ──────────────────────────────── */}
      <main className="main-content">
        {criticalErrorCount > 0 && (
          <div style={{
            background: 'linear-gradient(90deg, rgba(239,68,68,0.2) 0%, rgba(220,38,38,0.05) 100%)',
            border: '1px solid rgba(239,68,68,0.4)',
            borderRadius: 8,
            padding: '12px 20px',
            marginBottom: 20,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 16,
            backdropFilter: 'blur(8px)',
            boxShadow: '0 4px 20px rgba(239,68,68,0.15)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 20 }}>🚨</span>
              <div>
                <strong style={{ color: '#fca5a5' }}>Alerta Técnico Crítico:</strong>{' '}
                <span style={{ color: '#f1f5f9', fontSize: 14 }}>
                  Há {criticalErrorCount} conector(es) com falha contínua há mais de 3 dias. Verifique imediatamente para evitar perda de dados.
                </span>
              </div>
            </div>
            <button 
              className="btn btn-primary" 
              onClick={() => setPage('audit')}
              style={{ 
                padding: '6px 12px', 
                fontSize: 12, 
                background: '#ef4444', 
                borderColor: '#ef4444',
                color: '#fff',
                fontWeight: 600,
                flexShrink: 0
              }}
            >
              Verificar Auditoria
            </button>
          </div>
        )}
        {pages[page]}
      </main>
    </div>
  )
}
