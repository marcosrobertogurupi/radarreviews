import { useState, useEffect } from 'react'
import type { ReactElement } from 'react'
import { supabase } from './lib/supabase'
import type { Session } from '@supabase/supabase-js'
import {
  LayoutDashboard, MessageSquare, Bell,
  Bot, ChevronRight, LogOut, RefreshCw, CreditCard, Send, FileText, User
} from 'lucide-react'
import Login from './pages/Login'
import Onboarding from './pages/Onboarding'
import Dashboard from './pages/Dashboard'
import Reviews from './pages/Reviews'
import Alerts from './pages/Alerts'
import Copilot from './pages/Copilot'
import Reports from './pages/Reports'
import Pricing from './pages/Pricing'
import TrialExpired from './pages/TrialExpired'
import GenerateReviews from './pages/GenerateReviews'
import Settings from './pages/Settings'

type Page = 'dashboard' | 'reviews' | 'alerts' | 'copilot' | 'generate' | 'reports' | 'pricing' | 'settings'
type AuthView = 'login' | 'signup'

const NAV = [
  { id: 'dashboard' as Page, label: 'Visão Geral',  icon: LayoutDashboard },
  { id: 'reviews'   as Page, label: 'Reviews',      icon: MessageSquare },
  { id: 'alerts'    as Page, label: 'Alertas',      icon: Bell },
  { id: 'copilot'   as Page, label: 'IA Copilot',   icon: Bot },
  { id: 'generate'  as Page, label: 'Gerar Reviews', icon: Send },
  { id: 'reports'   as Page, label: 'Relatórios',    icon: FileText },
  { id: 'pricing'   as Page, label: 'Planos',        icon: CreditCard },
  { id: 'settings'  as Page, label: 'Meu Perfil',    icon: User },
]

