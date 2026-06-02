import { useState, useEffect } from 'react'

import { supabase } from '../lib/supabase'
import { CHANNEL_LABELS, CHANNEL_ICONS, API_URL } from '../lib/utils'
import type { SourceChannel } from '../lib/supabase'
import { Eye, EyeOff, ChevronRight, ChevronLeft, Check } from 'lucide-react'

// ── Constantes ───────────────────────────────────────────────────

const ALL_CHANNELS: SourceChannel[] = [
  'google_maps', 'tripadvisor', 'consumidor_gov', 'trustpilot',
  'reddit', 'facebook', 'instagram', 'reclame_aqui',
]

interface PlanData {
  id: string
  slug: string
  name: string
  price_monthly: number
  max_channels: number
  color: string
  is_popular: boolean
  benefits: string[]
}


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
  partnerRef?: string
}

// ── Componente ───────────────────────────────────────────────────

export default function Onboarding({ onBackToLogin, onComplete, partnerRef }: Props) {
  const [step,      setStep]     = useState(0)   // 0=conta 1=negócio 2=plano 3=canais 4=sucesso
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

  const [selectedPlan, setSelectedPlan] = useState<string>('basico')
  const [plans, setPlans] = useState<PlanData[]>([])
  const [plansLoading, setPlansLoading] = useState(true)
  const [channels,  setChannels] = useState<SourceChannel[]>([])
  
  const [carouselIdx, setCarouselIdx] = useState(0)
  const [customCh, setCustomCh] = useState(3)
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768)

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth <= 768)
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])


  
  // Configurações específicas por canal
  const [igUser,     setIgUser]     = useState('')
  const [igHashtags, setIgHashtags] = useState('')
  const [fbUrl,      setFbUrl]      = useState('')

  // ── Helpers ──────────────────────────────────────────────────

  const planConfig = plans.find(p => p.slug === selectedPlan) || plans[0] || { color: '#6b7280', name: 'Carregando...', max_channels: 3 }
  
  // Preço dinâmico para o Custom
  const getPlanPrice = (plan: PlanData) => {
    if (plan.slug === 'custom') {
      return 149 + (customCh - 3) * 49
    }
    return plan.price_monthly
  }

  const getPlanMaxChannels = (plan: PlanData) => {
    if (plan.slug === 'custom') return customCh
    return plan.max_channels
  }



  useEffect(() => {
    async function loadPlans() {
      try {
        const res = await fetch(`${API_URL}/api/plans`)
        if (res.ok) {
          const data = await res.json()
          setPlans(data)
          if (data.length > 0) {
            // Se houver planos, tenta manter o 'basico' como default se ele existir na lista
            const hasBasico = data.some((p: PlanData) => p.slug === 'basico')
            if (!hasBasico) setSelectedPlan(data[0].slug)
          }
        }
      } catch (err) {
        console.error('Erro ao carregar planos:', err)
      } finally {
        setPlansLoading(false)
      }
    }
    loadPlans()
  }, [])


  function toggleChannel(ch: SourceChannel) {
    setChannels(prev => {
      if (prev.includes(ch)) return prev.filter(c => c !== ch)
      const max = getPlanMaxChannels(planConfig as PlanData)
      if (planConfig && prev.length >= max) return prev // limite do plano
      return [...prev, ch]


    })
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

  function validateStep3(): string | null {
    if (channels.length === 0) return 'Selecione ao menos 1 canal.'
    return null
  }

  // ── Avanço de passo ──────────────────────────────────────────

  function nextStep() {
    setError('')
    const err = step === 0 ? validateStep0()
              : step === 1 ? validateStep1()
              : step === 2 ? null // plano sempre válido (já tem default)
              : step === 3 ? validateStep3()
              : null
    if (err) { setError(err); return }
    if (step < 3) { setStep(s => s + 1); return }
    // Step 3 → submit
    submit()
  }

  function nextCarousel() {
    const maxVisible = isMobile ? 1 : 2
    if (carouselIdx < plans.length - maxVisible) setCarouselIdx(v => v + 1)
  }

  function prevCarousel() {
    if (carouselIdx > 0) setCarouselIdx(v => v - 1)
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
          plan: selectedPlan,
          ...(selectedPlan === 'custom' ? { customChannels: customCh } : {}),
          ...(category ? { category } : {}),

          ...(cnpj ? { cnpj } : {}),
          channels,
          instagramUsername: igUser,
          hashtags: igHashtags,
          fbUrl: fbUrl,
          ...(partnerRef ? { partnerRef } : {}),
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

      setStep(4)
      setTimeout(onComplete, 2000)

    } catch {
      setError('Erro ao criar sua conta. Tente novamente em instantes ou entre em contato com o suporte.')
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

  const steps = ['Sua conta', 'Seu negócio', 'Plano', 'Canais']

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

      <div style={{ width: '100%', maxWidth: (step === 2 || step === 3) ? 520 : 440 }}>

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

          {/* ── Passo 2: Plano ── */}
          {step === 2 && (
            <div>
              <h2 style={{ fontFamily: 'Outfit', fontSize: 19, fontWeight: 700, marginBottom: 6 }}>
                Escolha seu plano
              </h2>
              <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 20 }}>
                7 dias grátis · sem cartão de crédito · cancele quando quiser
              </p>
              {plansLoading ? (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  {[1, 2].map(i => (
                    <div key={i} className="animate-pulse" style={{ height: 160, background: 'var(--bg-darker)', borderRadius: 12, border: '2px solid var(--border)' }} />
                  ))}
                </div>
              ) : (
                <div style={{ position: 'relative' }}>
                  <div style={{ overflow: 'hidden', margin: '0 -4px', padding: '12px 0' }}>
                    <div style={{ 
                      display: 'flex', 
                      transition: 'transform 0.4s cubic-bezier(0.4, 0, 0.2, 1)',
                      transform: `translateX(-${carouselIdx * (100 / (isMobile ? 1 : 2))}%)`,
                    }}>
                      {plans.map((plan, idx) => {
                        const active = selectedPlan === plan.slug
                        return (
                          <div key={plan.id} style={{ 
                            minWidth: isMobile ? '100%' : '50%', 
                            padding: '0 8px', 
                            boxSizing: 'border-box',
                            transition: 'all 0.3s'
                          }}>
                            <button
                              type="button"
                              onClick={() => { setSelectedPlan(plan.slug); setChannels([]) }}
                              style={{
                                width: '100%',
                                border: `2px solid ${active ? plan.color : 'var(--border)'}`,
                                borderRadius: 16, padding: '24px 20px 32px', 
                                background: active ? `rgba(99,102,241,0.06)` : 'var(--bg-darker)',
                                cursor: 'pointer', textAlign: 'left', transition: 'all 0.2s', position: 'relative',
                                height: '100%', display: 'flex', flexDirection: 'column',
                                boxShadow: active ? `0 8px 24px -8px ${plan.color}44` : 'none',
                                transform: active ? 'scale(1.02)' : 'scale(1)',
                              }}
                            >
                              {plan.is_popular && (
                                <div style={{ position: 'absolute', top: -10, right: 12, background: plan.color, color: '#fff', fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 99 }}>
                                  Mais popular
                                </div>
                              )}
                              <div style={{ fontSize: 14, fontWeight: 700, color: active ? plan.color : 'var(--text-primary)', marginBottom: 2 }}>{plan.name}</div>
                              <div style={{ fontSize: 17, fontWeight: 800, color: active ? plan.color : 'var(--text-primary)', marginBottom: 8 }}>
                                R$ {getPlanPrice(plan)}/mês
                              </div>

                              {/* Slider para Plano Custom */}
                              {plan.slug === 'custom' && (
                                <div style={{ marginBottom: 12 }} onClick={e => e.stopPropagation()}>
                                  <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 4, display: 'flex', justifyContent: 'space-between' }}>
                                    <span>Canais: <strong>{customCh}</strong></span>
                                    <span>Base + {(customCh-3)}x R$49</span>
                                  </div>
                                  <input 
                                    type="range" min={3} max={10} value={customCh} 
                                    onChange={e => setCustomCh(Number(e.target.value))}
                                    style={{ width: '100%', accentColor: plan.color, cursor: 'pointer' }}
                                  />
                                </div>
                              )}

                              <ul style={{ margin: 0, padding: 0, listStyle: 'none', flex: 1 }}>
                                {plan.benefits.map(f => (
                                  <li key={f} style={{ fontSize: 11, color: 'var(--text-secondary)', display: 'flex', gap: 6, alignItems: 'flex-start', marginBottom: 4 }}>
                                    <Check size={10} color={plan.color} style={{ marginTop: 2, flexShrink: 0 }} />{f}
                                  </li>
                                ))}
                              </ul>
                              {active && (
                                <div style={{ marginTop: 10, fontSize: 11, color: plan.color, fontWeight: 600 }}>✓ Selecionado</div>
                              )}
                            </button>
                          </div>
                        )
                      })}
                    </div>
                  </div>

                  {/* Controles do Carrossel */}
                  {plans.length > (isMobile ? 1 : 2) && (
                    <div style={{ display: 'flex', justifyContent: 'center', gap: 12, marginTop: 24 }}>
                      <button 
                        type="button" onClick={prevCarousel} disabled={carouselIdx === 0}
                        style={{ 
                          background: 'var(--bg-darker)', border: '1px solid var(--border)', 
                          borderRadius: '50%', width: 36, height: 36, 
                          display: 'flex', alignItems: 'center', justifyContent: 'center', 
                          cursor: 'pointer', opacity: carouselIdx === 0 ? 0.3 : 1,
                          transition: 'all 0.2s',
                          color: 'white'
                        }}
                        onMouseEnter={e => { if (carouselIdx > 0) e.currentTarget.style.borderColor = 'var(--accent)' }}
                        onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)' }}
                      >
                        <ChevronLeft size={20} />
                      </button>
                      
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        {Array.from({ length: plans.length - (isMobile ? 0 : 1) }).map((_, i) => (
                          <div key={i} style={{ 
                            width: 6, height: 6, borderRadius: '50%', 
                            background: carouselIdx === i ? 'var(--accent)' : 'var(--border)',
                            transition: 'all 0.2s'
                          }} />
                        ))}
                      </div>

                      <button 
                        type="button" onClick={nextCarousel} disabled={carouselIdx >= plans.length - (isMobile ? 1 : 2)}
                        style={{ 
                          background: 'var(--bg-darker)', border: '1px solid var(--border)', 
                          borderRadius: '50%', width: 36, height: 36, 
                          display: 'flex', alignItems: 'center', justifyContent: 'center', 
                          cursor: 'pointer', opacity: carouselIdx >= plans.length - (isMobile ? 1 : 2) ? 0.3 : 1,
                          transition: 'all 0.2s',
                          color: 'white'
                        }}
                        onMouseEnter={e => { if (carouselIdx < plans.length - (isMobile ? 1 : 2)) e.currentTarget.style.borderColor = 'var(--accent)' }}
                        onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)' }}
                      >
                        <ChevronRight size={20} />
                      </button>
                    </div>
                  )}
                </div>

              )}

            </div>
          )}

          {/* ── Passo 3: Canais ── */}
          {step === 3 && (
            <div>
              <h2 style={{ fontFamily: 'Outfit', fontSize: 19, fontWeight: 700, marginBottom: 4 }}>
                Canais para monitorar
              </h2>
              <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 4 }}>
                Plano <strong style={{ color: planConfig?.color }}>{planConfig?.name}</strong> · {getPlanMaxChannels(planConfig as PlanData)} {getPlanMaxChannels(planConfig as PlanData) !== 1 ? 'canais' : 'canal'} {getPlanMaxChannels(planConfig as PlanData) !== 1 ? 'disponíveis' : 'disponível'}


              </p>
              {channels.length >= planConfig.max_channels && (
                <p style={{ fontSize: 12, color: '#f59e0b', marginBottom: 12, background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 6, padding: '6px 10px', display: 'flex', alignItems: 'center', gap: 6 }}>
                  ⚠️ Você atingiu o limite de {planConfig.max_channels} canais deste plano.
                </p>
              )}
              <div className="channel-grid">
                {ALL_CHANNELS.map(ch => {
                    const selected = channels.includes(ch)
                    const max = getPlanMaxChannels(planConfig as PlanData)
                    const atLimit = !selected && channels.length >= (max || 0)
                    return (
                      <button
                        key={ch}
                        type="button"
                        className={`channel-card ${selected ? 'selected' : ''}`}
                        onClick={() => toggleChannel(ch)}
                        style={{ opacity: atLimit ? 0.4 : 1, cursor: atLimit ? 'not-allowed' : 'pointer' }}
                        title={atLimit ? `Limite de ${max} canais do plano ${planConfig?.name}` : undefined}
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
                {channels.length} de {getPlanMaxChannels(planConfig as PlanData)} {getPlanMaxChannels(planConfig as PlanData) !== 1 ? 'canais' : 'canal'} selecionado{channels.length !== 1 ? 's' : ''}


              </p>

              {/* Configuração Condicional do Instagram */}
              {channels.includes('instagram') && (
                <div style={{ marginTop: 20, padding: 16, background: 'rgba(99,102,241,0.05)', border: '1px solid rgba(99,102,241,0.2)', borderRadius: 12 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#a5b4fc', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                    📸 Configuração do Instagram
                  </div>
                  <div style={{ marginBottom: 12 }}>
                    <label style={LABEL_STYLE}>Seu usuário do Instagram (@)</label>
                    <input 
                      type="text" 
                      value={igUser} 
                      onChange={e => setIgUser(e.target.value.replace('@', ''))}
                      placeholder="ex: seunegocio" 
                      style={INPUT_STYLE} 
                    />
                  </div>
                  <div>
                    <label style={LABEL_STYLE}>Hashtags para monitorar (opcional)</label>
                    <input 
                      type="text" 
                      value={igHashtags} 
                      onChange={e => setIgHashtags(e.target.value)}
                      placeholder="ex: #suamarca, #reviews" 
                      style={INPUT_STYLE} 
                    />
                    <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}>Separe hashtags por vírgula.</div>
                    <div style={{ marginTop: 12, padding: 10, background: 'rgba(99,102,241,0.1)', borderRadius: 8, fontSize: 11, color: '#a5b4fc', border: '1px dashed rgba(99,102,241,0.3)' }}>
                      💡 <strong>Dica:</strong> Após criar sua conta, você poderá conectar oficialmente via Meta (Facebook/Instagram) nas configurações para obter dados ainda mais precisos.
                    </div>
                  </div>
                </div>
              )}

              {/* Configuração Condicional do Facebook */}
              {channels.includes('facebook') && (
                <div style={{ marginTop: 12, padding: 16, background: 'rgba(6,182,212,0.05)', border: '1px solid rgba(6,182,212,0.2)', borderRadius: 12 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#22d3ee', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                    👥 Configuração do Facebook
                  </div>
                  <div>
                    <label style={LABEL_STYLE}>URL da sua página</label>
                    <input 
                      type="text" 
                      value={fbUrl} 
                      onChange={e => setFbUrl(e.target.value)}
                      placeholder="https://facebook.com/suapagina" 
                      style={INPUT_STYLE} 
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── Passo 4: Sucesso ── */}
          {step === 4 && (
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
          {step < 4 && (
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
                ) : step < 3 ? (
                  <>Próximo <ChevronRight size={15} /></>
                ) : (
                  <>Criar conta grátis <ChevronRight size={15} /></>
                )}
              </button>
            </div>
          )}
        </div>

        {/* Link voltar ao login */}
        {step < 4 && (
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
