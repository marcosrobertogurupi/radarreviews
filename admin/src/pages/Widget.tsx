import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Copy, RefreshCw, Eye, Code, Layout, Palette } from 'lucide-react'
import { API_URL } from '../lib/utils'
import type { TenantOption } from '../App'

interface Props {
  tenants: TenantOption[]
  selectedTenantId: string
  onTenantChange: (id: string) => void
}

export default function WidgetConfig({ tenants, selectedTenantId, onTenantChange }: Props) {
  const [tenant, setTenant] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (selectedTenantId) loadTenant()
    else setTenant(null)
  }, [selectedTenantId])

  async function loadTenant() {
    setLoading(true)
    const { data } = await supabase
      .from('tenants')
      .select('id, name, widget_token, widget_config')
      .eq('id', selectedTenantId)
      .single()
    setTenant(data)
    setLoading(false)
  }

  async function rotateToken() {
    if (!confirm('Deseja realmente gerar um novo token? O widget antigo parará de funcionar.')) return
    setLoading(true)
    const newToken = crypto.randomUUID()
    await supabase.from('tenants').update({ widget_token: newToken }).eq('id', selectedTenantId)
    await loadTenant()
  }

  const embedCode = tenant?.widget_token 
    ? `<script src="${API_URL}/widget.js" data-token="${tenant.widget_token}" data-theme="light" data-limit="5"></script>`
    : 'Selecione um assinante para gerar o código.'

  function copyCode() {
    navigator.clipboard.writeText(embedCode)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Widget de Reviews</h1>
        <p className="page-subtitle">Configure o selo de reputação para o site do assinante</p>
        
        <select
          value={selectedTenantId}
          onChange={e => onTenantChange(e.target.value)}
          style={{ marginTop: 15, padding: '8px 14px', background: 'var(--bg-darker)', border: '1px solid var(--border)', color: 'var(--text-primary)', borderRadius: 8, fontSize: 14, cursor: 'pointer', minWidth: 240 }}
        >
          <option value=''>Selecione um assinante...</option>
          {tenants.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </div>

      {!selectedTenantId ? (
        <div className="card empty-state">
          <div className="empty-state-icon">🧩</div>
          <div className="empty-state-text">Escolha um assinante acima para configurar o widget.</div>
        </div>
      ) : loading ? (
        <div className="skeleton" style={{ height: 300 }} />
      ) : (
        <div className="grid-2">
          {/* Configuração */}
          <div className="card" style={{ padding: 24 }}>
            <div className="section-title"><Palette size={18} /> Estilo & Configuração</div>
            
            <div style={{ marginBottom: 20 }}>
              <label style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>Tema Visual</label>
              <div style={{ display: 'flex', gap: 10 }}>
                <button className="btn active" style={{ flex: 1 }}>Claro</button>
                <button className="btn" style={{ flex: 1, opacity: 0.5 }}>Escuro (Breve)</button>
              </div>
            </div>

            <div style={{ marginBottom: 20 }}>
              <label style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>Limite de Reviews</label>
              <input type="number" defaultValue={5} className="filter-search" style={{ width: '100%' }} />
            </div>

            <div style={{ padding: 16, background: 'rgba(99,102,241,0.05)', borderRadius: 10, border: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <span style={{ fontSize: 12, fontWeight: 600 }}>Token de Segurança</span>
                <button className="btn-icon" title="Gerar novo token" onClick={rotateToken}><RefreshCw size={14} /></button>
              </div>
              <code style={{ fontSize: 11, color: 'var(--text-secondary)', wordBreak: 'break-all' }}>{tenant?.widget_token || '—'}</code>
            </div>
          </div>

          {/* Embed Code */}
          <div className="card" style={{ padding: 24 }}>
            <div className="section-title"><Code size={18} /> Código de Incorporação</div>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 16 }}>
              Copie e cole este código no final da tag <code>&lt;body&gt;</code> do site para exibir o widget.
            </p>

            <div style={{ position: 'relative' }}>
              <pre style={{ 
                background: '#070b14', padding: 20, borderRadius: 10, 
                fontSize: 12, color: '#a5b4fc', whiteSpace: 'pre-wrap', 
                border: '1px solid var(--border)', lineHeight: 1.6
              }}>
                {embedCode}
              </pre>
              <button 
                onClick={copyCode}
                style={{ 
                  position: 'absolute', top: 12, right: 12, 
                  background: copied ? '#10b981' : 'var(--accent)', color: 'white',
                  border: 'none', borderRadius: 6, padding: '6px 12px', fontSize: 11,
                  display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer'
                }}
              >
                {copied ? 'Copiado!' : <><Copy size={13} /> Copiar</>}
              </button>
            </div>

            <div style={{ marginTop: 24, padding: 16, border: '1px dashed var(--border)', borderRadius: 10, textAlign: 'center' }}>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}><Eye size={14} /> Pré-visualização Indisponível</div>
              <p style={{ fontSize: 11, color: 'var(--text-muted)' }}>O widget só carrega em domínios autorizados (Fase 4).</p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