export default function App() {
  const [session, setSession]        = useState<Session | null>(null)
  const [loadingSession, setLoading] = useState(true)
  const [page, setPage]              = useState<Page>('dashboard')
  const [authView, setAuthView]      = useState<AuthView>('login')
  // null = verificando; false = sem tenant; true = tem tenant
  const [hasTenant, setHasTenant]    = useState<boolean | null>(null)
  const [tenantId, setTenantId]      = useState<string>('')
  const [businessName, setBusinessName] = useState<string>('')
  const [tenantTrial, setTenantTrial] = useState<{
    plan: string; plan_status: string; trial_ends_at: string | null
  } | null>(null)
  const [managedTenants, setManagedTenants] = useState<any[]>([])

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

  // Verifica se o usuário logado já tem tenant provisionado e carrega tenant_id
  useEffect(() => {
    if (!session) return
    supabase
      .from('usuarios')
      .select('id, perfil, nome')
      .eq('id', session.user.id)
      .single()
      .then(async ({ data: userProfile }) => {
        if (!userProfile) return

        if (userProfile.perfil === 'parceiro') {
          // Buscar assinantes vinculados a este parceiro
          const { data: indicated } = await supabase
            .from('assinantes')
            .select('id, tenants(id, name)')
            .eq('parceiro_id', userProfile.id)
          
          const tList = (indicated || []).map(i => (i as any).tenants).filter(Boolean)
          setManagedTenants(tList)
          if (tList.length > 0) {
            setTenantId(tList[0].id)
            setHasTenant(true)
          } else {
            setHasTenant(false)
          }
        } else {
          // Fluxo normal (assinante)
          const { data: tu } = await supabase
            .from('tenant_users')
            .select('tenant_id, managed_tenant_ids')
            .eq('user_id', session.user.id)
            .single()

          if (tu?.tenant_id) {
            const mainTenantId = tu.tenant_id
            setTenantId(mainTenantId)
            setHasTenant(true)

            const allowedIds = [mainTenantId, ...(tu.managed_tenant_ids || [])]
            const { data: tList } = await supabase
              .from('tenants')
              .select('id, name')
              .in('id', allowedIds)
            
            setManagedTenants(tList || [])
          } else {
            setHasTenant(false)
          }
        }
      })
  }, [session?.user.id])

  // Busca nome da empresa e status do trial (sempre filtrado pelo tenant_id do usuário)
  useEffect(() => {
    if (!hasTenant || !tenantId) return
    supabase.from('monitored_businesses').select('name').eq('tenant_id', tenantId).limit(1).single()
      .then(({ data }) => { if (data?.name) setBusinessName(data.name) })

    supabase.from('tenants')
      .select('plan, plan_status, trial_ends_at')
      .eq('id', tenantId)
      .single()
      .then(({ data }) => { if (data) setTenantTrial(data) })
  }, [hasTenant, tenantId])

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

  // Bloqueia se trial expirou e plano não está ativo
  const trialExpired = tenantTrial?.plan_status === 'trial' &&
    tenantTrial?.trial_ends_at != null &&
    new Date(tenantTrial.trial_ends_at) < new Date()

  if (trialExpired)
    return <TrialExpired plan={tenantTrial!.plan} onLogout={() => supabase.auth.signOut()} />

  // Dias restantes do trial
  const trialDaysLeft = tenantTrial?.plan_status === 'trial' && tenantTrial?.trial_ends_at
    ? Math.max(0, Math.ceil((new Date(tenantTrial.trial_ends_at).getTime() - Date.now()) / 86_400_000))
    : null

  const pages: Record<Page, ReactElement> = {
    dashboard: <Dashboard tenantId={tenantId} />,
    reviews:   <Reviews tenantId={tenantId} onNavigateCopilot={() => setPage('copilot')} />,
    alerts:    <Alerts tenantId={tenantId} />,
    copilot:   <Copilot session={session} />,
    generate:  <GenerateReviews tenantId={tenantId} />,
    reports:   <Reports tenantId={tenantId} />,
    pricing:   <Pricing />,
    settings:  <Settings />,
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
          {trialDaysLeft !== null && (
            <div style={{
              marginTop: 8, padding: '6px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600,
              background: trialDaysLeft <= 2 ? 'rgba(239,68,68,0.12)' : 'rgba(245,158,11,0.1)',
              border: `1px solid ${trialDaysLeft <= 2 ? 'rgba(239,68,68,0.3)' : 'rgba(245,158,11,0.3)'}`,
              color: trialDaysLeft <= 2 ? '#fca5a5' : '#fbbf24',
            }}>
              ⏰ {trialDaysLeft === 0 ? 'Último dia de trial' : `${trialDaysLeft} dia${trialDaysLeft !== 1 ? 's' : ''} de trial restante${trialDaysLeft !== 1 ? 's' : ''}`}
            </div>
          )}
          {businessName && (
            <div style={{
              fontSize: 13, fontWeight: 600, color: 'var(--text-primary)',
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              paddingTop: 2,
            }}>
              {businessName}
            </div>
          )}

          {/* Switcher de Tenant (Agência) */}
          {managedTenants.length > 1 && (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 4, fontWeight: 700, textTransform: 'uppercase' }}>
                🏢 Alternar Cliente
              </div>
              <select
                value={tenantId}
                onChange={e => setTenantId(e.target.value)}
                style={{
                  width: '100%',
                  padding: '6px 10px',
                  background: 'var(--bg-darker)',
                  border: '1px solid var(--border)',
                  color: 'var(--text-primary)',
                  borderRadius: 6,
                  fontSize: 12,
                  cursor: 'pointer',
                  outline: 'none'
                }}
              >
                {managedTenants.map(t => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
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
          <p className="sidebar-footer-text" style={{ marginTop: 12 }}>Reputei · v1.0.0</p>
        </div>
      </aside>

      <main className="main-content">
        {pages[page]}
      </main>
    </div>
  )
}
