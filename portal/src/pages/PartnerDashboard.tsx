import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { Users, DollarSign, TrendingUp, Link as LinkIcon, Copy, Check } from 'lucide-react'

export default function PartnerDashboard() {
  const [loading, setLoading] = useState(true)
  const [stats, setStats] = useState<any>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    async function loadStats() {
      const { data: user } = await supabase.auth.getUser()
      if (!user.user) return

      const { data } = await supabase
        .from('partner_dashboard_summary')
        .select('*')
        .eq('user_id', user.user.id)
        .single()
      
      setStats(data)
      setLoading(false)
    }
    loadStats()
  }, [])

  if (loading) {
    return <div style={{ padding: 40, color: '#fff' }}>Carregando seu painel de parceiro...</div>
  }

  if (!stats) {
    return <div style={{ padding: 40, color: '#fff' }}>Perfil de parceiro não localizado.</div>
  }

  const referralLink = `https://reputei.com.br/trial?ref=${stats.partner_id}`

  function copyLink() {
    navigator.clipboard.writeText(referralLink)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div style={{ padding: '40px', maxWidth: 1200, margin: '0 auto', fontFamily: 'Inter, sans-serif' }}>
      <h1 style={{ fontSize: 32, fontWeight: 800, color: '#fff', marginBottom: 8 }}>Painel do Parceiro</h1>
      <p style={{ color: '#94a3b8', marginBottom: 40 }}>Bem-vindo de volta, {stats.partner_name}. Aqui está o resumo das suas indicações.</p>

      {/* Link de indicação */}
      <div style={{ background: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.2)', padding: 24, borderRadius: 16, marginBottom: 40, display: 'flex', alignItems: 'center', gap: 24, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 300 }}>
          <h3 style={{ color: '#818cf8', fontSize: 14, fontWeight: 700, textTransform: 'uppercase', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
            <LinkIcon size={16} /> Seu Link de Indicação
          </h3>
          <p style={{ color: '#cbd5e1', fontSize: 14, marginBottom: 16 }}>
            Compartilhe este link com seus clientes. Eles farão o trial de 7 dias e serão automaticamente atribuídos a você.
          </p>
          <div style={{ display: 'flex', gap: 12 }}>
            <input 
              type="text" 
              readOnly 
              value={referralLink} 
              style={{ flex: 1, background: '#0f172a', border: '1px solid #334155', borderRadius: 8, padding: '12px 16px', color: '#fff', outline: 'none' }}
            />
            <button 
              onClick={copyLink}
              style={{ background: '#6366f1', color: '#fff', border: 'none', borderRadius: 8, padding: '0 24px', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}
            >
              {copied ? <Check size={18} /> : <Copy size={18} />}
              {copied ? 'Copiado!' : 'Copiar'}
            </button>
          </div>
        </div>
      </div>

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 24, marginBottom: 40 }}>
        <div style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 16, padding: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
            <div style={{ width: 40, height: 40, borderRadius: 10, background: 'rgba(56,189,248,0.1)', color: '#38bdf8', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Users size={20} />
            </div>
            <div style={{ color: '#94a3b8', fontSize: 14, fontWeight: 600 }}>Clientes Ativos</div>
          </div>
          <div style={{ fontSize: 36, fontWeight: 800, color: '#fff' }}>{stats.active_clients || 0}</div>
          <div style={{ color: '#64748b', fontSize: 13, marginTop: 4 }}>de {stats.total_clients || 0} indicados</div>
        </div>

        <div style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 16, padding: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
            <div style={{ width: 40, height: 40, borderRadius: 10, background: 'rgba(167,139,250,0.1)', color: '#a78bfa', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <TrendingUp size={20} />
            </div>
            <div style={{ color: '#94a3b8', fontSize: 14, fontWeight: 600 }}>MRR da Carteira</div>
          </div>
          <div style={{ fontSize: 36, fontWeight: 800, color: '#fff' }}>
            {Number(stats.current_month_mrr || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
          </div>
          <div style={{ color: '#64748b', fontSize: 13, marginTop: 4 }}>mensalidade total dos ativos</div>
        </div>

        <div style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 16, padding: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
            <div style={{ width: 40, height: 40, borderRadius: 10, background: 'rgba(52,211,153,0.1)', color: '#34d399', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <DollarSign size={20} />
            </div>
            <div style={{ color: '#94a3b8', fontSize: 14, fontWeight: 600 }}>Comissões Aprovadas</div>
          </div>
          <div style={{ fontSize: 36, fontWeight: 800, color: '#fff' }}>
            {Number(stats.approved_commission || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
          </div>
          <div style={{ color: '#64748b', fontSize: 13, marginTop: 4 }}>prontas para pagamento</div>
        </div>
      </div>
      
      {/* Detalhes (placeholder) */}
      <div style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 16, padding: 24 }}>
        <h3 style={{ color: '#fff', fontSize: 18, fontWeight: 700, marginBottom: 16 }}>Regras de Comissão</h3>
        <ul style={{ color: '#cbd5e1', fontSize: 14, display: 'flex', flexDirection: 'column', gap: 12, marginLeft: 20 }}>
          <li>Sua comissão de entrada (Setup) é de <strong>{stats.commission_setup_rate}%</strong> sobre o primeiro pagamento do cliente.</li>
          <li>Sua comissão recorrente é de <strong>{stats.commission_recurring_rate}%</strong> sobre todas as mensalidades seguintes.</li>
          <li>As comissões são apuradas no último dia do mês e pagas até o dia 10 do mês seguinte.</li>
        </ul>
      </div>
    </div>
  )
}
