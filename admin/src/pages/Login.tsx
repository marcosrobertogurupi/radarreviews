import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

interface LoginProps {
  externalError?: string | null
}

export default function Login({ externalError }: LoginProps) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)
  const error = externalError || localError

  // Se recebermos um erro externo (vido do App.tsx), paramos o loading
  useEffect(() => {
    if (externalError) {
      setLoading(false)
    }
  }, [externalError])

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setLocalError(null)

    const { error: authError } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (authError) {
      setLocalError('Credenciais inválidas. Verifique seu e-mail e senha.')
      setLoading(false)
      return
    }
    
    // O App.tsx via onAuthStateChange cuidará de validar o perfil
    // e redirecionar ou mostrar erro se necessário.
  }


  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: 'var(--bg-main)' }}>
      <div style={{ width: '100%', maxWidth: 380 }}>
        {/* Link voltar ao site */}
        <div style={{ textAlign: 'center', marginBottom: 16 }}>
          <a
            href="https://www.reputei.com.br"
            style={{ fontSize: 13, color: 'var(--text-muted)', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4, transition: 'color 0.2s' }}
            onMouseEnter={e => (e.currentTarget.style.color = '#a5b4fc')}
            onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-muted)')}
          >
            ← Voltar ao site principal
          </a>
        </div>

        <div className="card" style={{ padding: '40px 32px' }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 48, height: 48, borderRadius: 12, background: 'rgba(99, 102, 241, 0.1)', color: '#a5b4fc', fontSize: 24, marginBottom: 16 }}>
            📡
          </div>
          <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700, color: 'var(--text-primary)' }}>Radar de Reviews</h1>
          <p style={{ margin: '8px 0 0 0', color: 'var(--text-muted)', fontSize: 14 }}>Faça login para gerenciar sua reputação</p>
        </div>

        <form onSubmit={handleLogin}>
          {error && (
            <div style={{ padding: 12, background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.2)', borderRadius: 8, color: '#fca5a5', fontSize: 13, marginBottom: 20 }}>
              {error}
            </div>
          )}

          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', fontSize: 12, color: 'var(--text-secondary)', marginBottom: 6, fontWeight: 500 }}>E-mail corporativo</label>
            <input 
              type="email" 
              required
              value={email}
              onChange={e => setEmail(e.target.value)}
              style={{ width: '100%', padding: '10px 14px', background: 'var(--bg-dark)', border: '1px solid var(--border)', color: 'white', borderRadius: 8, outline: 'none' }}
              placeholder="exemplo@marca.com"
            />
          </div>

          <div style={{ marginBottom: 24 }}>
            <label style={{ display: 'block', fontSize: 12, color: 'var(--text-secondary)', marginBottom: 6, fontWeight: 500 }}>Senha</label>
            <input 
              type="password" 
              required
              value={password}
              onChange={e => setPassword(e.target.value)}
              style={{ width: '100%', padding: '10px 14px', background: 'var(--bg-dark)', border: '1px solid var(--border)', color: 'white', borderRadius: 8, outline: 'none' }}
              placeholder="••••••••"
            />
          </div>

          <button 
            type="submit" 
            disabled={loading}
            className="btn" 
            style={{ width: '100%', padding: 14, background: 'var(--accent)', justifyContent: 'center', fontSize: 14, fontWeight: 600, opacity: loading ? 0.7 : 1 }}
          >
            {loading ? 'Autenticando...' : 'Entrar no painel'}
          </button>
        </form>
          <div className="text-center mt-6">
            <p className="text-xs text-gray-500">v1.0.1 - {new Date().toLocaleDateString()}</p>
          </div>
        </div>
      </div>
    </div>
  )
}
