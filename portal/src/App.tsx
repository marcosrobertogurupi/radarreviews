import { useState, useEffect } from 'react'
import type { ReactElement } from 'react'
import { supabase } from './lib/supabase'
import type { Session } from '@supabase/supabase-js'
import {
  LayoutDashboard, MessageSquare, Bell,
  Bot, ChevronRight, LogOut, RefreshCw, CreditCard,
} from 'lucide-react'
import Login from './pages/Login'
import Onboarding from './pages/Onboarding'
import Dashboard from './pages/Dashboard'
import Reviews from './pages/Reviews'
import Alerts from './pages/Alerts'
import Copilot from './pages/Copilot'
import Pricing from './pages/Pricing'

type Page = 'dashboard' | 'reviews' | 'alerts' | 'copilot' | 'pricing'
type AuthView = 'login' | 'signup'

const NAV = [
  { id: 'dashboard' as Page, label: 'Visão Geral',  icon: LayoutDashboard },
  { id: 'reviews'   as Page, label: 'Reviews',      icon: MessageSquare },
  { id: 'alerts'    as Page, label: 'Alertas',      icon: Bell },
  { id: 'copilot'   as Page, label: 'IA Copilot',   icon: Bot },
  { id: 'pricing'   as Page, label: 'Planos',        icon: CreditCard },
]

export default function App() {
  const [session, setSession]        = useState<Session | null>(null)
  const [loadingSession, setLoading] = useState(true)
  const [page, setPage]              = useState<Page>('dashboard')
  const [authView, setAuthView]      = useState<AuthView>('login')
  // null = verificando; false = sem tenant; true = tem tenant
  const [hasTenant, setHasTenant]    = useState<boolean | null>(null)
  const [businessName, setBusinessName] = useState<string>('')

  useEffect(() => {
    supabase.auth.getSession()
      .then(({ data: { session } }) => {
        setSession(session)
        setLoading(false)
      })
      .catch(() => setLoading(false))
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s)
      if (!s) setHasTenant(null)   // logout → reset
    })

    let timer: ReturnType<typeof setTimeout>
    const channel = supabase.channel('portal-changes')
      .on('postgres_changes', { event: '*', schema: 'public' }, () => {
        clearTimeout(timer)
        timer = setTimeout(() => window.dispatchEvent(new Event('refresh_data')), 1200)
      })
      .subscribe()

    return () => { subscription.unsubscribe(); channel.unsubscribe() }
  }, [])

  // Verifica se o usuário logado já tem tenant provisionado
  useEffect(() => {
    if (!session) return
    supabase
      .from('tenant_users')
      .select('tenant_id', { count: 'exact', head: true })
      .then(({ count }) => setHasTenant((count ?? 0) > 0))
  }, [session?.user.id])

  // Busca nome da empresa do tenant
  useEffect(() => {
    if (!hasTenant) return
    supabase
      .from('monitored_businesses')
      .select('name')
      .limit(1)
      .single()
      .then(({ data }) => { if (data?.name) setBusinessName(data.name) })
  }, [hasTenant])

  function refresh() { window.dispatchEvent(new Event('refresh_data')) }

  if (loadingSession) return <div style={{ height: '100vh', background: 'var(--bg-base)' }} />

  if (!session) {
    if (authView === 'signup')
      return <Onboarding onBackToLogin={() => setAuthView('login')} onComplete={() => setHasTenant(true)} />
    return <Login onSignup={() => setAuthView('signup')} />
  }

  // Sessão estabelecida mas ainda verificando tenant
  if (hasTenant === null)
    return <div style={{ height: '100vh', background: 'var(--bg-base)' }} />

  // Usuário logado mas sem tenant (onboarding interrompido)
  if (!hasTenant)
    return <Onboarding onBackToLogin={() => supabase.auth.signOut()} onComplete={() => setHasTenant(true)} />

  const pages: Record<Page, ReactElement> = {
    dashboard: <Dashboard />,
    reviews:   <Reviews onNavigateCopilot={() => setPage('copilot')} />,
    alerts:    <Alerts />,
    copilot:   <Copilot session={session} />,
    pricing:   <Pricing />,
  }

  return (
    <div className="app-layout">
      <aside className="sidebar">
        <div className="sidebar-logo">
          <div className="sidebar-logo-icon">📡</div>
          <div className="sidebar-logo-text">Reputei</div>
        </div>
        <div style={{ padding: '0 16px 16px' }}>
          <div style={{
            fontSize: 10, fontWeight: 700, letterSpacing: '0.08em',
            textTransform: 'uppercase', color: 'var(--accent)',
            background: 'rgba(99,102,241,0.12)', border: '1px solid rgba(99,102,241,0.25)',
            borderRadius: 6, padding: '4px 8px', marginBottom: businessName ? 8 : 0,
            display: 'inline-block'
          }}>
            Portal do Assinante
          </div>
          {businessName && (
            <div style={{
              fontSize: 13, fontWeight: 600, color: 'var(--text-primary)',
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              paddingTop: 2,
            }}>
              {businessName}
            </div>
          )}
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

        <div className="sidebar-footer">
          <button className="btn-refresh" style={{ width: '100%', justifyContent: 'center', marginBottom: 8 }} onClick={refresh}>
            <RefreshCw size={14} style={{ flexShrink: 0 }} />
            <span className="btn-sidebar-label">Atualizar</span>
          </button>
          <button
            className="btn"
            style={{ width: '100%', justifyContent: 'center', background: 'rgba(239,68,68,0.1)', color: '#fca5a5', border: '1px solid rgba(239,68,68,0.2)' }}
            onClick={() => supabase.auth.signOut()}
          >
            <LogOut size={14} style={{ flexShrink: 0 }} />
            <span className="btn-sidebar-label">Sair</span>
          </button>
          <p className="sidebar-footer-text" style={{ marginTop: 12 }}>Reputei · v1.0.0</p>
        </div>
      </aside>

      <main className="main-content">
        {pages[page]}
      </main>
    </div>
  )
}
