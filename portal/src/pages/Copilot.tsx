import { useState, useEffect, useRef } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { API_URL } from '../lib/utils'
import { Send, Bot, User, RefreshCw } from 'lucide-react'

interface Message {
  role: 'user' | 'assistant'
  content: string
  time: Date
}

interface HistoryItem { role: string; text: string }

const SUGGESTIONS = [
  'Por que minha reputação caiu esta semana?',
  'Quais são as principais reclamações dos clientes?',
  'Como devo responder um review crítico?',
  'Quais canais têm mais feedbacks negativos?',
  'Me dê um resumo da situação atual.',
  'O que devo priorizar para melhorar minha nota?',
]

const WELCOME: Message = {
  role: 'assistant',
  content: 'Olá! Sou a **Reputei IA** ✨, assistente de Inteligência Reputacional da Reputei.\n\nAnalisei os seus reviews e alertas recentes. Posso te ajudar a:\n\n• Entender o que está impactando sua reputação\n• Sugerir respostas empáticas para reviews negativos\n• Identificar padrões nos feedbacks de clientes\n• Recomendar ações prioritárias baseadas em dados\n\nMinhas análises são baseadas exclusivamente nos seus dados — sem invenções. Como posso te ajudar hoje?',
  time: new Date(),
}

interface Props { session: Session }

export default function Copilot({ session }: Props) {
  const [messages, setMessages] = useState<Message[]>([WELCOME])
  const [input, setInput]       = useState('')
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState('')
  const bottomRef               = useRef<HTMLDivElement>(null)
  const inputRef                = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  async function send(text?: string) {
    const message = (text ?? input).trim()
    if (!message || loading) return

    setInput('')
    setError('')
    setMessages(prev => [...prev, { role: 'user', content: message, time: new Date() }])
    setLoading(true)

    // Construir histórico (sem a mensagem de boas-vindas e sem a última mensagem do usuário)
    const history: HistoryItem[] = messages
      .slice(1)  // skip welcome
      .map(m => ({ role: m.role === 'user' ? 'user' : 'assistant', text: m.content }))

    try {
      const res = await fetch(`${API_URL}/api/copilot`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ message, history }),
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` })) as { error?: string }
        throw new Error(err.error ?? `Erro ${res.status}`)
      }

      const data = await res.json() as { reply: string }
      setMessages(prev => [...prev, { role: 'assistant', content: data.reply, time: new Date() }])
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erro desconhecido'
      setError(msg)
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `⚠️ Não consegui processar sua mensagem.\n\n${msg.includes('fetch') || msg.includes('connect') ? 'Verifique se o servidor de IA está rodando (`npm run dev:api`).' : msg}`,
        time: new Date(),
      }])
    }
    setLoading(false)
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
  }

  function reset() {
    setMessages([WELCOME])
    setInput('')
    setError('')
    inputRef.current?.focus()
  }

  function renderMarkdown(text: string) {
    // Renderização simples de markdown: bold, listas, quebras de linha
    return text
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      .replace(/^• (.+)$/gm, '<li>$1</li>')
      .replace(/(<li>.*<\/li>)/s, '<ul style="padding-left:18px;margin:4px 0">$1</ul>')
      .replace(/\n/g, '<br />')
  }

  return (
    <div>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 32, height: 32, borderRadius: 8, background: 'linear-gradient(135deg, #6366f1, #06b6d4)', boxShadow: '0 0 14px rgba(99,102,241,0.4)', flexShrink: 0 }}>
              <Bot size={17} color="white" />
            </span>
            Reputei IA
          </h1>
          <p className="page-subtitle">Sua assistente de Inteligência Reputacional. Análises baseadas nos seus dados reais, sem alucinações.</p>
        </div>
        <button className="btn btn-ghost" onClick={reset} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <RefreshCw size={14} /> Nova conversa
        </button>
      </div>

      <div className="chat-container">
        {/* Sugestões (só exibe no início) */}
        {messages.length <= 1 && (
          <div className="chat-suggestions">
            {SUGGESTIONS.map(s => (
              <button key={s} className="chat-suggestion" onClick={() => send(s)}>{s}</button>
            ))}
          </div>
        )}

        {/* Mensagens */}
        <div className="chat-messages">
          {messages.map((m, i) => (
            <div key={i} className={`chat-message ${m.role}`}>
              <div className={`chat-avatar ${m.role}`}>
                {m.role === 'assistant' ? <Bot size={16} color="white" /> : <User size={14} color="rgba(255,255,255,0.8)" />}
              </div>
              <div>
                <div className={`chat-bubble ${m.role}`}
                  dangerouslySetInnerHTML={{ __html: renderMarkdown(m.content) }}
                />
                <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4, textAlign: m.role === 'user' ? 'right' : 'left' }}>
                  {m.time.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                </div>
              </div>
            </div>
          ))}

          {loading && (
            <div className="chat-message assistant">
              <div className="chat-avatar ai">
                <Bot size={16} color="white" />
              </div>
              <div className="chat-bubble ai" style={{ padding: '14px 16px' }}>
                <div className="chat-typing">
                  <span /><span /><span />
                </div>
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <div className="chat-input-row">
          <textarea
            ref={inputRef}
            className="chat-input"
            placeholder="Digite sua pergunta sobre reputação... (Enter para enviar, Shift+Enter para nova linha)"
            value={input}
            rows={2}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={loading}
          />
          <button
            className="chat-send"
            onClick={() => send()}
            disabled={loading || !input.trim()}
            title="Enviar (Enter)"
          >
            <Send size={16} />
          </button>
        </div>

        {error && (
          <div style={{ marginTop: 8, fontSize: 12, color: '#fca5a5', padding: '8px 12px', background: 'rgba(239,68,68,0.08)', borderRadius: 8, border: '1px solid rgba(239,68,68,0.2)' }}>
            {error}
          </div>
        )}

        <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 10, textAlign: 'center' }}>
          A Reputei IA gera respostas com base exclusivamente nos seus dados reais. Valide ações críticas com sua equipe.
        </p>
      </div>
    </div>
  )
}
