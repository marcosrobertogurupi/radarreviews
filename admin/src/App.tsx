import { useState, useEffect } from 'react'
import type { ReactElement } from 'react'
import { supabase } from './lib/supabase'
import type { Session } from '@supabase/supabase-js'
import {
  LayoutDashboard, MessageSquare, Bell, Radio,
  Building2, RefreshCw, ChevronRight, LogOut, ShieldCheck, BarChart2, Layout
} from 'lucide-react'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Reviews from './pages/Reviews'
import Alerts from './pages/Alerts'
import Connectors from './pages/Connectors'
import Tenants from './pages/Tenants'
import Competitors from './pages/Competitors'
import Widget from './pages/Widget'
import Audit from './pages/Audit'

type Page = 'dashboard' | 'reviews' | 'alerts' | 'connectors' | 'competitors' | 'widget' | 'tenants' | 'audit'

export interface TenantOption { id: string; name: string }

const NAV = [
  { id: 'dashboard' as Page,   label: 'Dashboard',   icon: LayoutDashboard },
  { id: 'reviews' as Page,     label: 'Reviews',     icon: MessageSquare },
  { id: 'alerts' as Page,      label: 'Alertas',     icon: Bell },
  { id: 'connectors' as Page,  label: 'Conectores',  icon: Radio },
  { id: 'competitors' as Page, label: 'Benchmarking', icon: BarChart2 },
  { id: 'widget' as Page,      label: 'Widgets',      icon: Layout },
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
      if (session) {
        loadTenants()
      }
    })

    const authSub = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
      if (session) {
        loadTenants()
      }
    })

    async function loadTenants() {
      const { data } = await supabase.from('tenants').select('id, name').order('name')
      setTenants(data ?? [])
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
    competitors: <Competitors />,
    widget:     <Widget {...filterProps} />,
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
