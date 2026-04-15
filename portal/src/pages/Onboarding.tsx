import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { CHANNEL_LABELS, CHANNEL_ICONS, API_URL } from '../lib/utils'
import type { SourceChannel } from '../lib/supabase'
import { Eye, EyeOff, ChevronRight, ChevronLeft, Check } from 'lucide-react'

// ── Constantes ───────────────────────────────────────────────────

const ALL_CHANNELS: SourceChannel[] = [
  'google_maps', 'tripadvisor', 'consumidor_gov', 'trustpilot',
  'reddit', 'facebook', 'instagram', 'reclame_aqui',
]

const CATEGORIES = [
  'Hotel / Pousada',
  'Restaurante / Bar',
  'E-commerce',
  'Saúde / Clínica',
  'Serviços em Geral',
  'Educação',
  'Varejo / Loja',
  'Outro',
]

// ── Props ────────────────────────────────────────────────────────

interface Props {
  onBackToLogin: () => void
  onComplete: () => void
}

// ── Componente ───────────────────────────────────────────────────

export default function Onboarding({ onBackToLogin, onComplete }: Props) {
  const [step,      setStep]     = useState(0)   // 0 = conta, 1 = negócio, 2 = canais, 3 = sucesso
  const [loading,   setLoading]  = useState(false)
  const [error,     setError]    = useState('')

  // Dados do formulário
  const [email,     setEmail]    = useState('')
  const [password,  setPassword] = useState('')
  const [passConf,  setPassConf] = useState('')
  const [showPass,  setShowPass] = useState(false)

  const [bizName,   setBizName]  = useState('')
  const [category,  setCategory] = useState('')
  const [cnpj,      setCnpj]     = useState('')

  const [channels,  setChannels] = useState<SourceChannel[]>([])

  // ── Helpers ──────────────────────────────────────────────────

  function toggleChannel(ch: SourceChannel) {
    setChannels(prev =>
      prev.includes(ch) ? prev.filter(c => c !== ch) : [...prev, ch]
    )
  }

  function formatCnpj(v: string) {
    const d = v.replace(/\D/g, '').slice(0, 14)
    if (d.length <= 2)  return d
    if (d.length <= 5)  return `${d.slice(0,2)}.${d.slice(2)}`
    if (d.length <= 8)  return `${d.slice(0,2)}.${d.slice(2,5)}.${d.slice(5)}`
    if (d.length <= 12) return `${d.slice(0,2)}.${d.slice(2,5)}.${d.slice(5,8)}/${d.slice(8)}`
    return `${d.slice(0,2)}.${d.slice(2,5)}.${d.slice(5,8)}/${d.slice(8,12)}-${d.slice(12)}`
  }

  // ── Validações por passo ─────────────────────────────────────

  function validateStep0(): string | null {
    if (!email.trim())      return 'Informe seu e-mail.'
    if (!/\S+@\S+\.\S+/.test(email)) return 'E-mail inválido.'
    if (password.length < 8) return 'Senha deve ter ao menos 8 caracteres.'
    if (password !== passConf) return 'As senhas não coincidem.'
    return null
  }

  function validateStep1(): string | null {
    if (!bizName.trim()) return 'Informe o nome do seu negócio.'
    return null
  }

  function validateStep2(): string | null {
    if (channels.length === 0) return 'Selecione ao menos 1 canal.'
    return null
  }

  // ── Avanço de passo ──────────────────────────────────────────

  function nextStep() {
    setError('')
    const err = step === 0 ? validateStep0()
              : step === 1 ? validateStep1()
              : step === 2 ? validateStep2()
              : null
    if (err) { setError(err); return }
    if (step < 2) { setStep(s => s + 1); return }
    // Step 2 → submit
    submit()
  }

  // ── Submit ───────────────────────────────────────────────────

  async function submit() {
    setLoading(true)
    setError('')

    try {
      const res = await fetch(`${API_URL}/api/onboarding`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim(),
          password,
          businessName: bizName.trim(),
          ...(category ? { category } : {}),
          ...(cnpj ? { cnpj } : {}),
          channels,
        }),
      })

      const data = await res.json() as { ok?: boolean; error?: string }

      if (!res.ok) {
        setError(
          res.status === 409
            ? 'Este e-mail já está cadastrado. Faça login.'
            : data.error ?? `Erro ${res.status}`
        )
        setLoading(false)
        return
      }

      // Auto-login com as credenciais criadas
      const { error: loginErr } = await supabase.auth.signInWithPassword({
        email: email.trim(), password,
      })
      if (loginErr) {
        setError('Conta criada! Faça login para continuar.')
        setLoading(false)
        onBackToLogin()
        return
      }

      setStep(3)
      setTimeout(onComplete, 2000)

    } catch {
      setError('Não foi possível conectar ao servidor. Verifique se o servidor está rodando.')
    }

    setLoading(false)
  }

  // ── Render ───────────────────────────────────────────────────

  const INPUT_STYLE: React.CSSProperties = {
    width: '100%', padding: '10px 14px',
    background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border)',
    borderRadius: 8, color: 'var(--text-primary)', fontSize: 14,
    fontFamily: 'Inter', outline: 'none', transition: 'border-color 0.2s',
    boxSizing: 'border-box',
  }

  const LABEL_STYLE: React.CSSProperties = {
    display: 'block', fontSize: 12, fontWeight: 600,
    color: 'var(--text-muted)', textTransform: 'uppercase',
    letterSpacing: '0.08em', marginBottom: 6,
  }

  const steps = ['Sua conta', 'Seu negócio', 'Canais']

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'var(--bg-base)', padding: '32px 24px',
    }}>
      {/* Glow decorativo */}
      <div style={{
        position: 'fixed', top: '15%', left: '50%', transform: 'translateX(-50%)',
        width: 700, height: 350, borderRadius: '50%',
        background: 'radial-gradient(ellipse, rgba(99,102,241,0.1), transparent 70%)',
        pointerEvents: 'none',
      }} />

      <div style={{ width: '100%', maxWidth: step === 2 ? 520 : 440 }}>

        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{
            width: 52, height: 52, borderRadius: 14, margin: '0 auto 14px',
            background: 'linear-gradient(135deg, #6366f1, #06b6d4)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 24, boxShadow: '0 0 28px rgba(99,102,241,0.35)',
          }}>📡</div>
          <h1 style={{ fontFamily: 'Outfit', fontWeight: 800, fontSize: 26, background: 'linear-gradient(90deg, #fff, #06b6d4)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>
            Reputei
          </h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginTop: 4 }}>
            Crie sua conta grátis · 7 dias de trial
          </p>
        </div>

        {/* Indicador de passos */}
        {step < 3 && (
          <div className="wizard-steps">
            {steps.map((label, i) => (
              <div key={i} className={`wizard-step ${i === step ? 'active' : i < step ? 'done' : ''}`}>
                <div className="wizard-step-dot">
                  {i < step ? <Check size={11} /> : i + 1}
                </div>
                <span className="wizard-step-label">{label}</span>
              </div>
            ))}
          </div>
        )}

        {/* Card */}
        <div className="card" style={{ padding: 32 }}>

          {/* ── Passo 0: Conta ── */}
          {step === 0 && (
            <div>
              <h2 style={{ fontFamily: 'Outfit', fontSize: 19, fontWeight: 700, marginBottom: 22 }}>
                Crie sua conta
              </h2>
              <div style={{ marginBottom: 14 }}>
                <label style={LABEL_STYLE}>E-mail</label>
                <input type="email" required value={email} onChange={e => setEmail(e.target.value)}
                  placeholder="seu@email.com" style={INPUT_STYLE} autoFocus
                  onFocus={e => { e.target.style.borderColor = 'var(--accent)' }}
                  onBlur={e => { e.target.style.borderColor = 'var(--border)' }} />
              </div>
              <div style={{ marginBottom: 14 }}>
                <label style={LABEL_STYLE}>Senha</label>
                <div style={{ position: 'relative' }}>
                  <input type={showPass ? 'text' : 'password'} value={password}
                    onChange={e => setPassword(e.target.value)} placeholder="Mínimo 8 caracteres"
                    style={{ ...INPUT_STYLE, paddingRight: 44 }}
                    onFocus={e => { e.target.style.borderColor = 'var(--accent)' }}
                    onBlur={e => { e.target.style.borderColor = 'var(--border)' }} />
                  <button type="button" onClick={() => setShowPass(v => !v)}
                    style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex' }}>
                    {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>
              <div style={{ marginBottom: 24 }}>
                <label style={LABEL_STYLE}>Confirmar senha</label>
                <input type={showPass ? 'text' : 'password'} value={passConf}
                  onChange={e => setPassConf(e.target.value)} placeholder="Repita a senha"
                  style={INPUT_STYLE}
                  onFocus={e => { e.target.style.borderColor = 'var(--accent)' }}
                  onBlur={e => { e.target.style.borderColor = 'var(--border)' }} />
              </div>
            </div>
          )}

          {/* ── Passo 1: Negócio ── */}
          {step === 1 && (
            <div>
              <h2 style={{ fontFamily: 'Outfit', fontSize: 19, fontWeight: 700, marginBottom: 22 }}>
                Sobre seu negócio
              </h2>
              <div style={{ marginBottom: 14 }}>
                <label style={LABEL_STYLE}>Nome do negócio *</label>
                <input type="text" value={bizName} onChange={e => setBizName(e.target.value)}
                  placeholder="Ex: Hotel Central, Restaurante Bom Sabor..." style={INPUT_STYLE} autoFocus
                  onFocus={e => { e.target.style.borderColor = 'var(--accent)' }}
                  onBlur={e => { e.target.style.borderColor = 'var(--border)' }} />
              </div>
              <div style={{ marginBottom: 14 }}>
                <label style={LABEL_STYLE}>Categoria</label>
                <select value={category} onChange={e => setCategory(e.target.value)}
                  style={{ ...INPUT_STYLE, cursor: 'pointer' }}>
                  <option value="">Selecione (opcional)</option>
                  {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div style={{ marginBottom: 24 }}>
                <label style={LABEL_STYLE}>CNPJ <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>(opcional)</span></label>
                <input type="text" value={cnpj} onChange={e => setCnpj(formatCnpj(e.target.value))}
                  placeholder="00.000.000/0000-00" style={INPUT_STYLE}
                  onFocus={e => { e.target.style.borderColor = 'var(--accent)' }}
                  onBlur={e => { e.target.style.borderColor = 'var(--border)' }} />
              </div>
            </div>
          )}

          {/* ── Passo 2: Canais ── */}
          {step === 2 && (
            <div>
              <h2 style={{ fontFamily: 'Outfit', fontSize: 19, fontWeight: 700, marginBottom: 6 }}>
                Canais para monitorar
              </h2>
              <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 20 }}>
                Selecione onde sua empresa aparece. Você pode ajustar depois.
              </p>
              <div className="channel-grid">
                {ALL_CHANNELS.map(ch => {
                  const selected = channels.includes(ch)
                  return (
                    <button
                      key={ch}
                      type="button"
                      className={`channel-card ${selected ? 'selected' : ''}`}
                      onClick={() => toggleChannel(ch)}
                    >
                      <span className="channel-card-icon">{CHANNEL_ICONS[ch]}</span>
                      <span className="channel-card-label">{CHANNEL_LABELS[ch]}</span>
                      {selected && (
                        <span className="channel-card-check">
                          <Check size={11} />
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
              <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 10 }}>
                {channels.length} de {ALL_CHANNELS.length} canal{channels.length !== 1 ? 'is' : ''} selecionado{channels.length !== 1 ? 's' : ''}
              </p>
            </div>
          )}

          {/* ── Passo 3: Sucesso ── */}
          {step === 3 && (
            <div style={{ textAlign: 'center', padding: '20px 0' }}>
              <div style={{
                width: 64, height: 64, borderRadius: '50%', margin: '0 auto 20px',
                background: 'rgba(16,185,129,0.15)', border: '2px solid rgba(16,185,129,0.4)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                animation: 'pop-in 0.4s cubic-bezier(0.34,1.56,0.64,1)',
              }}>
                <Check size={28} color="#10b981" />
              </div>
              <h3 style={{ fontFamily: 'Outfit', fontSize: 22, fontWeight: 700, marginBottom: 8, color: '#10b981' }}>
                Conta criada!
              </h3>
              <p style={{ color: 'var(--text-secondary)', fontSize: 14, lineHeight: 1.6 }}>
                Seu trial de 7 dias foi ativado.<br />
                Redirecionando para o painel...
              </p>
              <div style={{ display: 'flex', gap: 4, justifyContent: 'center', marginTop: 20 }}>
                {[0,1,2].map(i => (
                  <span key={i} style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--accent)', opacity: 0.4 + i * 0.3 }} />
                ))}
              </div>
            </div>
          )}

          {/* Erro */}
          {error && (
            <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 8, padding: '10px 14px', color: '#fca5a5', fontSize: 13, marginBottom: 16 }}>
              {error}
            </div>
          )}

          {/* Botões */}
          {step < 3 && (
            <div style={{ display: 'flex', gap: 10 }}>
              {step > 0 && (
                <button
                  type="button"
                  className="btn btn-ghost"
                  style={{ flex: '0 0 auto' }}
                  onClick={() => { setError(''); setStep(s => s - 1) }}
                  disabled={loading}
                >
                  <ChevronLeft size={15} />
                </button>
              )}
              <button
                type="button"
                className="btn btn-primary"
                style={{ flex: 1, justifyContent: 'center', padding: '11px 0' }}
                onClick={nextStep}
                disabled={loading}
              >
                {loading ? (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ width: 16, height: 16, border: '2px solid rgba(255,255,255,0.3)', borderTopColor: 'white', borderRadius: '50%', animation: 'spin 0.7s linear infinite', display: 'inline-block' }} />
                    Criando conta...
                  </span>
                ) : step < 2 ? (
                  <>Próximo <ChevronRight size={15} /></>
                ) : (
                  <>Criar conta grátis <ChevronRight size={15} /></>
                )}
              </button>
            </div>
          )}
        </div>

        {/* Link voltar ao login */}
        {step < 3 && (
          <p style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: 13, marginTop: 20 }}>
            Já tem conta?{' '}
            <button
              type="button"
              onClick={onBackToLogin}
              style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: 13, textDecoration: 'underline' }}
            >
              Fazer login
            </button>
          </p>
        )}
      </div>

      <style>{`
        @keyframes spin    { to { transform: rotate(360deg); } }
        @keyframes pop-in  { from { transform: scale(0.5); opacity: 0; } to { transform: scale(1); opacity: 1; } }
      `}</style>
    </div>
  )
}
