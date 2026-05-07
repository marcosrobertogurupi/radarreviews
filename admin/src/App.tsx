import { useState, useEffect } from 'react'
import type { ReactElement } from 'react'
import { supabase } from './lib/supabase'
import type { Session } from '@supabase/supabase-js'
import {
  LayoutDashboard, MessageSquare, Bell, Radio,
  Building2, RefreshCw, ChevronRight, LogOut, ShieldCheck, BarChart2, Layout, CreditCard, LifeBuoy,
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


type Page = 'dashboard' | 'reviews' | 'alerts' | 'connectors' | 'tenants' | 'plans' | 'audit' | 'support' | 'prospects' | 'commercial'


export interface TenantOption { id: string; name: string }

const NAV = [
  { id: 'dashboard' as Page,   label: 'Dashboard',   icon: LayoutDashboard },
  { id: 'commercial' as Page,  label: 'Comercial',   icon: Briefcase },
  { id: 'prospects' as Page,   label: 'Prospecção',  icon: Target },
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
    // Carregar sessão inicial
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (session) {
        const ok = await validateProfile(session)
        if (ok) {
          setSession(session)
          loadTenants()
        }
      }
      setLoadingSession(false)
    })

    const authSub = supabase.auth.onAuthStateChange(async (event, session) => {
      console.log('Auth Event:', event)
      
      if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
        if (session) {
          const ok = await validateProfile(session)
          if (ok) setSession(session)
        }
      } else if (event === 'SIGNED_OUT') {
        setSession(null)
        setIsValidated(false)
        setAuthError(null)
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

    const handleRefresh = () => loadTenants()
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
    audit:      <Audit />,
    support:    <SupportCenter />,
  }

  return (
    <div className="app-layout">
      {/* ── Sidebar ───────────────────────────────────── */}
      <aside className="sidebar">
        <div className="sidebar-logo">
          <div className="sidebar-logo-icon">📡</div>
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
        {pages[page]}
      </main>
    </div>
  )
}
