import { useState, useEffect } from 'react'
import type { Session } from '@supabase/supabase-js'
import { Check, X, Zap, Star, Puzzle, Building2, ChevronRight, Info, Loader2, ExternalLink, Copy, Lock, Radio } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { API_URL } from '../lib/utils'


// ── Tipos e Constantes ────────────────────────────────────────────

type Period = 'trimestral' | 'semestral' | 'anual'

const PERIOD_OPTIONS: { value: Period; label: string; discount: number; months: number }[] = [
  { value: 'trimestral', label: 'Trimestral', discount: 5,  months: 3  },
  { value: 'semestral',  label: 'Semestral',  discount: 10, months: 6  },
  { value: 'anual',      label: 'Anual',      discount: 20, months: 12 },
]

const PIX_EXTRA = 5   // % de desconto adicional ao pagar com PIX

const CHANNEL_MAP: Record<string, { label: string; icon: string }> = {
  google_maps:    { label: 'Google Maps',    icon: '📍' },
  tripadvisor:    { label: 'TripAdvisor',    icon: '🦉' },
  facebook:       { label: 'Facebook',       icon: '📘' },
  instagram:      { label: 'Instagram',      icon: '📸' },
  reclame_aqui:   { label: 'Reclame Aqui',   icon: '🔴' },
  consumidor_gov: { label: 'Consumidor.gov', icon: '🏛️' },
  trustpilot:     { label: 'Trustpilot',     icon: '⭐' },
  reddit:         { label: 'Reddit',         icon: '🤖' },
}

const PLAN_TIERS: Record<string, number> = {
  'basico': 1,
  'completo': 2,
  'custom': 3,
  'enterprise': 4,
}

// ── Helpers ──────────────────────────────────────────────────────

function calcPrice(
  base: number,
  period: Period,
  pix: boolean
): { monthly: number; total: number; months: number; savedVsMonthly: number } {
  const opt      = PERIOD_OPTIONS.find(p => p.value === period)!
  const mult     = 1 - opt.discount / 100
  const pixMult  = pix ? (1 - PIX_EXTRA / 100) : 1
  const monthly  = +(base * mult * pixMult).toFixed(2)
  return {
    monthly,
    total:           +(monthly * opt.months).toFixed(2),
    months:          opt.months,
    savedVsMonthly:  +(base - monthly).toFixed(2),
  }
}

