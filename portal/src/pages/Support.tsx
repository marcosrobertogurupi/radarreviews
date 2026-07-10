import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { API_URL, timeAgo } from '../lib/utils'
import { 
  Plus, MessageCircle, Send, ChevronRight, ArrowLeft, LifeBuoy
} from 'lucide-react'
import { useToast } from '../components/Toast'

interface Ticket {
  id: string
  ticket_number: string
  subject: string
  description?: string
  status: string
  priority: string
  category_id: string
  created_at: string
  updated_at: string
  ticket_categories?: { name: string }
  ticket_messages?: any[]
}

const STATUS_LABELS: Record<string, string> = {
  open: 'Aberto',
  ai_triaged: 'Em Triagem',
  ai_responding: 'IA Respondendo',
  ai_resolved: 'Resolvido (IA)',
  waiting_agent: 'Aguardando Agente',
  waiting_tenant: 'Aguardando Você',
  resolved: 'Resolvido',
  closed: 'Fechado',
  reopened: 'Reaberto'
}

const STATUS_COLORS: Record<string, string> = {
  open: '#6366f1',
  ai_triaged: '#06b6d4',
  ai_responding: '#10b981',
  ai_resolved: '#10b981',
  waiting_agent: '#f59e0b',
  waiting_tenant: '#ef4444',
  resolved: '#10b981',
  closed: '#6b7280',
  reopened: '#6366f1'
}

