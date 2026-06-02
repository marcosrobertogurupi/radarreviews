import { useState } from 'react'
import { LifeBuoy, X, Send, MessageSquare } from 'lucide-react'
import { API_URL } from '../lib/utils'
import { supabase } from '../lib/supabase'

export default function SupportFloatingButton() {
  const [isOpen, setIsOpen] = useState(false)
  const [subject, setSubject] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)

  async function handleQuickSubmit() {
    if (!subject.trim()) return
    setLoading(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(`${API_URL}/api/support/tickets`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.access_token}`
        },
        body: JSON.stringify({ 
          subject: 'Dúvida Rápida', 
          description: subject,
          channel: 'portal_widget'
        })
      })
      if (res.ok) {
        setSent(true)
        setSubject('')
      }
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 9999 }}>
      {isOpen ? (
        <div style={{ 
          width: 320, background: 'var(--bg-base)', borderRadius: 16, 
          boxShadow: '0 10px 40px rgba(0,0,0,0.5)', border: '1px solid var(--border)',
          overflow: 'hidden', display: 'flex', flexDirection: 'column',
          animation: 'slideUp 0.3s ease-out'
        }}>
          <div style={{ padding: '16px 20px', background: 'linear-gradient(135deg, #6366f1, #06b6d4)', color: 'white', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <LifeBuoy size={18} />
              <span style={{ fontWeight: 700 }}>Suporte Reputei</span>
            </div>
            <button onClick={() => setIsOpen(false)} style={{ color: 'white', opacity: 0.8, background: 'none', border: 'none', cursor: 'pointer' }}>
              <X size={18} />
            </button>
          </div>

          <div style={{ padding: 20 }}>
            {sent ? (
              <div style={{ textAlign: 'center', padding: '20px 0' }}>
                <div style={{ color: '#10b981', marginBottom: 12 }}>✓ Solicitação enviada!</div>
                <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 20 }}>Nossa IA já está analisando seu caso. Você receberá uma notificação em breve.</p>
                <button className="btn btn-ghost" onClick={() => { setSent(false); setIsOpen(false); }}>Fechar</button>
              </div>
            ) : (
              <>
                <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 16 }}>Conte-nos brevemente o que aconteceu ou qual sua dúvida:</p>
                <textarea 
                  style={{ 
                    width: '100%', padding: 12, borderRadius: 12, background: 'var(--bg-darker)', 
                    border: '1px solid var(--border)', color: 'var(--text-primary)', fontSize: 13,
                    resize: 'none', marginBottom: 16, outline: 'none'
                  }}
                  rows={4}
                  placeholder="Ex: Não consigo gerar o relatório de reviews..."
                  value={subject}
                  onChange={e => setSubject(e.target.value)}
                />
                <button 
                  className="btn btn-primary" 
                  style={{ width: '100%', gap: 8 }}
                  disabled={loading || !subject.trim()}
                  onClick={handleQuickSubmit}
                >
                  <Send size={14} /> {loading ? 'Enviando...' : 'Enviar Mensagem'}
                </button>
                <div style={{ textAlign: 'center', marginTop: 16 }}>
                  <button 
                    style={{ fontSize: 11, color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}
                    onClick={() => { setIsOpen(false); window.dispatchEvent(new CustomEvent('navigate_support')); }}
                  >
                    Ver todos os meus chamados
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      ) : (
        <button 
          onClick={() => setIsOpen(true)}
          style={{ 
            width: 56, height: 56, borderRadius: '50%', background: 'var(--accent)', color: 'white',
            display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
            boxShadow: '0 8px 24px rgba(99,102,241,0.5)', border: 'none',
            transition: 'transform 0.2s'
          }}
          onMouseOver={e => e.currentTarget.style.transform = 'scale(1.1)'}
          onMouseOut={e => e.currentTarget.style.transform = 'scale(1)'}
        >
          <MessageSquare size={24} />
        </button>
      )}

      <style>{`
        @keyframes slideUp {
          from { transform: translateY(20px); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
      `}</style>
    </div>
  )
}
