import { useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { User, Building, Mail, Phone, Shield, Save } from 'lucide-react'

interface ProfileProps {
  session: Session
  partner: any
}

export default function Profile({ session, partner }: ProfileProps) {
  // In a real app we'd fetch the full partner data or have it passed
  const [form, setForm] = useState({
    name: partner.partner_name || '',
    company_name: '',
    phone: '',
    pix_key: '', // This would be fetched from a secure table/vault
  })
  
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    // Simulate save
    setTimeout(() => {
      setLoading(false)
      alert('Perfil salvo com sucesso!')
    }, 800)
  }

  return (
    <div style={{ maxWidth: 800, margin: '0 auto' }}>
      <div style={{ marginBottom: 32 }}>
        <h1 style={{ fontSize: 32, fontWeight: 800, margin: '0 0 8px 0' }}>Meu Perfil</h1>
        <p style={{ color: 'var(--text-muted)', margin: 0, fontSize: 16 }}>
          Gerencie seus dados e informações para pagamento.
        </p>
      </div>

      <div style={{ display: 'grid', gap: 32 }}>
        <div style={{ background: 'var(--bg-darker)', border: '1px solid var(--border)', borderRadius: 16, padding: 32 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24, borderBottom: '1px solid var(--border)', paddingBottom: 16 }}>
            <div style={{ width: 40, height: 40, borderRadius: 12, background: 'rgba(99,102,241,0.1)', color: '#818cf8', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <User size={20} />
            </div>
            <h2 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>Dados Pessoais</h2>
          </div>

          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <label style={{ fontSize: 14, fontWeight: 600 }}>Nome Completo</label>
                <div style={{ position: 'relative' }}>
                  <User size={16} style={{ position: 'absolute', left: 16, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                  <input 
                    type="text" 
                    value={form.name}
                    onChange={e => setForm({...form, name: e.target.value})}
                    style={{ width: '100%', padding: '12px 16px 12px 44px', background: 'var(--bg-darkest)', border: '1px solid var(--border)', borderRadius: 12, color: 'var(--text-primary)', outline: 'none' }}
                  />
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <label style={{ fontSize: 14, fontWeight: 600 }}>E-mail (Login)</label>
                <div style={{ position: 'relative' }}>
                  <Mail size={16} style={{ position: 'absolute', left: 16, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                  <input 
                    type="email" 
                    disabled
                    value={session.user.email}
                    style={{ width: '100%', padding: '12px 16px 12px 44px', background: 'var(--bg-darkest)', border: '1px solid var(--border)', borderRadius: 12, color: 'var(--text-muted)', outline: 'none', cursor: 'not-allowed', opacity: 0.7 }}
                  />
                </div>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <label style={{ fontSize: 14, fontWeight: 600 }}>Empresa (Opcional)</label>
                <div style={{ position: 'relative' }}>
                  <Building size={16} style={{ position: 'absolute', left: 16, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                  <input 
                    type="text" 
                    value={form.company_name}
                    onChange={e => setForm({...form, company_name: e.target.value})}
                    style={{ width: '100%', padding: '12px 16px 12px 44px', background: 'var(--bg-darkest)', border: '1px solid var(--border)', borderRadius: 12, color: 'var(--text-primary)', outline: 'none' }}
                  />
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <label style={{ fontSize: 14, fontWeight: 600 }}>Telefone</label>
                <div style={{ position: 'relative' }}>
                  <Phone size={16} style={{ position: 'absolute', left: 16, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                  <input 
                    type="text" 
                    value={form.phone}
                    onChange={e => setForm({...form, phone: e.target.value})}
                    style={{ width: '100%', padding: '12px 16px 12px 44px', background: 'var(--bg-darkest)', border: '1px solid var(--border)', borderRadius: 12, color: 'var(--text-primary)', outline: 'none' }}
                  />
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
              <button type="submit" className="btn btn-primary" disabled={loading} style={{ padding: '0 24px' }}>
                {loading ? 'Salvando...' : <><Save size={16} /> Salvar Alterações</>}
              </button>
            </div>
          </form>
        </div>

        <div style={{ background: 'var(--bg-darker)', border: '1px solid var(--border)', borderRadius: 16, padding: 32 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24, borderBottom: '1px solid var(--border)', paddingBottom: 16 }}>
            <div style={{ width: 40, height: 40, borderRadius: 12, background: 'rgba(16,185,129,0.1)', color: '#34d399', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Shield size={20} />
            </div>
            <h2 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>Dados para Pagamento</h2>
          </div>

          <div style={{ padding: 24, background: 'var(--bg-darkest)', borderRadius: 12, border: '1px dashed var(--border)' }}>
            <p style={{ margin: '0 0 16px 0', color: 'var(--text-muted)' }}>
              Para receber suas comissões, informe sua chave PIX vinculada ao mesmo CPF/CNPJ de cadastro.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 400 }}>
              <label style={{ fontSize: 14, fontWeight: 600 }}>Chave PIX</label>
              <input 
                type="text" 
                placeholder="E-mail, CPF, CNPJ ou Telefone"
                value={form.pix_key}
                onChange={e => setForm({...form, pix_key: e.target.value})}
                style={{ padding: '12px 16px', background: '#090a0f', border: '1px solid var(--border)', borderRadius: 12, color: 'var(--text-primary)', outline: 'none' }}
              />
              <button className="btn" style={{ alignSelf: 'flex-start', marginTop: 8 }} onClick={handleSubmit}>
                Atualizar PIX
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
