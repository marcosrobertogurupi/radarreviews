import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { User, Mail, Lock, Save, Loader2, Phone, CheckCircle2, XCircle, Bell, Link2 } from 'lucide-react'
import { useToast } from '../components/Toast'
import { API_URL } from '../lib/utils'

const PROFILE_LABEL: Record<string, string> = {
  admin: 'Administrador',
  operador: 'Operador',
  parceiro: 'Parceiro',
  assinante: 'Assinante',
}

function Avatar({ name }: { name: string }) {
  const initials = name.split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase() || '?'
  return (
    <div style={{
      width: 72, height: 72, borderRadius: '50%',
      background: 'linear-gradient(135deg, #6366f1, #06b6d4)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: 26, fontWeight: 800, color: '#fff',
      boxShadow: '0 0 0 4px rgba(99,102,241,0.2)',
      flexShrink: 0,
    }}>
      {initials}
    </div>
  )
}

function SectionCard({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{
      background: 'var(--bg-card, #13141f)',
      border: '1px solid var(--border, rgba(255,255,255,0.07))',
      borderRadius: 16,
      padding: '24px 28px',
      ...style,
    }}>
      {children}
    </div>
  )
}

function SectionTitle({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
      <div style={{
        width: 32, height: 32, borderRadius: 8,
        background: 'rgba(99,102,241,0.12)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: '#818cf8',
      }}>
        {icon}
      </div>
      <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary, #f1f5f9)' }}>{children}</span>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted, #64748b)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        {label}
      </label>
      {children}
    </div>
  )
}

function Input({ icon, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { icon?: React.ReactNode }) {
  return (
    <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
      {icon && (
        <span style={{ position: 'absolute', left: 12, color: 'var(--text-muted, #64748b)', display: 'flex' }}>
          {icon}
        </span>
      )}
      <input
        {...props}
        style={{
          width: '100%',
          padding: icon ? '10px 14px 10px 38px' : '10px 14px',
          background: 'var(--bg-darker, #0d0e18)',
          border: '1px solid var(--border, rgba(255,255,255,0.07))',
          borderRadius: 10,
          color: 'var(--text-primary, #f1f5f9)',
          fontSize: 14,
          outline: 'none',
          transition: 'border-color 0.15s',
          boxSizing: 'border-box',
          ...props.style,
        }}
      />
    </div>
  )
}

function StatusBadge({ connected, label }: { connected: boolean; label?: string }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      padding: '4px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700,
      background: connected ? 'rgba(52,211,153,0.12)' : 'rgba(100,116,139,0.12)',
      color: connected ? '#34d399' : '#94a3b8',
      border: `1px solid ${connected ? 'rgba(52,211,153,0.25)' : 'rgba(100,116,139,0.2)'}`,
    }}>
      {connected ? <CheckCircle2 size={11} /> : <XCircle size={11} />}
      {label ?? (connected ? 'Conectado' : 'Não conectado')}
    </span>
  )
}