function fmt(n: number) {
  return n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

// ── Component ────────────────────────────────────────────────────

export default function Pricing({ 
  tenantTrial, 
  session,
  tenantId
}: { 
  tenantTrial?: { plan: string; plan_status?: string; subscription_status?: string; trial_ends_at: string | null } | null; 
  session?: Session | null;
  tenantId?: string;
}) {
  const [period,   setPeriod]   = useState<Period>('anual')
  const [pix,      setPix]      = useState(false)
  const [customCh, setCustomCh] = useState(3)
  const [modal,    setModal]    = useState<string | null>(null)
  const [plans,    setPlans]    = useState<any[]>([])
  const [checkoutLoading, setCheckoutLoading] = useState(false)
  const [checkoutData, setCheckoutData] = useState<{ invoiceUrl?: string; pixQrCode?: string; pixCopyPaste?: string; subscriptionId?: string; status?: string } | null>(null)
  const [checkoutError, setCheckoutError] = useState('')
  const [copied, setCopied] = useState(false)
  const [connectors, setConnectors] = useState<any[]>([])
  const [loadingConnectors, setLoadingConnectors] = useState(false)

  useEffect(() => {
    async function loadPlans() {
      try {
        const res = await fetch(`${API_URL}/api/plans`)
        if (res.ok) {
          const data = await res.json()
          setPlans(data)
        }
      } catch (err) {
        console.error('Erro ao carregar planos:', err)
      }
    }
    loadPlans()
  }, [])

  useEffect(() => {
    if (!tenantId) return
    async function fetchConnectors() {
      setLoadingConnectors(true)
      try {
        const { data: biz } = await supabase
          .from('monitored_businesses')
          .select('id')
          .eq('tenant_id', tenantId)
          .limit(1)
          .single()

        if (biz?.id) {
          const { data: conns } = await supabase
            .from('channel_connectors')
            .select('id, channel, status, external_id, created_at, last_sync_at')
            .eq('business_id', biz.id)

          if (conns) {
            setConnectors(conns)
          }
        }
      } catch (err) {
        console.error('Erro ao carregar conectores:', err)
      } finally {
        setLoadingConnectors(false)
      }
    }

    fetchConnectors()
  }, [tenantId])

  const activePeriod  = PERIOD_OPTIONS.find(p => p.value === period)!
  const totalDiscount = activePeriod.discount + (pix ? PIX_EXTRA : 0)

  // Preços calculados conforme API
  const baseBasico   = plans.find(p => p.slug === 'basico')?.price_monthly ?? 289
  const baseCompleto = plans.find(p => p.slug === 'completo')?.price_monthly ?? 459
  const baseEnterprise = plans.find(p => p.slug === 'enterprise')?.price_monthly ?? 1500
  const baseCustom     = plans.find(p => p.slug === 'custom')?.price_monthly ?? 389

  const basic    = calcPrice(baseBasico, period, pix)
  const complete = calcPrice(baseCompleto, period, pix)
  const customBase = baseCustom + (customCh - 3) * 50
  const custom   = calcPrice(customBase, period, pix)

  const inTrial = tenantTrial?.plan_status === 'trial' || tenantTrial?.subscription_status === 'trial'
  const isContractedActive = (tenantTrial?.subscription_status === 'active' || tenantTrial?.plan_status === 'active') && !inTrial
  const currentPlan = (tenantTrial?.plan || 'basico').toLowerCase()
  const currentTier = PLAN_TIERS[currentPlan] || 1

  const planMaxChannels: Record<string, string> = {
    'basico': '3',
    'completo': '8',
    'custom': `${customCh}`,
    'enterprise': 'Ilimitados',
  }

  function renderPlanCTA(planSlug: string, planTitle: string) {
    const targetTier = PLAN_TIERS[planSlug] || 1
    const isCurrent = currentPlan === planSlug
    const isDowngrade = isContractedActive && targetTier < currentTier
    const isUpgrade = isContractedActive && targetTier > currentTier

    if (isCurrent) {
      return (
        <div style={{ marginTop: 'auto' }}>
          <button className="btn plan-cta btn-secondary" disabled style={{ width: '100%', opacity: 0.85, cursor: 'default', justifyContent: 'center' }}>
            Plano Atual
          </button>
          {isContractedActive && (
            <p style={{ fontSize: 11, color: '#10b981', textAlign: 'center', marginTop: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
              <Check size={12} /> Contrato ativo
            </p>
          )}
        </div>
      )
    }

    if (isDowngrade) {
      return (
        <div style={{ marginTop: 'auto' }}>
          <button className="btn plan-cta btn-disabled-downgrade" disabled style={{ width: '100%', cursor: 'not-allowed', justifyContent: 'center' }}>
            <Lock size={12} style={{ marginRight: 4 }} /> Downgrade indisponível
          </button>
          <p style={{ fontSize: 11, color: '#ef4444', textAlign: 'center', marginTop: 6, lineHeight: 1.3 }}>
            Não é possível alterar para um plano menor no período contratado
          </p>
        </div>
      )
    }

    if (isUpgrade) {
      return (
        <div style={{ marginTop: 'auto' }}>
          <button className="btn plan-cta btn-primary" onClick={() => setModal(planTitle)} style={{ width: '100%', justifyContent: 'center' }}>
            Fazer Upgrade <ChevronRight size={13} />
          </button>
        </div>
      )
    }

    // Default / Trial
    return (
      <div style={{ marginTop: 'auto' }}>
        <button 
          className={`btn plan-cta ${inTrial && currentPlan === planSlug ? 'btn-primary' : (planSlug === 'completo' ? 'btn-primary' : 'btn-ghost')}`} 
          onClick={() => setModal(planTitle)}
          style={{ width: '100%', justifyContent: 'center' }}
        >
          {inTrial 
            ? (currentPlan === planSlug ? 'Plano atual — Assinar' : 'Assinar este plano') 
            : (planSlug === 'enterprise' ? 'Falar com vendas' : 'Começar trial gratuito')} <ChevronRight size={13} />
        </button>
      </div>
    )
  }

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Planos &amp; Assinatura</h1>
        <p className="page-subtitle">
          Escolha o plano ideal · 7 dias grátis em todos os planos · sem cartão de crédito
        </p>
      </div>

      {inTrial && (
        <div style={{
          padding: '16px 20px', background: 'rgba(245,158,11,0.1)',
          border: '1px solid rgba(245,158,11,0.3)', borderRadius: 12,
          color: '#fbbf24', fontSize: 14, fontWeight: 600,
          display: 'flex', alignItems: 'center', gap: 10,
          marginBottom: 24, justifyContent: 'center'
        }}>
          <Info size={18} />
          Você está no período de avaliação gratuita. Escolha um plano para continuar após o trial.
        </div>
      )}

      {/* ── Card de Conectores em Uso ─────────────────────────── */}
      <div className="subscriber-connectors-card">
        <div className="connectors-card-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div className="connectors-icon-badge">
              <Radio size={18} color="#6366f1" />
            </div>
            <div>
              <h3 className="connectors-card-title">Conectores em uso</h3>
              <p className="connectors-card-subtitle">
                Canais de reputação atualmente integrados à sua conta
              </p>
            </div>
          </div>
          <div className="connectors-count-badge">
            <strong>{connectors.length}</strong> / {planMaxChannels[currentPlan] || '3'} canais utilizados
          </div>
        </div>

        {loadingConnectors ? (
          <div style={{ padding: '16px 0', display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-muted)', fontSize: 13 }}>
            <Loader2 size={16} className="spin" /> Carregando conectores...
          </div>
        ) : connectors.length === 0 ? (
          <div className="connectors-empty-state">
            <span>Nenhum conector ativo no momento. Configure seus canais em <strong>Meu Perfil / Configurações</strong>.</span>
          </div>
        ) : (
          <div className="connectors-grid">
            {connectors.map(c => {
              const info = CHANNEL_MAP[c.channel] || { label: c.channel, icon: '🔌' }
              const statusMap: Record<string, { label: string; class: string }> = {
                active: { label: 'Ativo', class: 'status-active' },
                paused: { label: 'Pausado', class: 'status-paused' },
                error: { label: 'Erro', class: 'status-error' },
                pending_auth: { label: 'Pendente', class: 'status-pending' },
              }
              const st = statusMap[c.status] || { label: c.status, class: 'status-pending' }
              return (
                <div key={c.id} className="connector-pill-item">
                  <span className="connector-pill-icon">{info.icon}</span>
                  <span className="connector-pill-name">{info.label}</span>
                  <span className={`connector-status-tag ${st.class}`}>{st.label}</span>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* ── Banner PIX ─────────────────────────────────────────── */}
      <div className="pricing-pix-banner">
        <div className="pix-logo">PIX</div>
        <div className="pix-text">
          <strong>Pague com PIX e economize {PIX_EXTRA}% extra</strong>
          <span> · Processado via Asaas · Confirmação instantânea · Recorrência nativa</span>
        </div>
        <label className="pix-toggle">
          <input
            type="checkbox"
            checked={pix}
            onChange={e => setPix(e.target.checked)}
            disabled={isContractedActive}
            style={{ display: 'none' }}
          />
          <div className={`pix-slider ${pix ? 'on' : ''}`} style={{ opacity: isContractedActive ? 0.6 : 1 }}>
            <div className="pix-thumb" />
          </div>
          <span className={`pix-label ${pix ? 'on' : ''}`}>
            {pix ? `PIX ativado (-${PIX_EXTRA}%)` : 'Ativar desconto PIX'}
          </span>
        </label>
      </div>

      {/* ── Aviso de Período Bloqueado ─────────────────────────── */}
      {isContractedActive && (
        <div style={{
          padding: '12px 16px', background: 'rgba(99,102,241,0.08)',
          border: '1px solid rgba(99,102,241,0.25)', borderRadius: 10,
          color: '#818cf8', fontSize: 13, fontWeight: 500,
          display: 'flex', alignItems: 'center', gap: 10,
          marginBottom: 16, justifyContent: 'center'
        }}>
          <Lock size={16} />
          Seu plano está em um período contratado ativo. A edição de período de cobrança fica bloqueada durante a vigência.
        </div>
      )}

      {/* ── Seletor de período ─────────────────────────────────── */}
      <div className="period-selector" style={{ opacity: isContractedActive ? 0.7 : 1 }}>
        {PERIOD_OPTIONS.map(opt => (
          <button
            key={opt.value}
            className={`period-btn ${period === opt.value ? 'active' : ''}`}
            onClick={() => {
              if (!isContractedActive) setPeriod(opt.value)
            }}
            disabled={isContractedActive}
            title={isContractedActive ? 'Edição de período bloqueada no período contratado' : undefined}
          >
            {opt.label}
            {opt.discount > 0 && (
              <span className="period-badge">-{opt.discount}%</span>
            )}
          </button>
        ))}
      </div>

      {totalDiscount > 0 && (
        <p className="discount-notice">
          <Check size={13} />
          Você está economizando <strong>{totalDiscount}%</strong> neste plano
          {pix && activePeriod.discount > 0
            ? ` (${activePeriod.discount}% período + ${PIX_EXTRA}% PIX)`
            : pix
            ? ` (${PIX_EXTRA}% PIX)`
            : ` (${activePeriod.discount}% ${period})`}
        </p>
      )}

      {/* ── Grid de planos ─────────────────────────────────────── */}
      <div className="plans-grid">

        {/* ── Básico ── */}
        <div className="plan-card">
          <div className="plan-icon" style={{ '--plan-color': '#06b6d4' } as React.CSSProperties}>
            <Zap size={20} color="#06b6d4" />
          </div>
          <div className="plan-name">Básico</div>
          <div className="plan-price">
            <span className="plan-currency">R$</span>
            <span className="plan-amount">{fmt(basic.monthly)}</span>
            <span className="plan-period">/mês</span>
          </div>
          {period !== 'trimestral' && (
            <div className="plan-subtotal">
              Total R$ {fmt(basic.total)} · {basic.months} meses
            </div>
          )}
          {basic.savedVsMonthly > 0 && (
            <div className="plan-saving">Você economiza R$ {fmt(basic.savedVsMonthly)}/mês</div>
          )}
          <div className="plan-trial">7 dias grátis · sem cartão</div>
          <ul className="plan-features">
            <li className="feat-yes"><Check size={12} /><span>3 canais monitorados</span></li>
            <li className="feat-yes"><Check size={12} /><span>500 reviews/mês</span></li>
            <li className="feat-yes"><Check size={12} /><span>Google Maps, TripAdvisor, Consumidor.gov</span></li>
            <li className="feat-yes"><Check size={12} /><span>Alertas por e-mail</span></li>
            <li className="feat-yes"><Check size={12} /><span>Relatórios semanais</span></li>
            <li className="feat-yes"><Check size={12} /><span>Suporte por e-mail</span></li>
            <li className="feat-no"><X size={12} /><span>IA Copilot</span></li>
            <li className="feat-no"><X size={12} /><span>Alertas avançados</span></li>
          </ul>
          {renderPlanCTA('basico', 'Básico')}
        </div>

        {/* ── Completo (destaque) ── */}
        <div className="plan-card featured">
          <div className="plan-popular-badge">Mais popular</div>
          <div className="plan-icon featured-icon">
            <Star size={20} color="#a5b4fc" />
          </div>
          <div className="plan-name">Completo</div>
          <div className="plan-price">
            <span className="plan-currency">R$</span>
            <span className="plan-amount">{fmt(complete.monthly)}</span>
            <span className="plan-period">/mês</span>
          </div>
          {period !== 'trimestral' && (
            <div className="plan-subtotal">
              Total R$ {fmt(complete.total)} · {complete.months} meses
            </div>
          )}
          {complete.savedVsMonthly > 0 && (
            <div className="plan-saving">Você economiza R$ {fmt(complete.savedVsMonthly)}/mês</div>
          )}
          <div className="plan-trial">7 dias grátis · sem cartão</div>
          <ul className="plan-features">
            <li className="feat-yes"><Check size={12} /><span>8 canais monitorados</span></li>
            <li className="feat-yes"><Check size={12} /><span>Reviews ilimitados</span></li>
            <li className="feat-yes"><Check size={12} /><span>Todos os canais disponíveis</span></li>
            <li className="feat-yes"><Check size={12} /><span>Alertas avançados (e-mail + SMS)</span></li>
            <li className="feat-yes"><Check size={12} /><span>Relatórios diários</span></li>
            <li className="feat-yes"><Check size={12} /><span><strong>IA Copilot</strong> incluso</span></li>
            <li className="feat-yes"><Check size={12} /><span>Suporte prioritário</span></li>
            <li className="feat-yes"><Check size={12} /><span>Acesso à API</span></li>
          </ul>
          {renderPlanCTA('completo', 'Completo')}
        </div>

        {/* ── Custom ── */}
        <div className="plan-card">
          <div className="plan-icon" style={{ '--plan-color': '#f59e0b' } as React.CSSProperties}>
            <Puzzle size={20} color="#f59e0b" />
          </div>
          <div className="plan-name">Custom</div>

          {/* Seletor de canais */}
          <div className="channel-selector">
            <div className="channel-label">
              Canais: <strong>{customCh}</strong>
              {customCh > 3 && (
                <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>
                  {' '}(base + {customCh - 3} ×R$50)
                </span>
              )}
            </div>
            <input
              type="range"
              min={3} max={8}
              value={customCh}
              onChange={e => setCustomCh(Number(e.target.value))}
              disabled={isContractedActive && currentPlan === 'custom'}
              className="channel-range"
            />
            <div className="channel-range-labels">
              <span>3</span><span>8</span>
            </div>
          </div>

          <div className="plan-price" style={{ marginTop: 8 }}>
            <span className="plan-currency">R$</span>
            <span className="plan-amount">{fmt(custom.monthly)}</span>
            <span className="plan-period">/mês</span>
          </div>
          {period !== 'trimestral' && (
            <div className="plan-subtotal">
              Total R$ {fmt(custom.total)} · {custom.months} meses
            </div>
          )}
          {custom.savedVsMonthly > 0 && (
            <div className="plan-saving">Você economiza R$ {fmt(custom.savedVsMonthly)}/mês</div>
          )}
          <div className="plan-trial">7 dias grátis · sem cartão</div>
          <ul className="plan-features">
            <li className="feat-yes"><Check size={12} /><span>{customCh} canais monitorados</span></li>
            <li className="feat-yes"><Check size={12} /><span>Reviews ilimitados</span></li>
            <li className="feat-yes"><Check size={12} /><span>Alertas personalizados</span></li>
            <li className="feat-yes"><Check size={12} /><span>Relatórios customizados</span></li>
            <li className="feat-yes"><Check size={12} /><span><strong>IA Copilot</strong> incluso</span></li>
            <li className="feat-yes"><Check size={12} /><span>Multi-unidades</span></li>
            <li className="feat-yes"><Check size={12} /><span>Gerente de conta dedicado</span></li>
          </ul>
          {renderPlanCTA('custom', 'Custom')}
        </div>

        {/* ── Enterprise ── */}
        <div className="plan-card enterprise">
          <div className="plan-icon" style={{ '--plan-color': '#f87171' } as React.CSSProperties}>
            <Building2 size={20} color="#f87171" />
          </div>
          <div className="plan-name">Enterprise</div>
          <div className="plan-price">
            <span className="plan-currency">R$</span>
            <span className="plan-amount">{fmt(baseEnterprise)}</span>

            <span className="plan-period">+/mês</span>
          </div>
          <div className="plan-subtotal">Desconto por volume disponível</div>
          <div className="plan-trial">Contato direto · SLA garantido</div>
          <ul className="plan-features">
            <li className="feat-yes"><Check size={12} /><span>Canais ilimitados</span></li>
            <li className="feat-yes"><Check size={12} /><span>Múltiplas unidades/redes</span></li>
            <li className="feat-yes"><Check size={12} /><span>SLA garantido</span></li>
            <li className="feat-yes"><Check size={12} /><span>Implantação assistida</span></li>
            <li className="feat-yes"><Check size={12} /><span>Integrações customizadas</span></li>
            <li className="feat-yes"><Check size={12} /><span>Suporte 24/7</span></li>
            <li className="feat-yes"><Check size={12} /><span>Desconto por volume (10–40%)</span></li>
          </ul>
          {renderPlanCTA('enterprise', 'Enterprise')}
        </div>
      </div>

      {/* ── Rodapé gateway ──────────────────────────────────────── */}
      <div className="pricing-gateway-note">
        <Info size={12} />
        <span>
          Pagamentos processados via <strong>Asaas</strong> — PIX, boleto bancário e cartão de crédito.
          Assinatura recorrente com PIX disponível. Cancele a qualquer momento, sem multa.
        </span>
      </div>

      {/* ── Modal de Checkout ────────────────────────────────────── */}
      {modal && (
        <div className="modal-overlay" onClick={() => { setModal(null); setCheckoutData(null); setCheckoutError('') }}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: 460 }}>
            <div className="modal-title">
              Plano {modal} — {inTrial ? 'Assinar agora' : 'Iniciar trial'}
              <button className="modal-close" onClick={() => { setModal(null); setCheckoutData(null); setCheckoutError('') }}>✕</button>
            </div>

            {/* Estado: Carregando checkout */}
            {checkoutLoading && (
              <div style={{ textAlign: 'center', padding: '40px 0' }}>
                <Loader2 size={36} className="spin" style={{ color: 'var(--accent)', marginBottom: 16 }} />
                <p style={{ color: 'var(--text-secondary)', fontSize: 14 }}>Preparando seu checkout...</p>
              </div>
            )}

            {/* Estado: Erro */}
            {checkoutError && !checkoutLoading && (
              <div style={{ textAlign: 'center', padding: '20px 0' }}>
                <div style={{ fontSize: 40, marginBottom: 12 }}>⚠️</div>
                <p style={{ color: '#ef4444', fontSize: 13.5, lineHeight: 1.7, marginBottom: 16 }}>
                  {checkoutError}
                </p>
                <button
                  className="btn btn-primary"
                  style={{ width: '100%', justifyContent: 'center' }}
                  onClick={() => handleCheckout(modal)}
                >
                  Tentar novamente
                </button>
              </div>
            )}

            {/* Estado: Checkout pronto */}
            {checkoutData && !checkoutLoading && !checkoutError && (
              <div style={{ textAlign: 'center', padding: '16px 0' }}>
                <div style={{ fontSize: 40, marginBottom: 12 }}>✅</div>
                <h3 style={{ fontFamily: 'Outfit', fontSize: 18, fontWeight: 700, marginBottom: 8 }}>
                  Assinatura criada!
                </h3>
                <p style={{ color: 'var(--text-secondary)', fontSize: 13, lineHeight: 1.6, marginBottom: 16 }}>
                  Seu plano foi configurado com sucesso. Complete o pagamento para ativar.
                </p>

                {/* Link para fatura Asaas */}
                {checkoutData.invoiceUrl && (
                  <a
                    href={checkoutData.invoiceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn btn-primary"
                    style={{ width: '100%', justifyContent: 'center', marginBottom: 12, textDecoration: 'none', display: 'flex', gap: 8 }}
                  >
                    <ExternalLink size={16} />
                    Abrir página de pagamento
                  </a>
                )}

                {/* PIX Copia e Cola */}
                {checkoutData.pixCopyPaste && (
                  <div style={{ marginTop: 12 }}>
                    <div style={{ 
                      padding: '12px 16px', background: 'rgba(16,185,129,0.08)', 
                      border: '1px solid rgba(16,185,129,0.2)', borderRadius: 10, 
                      fontSize: 12, color: '#10b981', marginBottom: 8,
                      wordBreak: 'break-all'
                    }}>
                      <strong>PIX Copia e Cola:</strong>
                      <p style={{ marginTop: 6, fontFamily: 'monospace', fontSize: 11, color: 'var(--text-secondary)' }}>
                        {checkoutData.pixCopyPaste.slice(0, 60)}...
                      </p>
                    </div>
                    <button
                      className="btn btn-ghost"
                      style={{ width: '100%', justifyContent: 'center', gap: 8 }}
                      onClick={() => {
                        navigator.clipboard.writeText(checkoutData.pixCopyPaste!)
                        setCopied(true)
                        setTimeout(() => setCopied(false), 2000)
                      }}
                    >
                      <Copy size={14} />
                      {copied ? 'Copiado!' : 'Copiar código PIX'}
                    </button>
                  </div>
                )}

                {/* QR Code PIX */}
                {checkoutData.pixQrCode && (
                  <div style={{ marginTop: 16, textAlign: 'center' }}>
                    <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
                      Escaneie o QR Code com seu app de banco:
                    </p>
                    <img 
                      src={`data:image/png;base64,${checkoutData.pixQrCode}`} 
                      alt="QR Code PIX" 
                      style={{ width: 200, height: 200, borderRadius: 8, border: '2px solid rgba(99,102,241,0.2)' }}
                    />
                  </div>
                )}

                <div style={{ marginTop: 16, padding: '10px 16px', background: 'rgba(99,102,241,0.06)', borderRadius: 8, fontSize: 12, color: 'var(--text-secondary)' }}>
                  Após o pagamento, seu plano será ativado automaticamente em instantes.
                </div>
              </div>
            )}

            {/* Estado inicial: Confirmação */}
            {!checkoutData && !checkoutLoading && !checkoutError && (
              <div style={{ textAlign: 'center', padding: '20px 0 8px' }}>
                <div style={{ fontSize: 52, marginBottom: 16 }}>💳</div>
                <h3 style={{ fontFamily: 'Outfit', fontSize: 20, fontWeight: 700, marginBottom: 10 }}>
                  Confirmar assinatura
                </h3>
                <p style={{ color: 'var(--text-secondary)', fontSize: 13.5, lineHeight: 1.7, maxWidth: 340, margin: '0 auto' }}>
                  Pagamento processado via <strong>Asaas</strong> (PIX + cartão + boleto).
                  {inTrial && ' Seu trial permanece ativo até a primeira cobrança.'}
                </p>

                <div style={{ margin: '20px 0', padding: '14px 20px', background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.2)', borderRadius: 10, fontSize: 14 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                    <span style={{ color: 'var(--text-secondary)' }}>Plano</span>
                    <strong>{modal}</strong>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                    <span style={{ color: 'var(--text-secondary)' }}>Período</span>
                    <strong>{PERIOD_OPTIONS.find(p => p.value === period)?.label}</strong>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                    <span style={{ color: 'var(--text-secondary)' }}>Pagamento</span>
                    <strong>{pix ? 'PIX' : 'Cartão de crédito'}</strong>
                  </div>
                  {totalDiscount > 0 && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', color: '#10b981' }}>
                      <span>Desconto total</span>
                      <strong>-{totalDiscount}%</strong>
                    </div>
                  )}
                </div>

                <button
                  className="btn btn-primary"
                  style={{ width: '100%', justifyContent: 'center', marginTop: 8 }}
                  onClick={() => handleCheckout(modal)}
                >
                  {pix ? '🔒 Gerar PIX' : '🔒 Ir para pagamento'} <ChevronRight size={14} />
                </button>
              </div>
            )}

            <button
              className="btn btn-ghost"
              style={{ width: '100%', justifyContent: 'center', marginTop: 12 }}
              onClick={() => { setModal(null); setCheckoutData(null); setCheckoutError('') }}
            >
              Fechar
            </button>
          </div>
        </div>
      )}
    </div>
  )

  // ── Checkout handler ──────────────────────────────────────────
  async function handleCheckout(planName: string) {
    setCheckoutLoading(true)
    setCheckoutError('')
    setCheckoutData(null)

    // Mapear nome visual → slug
    const slugMap: Record<string, string> = {
      'Básico': 'basico',
      'Completo': 'completo',
      'Custom': 'custom',
      'Enterprise': 'enterprise',
    }
    const planSlug = slugMap[planName] || 'completo'

    try {
      const res = await fetch(`${API_URL}/api/subscription/checkout`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({
          plan: planSlug,
          billingMethod: pix ? 'pix' : 'credit_card',
          periodicity: period,
          ...(planSlug === 'custom' ? { customCh } : {}),
        }),
      })

      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || `Erro ${res.status}`)
      }

      setCheckoutData(data)
    } catch (err: any) {
      setCheckoutError(err.message || 'Erro ao processar checkout. Tente novamente.')
    } finally {
      setCheckoutLoading(false)
    }
  }
}
