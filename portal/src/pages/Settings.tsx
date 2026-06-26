import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { User, Mail, Lock, ShieldCheck, Save, Loader2, Phone, CheckCircle2, XCircle } from 'lucide-react'
import { useToast } from '../components/Toast'
import { API_URL } from '../lib/utils'

export default function Settings() {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [connectingGoogle, setConnectingGoogle] = useState(false)
  const { toast } = useToast()

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [profile, setProfile] = useState<string>('')
  const [tenantId, setTenantId] = useState('')
  const [hasMeta, setHasMeta] = useState(false)
  const [metaAccountName, setMetaAccountName] = useState('')
  const [businessId, setBusinessId] = useState('')
  const [adminWhatsapp, setAdminWhatsapp] = useState('')
  const [adminEmail, setAdminEmail] = useState('')

  // Google Business Profile
  const [googleConnected, setGoogleConnected] = useState(false)
  const [googleConnectedAt, setGoogleConnectedAt] = useState<string | null>(null)
  const [googleScope, setGoogleScope] = useState<string | null>(null)

  useEffect(() => {
    loadProfile()

    // Retorno do OAuth Google — mostrar toast com resultado
    const params = new URLSearchParams(window.location.search)
    if (params.get('google_connected') === '1') {
      toast('Google Business Profile conectado com sucesso!', 'success')
      window.history.replaceState({}, '', window.location.pathname)
    } else if (params.get('google_error')) {
      const err = params.get('google_error')
      toast(`Erro ao conectar Google: ${err}`, 'error')
      window.history.replaceState({}, '', window.location.pathname)
    }
  }, [])

  async function loadProfile() {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return

    const { data: userData } = await supabase
      .from('usuarios')
      .select('*')
      .eq('id', session.user.id)
      .single()

    if (userData) {
      setName(userData.nome)
      setEmail(userData.email)
      setProfile(userData.perfil)
    }

    const { data: tu } = await supabase
      .from('tenant_users')
      .select('tenant_id')
      .eq('user_id', session.user.id)
      .single()

    if (tu?.tenant_id) {
      setTenantId(tu.tenant_id)

      const { data: tenantData } = await supabase
        .from('tenants')
        .select('admin_whatsapp, admin_email')
        .eq('id', tu.tenant_id)
        .single()
      
      if (tenantData) {
        setAdminWhatsapp(tenantData.admin_whatsapp || '')
        setAdminEmail(tenantData.admin_email || '')
      }

      // Fetch the business ID for this tenant
      const { data: biz } = await supabase
        .from('monitored_businesses')
        .select('id')
        .eq('tenant_id', tu.tenant_id)
        .limit(1)
        .single()
      
      if (biz?.id) {
        setBusinessId(biz.id)
        
        // Verificar se já tem conector Meta configurado
        const { data: metaConns } = await supabase
          .from('channel_connectors')
          .select('id, config')
          .eq('business_id', biz.id)
          .in('channel', ['facebook', 'instagram'])
          .limit(1)
        
        if (metaConns && metaConns.length > 0) {
          setHasMeta(true)
          const cfg = metaConns[0].config as any
          if (cfg?.page_name) setMetaAccountName(cfg.page_name)
          else if (cfg?.username) setMetaAccountName(cfg.username)
        }
      }
    }

    // Carregar status do Google Business Profile
    const { data: { session: sess } } = await supabase.auth.getSession()
    if (sess) {
      try {
        const gRes = await fetch(`${API_URL}/api/auth/google/status`, {
          headers: { Authorization: `Bearer ${sess.access_token}` }
        })
        if (gRes.ok) {
          const gData = await gRes.json() as { connected: boolean; connected_at: string | null; scope: string | null }
          setGoogleConnected(gData.connected)
          setGoogleConnectedAt(gData.connected_at)
          setGoogleScope(gData.scope)
        }
      } catch { /* ignora falha de rede silenciosamente */ }
    }

    setLoading(false)
  }

  async function handleGoogleConnect() {
    setConnectingGoogle(true)
    try {
      const { data: { session: sess } } = await supabase.auth.getSession()
      if (!sess) { toast('Sessão expirada. Faça login novamente.', 'error'); return }

      const res = await fetch(`${API_URL}/api/auth/google/connect`, {
        headers: { Authorization: `Bearer ${sess.access_token}` }
      })
      const data = await res.json() as { auth_url?: string; error?: string }

      if (!res.ok || !data.auth_url) {
        toast(data.error || 'Erro ao iniciar conexão com Google', 'error')
        return
      }

      // Redireciona para a tela de autorização do Google
      // Usa window.top para sair do iframe (Google bloqueia OAuth em iframes)
      if (window.top) {
        window.top.location.href = data.auth_url
      } else {
        window.location.href = data.auth_url
      }
    } catch {
      toast('Erro de conexão com o servidor', 'error')
    } finally {
      setConnectingGoogle(false)
    }
  }

  async function handleGoogleDisconnect() {
    try {
      const { data: { session: sess } } = await supabase.auth.getSession()
      if (!sess) return

      await fetch(`${API_URL}/api/auth/google/disconnect`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${sess.access_token}` }
      })
      setGoogleConnected(false)
      setGoogleConnectedAt(null)
      setGoogleScope(null)
      toast('Conexão com Google removida.', 'success')
    } catch {
      toast('Erro ao desconectar Google.', 'error')
    }
  }

  function handleMetaConnect() {
    if (!tenantId || !businessId) {
      toast('Erro interno: ID da empresa não encontrado.', 'error')
      return
    }
    const apiUrl = API_URL.replace(/\/+$/, '')
    
    const isIframe = window !== window.top
    const fallbackParent = 'https://reputei.com.br/portalcliente'
    const returnUrlStr = isIframe && !window.location.hostname.includes('localhost') 
      ? fallbackParent 
      : window.location.href
    
    const returnUrl = encodeURIComponent(returnUrlStr)
    const connectUrl = `${apiUrl}/api/auth/meta/connect?tenant_id=${tenantId}&business_id=${businessId}&return_url=${returnUrl}`
    
    // Usamos window.top para garantir que, se o portal estiver num iframe, o Facebook carregue na janela inteira.
    if (window.top) {
      window.top.location.href = connectUrl
    } else {
      window.location.href = connectUrl
    }
  }

  async function handleUpdateProfile(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)

    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return

    try {
      // 1. Atualizar public.usuarios
      const { error: upErr } = await supabase
        .from('usuarios')
        .update({ nome: name })
        .eq('id', session.user.id)

      if (upErr) throw upErr

      // 2. Se mudou a senha
      if (newPassword) {
        const { error: passErr } = await supabase.auth.updateUser({ password: newPassword })
        if (passErr) throw passErr
        setNewPassword('')
      }

      // 3. Atualizar contatos do admin
      if (tenantId) {
        const { error: tErr } = await supabase
          .from('tenants')
          .update({ admin_whatsapp: adminWhatsapp || null, admin_email: adminEmail || null })
          .eq('id', tenantId)
        if (tErr) throw tErr
      }

      toast('Perfil atualizado com sucesso!', 'success')
    } catch (err: any) {
      toast(err.message || 'Erro ao atualizar perfil', 'error')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="p-8 text-center color-muted">Carregando...</div>

  return (
    <div className="settings-page p-8">
      <div className="page-header mb-8">
        <h1 className="page-title">Meu Perfil</h1>
        <p className="page-subtitle">Gerencie suas informações de acesso e dados pessoais.</p>
      </div>

      <div className="max-w-2xl">
        <form onSubmit={handleUpdateProfile} className="card p-6" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          
          <div className="form-group">
            <label style={{ display: 'block', marginBottom: 8, fontSize: 13, fontWeight: 600 }}>Perfil de Acesso</label>
            <div style={{ 
              display: 'flex', alignItems: 'center', gap: 8, 
              padding: '10px 14px', background: 'var(--bg-darker)', 
              borderRadius: 8, border: '1px solid var(--border)', color: 'var(--text-muted)' 
            }}>
              <ShieldCheck size={16} />
              <span style={{ textTransform: 'uppercase', fontSize: 12, fontWeight: 700 }}>{profile}</span>
            </div>
          </div>

          <div className="form-group">
            <label style={{ display: 'block', marginBottom: 8, fontSize: 13, fontWeight: 600 }}>Nome Completo</label>
            <div className="input-with-icon">
              <User size={16} className="icon" />
              <input 
                type="text" 
                value={name} 
                onChange={e => setName(e.target.value)} 
                required 
                placeholder="Seu nome"
                className="input"
              />
            </div>
          </div>

          <div className="form-group">
            <label style={{ display: 'block', marginBottom: 8, fontSize: 13, fontWeight: 600 }}>E-mail (Login)</label>
            <div className="input-with-icon">
              <Mail size={16} className="icon" />
              <input 
                type="email" 
                value={email} 
                disabled 
                title="O e-mail não pode ser alterado por aqui."
                className="input"
                style={{ opacity: 0.6, cursor: 'not-allowed' }}
              />
            </div>
          </div>

          <hr style={{ border: '0', borderTop: '1px solid var(--border)', margin: '10px 0' }} />

          <div className="form-group">
            <label style={{ display: 'block', marginBottom: 8, fontSize: 13, fontWeight: 600 }}>Nova Senha (deixe em branco para manter)</label>
            <div className="input-with-icon">
              <Lock size={16} className="icon" />
              <input 
                type="password" 
                value={newPassword} 
                onChange={e => setNewPassword(e.target.value)} 
                placeholder="Mínimo 6 caracteres"
                className="input"
                minLength={6}
              />
            </div>
          </div>

          {profile !== 'parceiro' && (
            <>
              <hr style={{ border: '0', borderTop: '1px solid var(--border)', margin: '10px 0' }} />
              <h3 style={{ margin: '0 0 8px 0', fontSize: 14, fontWeight: 700 }}>Notificações de Alertas Críticos</h3>
              <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 16 }}>
                Defina quem será avisado caso ocorra algum review crítico não respondido.
              </p>

              <div className="form-group">
                <label style={{ display: 'block', marginBottom: 8, fontSize: 13, fontWeight: 600 }}>WhatsApp do Admin</label>
                <div className="input-with-icon">
                  <Phone size={16} className="icon" />
                  <input 
                    type="tel" 
                    value={adminWhatsapp} 
                    onChange={e => setAdminWhatsapp(e.target.value)} 
                    placeholder="+5511999999999"
                    className="input"
                  />
                </div>
              </div>

              <div className="form-group">
                <label style={{ display: 'block', marginBottom: 8, fontSize: 13, fontWeight: 600 }}>E-mail do Admin</label>
                <div className="input-with-icon">
                  <Mail size={16} className="icon" />
                  <input 
                    type="email" 
                    value={adminEmail} 
                    onChange={e => setAdminEmail(e.target.value)} 
                    placeholder="adm@empresa.com"
                    className="input"
                  />
                </div>
              </div>
            </>
          )}


          <button 
            type="submit" 
            className="btn btn-primary" 
            disabled={saving}
            style={{ width: 'fit-content', padding: '12px 24px', alignSelf: 'flex-end' }}
          >
            {saving ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
            {saving ? 'Salvando...' : 'Salvar Alterações'}
          </button>

        </form>

        {profile !== 'parceiro' && (
          <div className="card p-6 mt-8" style={{ background: 'rgba(99,102,241,0.03)', border: '1px solid rgba(99,102,241,0.1)' }}>
            <h3 style={{ margin: '0 0 16px 0', fontSize: 16, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
              🔗 Conexões Sociais
            </h3>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 20 }}>
              Conecte sua conta oficial do Facebook ou Instagram para obter métricas mais precisas e automações avançadas.
            </p>

            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              background: 'var(--bg-darker)', border: '1px solid var(--border)', borderRadius: 12, padding: 16
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                <div style={{ width: 40, height: 40, borderRadius: 10, background: 'linear-gradient(45deg, #f09433 0%, #e6683c 25%, #dc2743 50%, #cc2366 75%, #bc1888 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 20, fontWeight: 800 }}>
                  f
                </div>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700 }}>Meta (Facebook & Instagram)</div>
                  {hasMeta ? (
                    <div style={{ fontSize: 12, color: '#34d399', display: 'flex', alignItems: 'center', gap: 4, marginTop: 2 }}>
                      <ShieldCheck size={12} /> Conectado como {metaAccountName || 'sua conta'}
                    </div>
                  ) : (
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>○ Não conectado</div>
                  )}
                </div>
              </div>

              <button
                onClick={handleMetaConnect}
                className="btn btn-primary"
                style={{ background: hasMeta ? 'var(--bg-lighter)' : undefined, color: hasMeta ? 'var(--text-primary)' : undefined, border: hasMeta ? '1px solid var(--border)' : undefined }}
              >
                {hasMeta ? 'Refazer Conexão' : 'Conectar Agora'}
              </button>
            </div>

            {/* Google Business Profile */}
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              background: 'var(--bg-darker)', border: '1px solid var(--border)', borderRadius: 12, padding: 16, marginTop: 12
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                <div style={{ width: 40, height: 40, borderRadius: 10, background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, boxShadow: '0 1px 4px rgba(0,0,0,0.15)' }}>
                  G
                </div>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700 }}>Google Business Profile</div>
                  {googleConnected ? (
                    <div style={{ fontSize: 12, color: '#34d399', display: 'flex', alignItems: 'center', gap: 4, marginTop: 2 }}>
                      <CheckCircle2 size={12} />
                      Conectado{googleConnectedAt ? ` em ${new Date(googleConnectedAt).toLocaleDateString('pt-BR')}` : ''}
                    </div>
                  ) : (
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 4, marginTop: 2 }}>
                      <XCircle size={12} /> Não conectado — necessário para importar avaliações do Google
                    </div>
                  )}
                </div>
              </div>

              <div style={{ display: 'flex', gap: 8 }}>
                {googleConnected && (
                  <button onClick={handleGoogleDisconnect} className="btn" style={{ fontSize: 12, color: '#fca5a5', border: '1px solid rgba(239,68,68,0.3)' }}>
                    Desconectar
                  </button>
                )}
                <button
                  onClick={handleGoogleConnect}
                  className="btn btn-primary"
                  disabled={connectingGoogle}
                  style={{ background: googleConnected ? 'var(--bg-lighter)' : undefined, color: googleConnected ? 'var(--text-primary)' : undefined, border: googleConnected ? '1px solid var(--border)' : undefined }}
                >
                  {connectingGoogle ? <Loader2 size={14} className="animate-spin" /> : null}
                  {googleConnected ? 'Refazer Conexão' : 'Conectar Agora'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