export default function Settings() {
  const [loading, setLoading]               = useState(true)
  const [saving, setSaving]                 = useState(false)
  const [connectingGoogle, setConnectingGoogle] = useState(false)
  const { toast } = useToast()

  const [name, setName]               = useState('')
  const [email, setEmail]             = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [profile, setProfile]         = useState<string>('')
  const [tenantId, setTenantId]       = useState('')
  const [hasMeta, setHasMeta]         = useState(false)
  const [metaAccountName, setMetaAccountName] = useState('')
  const [businessId, setBusinessId]   = useState('')
  const [adminWhatsapp, setAdminWhatsapp] = useState('')
  const [adminEmail, setAdminEmail]   = useState('')

  const [googleConnected, setGoogleConnected]     = useState(false)
  const [googleConnectedAt, setGoogleConnectedAt] = useState<string | null>(null)

  useEffect(() => {
    loadProfile()
    const params = new URLSearchParams(window.location.search)
    if (params.get('google_connected') === '1') {
      toast('Google Business Profile conectado com sucesso!', 'success')
      window.history.replaceState({}, '', window.location.pathname)
    } else if (params.get('google_error')) {
      toast(`Erro ao conectar Google: ${params.get('google_error')}`, 'error')
      window.history.replaceState({}, '', window.location.pathname)
    }
  }, [])

  async function loadProfile() {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return

    const { data: userData } = await supabase.from('usuarios').select('*').eq('id', session.user.id).single()
    if (userData) { setName(userData.nome); setEmail(userData.email); setProfile(userData.perfil) }

    const { data: tu } = await supabase.from('tenant_users').select('tenant_id').eq('user_id', session.user.id).single()
    if (tu?.tenant_id) {
      setTenantId(tu.tenant_id)
      const { data: td } = await supabase.from('tenants').select('admin_whatsapp, admin_email').eq('id', tu.tenant_id).single()
      if (td) { setAdminWhatsapp(td.admin_whatsapp || ''); setAdminEmail(td.admin_email || '') }

      const { data: biz } = await supabase.from('monitored_businesses').select('id').eq('tenant_id', tu.tenant_id).limit(1).single()
      if (biz?.id) {
        setBusinessId(biz.id)
        const { data: metaConns } = await supabase.from('channel_connectors').select('id, config').eq('business_id', biz.id).in('channel', ['facebook', 'instagram']).limit(1)
        if (metaConns && metaConns.length > 0) {
          setHasMeta(true)
          const cfg = metaConns[0].config as any
          if (cfg?.page_name) setMetaAccountName(cfg.page_name)
          else if (cfg?.username) setMetaAccountName(cfg.username)
        }
      }
    }

    try {
      const gRes = await fetch(`${API_URL}/api/auth/google/status`, { headers: { Authorization: `Bearer ${session.access_token}` } })
      if (gRes.ok) {
        const gData = await gRes.json() as { connected: boolean; connected_at: string | null }
        setGoogleConnected(gData.connected)
        setGoogleConnectedAt(gData.connected_at)
      }
    } catch { /* ignora */ }

    setLoading(false)
  }

  async function handleGoogleConnect() {
    setConnectingGoogle(true)
    try {
      const { data: { session: sess } } = await supabase.auth.getSession()
      if (!sess) { toast('Sessão expirada.', 'error'); return }
      const res = await fetch(`${API_URL}/api/auth/google/connect`, { headers: { Authorization: `Bearer ${sess.access_token}` } })
      const data = await res.json() as { auth_url?: string; error?: string }
      if (!res.ok || !data.auth_url) { toast(data.error || 'Erro ao conectar Google', 'error'); return }
      if (window.top) window.top.location.href = data.auth_url
      else window.location.href = data.auth_url
    } catch { toast('Erro de conexão com o servidor', 'error') }
    finally { setConnectingGoogle(false) }
  }

  async function handleGoogleDisconnect() {
    try {
      const { data: { session: sess } } = await supabase.auth.getSession()
      if (!sess) return
      await fetch(`${API_URL}/api/auth/google/disconnect`, { method: 'DELETE', headers: { Authorization: `Bearer ${sess.access_token}` } })
      setGoogleConnected(false); setGoogleConnectedAt(null)
      toast('Conexão com Google removida.', 'success')
    } catch { toast('Erro ao desconectar Google.', 'error') }
  }

  function handleMetaConnect() {
    if (!tenantId || !businessId) { toast('ID da empresa não encontrado.', 'error'); return }
    const apiUrl = API_URL.replace(/\/+$/, '')
    const isIframe = window !== window.top
    const fallbackParent = 'https://reputei.com.br/portalcliente'
    const returnUrl = encodeURIComponent(isIframe && !window.location.hostname.includes('localhost') ? fallbackParent : window.location.href)
    const connectUrl = `${apiUrl}/api/auth/meta/connect?tenant_id=${tenantId}&business_id=${businessId}&return_url=${returnUrl}`
    if (window.top) window.top.location.href = connectUrl
    else window.location.href = connectUrl
  }

  async function handleUpdateProfile(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return
    try {
      const { error: upErr } = await supabase.from('usuarios').update({ nome: name }).eq('id', session.user.id)
      if (upErr) throw upErr
      if (newPassword) {
        const { error: passErr } = await supabase.auth.updateUser({ password: newPassword })
        if (passErr) throw passErr
        setNewPassword('')
      }
      if (tenantId) {
        const { error: tErr } = await supabase.from('tenants').update({ admin_whatsapp: adminWhatsapp || null, admin_email: adminEmail || null }).eq('id', tenantId)
        if (tErr) throw tErr
      }
      toast('Perfil atualizado com sucesso!', 'success')
    } catch (err: any) {
      toast(err.message || 'Erro ao atualizar perfil', 'error')
    } finally { setSaving(false) }
  }

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 300, color: 'var(--text-muted)' }}>
      <Loader2 size={24} style={{ animation: 'spin 1s linear infinite' }} />
    </div>
  )

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '32px 24px', display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* ── Header com avatar ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 20, marginBottom: 8 }}>
        <Avatar name={name} />
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: 'var(--text-primary, #f1f5f9)' }}>{name || 'Meu Perfil'}</h1>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{email}</span>
            <span style={{
              padding: '2px 8px', borderRadius: 20, fontSize: 11, fontWeight: 700,
              background: 'rgba(99,102,241,0.15)', color: '#818cf8',
              border: '1px solid rgba(99,102,241,0.25)',
            }}>
              {PROFILE_LABEL[profile] ?? profile}
            </span>
          </div>
        </div>
      </div>

      <form onSubmit={handleUpdateProfile} style={{ display: 'contents' }}>

        {/* ── Dados da Conta ── */}
        <SectionCard>
          <SectionTitle icon={<User size={16} />}>Dados da Conta</SectionTitle>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <Field label="Nome Completo">
              <Input icon={<User size={14} />} type="text" value={name} onChange={e => setName(e.target.value)} required placeholder="Seu nome" />
            </Field>
            <Field label="E-mail (Login)">
              <Input icon={<Mail size={14} />} type="email" value={email} disabled placeholder="email@empresa.com" style={{ opacity: 0.5, cursor: 'not-allowed' }} />
            </Field>
          </div>
        </SectionCard>

        {/* ── Segurança ── */}
        <SectionCard>
          <SectionTitle icon={<Lock size={16} />}>Segurança</SectionTitle>
          <Field label="Nova Senha (deixe em branco para manter)">
            <Input icon={<Lock size={14} />} type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} placeholder="Mínimo 6 caracteres" minLength={6} />
          </Field>
        </SectionCard>

        {/* ── Notificações (apenas não-parceiros) ── */}
        {profile !== 'parceiro' && (
          <SectionCard>
            <SectionTitle icon={<Bell size={16} />}>Alertas Críticos</SectionTitle>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 16, marginTop: -8 }}>
              Quem será avisado quando houver um review crítico sem resposta.
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <Field label="WhatsApp">
                <Input icon={<Phone size={14} />} type="tel" value={adminWhatsapp} onChange={e => setAdminWhatsapp(e.target.value)} placeholder="+5511999999999" />
              </Field>
              <Field label="E-mail">
                <Input icon={<Mail size={14} />} type="email" value={adminEmail} onChange={e => setAdminEmail(e.target.value)} placeholder="adm@empresa.com" />
              </Field>
            </div>
          </SectionCard>
        )}

        {/* ── Botão Salvar ── */}
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button type="submit" className="btn btn-primary" disabled={saving} style={{ padding: '11px 28px', fontWeight: 700, gap: 8 }}>
            {saving ? <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> : <Save size={16} />}
            {saving ? 'Salvando...' : 'Salvar Alterações'}
          </button>
        </div>

      </form>

      {/* ── Integrações ── */}
      {profile !== 'parceiro' && (
        <SectionCard style={{ borderColor: 'rgba(99,102,241,0.15)' }}>
          <SectionTitle icon={<Link2 size={16} />}>Integrações</SectionTitle>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 20, marginTop: -8 }}>
            Conecte seus canais para coletar avaliações e automatizar respostas.
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

            {/* Meta */}
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              background: 'var(--bg-darker)', borderRadius: 14, padding: '14px 18px',
              border: '1px solid var(--border)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <div style={{
                  width: 44, height: 44, borderRadius: 12, flexShrink: 0,
                  background: 'linear-gradient(45deg, #f09433 0%, #e6683c 25%, #dc2743 50%, #cc2366 75%, #bc1888 100%)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: '#fff', fontSize: 22, fontWeight: 800,
                }}>f</div>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700 }}>Meta (Facebook & Instagram)</div>
                  <div style={{ marginTop: 4 }}>
                    <StatusBadge connected={hasMeta} label={hasMeta ? `Conectado${metaAccountName ? ' — ' + metaAccountName : ''}` : 'Não conectado'} />
                  </div>
                </div>
              </div>
              <button onClick={handleMetaConnect} className="btn btn-primary" style={{ fontSize: 13, padding: '8px 18px' }}>
                {hasMeta ? 'Refazer' : 'Conectar'}
              </button>
            </div>

            {/* Google Business Profile */}
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              background: 'var(--bg-darker)', borderRadius: 14, padding: '14px 18px',
              border: googleConnected ? '1px solid rgba(52,211,153,0.2)' : '1px solid var(--border)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <div style={{
                  width: 44, height: 44, borderRadius: 12, flexShrink: 0,
                  background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  boxShadow: '0 2px 8px rgba(0,0,0,0.18)',
                }}>
                  <svg width="24" height="24" viewBox="0 0 24 24">
                    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
                    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                  </svg>
                </div>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700 }}>Google Business Profile</div>
                  <div style={{ marginTop: 4 }}>
                    <StatusBadge
                      connected={googleConnected}
                      label={googleConnected && googleConnectedAt
                        ? `Conectado em ${new Date(googleConnectedAt).toLocaleDateString('pt-BR')}`
                        : googleConnected ? 'Conectado' : 'Necessário para avaliações do Google'}
                    />
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                {googleConnected && (
                  <button onClick={handleGoogleDisconnect} className="btn" style={{ fontSize: 13, padding: '8px 14px', color: '#fca5a5', border: '1px solid rgba(239,68,68,0.3)' }}>
                    Remover
                  </button>
                )}
                <button onClick={handleGoogleConnect} disabled={connectingGoogle} className="btn btn-primary" style={{ fontSize: 13, padding: '8px 18px' }}>
                  {connectingGoogle ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : null}
                  {googleConnected ? 'Refazer' : 'Conectar'}
                </button>
              </div>
            </div>

          </div>
        </SectionCard>
      )}

    </div>
  )
}