export default function Support({ tenantId }: { tenantId: string }) {
  const [view, setView] = useState<'list' | 'new' | 'details'>('list')
  const [tickets, setTickets] = useState<Ticket[]>([])
  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const { toast } = useToast()

  // Form states
  const [subject, setSubject] = useState('')
  const [description, setDescription] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [categories, setCategories] = useState<any[]>([])

  // Message state
  const [msgInput, setMsgInput] = useState('')
  const chatBottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    loadTickets()
    loadCategories()
  }, [tenantId])

  useEffect(() => {
    if (view === 'details' && chatBottomRef.current) {
      chatBottomRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [view, selectedTicket?.ticket_messages])

  async function loadTickets() {
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(`${API_URL}/api/support/tickets`, {
        headers: { Authorization: `Bearer ${session?.access_token}` }
      })
      if (res.ok) setTickets(await res.json())
    } catch (err) {
      console.error('Erro ao carregar tickets', err)
    } finally {
      setLoading(false)
    }
  }

  async function loadCategories() {
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(`${API_URL}/api/support/categories`, {
        headers: { Authorization: `Bearer ${session?.access_token}` }
      })
      if (res.ok) setCategories(await res.json())
    } catch (err) {
      console.error('Erro ao carregar categorias', err)
    }
  }

  async function createTicket() {
    if (!subject || !description) return
    setSubmitting(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(`${API_URL}/api/support/tickets`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.access_token}`
        },
        body: JSON.stringify({ subject, description, category_id: categoryId })
      })
      if (res.ok) {
        toast('Solicitação enviada com sucesso!', 'success')
        setSubject('')
        setDescription('')
        setCategoryId('')
        setView('list')
        loadTickets()
      } else {
        toast('Erro ao enviar solicitação', 'error')
      }
    } catch (err) {
      toast('Erro de conexão', 'error')
    } finally {
      setSubmitting(false)
    }
  }

  async function loadTicketDetails(id: string) {
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(`${API_URL}/api/support/tickets/${id}`, {
        headers: { Authorization: `Bearer ${session?.access_token}` }
      })
      if (res.ok) {
        setSelectedTicket(await res.json())
        setView('details')
      }
    } catch (err) {
      toast('Erro ao carregar detalhes', 'error')
    }
  }

  async function sendMessage() {
    if (!msgInput.trim() || !selectedTicket) return
    const id = selectedTicket.id
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(`${API_URL}/api/support/tickets/${id}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.access_token}`
        },
        body: JSON.stringify({ body: msgInput })
      })
      if (res.ok) {
        setMsgInput('')
        loadTicketDetails(id)
      }
    } catch (err) {
      toast('Erro ao enviar mensagem', 'error')
    }
  }

  return (
    <div className="support-page">
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 32, height: 32, borderRadius: 8, background: 'linear-gradient(135deg, #6366f1, #06b6d4)', flexShrink: 0 }}>
              <LifeBuoy size={17} color="white" />
            </span>
            Suporte e Ajuda
          </h1>
          <p className="page-subtitle">Como podemos ajudar você hoje?</p>
        </div>
        {view === 'list' && (
          <button className="btn btn-primary" onClick={() => setView('new')} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Plus size={16} /> Novo Chamado
          </button>
        )}
      </div>

      {view === 'list' && (
        <div className="card" style={{ padding: 0 }}>
          {loading ? (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>Carregando chamados...</div>
          ) : tickets.length === 0 ? (
            <div style={{ padding: 80, textAlign: 'center' }}>
              <div style={{ background: 'var(--bg-darker)', width: 60, height: 60, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px' }}>
                <MessageCircle size={24} color="var(--text-muted)" />
              </div>
              <h3 style={{ fontSize: 18, color: 'var(--text-primary)', marginBottom: 8 }}>Nenhum chamado aberto</h3>
              <p style={{ color: 'var(--text-muted)', marginBottom: 24 }}>Você ainda não criou nenhuma solicitação de suporte.</p>
              <button className="btn btn-primary" onClick={() => setView('new')}>Criar meu primeiro chamado</button>
            </div>
          ) : (
            <div className="support-list">
              {tickets.map(t => (
                <div key={t.id} className="support-item" onClick={() => loadTicketDetails(t.id)}>
                  <div className="support-item-main">
                    <div className="support-item-id">#{t.ticket_number}</div>
                    <div className="support-item-content">
                      <h4 className="support-item-title">{t.subject}</h4>
                      <div className="support-item-meta">
                        <span className="support-category">{t.ticket_categories?.name || 'Geral'}</span>
                        <span className="support-dot" />
                        <span>Atualizado {timeAgo(t.updated_at)}</span>
                      </div>
                    </div>
                  </div>
                  <div className="support-item-status">
                    <span className="status-badge" style={{ 
                      background: `${STATUS_COLORS[t.status]}20`, 
                      color: STATUS_COLORS[t.status],
                      borderColor: `${STATUS_COLORS[t.status]}40`
                    }}>
                      {STATUS_LABELS[t.status] || t.status}
                    </span>
                    <ChevronRight size={18} color="var(--text-muted)" />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {view === 'new' && (
        <div className="card" style={{ maxWidth: 600, margin: '0 auto' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
            <button className="btn btn-ghost" onClick={() => setView('list')} style={{ padding: 8 }}>
              <ArrowLeft size={20} />
            </button>
            <h2 style={{ fontSize: 20, fontWeight: 700 }}>Novo Chamado</h2>
          </div>

          <div className="form-group">
            <label>Qual o assunto?</label>
            <input 
              className="form-input" 
              placeholder="Ex: Erro na sincronização do Google Maps" 
              value={subject}
              onChange={e => setSubject(e.target.value)}
            />
          </div>

          <div className="form-group">
            <label>Categoria</label>
            <select className="form-input" value={categoryId} onChange={e => setCategoryId(e.target.value)}>
              <option value="">Selecione uma categoria...</option>
              {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>

          <div className="form-group">
            <label>Descreva o problema com detalhes</label>
            <textarea 
              className="form-input" 
              rows={6} 
              placeholder="Explique o que está acontecendo e como podemos ajudar..."
              value={description}
              onChange={e => setDescription(e.target.value)}
            />
          </div>

          <div className="form-actions">
            <button className="btn btn-ghost" style={{ flex: 1 }} onClick={() => setView('list')}>Cancelar</button>
            <button 
              className="btn btn-primary" 
              style={{ flex: 2 }} 
              disabled={submitting || !subject || !description}
              onClick={createTicket}
            >
              {submitting ? 'Enviando...' : 'Abrir Chamado'}
            </button>
          </div>
        </div>
      )}

      {view === 'details' && selectedTicket && (
        <div className="ticket-details-layout">
          <div className="ticket-sidebar">
            <button className="btn btn-ghost" onClick={() => setView('list')} style={{ marginBottom: 20, width: '100%', justifyContent: 'flex-start', gap: 8 }}>
              <ArrowLeft size={16} /> Voltar para lista
            </button>

            <div className="card" style={{ padding: 16 }}>
              <div style={{ marginBottom: 20 }}>
                <span className="status-badge" style={{ 
                  background: `${STATUS_COLORS[selectedTicket.status]}20`, 
                  color: STATUS_COLORS[selectedTicket.status],
                  marginBottom: 12
                }}>
                  {STATUS_LABELS[selectedTicket.status] || selectedTicket.status}
                </span>
                <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>#{selectedTicket.ticket_number}</h3>
                <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>Aberto em {new Date(selectedTicket.created_at).toLocaleDateString('pt-BR')}</p>
              </div>

              <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16 }}>
                <div style={{ marginBottom: 12 }}>
                  <label style={{ fontSize: 11, textTransform: 'uppercase', color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Categoria</label>
                  <div style={{ fontSize: 13, color: 'var(--text-primary)' }}>{selectedTicket.ticket_categories?.name || 'Geral'}</div>
                </div>
                <div>
                  <label style={{ fontSize: 11, textTransform: 'uppercase', color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Prioridade</label>
                  <div style={{ fontSize: 13, color: 'var(--text-primary)', textTransform: 'capitalize' }}>{selectedTicket.priority}</div>
                </div>
              </div>
            </div>
          </div>

          <div className="ticket-chat-area">
            <div className="card" style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 200px)', padding: 0 }}>
              <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
                <h2 style={{ fontSize: 18, fontWeight: 700 }}>{selectedTicket.subject}</h2>
              </div>

              <div className="chat-messages" style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
                {/* Descrição inicial */}
                <div className="chat-message user">
                  <div className="chat-bubble user">
                    <p>{selectedTicket.description}</p>
                  </div>
                  <div className="chat-time">{new Date(selectedTicket.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</div>
                </div>

                {/* Mensagens do thread */}
                {selectedTicket.ticket_messages?.map((m: any) => (
                  <div key={m.id} className={`chat-message ${m.author_role === 'tenant_user' ? 'user' : 'assistant'}`}>
                    <div className={`chat-bubble ${m.author_role === 'tenant_user' ? 'user' : 'assistant'}`}>
                      <p>{m.body}</p>
                    </div>
                    <div className="chat-time">{new Date(m.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</div>
                  </div>
                ))}
                <div ref={chatBottomRef} />
              </div>

              {['resolved', 'closed', 'ai_resolved'].includes(selectedTicket.status) ? (
                <div style={{ padding: 20, textAlign: 'center', background: 'var(--bg-darker)', borderTop: '1px solid var(--border)' }}>
                  <p style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 12 }}>Este chamado está {STATUS_LABELS[selectedTicket.status].toLowerCase()}.</p>
                  <button className="btn btn-ghost" onClick={() => setMsgInput('Quero reabrir este chamado.')}>Deseja reabrir?</button>
                </div>
              ) : (
                <div className="chat-input-row" style={{ padding: 16, borderTop: '1px solid var(--border)' }}>
                  <input 
                    className="chat-input" 
                    placeholder="Digite sua resposta..." 
                    value={msgInput}
                    onChange={e => setMsgInput(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && sendMessage()}
                  />
                  <button className="chat-send" onClick={sendMessage} disabled={!msgInput.trim()}>
                    <Send size={18} />
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <style>{`
        .support-list { display: flex; flexDirection: column; }
        .support-item { 
          display: flex; justify-content: space-between; align-items: center; 
          padding: 16px 20px; border-bottom: 1px solid var(--border); cursor: pointer;
          transition: all 0.2s;
        }
        .support-item:hover { background: var(--bg-darker); }
        .support-item:last-child { border-bottom: none; border-bottom-left-radius: 12px; border-bottom-right-radius: 12px; }
        .support-item-main { display: flex; align-items: center; gap: 20px; flex: 1; }
        .support-item-id { 
          font-family: monospace; font-size: 13; color: var(--text-muted); 
          background: var(--bg-darker); padding: 4px 8px; borderRadius: 6px;
        }
        .support-item-title { font-size: 15px; font-weight: 600; color: var(--text-primary); margin-bottom: 4px; }
        .support-item-meta { display: flex; align-items: center; gap: 10px; font-size: 12px; color: var(--text-muted); }
        .support-category { color: var(--accent); font-weight: 600; }
        .support-dot { width: 4px; height: 4px; border-radius: 50%; background: var(--border); }
        .support-item-status { display: flex; align-items: center; gap: 16px; }
        
        .ticket-details-layout { display: grid; grid-template-columns: 280px 1fr; gap: 24px; align-items: start; }
        
        .chat-messages { display: flex; flex-direction: column; gap: 16px; }
        .chat-message { display: flex; flex-direction: column; max-width: 80%; }
        .chat-message.user { align-self: flex-end; align-items: flex-end; }
        .chat-message.assistant { align-self: flex-start; align-items: flex-start; }
        
        .chat-bubble { padding: 12px 16px; border-radius: 16px; font-size: 14px; line-height: 1.5; }
        .chat-bubble.user { background: var(--accent); color: white; border-bottom-right-radius: 4px; }
        .chat-bubble.assistant { background: var(--bg-darker); color: var(--text-primary); border-bottom-left-radius: 4px; border: 1px solid var(--border); }
        .chat-time { font-size: 10px; color: var(--text-muted); margin-top: 4px; }
        
        .status-badge { 
          padding: 4px 10px; border-radius: 100px; font-size: 11px; font-weight: 700; 
          text-transform: uppercase; border: 1px solid transparent; display: inline-block;
        }

        /* Novas Estilizações de Formulário (Alinhado ao Cadastro) */
        .form-group {
          margin-bottom: 20px;
        }
        .form-group label {
          display: block;
          font-size: 12px;
          font-weight: 600;
          color: var(--text-secondary);
          text-transform: uppercase;
          letter-spacing: 0.08em;
          margin-bottom: 8px;
        }
        .form-input {
          width: 100%;
          padding: 12px 16px;
          background: rgba(255,255,255,0.04);
          border: 1px solid var(--border);
          border-radius: 8px;
          color: var(--text-primary);
          font-size: 14px;
          font-family: 'Inter', sans-serif;
          outline: none;
          transition: border-color 0.2s, box-shadow 0.2s, background-color 0.2s;
          box-sizing: border-box;
        }
        .form-input:focus {
          border-color: var(--accent);
          background: rgba(255,255,255,0.07);
          box-shadow: 0 0 0 3px rgba(99,102,241,0.15);
        }
        .form-input::placeholder {
          color: var(--text-muted);
        }
        textarea.form-input {
          resize: vertical;
          min-height: 130px;
          line-height: 1.5;
        }
        select.form-input {
          appearance: none;
          background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='%238892aa'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M19 9l-7 7-7-7'/%3E%3C/svg%3E");
          background-repeat: no-repeat;
          background-position: right 14px center;
          background-size: 16px;
          padding-right: 40px;
          cursor: pointer;
        }
        .form-actions {
          display: flex;
          gap: 12px;
          margin-top: 24px;
        }
        .form-actions .btn {
          padding: 11px 20px;
          font-size: 14px;
          font-weight: 600;
          border-radius: 8px;
          justify-content: center;
          align-items: center;
          display: flex;
        }
      `}</style>
    </div>
  )
}
