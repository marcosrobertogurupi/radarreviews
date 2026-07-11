import { LogOut, MessageCircle, Mail } from 'lucide-react'

interface Props {
  plan: string
  onLogout: () => void
}

const PLAN_LABELS: Record<string, string> = {
  basico:   'Básico',
  completo: 'Completo',
  trial:    'Trial',
}

export default function TrialExpired({ plan, onLogout }: Props) {
  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'var(--bg-base)', padding: 24,
    }}>
      <div style={{ width: '100%', maxWidth: 420, textAlign: 'center' }}>

        {/* Logo */}
        <img
          src="/logo-reputei.png"
          alt="Reputei — Radar de Reviews"
          style={{
            width: 140, height: 'auto', margin: '0 auto 16px',
            display: 'block', filter: 'drop-shadow(0 0 24px rgba(99,102,241,0.3))',
          }}
        />

        {/* Card principal */}
        <div className="card" style={{ padding: 32, marginTop: 24, textAlign: 'left' }}>
          <div style={{
            width: 48, height: 48, borderRadius: '50%', margin: '0 auto 16px',
            background: 'rgba(245,158,11,0.15)', border: '2px solid rgba(245,158,11,0.4)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22,
          }}>
            ⏰
          </div>

          <h2 style={{ fontFamily: 'Outfit', fontSize: 20, fontWeight: 700, textAlign: 'center', marginBottom: 8 }}>
            Seu trial de 7 dias encerrou
          </h2>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', textAlign: 'center', lineHeight: 1.6, marginBottom: 24 }}>
            Você escolheu o plano <strong style={{ color: '#6366f1' }}>{PLAN_LABELS[plan] ?? plan}</strong>.<br />
            Para continuar monitorando sua reputação, ative sua assinatura.
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <a
              href="https://wa.me/5563992420061?text=Quero+ativar+minha+assinatura+Reputei"
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                padding: '11px 0', borderRadius: 8, fontWeight: 600, fontSize: 14,
                background: '#25d366', color: '#fff', textDecoration: 'none',
                border: 'none', cursor: 'pointer',
              }}
            >
              <MessageCircle size={16} /> Falar com suporte via WhatsApp
            </a>

            <a
              href="mailto:suporte@netservice.net.br?subject=Quero ativar minha assinatura"
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                padding: '11px 0', borderRadius: 8, fontWeight: 600, fontSize: 14,
                background: 'rgba(99,102,241,0.15)', color: '#a5b4fc',
                border: '1px solid rgba(99,102,241,0.3)', textDecoration: 'none',
                cursor: 'pointer',
              }}
            >
              <Mail size={16} /> Enviar e-mail
            </a>
          </div>

          <div style={{
            marginTop: 20, padding: '10px 14px', background: 'rgba(255,255,255,0.03)',
            borderRadius: 8, fontSize: 12, color: 'var(--text-muted)', textAlign: 'center',
          }}>
            Seus dados estão seguros e preservados. Assim que a assinatura for ativada, o acesso é liberado imediatamente.
          </div>
        </div>

        <button
          onClick={onLogout}
          style={{
            marginTop: 16, display: 'flex', alignItems: 'center', gap: 6,
            background: 'none', border: 'none', color: 'var(--text-muted)',
            fontSize: 13, cursor: 'pointer', margin: '16px auto 0',
          }}
        >
          <LogOut size={14} /> Sair da conta
        </button>
      </div>
    </div>
  )
}
