import { useState, useEffect } from 'react'
import type { Session } from '@supabase/supabase-js'
import { ArrowLeft, UserCheck, CheckCircle2 } from 'lucide-react'
import { useToast } from '../components/Toast'
import { API_URL } from '../lib/utils'

interface ClientNewProps {
  session: Session
  onCreated: () => void
}

export default function ClientNew({ session, onCreated }: ClientNewProps) {
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState<{ id: string } | null>(null)
  const { showToast } = useToast()

  const [form, setForm] = useState({
    business_name: '',
    email: '',
    phone: '',
    plan_slug: 'starter_mes'
  })

  // Os planos serão fixos para simplificar a demo, mas poderiam vir de API
  const plans = [
    { id: 'starter_mes', name: 'Starter — Mensal — R$ 99/mês' },
    { id: 'starter_ano', name: 'Starter — Anual — R$ 948' },
    { id: 'pro_mes', name: 'Pro — Mensal — R$ 149/mês' },
    { id: 'pro_ano', name: 'Pro — Anual — R$ 1.428' },
    { id: 'complete_mes', name: 'Complete — Mensal — R$ 239/mês' },
    { id: 'complete_ano', name: 'Complete — Anual — R$ 2.292' }
  ]

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)

    try {
      const res = await fetch(`${API_URL}/api/partner/clients`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`
        },
        body: JSON.stringify(form)
      })

      const data = await res.json()

      if (!res.ok) throw new Error(data.error || 'Erro ao cadastrar')

      setSuccess({ id: data.tenantId })
      showToast('Cliente cadastrado com sucesso!', 'success')
      
      // Limpa o form após cadastro com sucesso
      setForm({ business_name: '', email: '', phone: '', plan_slug: 'basic_tri' })

    } catch (err: any) {
      showToast(err.message, 'error')
    } finally {
      setLoading(false)
    }
  }

  if (success) {
    return (
      <div style={{ maxWidth: 600, margin: '60px auto', textAlign: 'center' }}>
        <div style={{ width: 80, height: 80, background: 'rgba(16,185,129,0.1)', color: '#34d399', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 24px' }}>
          <CheckCircle2 size={40} />
        </div>
        <h1 style={{ fontSize: 32, fontWeight: 800, marginBottom: 16 }}>Cliente Criado!</h1>
        <p style={{ color: 'var(--text-muted)', fontSize: 16, marginBottom: 32, lineHeight: 1.6 }}>
          O ambiente do cliente já está pronto para uso e o trial de 7 dias iniciou automaticamente.
        </p>
        <div style={{ display: 'flex', gap: 16, justifyContent: 'center' }}>
          <button className="btn btn-primary" onClick={() => onCreated()}>
            Ver Meus Clientes
          </button>
          <button className="btn" onClick={() => setSuccess(null)}>
            Cadastrar Novo
          </button>
        </div>
      </div>
    )
  }

  return (
    <div style={{ maxWidth: 800, margin: '0 auto' }}>
      <button className="btn" style={{ marginBottom: 24 }} onClick={onCreated}>
        <ArrowLeft size={16} /> Voltar
      </button>

      <div style={{ marginBottom: 32 }}>
        <h1 style={{ fontSize: 32, fontWeight: 800, margin: '0 0 8px 0' }}>Cadastrar Novo Cliente</h1>
        <p style={{ color: 'var(--text-muted)', margin: 0, fontSize: 16 }}>
          Preencha os dados básicos da empresa para provisionar o ambiente.
        </p>
      </div>

      <div style={{ background: 'var(--bg-darker)', border: '1px solid var(--border)', borderRadius: 16, padding: 32 }}>
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <label style={{ fontSize: 14, fontWeight: 600 }}>Nome da Empresa</label>
            <input 
              type="text" 
              required
              placeholder="Ex: Restaurante Sabor do Brasil"
              value={form.business_name}
              onChange={e => setForm({...form, business_name: e.target.value})}
              style={{ padding: '12px 16px', background: 'var(--bg-darkest)', border: '1px solid var(--border)', borderRadius: 12, color: 'var(--text-primary)', outline: 'none' }}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <label style={{ fontSize: 14, fontWeight: 600 }}>E-mail do Responsável</label>
              <input 
                type="email" 
                required
                placeholder="contato@empresa.com"
                value={form.email}
                onChange={e => setForm({...form, email: e.target.value})}
                style={{ padding: '12px 16px', background: 'var(--bg-darkest)', border: '1px solid var(--border)', borderRadius: 12, color: 'var(--text-primary)', outline: 'none' }}
              />
            </div>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <label style={{ fontSize: 14, fontWeight: 600 }}>Telefone (WhatsApp)</label>
              <input 
                type="text"
                placeholder="(00) 00000-0000"
                value={form.phone}
                onChange={e => setForm({...form, phone: e.target.value})}
                style={{ padding: '12px 16px', background: 'var(--bg-darkest)', border: '1px solid var(--border)', borderRadius: 12, color: 'var(--text-primary)', outline: 'none' }}
              />
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <label style={{ fontSize: 14, fontWeight: 600 }}>Plano Inicial</label>
            <select 
              value={form.plan_slug}
              onChange={e => setForm({...form, plan_slug: e.target.value})}
              style={{ padding: '12px 16px', background: 'var(--bg-darkest)', border: '1px solid var(--border)', borderRadius: 12, color: 'var(--text-primary)', outline: 'none', cursor: 'pointer' }}
            >
              {plans.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>O cliente iniciará com trial de 7 dias grátis antes da cobrança do plano escolhido.</p>
          </div>

          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 24, display: 'flex', justifyContent: 'flex-end', gap: 16 }}>
            <button type="button" className="btn" onClick={onCreated}>Cancelar</button>
            <button type="submit" className="btn btn-primary" disabled={loading} style={{ padding: '0 24px' }}>
              {loading ? 'Cadastrando...' : <><UserCheck size={18} /> Provisionar Ambiente</>}
            </button>
          </div>

        </form>
      </div>
    </div>
  )
}
