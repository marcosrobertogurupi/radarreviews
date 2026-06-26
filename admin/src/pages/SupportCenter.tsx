import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { API_URL, timeAgo } from '../lib/utils'
import { 
  LifeBuoy, MessageSquare, BookOpen, BarChart2, ArrowLeft, ArrowUpRight,
  Send, User, Cpu, AlertCircle, Clock, CheckCircle, Search, Edit3, Plus, X, Eye, FileText, AlertTriangle
} from 'lucide-react'
import { useToast } from '../components/Toast'

interface SupportStats {
  total: number
  open: number
  ai_handled: number
  critical: number
  avg_csat: string
  sla_breaches: number
}

interface KBDoc {
  id: string
  title: string
  problem_description: string
  solution_summary: string
  solution_steps: Array<{ step: number; text: string; code?: string }> | string[] | any
  keywords: string[]
  status: 'draft' | 'active' | 'archived'
  confidence_score: number
  resolution_count: number
  category_id?: string
  ticket_categories?: { name: string }
}

export default function SupportCenter() {
  const { toast } = useToast()
  const [tab, setTab] = useState<'tickets' | 'kb' | 'stats'>('tickets')
  const [stats, setStats] = useState<SupportStats | null>(null)
  const [tickets, setTickets] = useState<any[]>([])
  const [kbDocs, setKbDocs] = useState<KBDoc[]>([])
  const [categories, setCategories] = useState<any[]>([])

  // Estado do Ticket Selecionado (Visualização de Detalhes)
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null)
  const [selectedTicket, setSelectedTicket] = useState<any | null>(null)
  const [auditLogs, setAuditLogs] = useState<any[]>([])
  const [showAudit, setShowAudit] = useState(false)
  const [msgBody, setMsgBody] = useState('')
  const [msgIsInternal, setMsgIsInternal] = useState(false)
  const [transitionStatus, setTransitionStatus] = useState('')
  const [replyLoading, setReplyLoading] = useState(false)

  // Estado do Simulador RAG
  const [ragQuery, setRagQuery] = useState('')
  const [ragCategory, setRagCategory] = useState('')
  const [ragLoading, setRagLoading] = useState(false)
  const [ragResult, setRagResult] = useState<any | null>(null)

  // Estado do Modal de Edição/Criação de KB
  const [kbModalOpen, setKbModalOpen] = useState(false)
  const [editingDocId, setEditingDocId] = useState<string | null>(null)
  const [kbForm, setKbForm] = useState({
    title: '',
    problem_description: '',
    solution_summary: '',
    solution_steps_text: '',
    keywords_text: '',
    category_id: '',
    status: 'draft' as 'draft' | 'active' | 'archived'
  })
  const [kbSaving, setKbSaving] = useState(false)

  const chatEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    loadAll()
    loadCategories()
  }, [tab])

  useEffect(() => {
    if (selectedTicketId) {
      loadTicketDetails(selectedTicketId)
    }
  }, [selectedTicketId])

  useEffect(() => {
    if (chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [selectedTicket?.ticket_messages])

  async function loadCategories() {
    try {
      const { data } = await supabase.from('ticket_categories').select('*').eq('active', true).order('name')
      if (data) setCategories(data)
    } catch (err) {
      console.error(err)
    }
  }

  async function loadAll() {
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const headers = { Authorization: `Bearer ${session?.access_token}` }

      if (tab === 'stats') {
        const res = await fetch(`${API_URL}/api/admin/support/stats`, { headers })
        if (res.ok) setStats(await res.json())
      } else if (tab === 'tickets') {
        const res = await fetch(`${API_URL}/api/admin/support/tickets`, { headers })
        if (res.ok) setTickets(await res.json())
      } else if (tab === 'kb') {
        const res = await fetch(`${API_URL}/api/admin/support/kb`, { headers })
        if (res.ok) setKbDocs(await res.json())
      }
    } catch (err) {
      console.error(err)
    }
  }

  async function loadTicketDetails(id: string) {
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const headers = { Authorization: `Bearer ${session?.access_token}` }

      const [ticketRes, auditRes] = await Promise.all([
        fetch(`${API_URL}/api/admin/support/tickets/${id}`, { headers }),
        fetch(`${API_URL}/api/admin/support/tickets/${id}/audit`, { headers })
      ])

      if (ticketRes.ok) {
        const ticketData = await ticketRes.json()
        setSelectedTicket(ticketData)
        setTransitionStatus(ticketData.status)
      }
      if (auditRes.ok) {
        setAuditLogs(await auditRes.json())
      }
    } catch (err) {
      console.error(err)
      toast('Erro ao carregar detalhes do chamado', 'error')
    }
  }

  // Aprovar rascunho de IA (T2) em 1-Clique
  async function approveAIDraft() {
    if (!selectedTicket) return
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(`${API_URL}/api/admin/support/tickets/${selectedTicket.id}/approve-ai-draft`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.access_token}`
        }
      })

      if (res.ok) {
        toast('Rascunho de IA aprovado e enviado com sucesso!', 'success')
        loadTicketDetails(selectedTicket.id)
        loadAll()
      } else {
        const err = await res.json().catch(() => ({}))
        toast(err.error || 'Erro ao aprovar rascunho', 'error')
      }
    } catch (err) {
      console.error(err)
      toast('Erro ao conectar à API', 'error')
    }
  }

  // Enviar Resposta Humana com alteração opcional de status
  async function sendHumanResponse(e: React.FormEvent) {
    e.preventDefault()
    if (!msgBody.trim() || !selectedTicket) return
    setReplyLoading(true)

    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(`${API_URL}/api/admin/support/tickets/${selectedTicket.id}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.access_token}`
        },
        body: JSON.stringify({
          body: msgBody,
          is_internal: msgIsInternal,
          status: transitionStatus !== selectedTicket.status ? transitionStatus : undefined
        })
      })

      if (res.ok) {
        toast('Mensagem enviada com sucesso!', 'success')
        setMsgBody('')
        setMsgIsInternal(false)
        loadTicketDetails(selectedTicket.id)
        loadAll()
      } else {
        const err = await res.json().catch(() => ({}))
        toast(err.error || 'Erro ao enviar resposta', 'error')
      }
    } catch (err) {
      console.error(err)
      toast('Erro de conexão', 'error')
    } finally {
      setReplyLoading(false)
    }
  }

  // Simular Consulta RAG contra Base de Conhecimento
  async function runRagSimulation(e: React.FormEvent) {
    e.preventDefault()
    if (!ragQuery.trim()) return
    setRagLoading(true)
    setRagResult(null)

    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(`${API_URL}/api/admin/support/kb/test-query`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.access_token}`
        },
        body: JSON.stringify({
          query: ragQuery,
          category_id: ragCategory || undefined
        })
      })

      if (res.ok) {
        setRagResult(await res.json())
      } else {
        toast('Erro ao rodar simulação RAG', 'error')
      }
    } catch (err) {
      console.error(err)
      toast('Erro de conexão', 'error')
    } finally {
      setRagLoading(false)
    }
  }

  // Salvar Criação ou Edição de KB
  async function saveKBArticle(e: React.FormEvent) {
    e.preventDefault()
    if (!kbForm.title || !kbForm.solution_summary) {
      toast('Preencha os campos obrigatórios', 'error')
      return
    }
    setKbSaving(true)

    // Formata passos
    const solution_steps = kbForm.solution_steps_text
      .split('\n')
      .filter(line => line.trim().length > 0)
      .map((line, idx) => ({ step: idx + 1, text: line.trim() }))

    const keywords = kbForm.keywords_text
      .split(',')
      .map(k => k.trim())
      .filter(k => k.length > 0)

    const payload = {
      title: kbForm.title,
      problem_description: kbForm.problem_description,
      solution_summary: kbForm.solution_summary,
      solution_steps,
      keywords,
      category_id: kbForm.category_id || null,
      status: kbForm.status
    }

    try {
      const { data: { session } } = await supabase.auth.getSession()
      const url = editingDocId 
        ? `${API_URL}/api/admin/support/kb/${editingDocId}`
        : `${API_URL}/api/admin/support/kb`
      const method = editingDocId ? 'PATCH' : 'POST'

      const res = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.access_token}`
        },
        body: JSON.stringify(payload)
      })

      if (res.ok) {
        toast(editingDocId ? 'Artigo atualizado!' : 'Artigo criado com sucesso!', 'success')
        setKbModalOpen(false)
        loadAll()
      } else {
        const err = await res.json().catch(() => ({}))
        toast(err.error || 'Erro ao salvar artigo', 'error')
      }
    } catch (err) {
      console.error(err)
      toast('Erro ao conectar com servidor', 'error')
    } finally {
      setKbSaving(false)
    }
  }

  // Abrir Modal KB para criar novo
  function openCreateKBModal() {
    setEditingDocId(null)
    setKbForm({
      title: '',
      problem_description: '',
      solution_summary: '',
      solution_steps_text: '',
      keywords_text: '',
      category_id: '',
      status: 'draft'
    })
    setKbModalOpen(true)
  }

  // Abrir Modal KB para editar
  function openEditKBModal(doc: KBDoc) {
    setEditingDocId(doc.id)
    
    // Converte passos em texto
    let stepsText = ''
    if (Array.isArray(doc.solution_steps)) {
      stepsText = doc.solution_steps
        .map((s: any) => typeof s === 'string' ? s : s.text)
        .join('\n')
    }

    setKbForm({
      title: doc.title || '',
      problem_description: doc.problem_description || '',
      solution_summary: doc.solution_summary || '',
      solution_steps_text: stepsText,
      keywords_text: Array.isArray(doc.keywords) ? doc.keywords.join(', ') : '',
      category_id: doc.category_id || '',
      status: doc.status || 'draft'
    })
    setKbModalOpen(true)
  }

  // Aprovar artigo via atalho rápido
  async function updateDocStatus(id: string, status: 'active' | 'archived') {
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(`${API_URL}/api/admin/support/kb/${id}`, {
        method: 'PATCH',
        headers: { 
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.access_token}` 
        },
        body: JSON.stringify({ status })
      })
      if (res.ok) {
        toast('Status do artigo atualizado com sucesso!', 'success')
        loadAll()
      } else {
        toast('Erro ao atualizar status', 'error')
      }
    } catch (err) {
      console.error(err)
    }
  }

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 32, height: 32, borderRadius: 8, background: 'linear-gradient(135deg, #f59e0b, #ef4444)', flexShrink: 0 }}>
              <LifeBuoy size={17} color="white" />
            </span>
            Centro de Suporte Admin
          </h1>
          <p className="page-subtitle">Gestão global de chamados, base de conhecimento e performance de IA.</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="tabs" style={{ marginBottom: 24, display: 'flex', gap: 8, borderBottom: '1px solid var(--border)', paddingBottom: 0 }}>
        <button className={`tab ${tab === 'tickets' ? 'active' : ''}`} onClick={() => { setTab('tickets'); setSelectedTicketId(null); setSelectedTicket(null); }}>
          <MessageSquare size={16} /> Chamados
        </button>
        <button className={`tab ${tab === 'kb' ? 'active' : ''}`} onClick={() => { setTab('kb'); setRagResult(null); }}>
          <BookOpen size={16} /> Base de Conhecimento
        </button>
        <button className={`tab ${tab === 'stats' ? 'active' : ''}`} onClick={() => setTab('stats')}>
          <BarChart2 size={16} /> Analytics & KPIs
        </button>
      </div>

      {/* RENDER DETALHES DO TICKET */}
      {tab === 'tickets' && selectedTicket && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button className="btn btn-ghost" style={{ display: 'flex', alignItems: 'center', gap: 6 }} onClick={() => { setSelectedTicketId(null); setSelectedTicket(null); }}>
              <ArrowLeft size={16} /> Voltar para fila
            </button>
            <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>Chamado #{selectedTicket.ticket_number}</span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 24, alignItems: 'start' }}>
            
            {/* Esquerda: Informações Gerais, Conversa e Resposta */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              
              {/* Card de Informações Principais */}
              <div className="card" style={{ padding: 24 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: 16 }}>
                  <div>
                    <h2 style={{ fontSize: 18, fontWeight: 700, margin: '0 0 4px 0' }}>{selectedTicket.subject}</h2>
                    <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>
                      Assinante: <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{selectedTicket.tenants?.name}</span>
                    </p>
                  </div>
                  <span className={`status-badge ${selectedTicket.status}`} style={{ fontSize: 12, padding: '4px 10px' }}>{selectedTicket.status}</span>
                </div>

                <div style={{ fontSize: 14, color: 'var(--text-muted)', background: 'rgba(255,255,255,0.02)', padding: 16, borderRadius: 8, border: '1px solid var(--border)', whiteSpace: 'pre-wrap', lineHeight: 1.5, marginBottom: 20 }}>
                  {selectedTicket.description}
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
                  <div>
                    <span style={{ display: 'block', fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 4 }}>Prioridade</span>
                    <span style={{ fontWeight: 600, color: selectedTicket.priority === 'critical' ? '#ef4444' : selectedTicket.priority === 'high' ? '#f59e0b' : 'var(--text-primary)' }}>
                      {selectedTicket.priority.toUpperCase()}
                    </span>
                  </div>
                  <div>
                    <span style={{ display: 'block', fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 4 }}>Categoria</span>
                    <span style={{ fontWeight: 600 }}>{selectedTicket.ticket_categories?.name || 'Geral'}</span>
                  </div>
                  <div>
                    <span style={{ display: 'block', fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 4 }}>Prazo SLA</span>
                    {selectedTicket.is_sla_breached ? (
                      <span style={{ color: '#ef4444', fontWeight: 700 }}>🚨 SLA VIOLADO</span>
                    ) : (
                      <span style={{ fontWeight: 600, color: '#10b981' }}>{new Date(selectedTicket.sla_deadline).toLocaleString('pt-BR')}</span>
                    )}
                  </div>
                </div>
              </div>

              {/* RASCUNHO DE IA EM DESTAQUE (T2) */}
              {selectedTicket.ai_draft_response && (
                <div className="card" style={{ padding: 24, border: '1px dashed #f59e0b', background: 'rgba(245,158,11,0.02)', position: 'relative', overflow: 'hidden' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                    <Cpu size={20} color="#f59e0b" />
                    <h3 style={{ fontSize: 15, fontWeight: 700, margin: 0, color: '#f59e0b' }}>Sugestão de Resposta da IA (Rascunho T2)</h3>
                  </div>
                  <div style={{ fontSize: 14, color: 'var(--text-primary)', background: 'rgba(0,0,0,0.15)', padding: 16, borderRadius: 8, border: '1px solid rgba(245,158,11,0.2)', whiteSpace: 'pre-wrap', lineHeight: 1.5, marginBottom: 16 }}>
                    {selectedTicket.ai_draft_response}
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                    <button className="btn btn-primary" onClick={approveAIDraft} style={{ background: 'linear-gradient(135deg, #f59e0b, #ef4444)', borderColor: 'transparent', display: 'flex', alignItems: 'center', gap: 8 }}>
                      <CheckCircle size={16} /> Aprovar e Enviar Rascunho
                    </button>
                  </div>
                </div>
              )}

              {/* THREAD DE MENSAGENS */}
              <div className="card" style={{ padding: 24 }}>
                <h3 style={{ fontSize: 15, fontWeight: 700, marginTop: 0, marginBottom: 20, borderBottom: '1px solid var(--border)', paddingBottom: 10 }}>Thread de Conversa</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxHeight: '400px', overflowY: 'auto', paddingRight: 8, marginBottom: 20 }}>
                  {(!selectedTicket.ticket_messages || selectedTicket.ticket_messages.length === 0) ? (
                    <div style={{ padding: '30px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: 14 }}>Nenhuma mensagem na conversa ainda.</div>
                  ) : (
                    selectedTicket.ticket_messages.map((msg: any) => {
                      const isAgent = msg.author_role === 'agent'
                      const isAI = msg.author_role === 'ai'
                      const isSystem = msg.author_role === 'system'
                      return (
                        <div key={msg.id} style={{
                          display: 'flex',
                          flexDirection: 'column',
                          alignSelf: isAgent ? 'flex-end' : (isSystem ? 'center' : 'flex-start'),
                          maxWidth: isSystem ? '100%' : '75%',
                          background: msg.is_internal ? 'rgba(239,68,68,0.06)' : (isAgent ? 'var(--accent-2)' : (isSystem ? 'transparent' : 'rgba(255,255,255,0.05)')),
                          padding: isSystem ? '4px 12px' : '12px 16px',
                          borderRadius: 12,
                          border: msg.is_internal ? '1px solid rgba(239,68,68,0.2)' : (isSystem ? 'none' : '1px solid var(--border)')
                        }}>
                          {!isSystem && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--text-muted)', marginBottom: 6, fontWeight: 600 }}>
                              {isAI ? <Cpu size={12} /> : <User size={12} />}
                              <span>
                                {isAI ? 'Assistente IA' : (isAgent ? 'Operador' : 'Cliente')}
                                {msg.is_internal && <span style={{ color: '#ef4444', marginLeft: 6 }}>[NOTA INTERNA]</span>}
                              </span>
                              <span>•</span>
                              <span>{timeAgo(msg.created_at)}</span>
                            </div>
                          )}
                          <div style={{ fontSize: 13, color: isSystem ? 'var(--text-muted)' : 'var(--text-primary)', whiteSpace: 'pre-wrap', fontStyle: isSystem ? 'italic' : 'normal', textAlign: isSystem ? 'center' : 'left' }}>
                            {msg.body}
                          </div>
                        </div>
                      )
                    })
                  )}
                  <div ref={chatEndRef} />
                </div>

                {/* Caixa de Resposta */}
                <form onSubmit={sendHumanResponse} style={{ display: 'flex', flexDirection: 'column', gap: 12, borderTop: '1px solid var(--border)', paddingTop: 20 }}>
                  <textarea
                    className="form-control"
                    placeholder="Digite a resposta técnica ou nota interna..."
                    value={msgBody}
                    onChange={e => setMsgBody(e.target.value)}
                    style={{ minHeight: 80, width: '100%', padding: 12, background: 'var(--bg-darker)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: 8, resize: 'vertical' }}
                    required
                  />

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={msgIsInternal}
                          onChange={e => setMsgIsInternal(e.target.checked)}
                          style={{ accentColor: '#ef4444' }}
                        />
                        Nota Interna (Não visível ao cliente)
                      </label>

                      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
                        Alterar Status:
                        <select
                          className="form-control"
                          value={transitionStatus}
                          onChange={e => setTransitionStatus(e.target.value)}
                          style={{ padding: '4px 8px', background: 'var(--bg-darker)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: 6, fontSize: 12 }}
                        >
                          <option value="open">Aberto</option>
                          <option value="in_progress">Em Progresso</option>
                          <option value="waiting_tenant">Aguardando Assinante</option>
                          <option value="escalated">Escalado</option>
                          <option value="resolved">Resolvido</option>
                          <option value="closed">Fechado</option>
                        </select>
                      </label>
                    </div>

                    <button type="submit" disabled={replyLoading} className="btn btn-primary" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <Send size={14} /> {replyLoading ? 'Enviando...' : 'Enviar Resposta'}
                    </button>
                  </div>
                </form>
              </div>
            </div>

            {/* Direita: SLA, Histórico IA e Auditoria */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              
              {/* IA Insights */}
              <div className="card" style={{ padding: 20 }}>
                <h3 style={{ fontSize: 14, fontWeight: 700, margin: '0 0 16px 0', borderBottom: '1px solid var(--border)', paddingBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Cpu size={16} /> Triagem Inteligente
                </h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12, fontSize: 13 }}>
                  <div>
                    <span style={{ color: 'var(--text-muted)', display: 'block', marginBottom: 2 }}>Sentimento Detectado</span>
                    <span style={{ fontWeight: 600, color: selectedTicket.ai_sentiment === 'frustrated' || selectedTicket.ai_sentiment === 'negative' ? '#ef4444' : 'var(--text-primary)' }}>
                      {selectedTicket.ai_sentiment ? selectedTicket.ai_sentiment.toUpperCase() : 'Não analisado'}
                    </span>
                  </div>
                  <div>
                    <span style={{ color: 'var(--text-muted)', display: 'block', marginBottom: 2 }}>Confiança da IA</span>
                    <span style={{ fontWeight: 600 }}>{selectedTicket.ai_confidence ? `${Math.round(selectedTicket.ai_confidence * 100)}%` : 'N/A'}</span>
                  </div>
                  {selectedTicket.ai_summary && (
                    <div>
                      <span style={{ color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Resumo da IA</span>
                      <p style={{ margin: 0, padding: 8, background: 'rgba(255,255,255,0.02)', borderRadius: 6, border: '1px solid var(--border)', fontSize: 12, lineHeight: 1.4 }}>
                        {selectedTicket.ai_summary}
                      </p>
                    </div>
                  )}
                </div>
              </div>

              {/* Botão de Auditoria Técnica */}
              <div className="card" style={{ padding: 20 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                  <h3 style={{ fontSize: 14, fontWeight: 700, margin: 0 }}>Linha do Tempo Técnica</h3>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowAudit(!showAudit)} style={{ padding: '2px 8px', fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
                    <Eye size={12} /> {showAudit ? 'Ocultar' : 'Exibir'}
                  </button>
                </div>
                
                {showAudit && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 12, borderTop: '1px solid var(--border)', paddingTop: 12, maxHeight: '350px', overflowY: 'auto' }}>
                    {auditLogs.map((log: any) => (
                      <div key={log.id} style={{ fontSize: 11, position: 'relative', paddingLeft: 16, borderLeft: '2px solid var(--border)' }}>
                        <div style={{ position: 'absolute', left: -5, top: 4, width: 8, height: 8, borderRadius: '50%', background: log.action === 'sla_breached' ? '#ef4444' : 'var(--text-muted)' }} />
                        <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                          {log.action.toUpperCase()}
                        </div>
                        <div style={{ color: 'var(--text-muted)', margin: '2px 0' }}>
                          {log.from_value && `De ${log.from_value} `}
                          {log.to_value && `Para ${log.to_value}`}
                          {log.metadata?.reason && ` (${log.metadata.reason})`}
                        </div>
                        <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                          Por: {log.actor_role} ({timeAgo(log.created_at)})
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* RENDER LISTAGEM DE TICKETS */}
      {tab === 'tickets' && !selectedTicket && (
        <div className="card" style={{ padding: 0 }}>
          <table className="admin-table">
            <thead>
              <tr>
                <th>Ticket</th>
                <th>Assinante</th>
                <th>Assunto</th>
                <th>Status</th>
                <th>SLA</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {tickets.map(t => (
                <tr key={t.id} style={{ cursor: 'pointer' }} onClick={() => setSelectedTicketId(t.id)}>
                  <td style={{ fontFamily: 'monospace', fontSize: 12 }}>#{t.ticket_number}</td>
                  <td>
                    <div style={{ fontWeight: 600 }}>{t.tenants?.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>ID: {t.tenant_id.slice(0, 8)}</div>
                  </td>
                  <td>
                    <div style={{ fontWeight: 500 }}>{t.subject}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', display: 'flex', gap: 6, alignItems: 'center' }}>
                      <span>{t.ticket_categories?.name || 'Geral'}</span>
                      {t.ai_draft_response && <span style={{ padding: '1px 5px', background: 'rgba(245,158,11,0.1)', color: '#f59e0b', borderRadius: 4, fontSize: 9, fontWeight: 700 }}>AI DRAFT</span>}
                    </div>
                  </td>
                  <td>
                    <span className={`status-badge ${t.status}`}>{t.status}</span>
                  </td>
                  <td>
                    {t.is_sla_breached ? (
                      <span style={{ color: '#ef4444', fontWeight: 700, fontSize: 11 }}>🚨 SLA BREACHED</span>
                    ) : (
                      <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>{new Date(t.sla_deadline).toLocaleString('pt-BR')}</span>
                    )}
                  </td>
                  <td>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={(e) => { e.stopPropagation(); setSelectedTicketId(t.id); }}><ArrowUpRight size={14} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* RENDER BASE DE CONHECIMENTO */}
      {tab === 'kb' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          
          {/* Simulador de RAG */}
          <div className="card" style={{ padding: 24, border: '1px solid var(--accent)', background: 'rgba(99,102,241,0.02)' }}>
            <h2 style={{ fontSize: 16, fontWeight: 700, marginTop: 0, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
              <Cpu size={18} color="var(--accent)" /> Simulador de Consulta RAG (IA)
            </h2>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 16 }}>Testa a precisão das buscas semânticas e a resposta simulada gerada pelo Gemini usando o contexto atual da KB.</p>
            
            <form onSubmit={runRagSimulation} style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 16 }}>
              <div style={{ flex: 1, minWidth: 250 }}>
                <label style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>Pergunta Simulada</label>
                <div style={{ position: 'relative' }}>
                  <Search size={16} style={{ position: 'absolute', left: 12, top: 12, color: 'var(--text-muted)' }} />
                  <input
                    type="text"
                    className="form-control"
                    placeholder="Ex: Como sincronizar a conta do Google Maps no portal?"
                    value={ragQuery}
                    onChange={e => setRagQuery(e.target.value)}
                    style={{ width: '100%', padding: '10px 12px 10px 40px', background: 'var(--bg-darker)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: 8 }}
                    required
                  />
                </div>
              </div>

              <div style={{ width: 200 }}>
                <label style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>Filtrar Categoria</label>
                <select
                  className="form-control"
                  value={ragCategory}
                  onChange={e => setRagCategory(e.target.value)}
                  style={{ width: '100%', padding: '10px 12px', background: 'var(--bg-darker)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: 8 }}
                >
                  <option value="">Todas</option>
                  {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>

              <button type="submit" disabled={ragLoading} className="btn btn-primary" style={{ padding: '10px 24px', borderRadius: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
                {ragLoading ? 'Pesquisando...' : 'Testar RAG'}
              </button>
            </form>

            {ragResult && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16, borderTop: '1px solid var(--border)', paddingTop: 16 }}>
                <div>
                  <h4 style={{ fontSize: 13, fontWeight: 700, margin: '0 0 6px 0', color: 'var(--accent)' }}>Resposta Sintetizada do Gemini</h4>
                  <div style={{ padding: 12, background: 'var(--bg-darker)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 13, lineHeight: 1.5, color: 'var(--text-primary)', whiteSpace: 'pre-wrap' }}>
                    {ragResult.response}
                  </div>
                </div>

                <div>
                  <h4 style={{ fontSize: 13, fontWeight: 700, margin: '0 0 8px 0' }}>Documentos Recuperados (Similaridade de Cosseno)</h4>
                  {ragResult.documents.length === 0 ? (
                    <div style={{ fontSize: 12, color: '#ef4444', fontStyle: 'italic' }}>Nenhum documento retornado na busca semântica para esta query.</div>
                  ) : (
                    <table className="admin-table" style={{ background: 'var(--bg-darker)', borderRadius: 8, border: '1px solid var(--border)' }}>
                      <thead>
                        <tr>
                          <th>Documento</th>
                          <th>Status</th>
                          <th>Similaridade</th>
                          <th>Score RAG</th>
                        </tr>
                      </thead>
                      <tbody>
                        {ragResult.documents.map((doc: any, i: number) => (
                          <tr key={doc.docId || i}>
                            <td style={{ fontWeight: 600 }}>{doc.title}</td>
                            <td><span className={`status-badge ${doc.status}`}>{doc.status}</span></td>
                            <td style={{ fontWeight: 700 }}>{Math.round(doc.similarity * 100)}%</td>
                            <td>{Math.round(doc.confidenceScore * 100)}%</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Cabeçalho KB com botão Novo Artigo */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>Base de Artigos</h2>
            <button type="button" className="btn btn-primary" onClick={openCreateKBModal} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Plus size={16} /> Novo Artigo KB
            </button>
          </div>

          {/* Grid de Artigos */}
          <div className="kb-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(350px, 1fr))', gap: 20 }}>
            {kbDocs.map(doc => (
              <div key={doc.id} className="card kb-card" style={{ padding: 20, display: 'flex', flexDirection: 'column', height: '100%', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12, alignItems: 'center' }}>
                    <span className={`status-badge ${doc.status}`}>{doc.status}</span>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Categoria: {doc.ticket_categories?.name || 'Geral'}</span>
                  </div>
                  <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 8, color: 'var(--text-primary)' }}>{doc.title}</h3>
                  <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 16, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                    {doc.solution_summary}
                  </p>
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 'auto', borderTop: '1px solid var(--border)', paddingTop: 12 }}>
                  {doc.status === 'draft' && (
                    <button type="button" className="btn btn-primary btn-sm" style={{ flex: 1 }} onClick={() => updateDocStatus(doc.id, 'active')}>Aprovar</button>
                  )}
                  <button type="button" className="btn btn-ghost btn-sm" style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }} onClick={() => openEditKBModal(doc)}>
                    <Edit3 size={13} /> Editar
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* MODAL DE CRIAÇÃO / EDIÇÃO DE ARTIGO KB */}
      {kbModalOpen && (
        <div className="modal-overlay" onClick={() => setKbModalOpen(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: 650, width: '90%' }}>
            <div className="modal-title">
              <span>{editingDocId ? 'Editar Artigo KB' : 'Criar Novo Artigo KB'}</span>
              <button type="button" className="modal-close" onClick={() => setKbModalOpen(false)}><X size={18} /></button>
            </div>

            <form onSubmit={saveKBArticle} style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 12 }}>
              <div>
                <label style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>Título do Artigo <span style={{ color: '#ef4444' }}>*</span></label>
                <input
                  type="text"
                  className="form-control"
                  placeholder="Ex: Como configurar credenciais da API do TripAdvisor"
                  value={kbForm.title}
                  onChange={e => setKbForm({ ...kbForm, title: e.target.value })}
                  style={{ width: '100%', padding: '10px 12px', background: 'var(--bg-darker)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: 8 }}
                  required
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>Categoria</label>
                  <select
                    className="form-control"
                    value={kbForm.category_id}
                    onChange={e => setKbForm({ ...kbForm, category_id: e.target.value })}
                    style={{ width: '100%', padding: '10px 12px', background: 'var(--bg-darker)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: 8 }}
                  >
                    <option value="">Nenhuma</option>
                    {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>Status</label>
                  <select
                    className="form-control"
                    value={kbForm.status}
                    onChange={e => setKbForm({ ...kbForm, status: e.target.value as any })}
                    style={{ width: '100%', padding: '10px 12px', background: 'var(--bg-darker)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: 8 }}
                  >
                    <option value="draft">Rascunho (Draft)</option>
                    <option value="active">Ativo (Publicado)</option>
                    <option value="archived">Arquivado</option>
                  </select>
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>Descrição do Problema</label>
                <textarea
                  className="form-control"
                  placeholder="Descreva o problema comum ou cenário reportado pelo cliente..."
                  value={kbForm.problem_description}
                  onChange={e => setKbForm({ ...kbForm, problem_description: e.target.value })}
                  style={{ width: '100%', height: 70, padding: 10, background: 'var(--bg-darker)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: 8, resize: 'vertical' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>Resumo da Solução <span style={{ color: '#ef4444' }}>*</span></label>
                <textarea
                  className="form-control"
                  placeholder="Digite uma explicação resumida da solução para o cliente..."
                  value={kbForm.solution_summary}
                  onChange={e => setKbForm({ ...kbForm, solution_summary: e.target.value })}
                  style={{ width: '100%', height: 70, padding: 10, background: 'var(--bg-darker)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: 8, resize: 'vertical' }}
                  required
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>Passos da Solução (Um por linha)</label>
                <textarea
                  className="form-control"
                  placeholder="Passo 1: Ir nas configurações&#10;Passo 2: Clicar em salvar"
                  value={kbForm.solution_steps_text}
                  onChange={e => setKbForm({ ...kbForm, solution_steps_text: e.target.value })}
                  style={{ width: '100%', height: 90, padding: 10, background: 'var(--bg-darker)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: 8, resize: 'vertical' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>Palavras-chave (Separadas por vírgula)</label>
                <input
                  type="text"
                  className="form-control"
                  placeholder="tripadvisor, api, erro, conector"
                  value={kbForm.keywords_text}
                  onChange={e => setKbForm({ ...kbForm, keywords_text: e.target.value })}
                  style={{ width: '100%', padding: '10px 12px', background: 'var(--bg-darker)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: 8 }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, borderTop: '1px solid var(--border)', paddingTop: 16 }}>
                <button type="button" className="btn btn-ghost" onClick={() => setKbModalOpen(false)}>Cancelar</button>
                <button type="submit" disabled={kbSaving} className="btn btn-primary">
                  {kbSaving ? 'Salvando...' : 'Salvar Artigo'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* RENDER ANALYTICS & KPIS */}
      {tab === 'stats' && stats && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          <div className="stats-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 20 }}>
            <div className="card stat-card" style={{ padding: 20 }}>
              <div className="stat-label">Total de Chamados</div>
              <div className="stat-value">{stats.total}</div>
            </div>
            <div className="card stat-card" style={{ padding: 20 }}>
              <div className="stat-label">Pendentes</div>
              <div className="stat-value" style={{ color: '#f59e0b' }}>{stats.open}</div>
            </div>
            <div className="card stat-card" style={{ padding: 20 }}>
              <div className="stat-label">Resolvidos por IA</div>
              <div className="stat-value" style={{ color: '#10b981' }}>{stats.ai_handled}</div>
            </div>
            <div className="card stat-card" style={{ padding: 20 }}>
              <div className="stat-label">Críticos</div>
              <div className="stat-value" style={{ color: '#ef4444' }}>{stats.critical}</div>
            </div>
            <div className="card stat-card" style={{ padding: 20 }}>
              <div className="stat-label">Média CSAT</div>
              <div className="stat-value">{stats.avg_csat} / 5.0</div>
            </div>
            <div className="card stat-card" style={{ padding: 20 }}>
              <div className="stat-label">Violações de SLA</div>
              <div className="stat-value" style={{ color: '#ef4444' }}>{stats.sla_breaches}</div>
            </div>
          </div>
        </div>
      )}

      <style>{`
        .tabs { margin-bottom: 24px; }
        .tab { 
          padding: 10px 20px; background: none; border: none; color: var(--text-muted); 
          cursor: pointer; font-weight: 600; display: flex; align-items: center; gap: 8px;
          border-bottom: 2px solid transparent; transition: all 0.2s;
        }
        .tab.active { color: var(--accent); border-bottom-color: var(--accent); }
        .tab:hover { color: var(--text-primary); }
        
        .admin-table { width: 100%; border-collapse: collapse; }
        .admin-table th { text-align: left; padding: 12px 20px; font-size: 11px; text-transform: uppercase; color: var(--text-muted); border-bottom: 1px solid var(--border); }
        .admin-table td { padding: 16px 20px; border-bottom: 1px solid var(--border); font-size: 13px; }
        
        .kb-card { padding: 20px; display: flex; flex-direction: column; }
        
        .status-badge { 
          padding: 2px 8px; border-radius: 4px; font-size: 10px; font-weight: 700; 
          text-transform: uppercase; background: var(--bg-darker); color: var(--text-muted);
        }
        .status-badge.open, .status-badge.reopened, .status-badge.ai_triaged { background: #6366f120; color: #6366f1; }
        .status-badge.active, .status-badge.resolved, .status-badge.ai_resolved { background: #10b98120; color: #10b981; }
        .status-badge.draft { background: #f59e0b20; color: #f59e0b; }
        .status-badge.escalated { background: #ef444420; color: #ef4444; }

        .modal-overlay {
          position: fixed; top: 0; left: 0; right: 0; bottom: 0;
          background: rgba(0,0,0,0.6); display: flex; justify-content: center; align-items: center;
          z-index: 1000;
        }
        .modal-content {
          background: var(--bg-card); border: 1px solid var(--border); border-radius: 12px;
          padding: 24px; box-shadow: 0 10px 25px rgba(0,0,0,0.5);
        }
        .modal-title {
          display: flex; justify-content: space-between; align-items: center;
          font-size: 18px; font-weight: 700; color: var(--text-primary);
          border-bottom: 1px solid var(--border); padding-bottom: 12px;
        }
        .modal-close {
          background: none; border: none; color: var(--text-muted); cursor: pointer;
        }
        .modal-close:hover { color: var(--text-primary); }
      `}</style>
    </div>
  )
}
