import { useState, useEffect } from 'react'
import type { ReactElement } from 'react'
import { supabase } from './lib/supabase'
import type { Session } from '@supabase/supabase-js'
import {
  LayoutDashboard, Users, UserPlus, DollarSign,
  User, ChevronRight, LogOut, RefreshCw, Target
} from 'lucide-react'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Clients from './pages/Clients'
import ClientNew from './pages/ClientNew'
import Commissions from './pages/Commissions'
import Profile from './pages/Profile'
import Prospects from './pages/Prospects'
import { ToastProvider } from './components/Toast'
import { API_URL } from './lib/utils'

type Page = 'dashboard' | 'prospects' | 'clients' | 'clients_new' | 'commissions' | 'profile'

const NAV = [
  { id: 'dashboard' as Page, label: 'Visão Geral',  icon: LayoutDashboard },
  { id: 'prospects' as Page, label: 'Prospecção',   icon: Target },
  { id: 'clients'   as Page, label: 'Meus Clientes', icon: Users },
  { id: 'clients_new' as Page, label: 'Novo Cliente', icon: UserPlus },
  { id: 'commissions' as Page, label: 'Comissões',    icon: DollarSign },
  { id: 'profile'   as Page, label: 'Meu Perfil',     icon: User },
]

export default function App() {
  const [session, setSession]        = useState<Session | null>(null)
  const [loadingSession, setLoading] = useState(true)
  const [page, setPage]              = useState<Page>('dashboard')
  const [partner, setPartner]        = useState<any>(null)

  useEffect(() => {
    supabase.auth.getSession()
      .then(({ data: { session } }) => {
        setSession(session)
        setLoading(false)
      })
      .catch(() => setLoading(false))

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s)
    })

    return () => { 
      subscription.unsubscribe(); 
    }
  }, [])

  useEffect(() => {
    if (!session) return
    // Fetch partner details
    fetch(`${API_URL}/api/partner/dashboard`, {
      headers: { 'Authorization': `Bearer ${session.access_token}` }
    })
    .then(r => r.json())
    .then(data => {
      if (data.ok && data.dashboard) {
        setPartner(data.dashboard)
      } else {
        // Not a partner or inactive
        setPartner(false)
      }
    })
    .catch(() => setPartner(false))
  }, [session])

  function refresh() { window.dispatchEvent(new Event('refresh_data')) }

  if (loadingSession) {
    return (
      <div style={{ height: '100vh', background: '#090a0f', display: 'flex', justifyContent: 'center', alignItems: 'center', color: '#fff' }}>
        Carregando Reputei Partner...
      </div>
    )
  }

  if (!session) {
    return <Login onSignup={() => {}} isPartnerApp={true} />
  }

  if (partner === null) {
    return (
      <div style={{ height: '100vh', background: '#090a0f', display: 'flex', justifyContent: 'center', alignItems: 'center', color: '#fff' }}>
        Verificando perfil de parceiro...
      </div>
    )
  }

  if (partner === false) {
    return (
      <div style={{ height: '100vh', background: '#090a0f', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', color: '#fff', gap: 16 }}>
        <div style={{ fontSize: 48 }}>🔒</div>
        <h2>Acesso Negado</h2>
        <p style={{ color: '#94a3b8' }}>Esta conta não está cadastrada como Parceiro Reputei ou está inativa.</p>
        <button className="btn" onClick={() => supabase.auth.signOut()}>Sair</button>
      </div>
    )
  }

  const pages: Record<Page, ReactElement> = {
    dashboard: <Dashboard session={session} partner={partner} onNavigate={(p) => setPage(p)} />,
    prospects: <Prospects />,
    clients:   <Clients session={session} />,
    clients_new: <ClientNew session={session} onCreated={() => setPage('clients')} />,
    commissions: <Commissions session={session} />,
    profile:   <Profile session={session} partner={partner} />,
  }

  return (
    <ToastProvider>
      <div className="app-layout">
      <aside className="sidebar">
        <div className="sidebar-logo">
          <img className="sidebar-logo-icon" src="/logo-icon-reputei.png" alt="Reputei" />
          <div className="sidebar-logo-text">Reputei</div>
        </div>
        <div style={{ padding: '0 16px 16px' }}>
          <div style={{
            fontSize: 10, fontWeight: 700, letterSpacing: '0.08em',
            textTransform: 'uppercase', color: 'var(--accent)',
            background: 'rgba(99,102,241,0.12)', border: '1px solid rgba(99,102,241,0.25)',
            borderRadius: 6, padding: '4px 8px', marginBottom: 8,
            display: 'inline-block'
          }}>
            Partner Portal
          </div>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', marginTop: 4 }}>
            {partner.partner_name || session.user.email}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2, textTransform: 'capitalize' }}>
            Nível: {partner.partner_type === 'agency' ? 'Agência' : partner.partner_type === 'consultant' ? 'Consultor' : 'Representante'}
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

        <div className="sidebar-footer">
          <button className="btn-refresh" style={{ width: '100%', justifyContent: 'center' }} onClick={refresh}>
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
          <p className="sidebar-footer-text" style={{ marginTop: 12 }}>Reputei Partner · v1.0.0</p>
        </div>
      </aside>

      <main className="main-content" style={{ padding: '32px 40px' }}>
        {pages[page]}
      </main>
      </div>
    </ToastProvider>
  )
}
