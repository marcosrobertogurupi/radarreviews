import { useState, useEffect } from 'react'

import { Check, X, Zap, Star, Puzzle, Building2, ChevronRight, Info } from 'lucide-react'
import { API_URL } from '../lib/utils'


// ── Tipos ────────────────────────────────────────────────────────

type Period = 'trimestral' | 'semestral' | 'anual'

const PERIOD_OPTIONS: { value: Period; label: string; discount: number; months: number }[] = [
  { value: 'trimestral', label: 'Trimestral', discount: 5,  months: 3  },
  { value: 'semestral',  label: 'Semestral',  discount: 10, months: 6  },
  { value: 'anual',      label: 'Anual',      discount: 20, months: 12 },
]

const PIX_EXTRA = 5   // % de desconto adicional ao pagar com PIX

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

export default function Pricing({ tenantTrial }: { tenantTrial?: { plan: string; plan_status: string; trial_ends_at: string | null } | null }) {
  const [period,   setPeriod]   = useState<Period>('anual')
  const [pix,      setPix]      = useState(false)
  const [customCh, setCustomCh] = useState(3)
  const [modal,    setModal]    = useState<string | null>(null)
  const [plans,    setPlans]    = useState<any[]>([])

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



  const activePeriod  = PERIOD_OPTIONS.find(p => p.value === period)!
  const totalDiscount = activePeriod.discount + (pix ? PIX_EXTRA : 0)

  // Preços calculados conforme API
  const baseBasico   = plans.find(p => p.slug === 'basico')?.price_monthly ?? 139
  const baseCompleto = plans.find(p => p.slug === 'completo')?.price_monthly ?? 199
  const baseEnterprise = plans.find(p => p.slug === 'enterprise')?.price_monthly ?? 1500

  const basic    = calcPrice(baseBasico, period, pix)
  const complete = calcPrice(baseCompleto, period, pix)
  const customBase = 149 + (customCh - 3) * 49
  const custom   = calcPrice(customBase, period, pix)

  const inTrial = tenantTrial?.plan_status === 'trial'
  const currentPlan = tenantTrial?.plan


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
            style={{ display: 'none' }}
          />
          <div className={`pix-slider ${pix ? 'on' : ''}`}>
            <div className="pix-thumb" />
          </div>
          <span className={`pix-label ${pix ? 'on' : ''}`}>
            {pix ? `PIX ativado (-${PIX_EXTRA}%)` : 'Ativar desconto PIX'}
          </span>
        </label>
      </div>

      {/* ── Seletor de período ─────────────────────────────────── */}
      <div className="period-selector">
        {PERIOD_OPTIONS.map(opt => (
          <button
            key={opt.value}
            className={`period-btn ${period === opt.value ? 'active' : ''}`}
            onClick={() => setPeriod(opt.value)}
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
          <button 
            className={`btn plan-cta ${inTrial && currentPlan === 'basico' ? 'btn-primary' : 'btn-ghost'}`} 
            onClick={() => setModal('Básico')}
          >
            {inTrial 
              ? (currentPlan === 'basico' ? 'Plano atual — Assinar' : 'Assinar este plano') 
              : 'Começar trial gratuito'} <ChevronRight size={13} />
          </button>
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
          <button 
            className={`btn plan-cta ${inTrial && currentPlan === 'completo' ? 'btn-primary' : (inTrial ? 'btn-ghost' : 'btn-primary')}`} 
            onClick={() => setModal('Completo')}
          >
            {inTrial 
              ? (currentPlan === 'completo' ? 'Plano atual — Assinar' : 'Assinar este plano') 
              : 'Começar trial gratuito'} <ChevronRight size={13} />
          </button>
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
                  {' '}(base + {customCh - 3} ×R$39)
                </span>
              )}
            </div>
            <input
              type="range"
              min={3} max={8}
              value={customCh}
              onChange={e => setCustomCh(Number(e.target.value))}
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
          <button 
            className={`btn plan-cta ${inTrial && currentPlan === 'custom' ? 'btn-primary' : 'btn-ghost'}`} 
            onClick={() => setModal('Custom')}
          >
            {inTrial 
              ? (currentPlan === 'custom' ? 'Plano atual — Assinar' : 'Assinar este plano') 
              : 'Começar trial gratuito'} <ChevronRight size={13} />
          </button>
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
          <button className="btn plan-cta btn-ghost" onClick={() => setModal('Enterprise')}>
            Falar com vendas <ChevronRight size={13} />
          </button>
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

      {/* ── Modal ───────────────────────────────────────────────── */}
      {modal && (
        <div className="modal-overlay" onClick={() => setModal(null)}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: 420 }}>
            <div className="modal-title">
              Plano {modal} — Trial gratuito
              <button className="modal-close" onClick={() => setModal(null)}>✕</button>
            </div>
            <div style={{ textAlign: 'center', padding: '20px 0 8px' }}>
              <div style={{ fontSize: 52, marginBottom: 16 }}>🚀</div>
              <h3 style={{ fontFamily: 'Outfit', fontSize: 20, fontWeight: 700, marginBottom: 10 }}>
                Em breve!
              </h3>
              <p style={{ color: 'var(--text-secondary)', fontSize: 13.5, lineHeight: 1.7, maxWidth: 340, margin: '0 auto' }}>
                A integração de pagamentos com <strong>Asaas</strong> (PIX + cartão + boleto)
                está sendo implementada. Entre em contato para liberar acesso antecipado.
              </p>
              <div style={{ marginTop: 20, padding: '14px 20px', background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.2)', borderRadius: 10, fontSize: 13 }}>
                📧 <strong>suporte@netservice.net.br</strong>
              </div>
              {pix && (
                <div style={{ marginTop: 10, padding: '10px 20px', background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.2)', borderRadius: 10, fontSize: 12, color: '#10b981' }}>
                  Desconto PIX de {PIX_EXTRA}% será aplicado automaticamente no checkout
                </div>
              )}
            </div>
            <button
              className="btn btn-ghost"
              style={{ width: '100%', justifyContent: 'center', marginTop: 20 }}
              onClick={() => setModal(null)}
            >
              Fechar
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
