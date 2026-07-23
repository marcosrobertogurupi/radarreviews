import { useState, useEffect } from 'react'
import type { Session } from '@supabase/supabase-js'
import { Plus, Search, Building, MoreVertical, Calendar } from 'lucide-react'
import { API_URL } from '../lib/utils'

interface ClientsProps {
  session: Session
}

export default function Clients({ session }: ClientsProps) {
  const [clients, setClients] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  useEffect(() => {
    fetch(`${API_URL}/api/partner/clients`, {
      headers: { 'Authorization': `Bearer ${session.access_token}` }
    })
    .then(r => r.json())
    .then(data => {
      if (data.ok) setClients(data.clients)
      setLoading(false)
    })
    .catch(() => setLoading(false))
  }, [session])

  const filtered = clients.filter(c => 
    c.name.toLowerCase().includes(search.toLowerCase()) || 
    (c.slug && c.slug.toLowerCase().includes(search.toLowerCase()))
  )

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 32 }}>
        <div>
          <h1 style={{ fontSize: 32, fontWeight: 800, margin: '0 0 8px 0' }}>Meus Clientes</h1>
          <p style={{ color: 'var(--text-muted)', margin: 0, fontSize: 16 }}>
            Gerencie as contas das empresas que você indicou.
          </p>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 16, marginBottom: 24 }}>
        <div style={{ position: 'relative', flex: 1, maxWidth: 400 }}>
          <Search size={18} style={{ position: 'absolute', left: 16, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input 
            type="text" 
            placeholder="Buscar por nome..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ 
              width: '100%', padding: '12px 16px 12px 48px', 
              background: 'var(--bg-darker)', border: '1px solid var(--border)', 
              borderRadius: 12, color: 'var(--text-primary)', outline: 'none' 
            }}
          />
        </div>
      </div>

      {loading ? (
        <div style={{ padding: 60, textAlign: 'center', color: 'var(--text-muted)' }}>Carregando clientes...</div>
      ) : filtered.length === 0 ? (
        <div style={{ padding: 60, textAlign: 'center', color: 'var(--text-muted)', background: 'var(--bg-darker)', borderRadius: 16, border: '1px solid var(--border)' }}>
          {search ? 'Nenhum cliente encontrado para essa busca.' : 'Você ainda não possui clientes indicados.'}
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(350px, 1fr))', gap: 20 }}>
          {filtered.map(c => (
            <div key={c.id} style={{ background: 'var(--bg-darker)', border: '1px solid var(--border)', borderRadius: 16, padding: 24, position: 'relative' }}>
              <button style={{ position: 'absolute', top: 20, right: 20, background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}>
                <MoreVertical size={20} />
              </button>

              <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20 }}>
                <div style={{ width: 48, height: 48, borderRadius: 12, background: 'var(--bg-darkest)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-primary)' }}>
                  <Building size={24} />
                </div>
                <div>
                  <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>{c.name}</h3>
                  <div style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 4 }}>
                    {c.slug}.reputei.com.br
                  </div>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20, padding: '16px', background: 'var(--bg-darkest)', borderRadius: 12 }}>
                <div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600, marginBottom: 4 }}>Plano</div>
                  <div style={{ fontSize: 14, fontWeight: 600, textTransform: 'capitalize' }}>{c.plan || 'N/A'}</div>
                </div>
                <div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600, marginBottom: 4 }}>Status</div>
                  <div style={{ 
                    display: 'inline-block', padding: '2px 8px', borderRadius: 12, fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
                    background: !c.is_active ? 'rgba(239,68,68,0.1)' : c.plan_status === 'trial' ? 'rgba(245,158,11,0.1)' : 'rgba(16,185,129,0.1)',
                    color: !c.is_active ? '#fca5a5' : c.plan_status === 'trial' ? '#fbbf24' : '#34d399'
                  }}>
                    {!c.is_active ? 'Inativo' : c.plan_status === 'trial' ? 'Trial' : 'Ativo'}
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text-muted)' }}>
                <Calendar size={14} />
                Criado em {new Date(c.created_at).toLocaleDateString('pt-BR')}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
