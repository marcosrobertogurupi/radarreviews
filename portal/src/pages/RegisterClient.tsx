import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { API_URL, CHANNEL_LABELS, CHANNEL_ICONS } from '../lib/utils'
import type { SourceChannel } from '../lib/supabase'
import { ChevronRight, ChevronLeft, Check, X, Eye, EyeOff, User, Mail, Lock, Building2 } from 'lucide-react'

const ALL_CHANNELS: SourceChannel[] = [
  'google_maps', 'tripadvisor', 'consumidor_gov', 'trustpilot',
  'reddit', 'facebook', 'instagram', 'reclame_aqui',
]

const CATEGORIES = [
  'Hotel / Pousada', 'Restaurante / Bar', 'E-commerce',
  'Saúde / Clínica', 'Serviços em Geral', 'Educação',
  'Varejo / Loja', 'Outro',
]

interface PlanData {
  id: string; slug: string; name: string
  price_monthly: number; max_channels: number; color: string
  is_popular: boolean; benefits: string[]
}

interface Props {
  onClose: () => void
  onSuccess: () => void
}

const INPUT_STYLE: React.CSSProperties = {
  width: '100%', padding: '10px 14px',
  background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border)',
  borderRadius: 8, color: 'var(--text-primary)', fontSize: 14,
  fontFamily: 'Inter', outline: 'none', boxSizing: 'border-box',
}

const LABEL_STYLE: React.CSSProperties = {
  display: 'block', fontSize: 12, fontWeight: 600,
  color: 'var(--text-muted)', textTransform: 'uppercase',
  letterSpacing: '0.08em', marginBottom: 6,
}

