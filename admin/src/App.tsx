import { useState, useEffect } from 'react'
import type { ReactElement } from 'react'
import { supabase } from './lib/supabase'
import type { Session } from '@supabase/supabase-js'
import {
  LayoutDashboard, MessageSquare, Bell, Radio,
  Building2, RefreshCw, ChevronRight, LogOut, ShieldCheck
} from 'lucide-react'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Reviews from './pages/Reviews'
import Alerts from './pages/Alerts'
import Connectors from './pages/Connectors'
import Tenants from './pages/Tenants'
import Audit from './pages/Audit'

type Page = 'dashboard' | 'reviews' | 'alerts' | 'connectors' | 'tenants' | 'audit'

export interface TenantOption { id: string; name: string }

const NAV = [
  { id: 'dashboard' as Page,   label: 'Dashboard',   icon: LayoutDashboard },
  { id: 'reviews' as Page,     label: 'Reviews',     icon: MessageSquare },
  { id: 'alerts' as Page,      label: 'Alertas',     icon: Bell },
  { id: 'connectors' as Page,  label: 'Conectores',  icon: Radio },
  { id: 'tenants' as Page,     label: 'Assinantes',  icon: Building2 },
  { id: 'audit' as Page,       label: 'Auditoria',   icon: ShieldCheck },
]

export default function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [loadingSession, setLoadingSession] = useState(true)
  const [page, setPage] = useState<Page>('dashboard')
  const [tenants, setTenants] = useState<TenantOption[]>([])
  const [selectedTenantId, setSelectedTenantId] = useState('')

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setLoadingSession(false)
    })

    const authSub = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
    })

    // Carregar lista de tenants para o filtro
    supabase.from('tenants').select('id, name').order('name').then(({ data }) => {
      setTenants(data ?? [])
    })

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
      dbSub.unsubscribe()
    }
  }, [])

  function refresh() { window.dispatchEvent(new Event('refresh_data')) }

  async function handleLogout() {
    await supabase.auth.signOut()
  }

  if (loadingSession) {
    return <div style={{ height: '100vh', background: 'var(--bg-main)' }} />
  }

  if (!session) {
    return <Login />
  }

  const filterProps = { tenants, selectedTenantId, onTenantChange: setSelectedTenantId }

  const pages: Record<Page, ReactElement> = {
    dashboard:  <Dashboard  {...filterProps} />,
    reviews:    <Reviews    {...filterProps} />,
    alerts:     <Alerts     {...filterProps} />,
    connectors: <Connectors />,
    tenants:    <Tenants />,
    audit:      <Audit />,
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
            Reputei · v0.4.0
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
