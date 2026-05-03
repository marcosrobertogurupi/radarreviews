import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { Send, MessageSquare, Users, CheckCircle2, AlertCircle, Clock, Share2, Info } from 'lucide-react'

interface Props {
  tenantId: string
}

export default function GenerateReviews({ tenantId }: Props) {
  const [loading, setLoading] = useState(false)
  const [sending, setSending] = useState(false)
  const [tenant, setTenant] = useState<any>(null)
  const [number, setNumber] = useState('')
  const [name, setName] = useState('')
  const [template, setTemplate] = useState('padrao')
  const [status, setStatus] = useState<{ type: 'success' | 'error', msg: string } | null>(null)

  useEffect(() => {
    loadTenantData()
  }, [tenantId])

  async function loadTenantData() {
    setLoading(true)
    const { data } = await supabase
      .from('tenants')
      .select('whatsapp_limit_monthly, whatsapp_sent_this_month, whatsapp_token_enc')
      .eq('id', tenantId)
      .single()
    setTenant(data)
    setLoading(false)
  }

  const templates = {
    padrao: `Olá {nome}! 😊 Obrigado por nos visitar. Sua opinião é muito importante para nós. Poderia nos avaliar no Google? Leva apenas 30 segundos: https://search.google.com/local/writereview?placeid=SEU_PLACE_ID`,
    agradecimento: `Oi {nome}! Tudo bem? Gostamos muito de ter você aqui hoje. Se puder, conte como foi sua experiência: https://search.google.com/local/writereview?placeid=SEU_PLACE_ID`,
    resolucao: `Olá {nome}, vimos que resolvemos seu chamado! Ficamos felizes. Poderia registrar sua satisfação no nosso perfil? https://search.google.com/local/writereview?placeid=SEU_PLACE_ID`
  }

  const currentMessage = templates[template as keyof typeof templates].replace('{nome}', name || 'cliente')

  async function handleSend() {
    if (!number) {
      setStatus({ type: 'error', msg: 'Informe o número do WhatsApp.' })
      return
    }
    if (!tenant?.whatsapp_token_enc) {
      setStatus({ type: 'error', msg: 'WhatsApp não configurado. Entre em contato com o suporte.' })
      return
    }

    setSending(true)
    setStatus(null)

    try {
      const { data: { session } } = await supabase.auth.getSession()
      const apiUrl = (import.meta.env.VITE_API_URL ?? 'https://reputei-api.railway.app').replace(/\/+$/, '')
      const res = await fetch(`${apiUrl}/api/whatsapp/send`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session?.access_token}`
        },
        body: JSON.stringify({
          number,
          text: currentMessage,
          tenantId
        })
      })

      const result = await res.json()

      if (res.ok) {
        setStatus({ type: 'success', msg: 'Convite enviado com sucesso!' })
        setNumber('')
        setName('')
        loadTenantData() // Atualiza contador
      } else {
        setStatus({ type: 'error', msg: result.error || 'Falha ao enviar.' })
      }
    } catch (err) {
      setStatus({ type: 'error', msg: 'Erro de conexão com o servidor.' })
    } finally {
      setSending(false)
    }
  }

  const limitReached = tenant && tenant.whatsapp_sent_this_month >= tenant.whatsapp_limit_monthly

  return (
    <div className="fade-in">
      <div className="page-header">
        <h1 className="page-title">Gerar Reviews</h1>
        <p className="page-subtitle">Transforme clientes satisfeitos em promotores da sua marca via WhatsApp</p>
      </div>

      <div className="grid-2">
        {/* Formulário de Envio */}
        <div className="card" style={{ padding: 24 }}>
          <div className="section-title"><Send size={18} /> Novo Convite</div>
          
          <div style={{ marginBottom: 20 }}>
            <label className="filter-label">Nome do Cliente (opcional)</label>
            <input 
              type="text" 
              className="filter-search" 
              placeholder="Ex: João Silva" 
              value={name}
              onChange={e => setName(e.target.value)}
              style={{ width: '100%', marginBottom: 12 }}
            />
            
            <label className="filter-label">WhatsApp do Cliente</label>
            <input 
              type="tel" 
              className="filter-search" 
              placeholder="Ex: 5511999999999" 
              value={number}
              onChange={e => setNumber(e.target.value)}
              style={{ width: '100%' }}
            />
          </div>

          <div style={{ marginBottom: 20 }}>
            <label className="filter-label">Escolher Template</label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              {Object.keys(templates).map(t => (
                <button 
                  key={t}
                  className={`btn ${template === t ? 'active' : ''}`}
                  onClick={() => setTemplate(t)}
                  style={{ textTransform: 'capitalize' }}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          <div style={{ background: 'var(--bg-darker)', padding: 16, borderRadius: 10, border: '1px solid var(--border)', marginBottom: 20 }}>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8, fontWeight: 700, textTransform: 'uppercase' }}>
              Pré-visualização da Mensagem
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
              {currentMessage}
            </div>
          </div>

          {status && (
            <div style={{ 
              padding: 12, borderRadius: 8, marginBottom: 20, 
              background: status.type === 'success' ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)',
              color: status.type === 'success' ? '#10b981' : '#ef4444',
              display: 'flex', alignItems: 'center', gap: 8, fontSize: 13
            }}>
              {status.type === 'success' ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
              {status.msg}
            </div>
          )}

          <button 
            className="btn-primary" 
            style={{ width: '100%', height: 48, justifyContent: 'center' }}
            onClick={handleSend}
            disabled={sending || limitReached}
          >
            {sending ? 'Enviando...' : limitReached ? 'Limite Mensal Atingido' : 'Enviar via WhatsApp'}
          </button>
        </div>

        {/* Estatísticas e Info */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div className="card" style={{ padding: 24 }}>
            <div className="section-title"><Share2 size={18} /> Seu Desempenho</div>
            
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 10 }}>
              <div style={{ padding: 16, background: 'rgba(99,102,241,0.06)', borderRadius: 12, border: '1px solid rgba(99,102,241,0.1)' }}>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>Envios este mês</div>
                <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--accent)' }}>{tenant?.whatsapp_sent_this_month || 0}</div>
              </div>
              <div style={{ padding: 16, background: 'rgba(255,255,255,0.03)', borderRadius: 12, border: '1px solid var(--border)' }}>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>Limite do plano</div>
                <div style={{ fontSize: 24, fontWeight: 700 }}>{tenant?.whatsapp_limit_monthly || 30}</div>
              </div>
            </div>

            <div style={{ marginTop: 20 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 8 }}>
                <span style={{ color: 'var(--text-muted)' }}>Progresso do Limite</span>
                <span style={{ fontWeight: 600 }}>{Math.round(((tenant?.whatsapp_sent_this_month || 0) / (tenant?.whatsapp_limit_monthly || 30)) * 100)}%</span>
              </div>
              <div style={{ height: 8, background: 'var(--bg-darker)', borderRadius: 4, overflow: 'hidden' }}>
                <div style={{ 
                  height: '100%', 
                  background: limitReached ? '#ef4444' : 'var(--accent)', 
                  width: `${Math.min(100, ((tenant?.whatsapp_sent_this_month || 0) / (tenant?.whatsapp_limit_monthly || 30)) * 100)}%`,
                  transition: 'width 0.5s ease'
                }} />
              </div>
            </div>
          </div>

          <div className="card" style={{ padding: 24, background: 'linear-gradient(135deg, rgba(99,102,241,0.05) 0%, rgba(168,85,247,0.05) 100%)' }}>
            <div className="section-title"><Info size={18} /> Dicas de Ouro</div>
            <ul style={{ padding: 0, margin: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 12 }}>
              <li style={{ display: 'flex', gap: 10, fontSize: 13, color: 'var(--text-secondary)' }}>
                <div style={{ color: 'var(--accent)' }}>✦</div>
                Envie a solicitação logo após o atendimento, quando a experiência está fresca na memória.
              </li>
              <li style={{ display: 'flex', gap: 10, fontSize: 13, color: 'var(--text-secondary)' }}>
                <div style={{ color: 'var(--accent)' }}>✦</div>
                Personalize o nome do cliente para aumentar a taxa de conversão em até 3x.
              </li>
              <li style={{ display: 'flex', gap: 10, fontSize: 13, color: 'var(--text-secondary)' }}>
                <div style={{ color: 'var(--accent)' }}>✦</div>
                Clientes satisfeitos gostam de ajudar, não tenha vergonha de pedir!
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  )
}
