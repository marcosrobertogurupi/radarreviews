import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { User, Mail, Lock, ShieldCheck, Save, Loader2 } from 'lucide-react'

export default function Settings() {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null)
  
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [profile, setProfile] = useState<string>('')
  const [tenantId, setTenantId] = useState('')
  const [hasMeta, setHasMeta] = useState(false)
  const [businessId, setBusinessId] = useState('')

  useEffect(() => {
    loadProfile()
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
        const { data: metaConn } = await supabase
          .from('channel_connectors')
          .select('id, config')
          .eq('business_id', biz.id)
          .in('channel', ['facebook', 'instagram'])
          .not('config->page_token_enc', 'is', null)
          .maybeSingle()
        
        if (metaConn) setHasMeta(true)
      }
    }

    setLoading(false)
  }

  function handleMetaConnect() {
    if (!tenantId || !businessId) {
      setMessage({ type: 'error', text: 'Erro interno: ID da empresa não encontrado.' })
      return
    }
    const apiUrl = (import.meta.env.VITE_API_URL ?? 'https://reputei-api.railway.app').replace(/\/+$/, '')
    
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
    setMessage(null)

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

      setMessage({ type: 'success', text: 'Perfil atualizado com sucesso!' })
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'Erro ao atualizar perfil' })
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

          {message && (
            <div style={{ 
              padding: '12px 16px', borderRadius: 8, fontSize: 14,
              background: message.type === 'success' ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)',
              color: message.type === 'success' ? '#10b981' : '#f87171',
              border: `1px solid ${message.type === 'success' ? 'rgba(16,185,129,0.2)' : 'rgba(239,68,68,0.2)'}`
            }}>
              {message.text}
            </div>
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

        <div className="card p-6 mt-8" style={{ background: 'rgba(99,102,241,0.03)', border: '1px solid rgba(99,102,241,0.1)' }}>
          <h3 style={{ margin: '0 0 16px 0', fontSize: 16, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
            🔗 Conexões Sociais
          </h3>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 20 }}>
            Conecte sua conta oficial do Facebook ou Instagram para obter métricas mais precisas e automações avançadas.
          </p>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px', background: 'var(--bg-darker)', borderRadius: 12, border: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ width: 40, height: 40, borderRadius: 10, background: 'linear-gradient(45deg, #f09433 0%, #e6683c 25%, #dc2743 50%, #cc2366 75%, #bc1888 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontSize: 20 }}>
                f
              </div>
              <div>
                <div style={{ fontWeight: 600, fontSize: 14 }}>Meta (Facebook & Instagram)</div>
                <div style={{ fontSize: 12, color: hasMeta ? '#10b981' : 'var(--text-muted)' }}>
                  {hasMeta ? '● Conectado oficialmente' : '○ Não conectado'}
                </div>
              </div>
            </div>
            <button 
              type="button"
              onClick={handleMetaConnect}
              className="btn"
              style={{ 
                background: hasMeta ? 'rgba(16,185,129,0.1)' : 'var(--accent)',
                color: hasMeta ? '#10b981' : 'white',
                border: hasMeta ? '1px solid rgba(16,185,129,0.2)' : 'none',
                padding: '8px 16px',
                fontSize: 13
              }}
            >
              {hasMeta ? 'Reconectar' : 'Conectar Agora'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
