import { useState, useEffect } from 'react'
import type { ReactElement } from 'react'
import { supabase } from './lib/supabase'
import type { Session } from '@supabase/supabase-js'
import {
  LayoutDashboard, MessageSquare, Bell,
  Bot, ChevronRight, LogOut, RefreshCw, CreditCard, Send, FileText, User, LifeBuoy,
  BarChart2, Layout, Building2, DollarSign
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
import Support from './pages/Support'
import Benchmarking from './pages/Benchmarking'
import Widget from './pages/Widget'
import PartnerDashboard from './pages/PartnerDashboard'
import { ToastProvider } from './components/Toast'
import SupportFloatingButton from './components/SupportFloatingButton'

import MyClients from './pages/MyClients'
import MyCommissions from './pages/MyCommissions'

type Page = 'dashboard' | 'reviews' | 'alerts' | 'copilot' | 'benchmarking' | 'widget' | 'generate' | 'reports' | 'pricing' | 'settings' | 'support' | 'partner_dashboard' | 'my_clients' | 'my_commissions'
type AuthView = 'login' | 'signup'

const NAV_CLIENTE = [
  { id: 'dashboard' as Page, label: 'Visão Geral',  icon: LayoutDashboard },
  { id: 'reviews'   as Page, label: 'Reviews',      icon: MessageSquare },
  { id: 'alerts'    as Page, label: 'Alertas',      icon: Bell },
  { id: 'copilot'   as Page, label: 'IA Copilot',   icon: Bot },
  { id: 'benchmarking' as Page, label: 'Benchmarking', icon: BarChart2 },
  { id: 'widget'    as Page, label: 'Widget Site',  icon: Layout },
  { id: 'generate'  as Page, label: 'Gerar Reviews', icon: Send },
  { id: 'reports'   as Page, label: 'Relatórios',    icon: FileText },
  { id: 'pricing'   as Page, label: 'Planos',        icon: CreditCard },
  { id: 'support'   as Page, label: 'Suporte',       icon: LifeBuoy },
  { id: 'settings'  as Page, label: 'Meu Perfil',    icon: User },
]

const NAV_PARCEIRO = [
  { id: 'partner_dashboard' as Page, label: 'Painel do Parceiro', icon: LayoutDashboard },
  { id: 'my_clients'        as Page, label: 'Meus Clientes',      icon: Building2 },
  { id: 'my_commissions'    as Page, label: 'Minhas Comissões',   icon: DollarSign },
  { id: 'support'           as Page, label: 'Suporte',            icon: LifeBuoy },
  { id: 'settings'          as Page, label: 'Meu Perfil',         icon: User },
]

export default function App() {
  const [session, setSession]        = useState<Session | null>(null)
  const [loadingSession, setLoading] = useState(true)
  const [page, setPage]              = useState<Page>('dashboard')
  // authView movido para baixo para poder inicializar com base em ?ref=
  // null = verificando; false = sem tenant; true = tem tenant
  const [hasTenant, setHasTenant]    = useState<boolean | null>(null)
  const [tenantId, setTenantId]      = useState<string>('')
  const [businessName, setBusinessName] = useState<string>('')
  const [userName, setUserName] = useState<string>('')
  const [tenantTrial, setTenantTrial] = useState<{
    plan: string; subscription_status: string; trial_ends_at: string | null
  } | null>(null)
  const [managedTenants, setManagedTenants] = useState<any[]>([])
  const [userRole, setUserRole] = useState<string>('')
  
  // Controle para saber se o parceiro está visualizando a própria conta ou a de um cliente
  const [partnerViewingClient, setPartnerViewingClient] = useState(false)
  
  // Captura ?ref= do link de indicação do parceiro
  const [partnerRef] = useState<string>(() => {
    const params = new URLSearchParams(window.location.search)
    return params.get('ref') || ''
  })

  // Se veio com ?ref=, já abre o cadastro diretamente
  const [authView, setAuthView] = useState<AuthView>(() => {
    const params = new URLSearchParams(window.location.search)
    return params.get('ref') ? 'signup' : 'login'
  })

  useEffect(() => {
    supabase.auth.getSession()
      .then(({ data: { session } }) => {
        setSession(session)
        setLoading(false)
      })
      .catch(() => setLoading(false))
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s)
      if (!s) {
        setHasTenant(null)   // logout → reset
        setPage('dashboard')
        setTenantId('')
        setBusinessName('')
        setUserName('')
        setTenantTrial(null)
        setManagedTenants([])
        setUserRole('')
        setPartnerViewingClient(false)
      }
    })

    let timer: ReturnType<typeof setTimeout>
    const channel = supabase.channel('portal-changes')
      .on('postgres_changes', { event: '*', schema: 'public' }, () => {
        clearTimeout(timer)
        timer = setTimeout(() => window.dispatchEvent(new Event('refresh_data')), 1200)
      })
      .subscribe()

    const navListener = () => setPage('support')
    window.addEventListener('navigate_support', navListener)

    return () => { 
      subscription.unsubscribe(); 
      channel.unsubscribe();
      window.removeEventListener('navigate_support', navListener)
    }
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
        setUserName(userProfile.nome || '')
        setUserRole(userProfile.perfil || '')

        if (userProfile.perfil === 'parceiro') {
          // Buscar tenants vinculados a este parceiro
          const { data: partner } = await supabase
            .from('partners')
            .select('id')
            .eq('user_id', userProfile.id)
            .single()

          if (partner) {
            const { data: tList } = await supabase
              .from('tenants')
              .select('id, name')
              .eq('partner_id', partner.id)
            
            const list = tList || []
            setManagedTenants(list)
            // Parceiros nunca passam pelo onboarding de assinante e iniciam no seu próprio painel sem tenantId preenchido
            setTenantId('')
            setHasTenant(true)
            setPage('partner_dashboard')
            setPartnerViewingClient(false)
          } else {
            // Se por algum motivo o perfil for parceiro mas não tiver na tabela partners
            setHasTenant(false)
          }
        } else {
          // Fluxo normal (assinante)
          const { data: tu } = await supabase
            .from('tenant_users')
            .select('tenant_id')
            .eq('user_id', session.user.id)
            .single()

          if (tu?.tenant_id) {
            const mainTenantId = tu.tenant_id
            setTenantId(mainTenantId)
            setHasTenant(true)

            const allowedIds = [mainTenantId]
            const { data: tList } = await supabase
              .from('tenants')
              .select('id, name')
              .in('id', allowedIds)
            
            setManagedTenants(tList || [])
            setPage('dashboard') // Garante que assinantes vão para a visão geral
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
      .select('plan, subscription_status, trial_ends_at')
      .eq('id', tenantId)
      .single()
      .then(({ data }) => { if (data) setTenantTrial(data) })
  }, [hasTenant, tenantId])

  function refresh() { window.dispatchEvent(new Event('refresh_data')) }

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
          Acessando seu painel. Aguarde...
        </div>
        <div className="premium-loading-subtext">📡 Carregando sua reputação inteligente...</div>
      </div>
    )
  }

  // ── Link de indicação: ?ref= na URL → sempre mostra o cadastro de cliente ──
  // Isso funciona mesmo para o parceiro logado que clica no próprio link
  if (partnerRef && authView === 'signup') {
    return (
      <Onboarding
        partnerRef={partnerRef}
        onBackToLogin={() => {
          // Limpa o ?ref= da URL e volta ao login
          window.history.replaceState({}, '', window.location.pathname)
          setAuthView('login')
        }}
        onComplete={() => {
          // Limpa o ?ref= da URL após cadastro concluído
          window.history.replaceState({}, '', window.location.pathname)
          // Se não há sessão ativa, apenas muda para login
          // Se há sessão (parceiro), mantém onde estava
          if (!session) setHasTenant(true)
        }}
      />
    )
  }

  if (!session) {
    if (authView === 'signup')
      return <Onboarding partnerRef={partnerRef} onBackToLogin={() => setAuthView('login')} onComplete={() => setHasTenant(true)} />
    return <Login onSignup={() => setAuthView('signup')} />
  }

  // Sessão estabelecida mas ainda verificando tenant ou plano
  if (hasTenant === null || (hasTenant === true && !tenantTrial && tenantId !== '')) {
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
          Acessando seu painel. Aguarde...
        </div>
        <div className="premium-loading-subtext">📡 Carregando sua reputação inteligente...</div>
      </div>
    )
  }

  // Usuário logado mas sem tenant (onboarding interrompido)
  if (!hasTenant && userRole !== 'parceiro')
    return <Onboarding onBackToLogin={() => supabase.auth.signOut()} onComplete={() => setHasTenant(true)} />

  // [APPSEC] C5 — Proteção Global de Acesso (Trial Expirado e Inadimplência)
  const isSuspended = tenantTrial?.subscription_status === 'suspended' || tenantTrial?.subscription_status === 'cancelled'
  const isTrialExpired = tenantTrial?.subscription_status === 'trial' &&
    tenantTrial?.trial_ends_at != null &&
    new Date(tenantTrial.trial_ends_at) < new Date()

  if (isSuspended) {
    // Permite apenas acessar a página de suporte ou perfil, o resto bloqueia
    if (page !== 'support' && page !== 'settings') {
      return (
        <div style={{ height: '100vh', background: '#090a0f', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', color: '#fff', gap: 16 }}>
          <div style={{ fontSize: 48 }}>🔒</div>
          <h2>Conta Suspensa</h2>
          <p style={{ color: '#94a3b8' }}>Sua assinatura encontra-se suspensa ou cancelada.</p>
          <button className="btn btn-primary" onClick={() => setPage('support')}>Falar com Suporte</button>
          <button className="btn" onClick={() => supabase.auth.signOut()}>Sair</button>
        </div>
      )
    }
  }

  if (isTrialExpired && page !== 'pricing' && page !== 'support') {
    return <TrialExpired plan={tenantTrial!.plan} onLogout={() => supabase.auth.signOut()} />
  }

  // Dias restantes do trial
  const trialDaysLeft = tenantTrial?.subscription_status === 'trial' && tenantTrial?.trial_ends_at
    ? Math.max(0, Math.ceil((new Date(tenantTrial.trial_ends_at).getTime() - Date.now()) / 86_400_000))
    : null

  const pages: Record<Page, ReactElement> = {
    dashboard: <Dashboard tenantId={tenantId} />,
    reviews:   <Reviews tenantId={tenantId} onNavigateCopilot={() => setPage('copilot')} />,
    alerts:    <Alerts tenantId={tenantId} />,
    copilot:   <Copilot session={session} />,
    benchmarking: <Benchmarking tenantId={tenantId} />,
    widget:    <Widget tenantId={tenantId} />,
    generate:  <GenerateReviews tenantId={tenantId} />,
    reports:   <Reports tenantId={tenantId} />,
    pricing:   <Pricing tenantTrial={tenantTrial} session={session} />,
    settings:  <Settings />,
    support:   <Support tenantId={tenantId} />,
    partner_dashboard: <PartnerDashboard />,
    my_clients: <MyClients onSelectTenant={(id) => {
      setTenantId(id)
      setPartnerViewingClient(true)
      setPage('dashboard')
    }} />,
    my_commissions: <MyCommissions />
  }

  return (
    <ToastProvider>
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
            {userRole === 'parceiro' ? 'Portal do Parceiro' : 'Portal do Assinante'}
          </div>
          {userName || session?.user?.email ? (
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', marginTop: 4, marginBottom: 4 }}>
              👤 {userName || session?.user?.email}
            </div>
          ) : null}
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

          {/* Opção para parceiro sair da visão do cliente */}
          {userRole === 'parceiro' && partnerViewingClient && (
            <button 
              className="btn btn-primary" 
              style={{ width: '100%', marginTop: 12, padding: '6px', fontSize: 11, justifyContent: 'center' }}
              onClick={() => {
                setTenantId('')
                setPartnerViewingClient(false)
                setPage('my_clients')
              }}
            >
              ⬅ Voltar para Meus Clientes
            </button>
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
          <div className="sidebar-label">{partnerViewingClient ? 'Menu do Cliente' : 'Menu'}</div>
          
          {userRole === 'parceiro' && !partnerViewingClient ? (
            NAV_PARCEIRO.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                className={`nav-item ${page === id ? 'active' : ''}`}
                onClick={() => setPage(id)}
              >
                <Icon size={16} />
                <span className="nav-label">{label}</span>
                {page === id && <ChevronRight size={12} className="nav-chevron" style={{ marginLeft: 'auto' }} />}
              </button>
            ))
          ) : (
            NAV_CLIENTE.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                className={`nav-item ${page === id ? 'active' : ''}`}
                onClick={() => setPage(id)}
              >
                <Icon size={16} />
                <span className="nav-label">{label}</span>
                {page === id && <ChevronRight size={12} className="nav-chevron" style={{ marginLeft: 'auto' }} />}
              </button>
            ))
          )}
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
          {(userRole === 'admin' || userRole === 'operador') && (
            <a
              href="https://admin.reputei.com.br"
              target="_blank"
              rel="noreferrer"
              className="btn"
              style={{ width: '100%', justifyContent: 'center', marginTop: 8, background: 'rgba(99,102,241,0.1)', color: '#818cf8', border: '1px solid rgba(99,102,241,0.2)', textDecoration: 'none' }}
            >
              <LayoutDashboard size={14} style={{ flexShrink: 0 }} />
              <span className="btn-sidebar-label">Painel Operacional</span>
            </a>
          )}
          <p className="sidebar-footer-text" style={{ marginTop: 12 }}>Reputei · v1.0.1</p>
        </div>
      </aside>

      <main className="main-content">
        {pages[page]}
      </main>
      <SupportFloatingButton />
      </div>
    </ToastProvider>
  )
}