export default function RegisterClient({ onClose, onSuccess }: Props) {
  const [step, setStep] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<{ tenantId: string; clientEmail: string } | null>(null)

  // Passo 1 — Dados do cliente
  const [bizName, setBizName] = useState('')
  const [clientEmail, setClientEmail] = useState('')
  const [clientPassword, setClientPassword] = useState('')
  const [showPass, setShowPass] = useState(false)
  const [cnpj, setCnpj] = useState('')
  const [category, setCategory] = useState('')

  // Passo 2 — Plano
  const [plans, setPlans] = useState<PlanData[]>([])
  const [plansLoading, setPlansLoading] = useState(true)
  const [selectedPlan, setSelectedPlan] = useState('basico')

  // Passo 3 — Canais
  const [channels, setChannels] = useState<SourceChannel[]>([])
  const [igUser, setIgUser] = useState('')
  const [igHashtags, setIgHashtags] = useState('')
  const [fbUrl, setFbUrl] = useState('')

  useEffect(() => {
    fetch(`${API_URL}/api/plans`)
      .then(r => r.ok ? r.json() : [])
      .then(data => { setPlans(data); setPlansLoading(false) })
      .catch(() => setPlansLoading(false))
  }, [])

  const currentPlan = plans.find(p => p.slug === selectedPlan)
  const maxChannels = currentPlan?.max_channels ?? 3

  function formatCnpj(v: string) {
    const d = v.replace(/\D/g, '').slice(0, 14)
    if (d.length <= 2) return d
    if (d.length <= 5) return `${d.slice(0,2)}.${d.slice(2)}`
    if (d.length <= 8) return `${d.slice(0,2)}.${d.slice(2,5)}.${d.slice(5)}`
    if (d.length <= 12) return `${d.slice(0,2)}.${d.slice(2,5)}.${d.slice(5,8)}/${d.slice(8)}`
    return `${d.slice(0,2)}.${d.slice(2,5)}.${d.slice(5,8)}/${d.slice(8,12)}-${d.slice(12)}`
  }

  function toggleChannel(ch: SourceChannel) {
    setChannels(prev => {
      if (prev.includes(ch)) return prev.filter(c => c !== ch)
      if (prev.length >= maxChannels) return prev
      return [...prev, ch]
    })
  }

  function validateStep0(): string | null {
    if (!bizName.trim()) return 'Informe o nome da empresa.'
    if (!clientEmail.trim()) return 'Informe o e-mail do cliente.'
    if (!/\S+@\S+\.\S+/.test(clientEmail)) return 'E-mail inválido.'
    if (clientPassword.length < 6) return 'Senha deve ter ao menos 6 caracteres.'
    return null
  }

  function validateStep2(): string | null {
    if (channels.length === 0) return 'Selecione ao menos 1 canal.'
    return null
  }

  function nextStep() {
    setError('')
    const err = step === 0 ? validateStep0() : step === 2 ? validateStep2() : null
    if (err) { setError(err); return }
    if (step < 2) { setStep(s => s + 1); return }
    submit()
  }

  async function submit() {
    setLoading(true)
    setError('')
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) throw new Error('Sessão expirada. Faça login novamente.')

      const apiBase = API_URL.replace(/\/+$/, '')
      const res = await fetch(`${apiBase}/api/partner/register-client`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          businessName: bizName.trim(),
          clientEmail: clientEmail.trim(),
          clientPassword,
          plan: selectedPlan,
          cnpj: cnpj || undefined,
          category: category || undefined,
          channels,
          instagramUsername: igUser || undefined,
          hashtags: igHashtags || undefined,
          fbUrl: fbUrl || undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? `Erro ${res.status}`)

      setResult({ tenantId: data.tenantId, clientEmail: data.clientEmail })
      setStep(3)
    } catch (err: any) {
      setError(err.message || 'Erro ao cadastrar cliente.')
    } finally {
      setLoading(false)
    }
  }

  const STEPS = ['Dados do cliente', 'Plano', 'Canais']

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(8px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 16, overflowY: 'auto'
    }}>
      <div style={{
        width: '100%', maxWidth: step === 1 ? 720 : 540,
        background: 'var(--bg-dark)', borderRadius: 20,
        border: '1px solid var(--border)',
        boxShadow: '0 24px 80px rgba(0,0,0,0.5)',
        position: 'relative'
      }}>
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '24px 28px 0', marginBottom: 24
        }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: 'var(--text-primary)' }}>
              Cadastrar Novo Cliente
            </h2>
            <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--text-muted)' }}>
              Você está cadastrando um cliente em nome do seu negócio
            </p>
          </div>
          <button
            onClick={onClose}
            style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border)', borderRadius: 8, padding: 8, cursor: 'pointer', color: 'var(--text-muted)' }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Stepper */}
        {step < 3 && (
          <div style={{ display: 'flex', gap: 0, padding: '0 28px', marginBottom: 28 }}>
            {STEPS.map((label, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', flex: i < STEPS.length - 1 ? 1 : undefined }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                  <div style={{
                    width: 28, height: 28, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 12, fontWeight: 700,
                    background: i < step ? '#10b981' : i === step ? '#6366f1' : 'var(--bg-darker)',
                    color: i <= step ? '#fff' : 'var(--text-muted)',
                    border: i === step ? '2px solid #818cf8' : '2px solid transparent',
                    transition: 'all 0.2s'
                  }}>
                    {i < step ? <Check size={14} /> : i + 1}
                  </div>
                  <span style={{ fontSize: 12, fontWeight: 600, color: i === step ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                    {label}
                  </span>
                </div>
                {i < STEPS.length - 1 && (
                  <div style={{ flex: 1, height: 1, background: i < step ? '#10b981' : 'var(--border)', margin: '0 12px', transition: 'all 0.3s' }} />
                )}
              </div>
            ))}
          </div>
        )}

        <div style={{ padding: '0 28px 28px' }}>

          {/* ── Passo 0: Dados do cliente ── */}
          {step === 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div>
                <label style={LABEL_STYLE}><Building2 size={11} style={{ display: 'inline', marginRight: 4 }} />Nome da Empresa *</label>
                <input
                  autoFocus type="text" value={bizName}
                  onChange={e => setBizName(e.target.value)}
                  placeholder="Ex: Restaurante Bom Sabor"
                  style={INPUT_STYLE}
                  onFocus={e => { e.target.style.borderColor = 'var(--accent)' }}
                  onBlur={e => { e.target.style.borderColor = 'var(--border)' }}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={LABEL_STYLE}><Mail size={11} style={{ display: 'inline', marginRight: 4 }} />E-mail do Cliente *</label>
                  <input
                    type="email" value={clientEmail}
                    onChange={e => setClientEmail(e.target.value)}
                    placeholder="cliente@empresa.com"
                    style={INPUT_STYLE}
                    onFocus={e => { e.target.style.borderColor = 'var(--accent)' }}
                    onBlur={e => { e.target.style.borderColor = 'var(--border)' }}
                  />
                </div>
                <div>
                  <label style={LABEL_STYLE}><Lock size={11} style={{ display: 'inline', marginRight: 4 }} />Senha Inicial *</label>
                  <div style={{ position: 'relative' }}>
                    <input
                      type={showPass ? 'text' : 'password'} value={clientPassword}
                      onChange={e => setClientPassword(e.target.value)}
                      placeholder="Mínimo 6 caracteres"
                      style={{ ...INPUT_STYLE, paddingRight: 40 }}
                      onFocus={e => { e.target.style.borderColor = 'var(--accent)' }}
                      onBlur={e => { e.target.style.borderColor = 'var(--border)' }}
                    />
                    <button type="button" onClick={() => setShowPass(v => !v)}
                      style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>
                      {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={LABEL_STYLE}>CNPJ (opcional)</label>
                  <input type="text" value={cnpj}
                    onChange={e => setCnpj(formatCnpj(e.target.value))}
                    placeholder="00.000.000/0001-00"
                    style={INPUT_STYLE}
                    onFocus={e => { e.target.style.borderColor = 'var(--accent)' }}
                    onBlur={e => { e.target.style.borderColor = 'var(--border)' }}
                  />
                </div>
                <div>
                  <label style={LABEL_STYLE}>Categoria (opcional)</label>
                  <select value={category} onChange={e => setCategory(e.target.value)}
                    style={{ ...INPUT_STYLE, cursor: 'pointer' }}>
                    <option value="">Selecione...</option>
                    {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
              </div>

              <div style={{ padding: '10px 14px', background: 'rgba(99,102,241,0.08)', border: '1px dashed rgba(99,102,241,0.3)', borderRadius: 8, fontSize: 12, color: '#a5b4fc' }}>
                💡 O cliente receberá acesso com o e-mail e senha que você definiu acima. Ele poderá alterar a senha no primeiro acesso.
              </div>
            </div>
          )}

          {/* ── Passo 1: Plano ── */}
          {step === 1 && (
            <div>
              <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 20, padding: '8px 12px', background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)', borderRadius: 8, color: '#fbbf24' }}>
                ⚠️ O plano escolhido aqui inicia em trial de 7 dias. Somente o administrador Reputei pode alterar ou cancelar o plano após a criação.
              </p>

              {plansLoading ? (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  {[1, 2].map(i => <div key={i} style={{ height: 180, background: 'var(--bg-darker)', borderRadius: 12, border: '2px solid var(--border)', animation: 'pulse 1.5s ease infinite' }} />)}
                </div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 16 }}>
                  {plans.map(plan => {
                    const active = selectedPlan === plan.slug
                    return (
                      <button
                        key={plan.id} type="button"
                        onClick={() => { setSelectedPlan(plan.slug); setChannels([]) }}
                        style={{
                          border: `2px solid ${active ? plan.color : 'var(--border)'}`,
                          borderRadius: 16, padding: '20px 18px',
                          background: active ? `${plan.color}12` : 'var(--bg-darker)',
                          cursor: 'pointer', textAlign: 'left', position: 'relative',
                          boxShadow: active ? `0 8px 24px -8px ${plan.color}44` : 'none',
                          transform: active ? 'scale(1.02)' : 'scale(1)',
                          transition: 'all 0.2s'
                        }}
                      >
                        {plan.is_popular && (
                          <div style={{ position: 'absolute', top: -10, right: 10, background: plan.color, color: '#fff', fontSize: 9, fontWeight: 700, padding: '2px 8px', borderRadius: 99 }}>
                            Mais popular
                          </div>
                        )}
                        <div style={{ fontSize: 14, fontWeight: 700, color: active ? plan.color : 'var(--text-primary)', marginBottom: 4 }}>{plan.name}</div>
                        <div style={{ fontSize: 18, fontWeight: 800, color: active ? plan.color : 'var(--text-primary)', marginBottom: 10 }}>
                          R$ {plan.price_monthly}/mês
                        </div>
                        <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
                          {plan.benefits.slice(0, 3).map(f => (
                            <li key={f} style={{ fontSize: 11, color: 'var(--text-secondary)', display: 'flex', gap: 6, alignItems: 'flex-start', marginBottom: 4 }}>
                              <Check size={10} color={plan.color} style={{ marginTop: 2, flexShrink: 0 }} />{f}
                            </li>
                          ))}
                        </ul>
                        {active && <div style={{ marginTop: 10, fontSize: 11, color: plan.color, fontWeight: 700 }}>✓ Selecionado</div>}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {/* ── Passo 2: Canais ── */}
          {step === 2 && (
            <div>
              <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 4 }}>
                Plano <strong style={{ color: currentPlan?.color }}>{currentPlan?.name ?? selectedPlan}</strong> · {maxChannels} canais disponíveis
              </p>
              {channels.length >= maxChannels && (
                <p style={{ fontSize: 12, color: '#f59e0b', marginBottom: 12, background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 6, padding: '6px 10px' }}>
                  ⚠️ Limite de {maxChannels} canais atingido para este plano.
                </p>
              )}

              <div className="channel-grid" style={{ marginBottom: 20 }}>
                {ALL_CHANNELS.map(ch => {
                  const selected = channels.includes(ch)
                  const atLimit = !selected && channels.length >= maxChannels
                  return (
                    <button
                      key={ch} type="button"
                      className={`channel-card ${selected ? 'selected' : ''}`}
                      onClick={() => toggleChannel(ch)}
                      style={{ opacity: atLimit ? 0.4 : 1, cursor: atLimit ? 'not-allowed' : 'pointer' }}
                    >
                      <span className="channel-card-icon">{CHANNEL_ICONS[ch]}</span>
                      <span className="channel-card-label">{CHANNEL_LABELS[ch]}</span>
                      {selected && <span className="channel-card-check"><Check size={11} /></span>}
                    </button>
                  )
                })}
              </div>

              {channels.includes('instagram') && (
                <div style={{ padding: 16, background: 'rgba(99,102,241,0.05)', border: '1px solid rgba(99,102,241,0.2)', borderRadius: 12, marginBottom: 12 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#a5b4fc', marginBottom: 12 }}>📸 Configuração do Instagram</div>
                  <div style={{ marginBottom: 10 }}>
                    <label style={LABEL_STYLE}>Usuário do Instagram (@)</label>
                    <input type="text" value={igUser} onChange={e => setIgUser(e.target.value.replace('@', ''))}
                      placeholder="ex: seunegocio" style={INPUT_STYLE} />
                  </div>
                  <div>
                    <label style={LABEL_STYLE}>Hashtags para monitorar (opcional)</label>
                    <input type="text" value={igHashtags} onChange={e => setIgHashtags(e.target.value)}
                      placeholder="ex: #suamarca, #reviews" style={INPUT_STYLE} />
                  </div>
                </div>
              )}

              {channels.includes('facebook') && (
                <div style={{ padding: 16, background: 'rgba(6,182,212,0.05)', border: '1px solid rgba(6,182,212,0.2)', borderRadius: 12, marginBottom: 12 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#22d3ee', marginBottom: 12 }}>👥 Configuração do Facebook</div>
                  <label style={LABEL_STYLE}>URL da Página do Facebook</label>
                  <input type="text" value={fbUrl} onChange={e => setFbUrl(e.target.value)}
                    placeholder="https://facebook.com/suapagina" style={INPUT_STYLE} />
                </div>
              )}

              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8 }}>
                {channels.length} de {maxChannels} canais selecionados
              </div>
            </div>
          )}

          {/* ── Passo 3: Sucesso ── */}
          {step === 3 && result && (
            <div style={{ textAlign: 'center', padding: '20px 0' }}>
              <div style={{
                width: 72, height: 72, borderRadius: '50%', margin: '0 auto 24px',
                background: 'rgba(16,185,129,0.15)', border: '2px solid rgba(16,185,129,0.4)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <Check size={32} color="#10b981" />
              </div>
              <h3 style={{ fontSize: 22, fontWeight: 800, color: '#10b981', margin: '0 0 8px' }}>
                Cliente cadastrado com sucesso!
              </h3>
              <p style={{ color: 'var(--text-secondary)', fontSize: 14, marginBottom: 24, lineHeight: 1.7 }}>
                O cliente <strong style={{ color: 'var(--text-primary)' }}>{bizName}</strong> foi criado e aparecerá em "Meus Clientes".
              </p>

              <div style={{ background: 'var(--bg-darker)', border: '1px solid var(--border)', borderRadius: 12, padding: 20, marginBottom: 24, textAlign: 'left' }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12 }}>
                  🔑 Credenciais de Acesso do Cliente
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                    <span style={{ color: 'var(--text-muted)' }}>Portal de acesso:</span>
                    <a href="https://reputei.com.br/portalcliente" target="_blank" rel="noreferrer"
                      style={{ color: '#818cf8', textDecoration: 'none', fontWeight: 600 }}>
                      reputei.com.br/portalcliente
                    </a>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                    <span style={{ color: 'var(--text-muted)' }}>E-mail:</span>
                    <strong style={{ color: 'var(--text-primary)' }}>{result.clientEmail}</strong>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                    <span style={{ color: 'var(--text-muted)' }}>Plano:</span>
                    <strong style={{ color: currentPlan?.color ?? '#6366f1' }}>{currentPlan?.name ?? selectedPlan} · Trial 7 dias</strong>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                    <span style={{ color: 'var(--text-muted)' }}>Canais:</span>
                    <strong style={{ color: 'var(--text-primary)' }}>{channels.map(ch => CHANNEL_LABELS[ch]).join(', ')}</strong>
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
                <button
                  className="btn"
                  onClick={() => {
                    // Reset para cadastrar outro
                    setBizName(''); setClientEmail(''); setClientPassword(''); setCnpj(''); setCategory('')
                    setSelectedPlan('basico'); setChannels([]); setIgUser(''); setIgHashtags(''); setFbUrl('')
                    setResult(null); setStep(0)
                  }}
                  style={{ background: 'var(--bg-lighter)', border: '1px solid var(--border)', padding: '10px 20px' }}
                >
                  Cadastrar Outro
                </button>
                <button className="btn btn-primary" onClick={() => { onSuccess(); onClose() }} style={{ padding: '10px 24px' }}>
                  Ir para Meus Clientes
                </button>
              </div>
            </div>
          )}

          {/* Erro */}
          {error && (
            <div style={{ marginTop: 16, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 8, padding: '10px 14px', color: '#fca5a5', fontSize: 13 }}>
              {error}
            </div>
          )}

          {/* Botões de navegação */}
          {step < 3 && (
            <div style={{ display: 'flex', gap: 10, marginTop: 24 }}>
              {step > 0 && (
                <button type="button" className="btn"
                  onClick={() => { setError(''); setStep(s => s - 1) }}
                  disabled={loading}
                  style={{ background: 'var(--bg-lighter)', border: '1px solid var(--border)', padding: '10px 16px' }}
                >
                  <ChevronLeft size={16} />
                </button>
              )}
              <button type="button" className="btn btn-primary"
                onClick={nextStep} disabled={loading}
                style={{ flex: 1, justifyContent: 'center', padding: '12px 0' }}
              >
                {loading ? (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ width: 16, height: 16, border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 0.7s linear infinite', display: 'inline-block' }} />
                    Cadastrando...
                  </span>
                ) : step < 2 ? (
                  <>Próximo <ChevronRight size={16} /></>
                ) : (
                  <>Cadastrar Cliente <Check size={16} /></>
                )}
              </button>
            </div>
          )}
        </div>
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}
