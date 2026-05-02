import { useState, useEffect } from 'react'
import type { ReactElement } from 'react'
import { supabase } from './lib/supabase'
import type { Session } from '@supabase/supabase-js'
import {
  LayoutDashboard, MessageSquare, Bell, Radio,
  Building2, RefreshCw, ChevronRight, LogOut, ShieldCheck, BarChart2, Layout, CreditCard

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
import Plans from './pages/Plans'


type Page = 'dashboard' | 'reviews' | 'alerts' | 'connectors' | 'competitors' | 'widget' | 'tenants' | 'plans' | 'audit'


export interface TenantOption { id: string; name: string }

const NAV = [
  { id: 'dashboard' as Page,   label: 'Dashboard',   icon: LayoutDashboard },
  { id: 'reviews' as Page,     label: 'Reviews',     icon: MessageSquare },
  { id: 'alerts' as Page,      label: 'Alertas',     icon: Bell },
  { id: 'connectors' as Page,  label: 'Conectores',  icon: Radio },
  { id: 'competitors' as Page, label: 'Benchmarking', icon: BarChart2 },
  { id: 'widget' as Page,      label: 'Widgets',      icon: Layout },
  { id: 'tenants' as Page,     label: 'Assinantes',  icon: Building2 },
  { id: 'plans' as Page,       label: 'Planos',      icon: CreditCard },
  { id: 'audit' as Page,       label: 'Auditoria',   icon: ShieldCheck },

]

export default function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [loadingSession, setLoadingSession] = useState(true)
  const [authError, setAuthError] = useState<string | null>(null)
  const [page, setPage] = useState<Page>('dashboard')
  const [tenants, setTenants] = useState<TenantOption[]>([])
  const [selectedTenantId, setSelectedTenantId] = useState('')

  // Função de validação movida para fora para maior clareza e robustez
  async function validateProfile(session: Session, retry = true): Promise<boolean> {
    console.log('[Auth] Iniciando validação para:', session.user.id)
    try {
      // Usando um Promise.race para garantir que a consulta não trave o app se o Supabase estiver lento
      const queryPromise = supabase
        .from('usuarios')
        .select('perfil, ativo')
        .eq('id', session.user.id)
        .maybeSingle()

      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('TIMEOUT')), 6000)
      )

      const result = await Promise.race([queryPromise, timeoutPromise]) as any
      const { data, error } = result

      if (error) {
        console.error('[Auth] Erro na consulta de perfil:', error)
        // Se for erro de RLS/Permissão no início, tenta uma vez mais
        if (retry && error.code === 'PGRST116') {
          console.warn('[Auth] RLS não propagado, tentando novamente...')
          await new Promise(r => setTimeout(r, 1500))
          return validateProfile(session, false)
        }
        setAuthError(`Erro no banco: ${error.message}`)
        return false
      }

      if (!data) {
        console.warn('[Auth] Perfil não encontrado para ID:', session.user.id)
        setAuthError('Usuário não encontrado na tabela de perfis.')
        return false
      }

      console.log('[Auth] Perfil carregado:', data.perfil, '| Ativo:', data.ativo)

      if (!data.ativo) {
        await supabase.auth.signOut()
        setAuthError('Esta conta está desativada.')
        return false
      }

      if (!['admin', 'operador'].includes(data.perfil)) {
        await supabase.auth.signOut()
        setAuthError('Acesso restrito a administradores.')
        return false
      }

      setAuthError(null)
      return true
    } catch (err: any) {
      if (err.message === 'TIMEOUT') {
        console.error('[Auth] Timeout na validação de perfil')
        setAuthError('O banco de dados demorou muito para responder. Tente recarregar a página.')
      } else {
        console.error('[Auth] Exceção crítica:', err)
        setAuthError('Falha de conexão ao validar perfil.')
      }
      return false
    }
  }

  useEffect(() => {

    // Timeout de segurança para evitar tela preta infinita
    const timeout = setTimeout(() => {
      setLoadingSession(false)
    }, 8000)

    supabase.auth.getSession().then(async ({ data: { session } }) => {
      try {
        if (session) {
          const isValid = await validateProfile(session)
          if (isValid) {
            setSession(session)
            await loadTenants()
          }
        }
      } catch (err) {
        console.error('Erro fatal no getSession:', err)
        setAuthError('Erro ao iniciar sessão. Tente recarregar a página.')
      } finally {
        clearTimeout(timeout)
        setLoadingSession(false)
      }
    }).catch(err => {
      console.error('Falha na promessa getSession:', err)
      clearTimeout(timeout)
      setLoadingSession(false)
    })

    const authSub = supabase.auth.onAuthStateChange(async (_event, session) => {
      console.log('Auth Event:', _event)
      try {
        if (session) {
          const isValid = await validateProfile(session)
          if (isValid) {
            setSession(session)
            loadTenants()
          } else {
            setSession(null)
          }
        } else {
          setSession(null)
          if (_event === 'SIGNED_OUT') setAuthError(null)
        }
      } catch (err) {
        console.error('Erro no processamento do evento de auth:', err)
        setSession(null)
        setAuthError('Erro ao processar login.')
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
    return <div style={{ height: '100vh', background: 'var(--bg-main)' }} />
  }

  if (!session) {
    return <Login externalError={authError} />
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
    plans:      <Plans />,
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
