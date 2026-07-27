import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Copy, RefreshCw, Eye, Code, Palette, Save, Loader2, Star, ShieldCheck, Sparkles, Check } from 'lucide-react'
import { API_URL } from '../lib/utils'
import { useToast } from '../components/Toast'

interface Props {
  tenantId: string
}

export default function Widget({ tenantId }: Props) {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [rotating, setRotating] = useState(false)
  const [copied, setCopied] = useState(false)
  const { toast } = useToast()

  const [widgetToken, setWidgetToken] = useState('')
  const [businessName, setBusinessName] = useState('Sua Empresa')
  const [theme, setTheme] = useState<'light' | 'dark'>('light')
  const [limit, setLimit] = useState<number>(5)
  const [showScore, setShowScore] = useState<boolean>(true)
  const [showChannel, setShowChannel] = useState<boolean>(true)
  const [sampleReviews, setSampleReviews] = useState<any[]>([])

  useEffect(() => {
    loadWidgetConfig()
  }, [tenantId])

  async function loadWidgetConfig() {
    setLoading(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (session) {
        const res = await fetch(`${API_URL}/api/portal/widget`, {
          headers: { Authorization: `Bearer ${session.access_token}` }
        })
        if (res.ok) {
          const data = await res.json()
          setWidgetToken(data.widget_token || '')
          setBusinessName(data.business_name || 'Sua Empresa')
          if (data.widget_config) {
            setTheme(data.widget_config.theme || 'light')
            setLimit(data.widget_config.limit || 5)
            setShowScore(data.widget_config.show_score !== false)
            setShowChannel(data.widget_config.show_channel !== false)
          }
          if (data.sample_reviews?.length) {
            setSampleReviews(data.sample_reviews)
          }
          setLoading(false)
          return
        }
      }
    } catch (e) {
      console.warn('[Widget] Erro ao carregar via API, tentando fallback direct:', e)
    }

    // Fallback direct query
    try {
      const { data: t } = await supabase
        .from('tenants')
        .select('id, name, widget_token, widget_config')
        .eq('id', tenantId)
        .single()

      if (t) {
        setBusinessName(t.name || 'Sua Empresa')
        setWidgetToken(t.widget_token || '')
        if (t.widget_config) {
          setTheme(t.widget_config.theme || 'light')
          setLimit(t.widget_config.limit || 5)
          setShowScore(t.widget_config.show_score !== false)
          setShowChannel(t.widget_config.show_channel !== false)
        }
      }
    } catch (err) {
      console.error('[Widget] Erro no fallback direct:', err)
    } finally {
      setLoading(false)
    }
  }

  async function handleRotateToken() {
    if (!confirm('Deseja realmente gerar um novo token de segurança? O código antigo deixará de carregar até ser atualizado no seu site.')) {
      return
    }
    setRotating(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (session) {
        const res = await fetch(`${API_URL}/api/portal/widget/rotate`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${session.access_token}` }
        })
        if (res.ok) {
          const data = await res.json()
          setWidgetToken(data.widget_token)
          toast('Novo token de segurança gerado com sucesso!', 'success')
          setRotating(false)
          return
        }
      }
      throw new Error('Falha ao atualizar token via servidor')
    } catch (e: any) {
      toast(e.message || 'Erro ao gerar novo token', 'error')
    } finally {
      setRotating(false)
    }
  }

  async function handleSaveConfig() {
    setSaving(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (session) {
        const res = await fetch(`${API_URL}/api/portal/widget/config`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`
          },
          body: JSON.stringify({
            theme,
            limit: Number(limit),
            show_score: showScore,
            show_channel: showChannel
          })
        })
        if (res.ok) {
          toast('Configurações do widget salvas com sucesso!', 'success')
          setSaving(false)
          return
        }
      }
      throw new Error('Erro ao salvar no servidor')
    } catch (e: any) {
      toast(e.message || 'Erro ao salvar configurações', 'error')
    } finally {
      setSaving(false)
    }
  }

  const embedCode = widgetToken 
    ? `<div id="reputei-widget" data-token="${widgetToken}"></div>\n<script src="${API_URL}/widget.js" async></script>`
    : 'Gerando token de segurança...'

  function copyCode() {
    if (!widgetToken) return
    navigator.clipboard.writeText(embedCode)
    setCopied(true)
    toast('Código de incorporação copiado com sucesso!', 'success')
    setTimeout(() => setCopied(false), 2000)
  }

  // Prepara amostras para o live preview interativo
  const displayReviews = sampleReviews.length > 0 ? sampleReviews.slice(0, limit) : [
    { author_name: 'Ana Paula Silva', rating: 5, body: 'Atendimento excelente! Resolveram tudo com muita agilidade e cordialidade.', channel: 'google_maps' },
    { author_name: 'Carlos Eduardo', rating: 5, body: 'Produtos de altíssima qualidade. Recomendo de olhos fechados!', channel: 'trustpilot' },
    { author_name: 'Mariana Costa', rating: 5, body: 'Experiência impecável do início ao fim. Muito satisfeita com o serviço.', channel: 'reclame_aqui' }
  ].slice(0, limit)

  return (
    <div className="page-container" style={{ padding: '24px 32px' }}>
      <div className="page-header" style={{ marginBottom: 28 }}>
        <h1 className="page-title" style={{ fontSize: 24, fontWeight: 800, color: 'var(--text-primary)' }}>Widget de Reviews</h1>
        <p className="page-subtitle" style={{ fontSize: 14, color: 'var(--text-muted)' }}>
          Configure e incorpore o selo oficial de reputação no seu site
        </p>
      </div>

      {loading ? (
        <div className="skeleton" style={{ height: 320, background: 'var(--bg-darker, #0e1017)', borderRadius: 16 }} />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.2fr', gap: 24, alignItems: 'start' }}>
          
          {/* Coluna 1: Estilo & Configuração */}
          <div className="card" style={{ padding: 24, background: 'var(--bg-card)', borderRadius: 16, border: '1px solid var(--border)' }}>
            <div className="section-title" style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 24, fontSize: 16, fontWeight: 700 }}>
              <div style={{ width: 32, height: 32, borderRadius: 8, background: 'rgba(99,102,241,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent, #6366f1)' }}>
                <Palette size={18} />
              </div>
              Estilo & Configuração
            </div>
            
            {/* Tema Visual */}
            <div style={{ marginBottom: 20 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Tema Visual
              </label>
              <div style={{ display: 'flex', gap: 10 }}>
                <button 
                  type="button"
                  onClick={() => setTheme('light')} 
                  style={{
                    flex: 1, padding: '10px 14px', borderRadius: 10, fontSize: 13, fontWeight: 700,
                    cursor: 'pointer', transition: 'all 0.2s',
                    background: theme === 'light' ? 'var(--accent, #6366f1)' : 'var(--bg-darker, #090a10)',
                    color: theme === 'light' ? '#ffffff' : 'var(--text-muted)',
                    border: `1px solid ${theme === 'light' ? 'var(--accent)' : 'var(--border)'}`
                  }}
                >
                  ☀️ Claro
                </button>
                <button 
                  type="button"
                  onClick={() => setTheme('dark')} 
                  style={{
                    flex: 1, padding: '10px 14px', borderRadius: 10, fontSize: 13, fontWeight: 700,
                    cursor: 'pointer', transition: 'all 0.2s',
                    background: theme === 'dark' ? 'var(--accent, #6366f1)' : 'var(--bg-darker, #090a10)',
                    color: theme === 'dark' ? '#ffffff' : 'var(--text-muted)',
                    border: `1px solid ${theme === 'dark' ? 'var(--accent)' : 'var(--border)'}`
                  }}
                >
                  🌙 Escuro
                </button>
              </div>
            </div>

            {/* Limite de Reviews */}
            <div style={{ marginBottom: 20 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Limite de Reviews Exibidos
              </label>
              <select 
                value={limit} 
                onChange={e => setLimit(Number(e.target.value))}
                style={{ 
                  width: '100%', background: 'var(--bg-darker, #090a10)', 
                  border: '1px solid var(--border)', borderRadius: 10, 
                  padding: '10px 14px', color: 'var(--text-primary)',
                  fontSize: 14, outline: 'none', cursor: 'pointer'
                }}
              >
                <option value={3}>3 Reviews</option>
                <option value={5}>5 Reviews (Recomendado)</option>
                <option value={8}>8 Reviews</option>
                <option value={10}>10 Reviews</option>
              </select>
            </div>

            {/* Opções de Exibição */}
            <div style={{ marginBottom: 24, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontSize: 13, color: 'var(--text-primary)' }}>
                <input 
                  type="checkbox" 
                  checked={showScore} 
                  onChange={e => setShowScore(e.target.checked)}
                  style={{ width: 16, height: 16, accentColor: 'var(--accent)' }}
                />
                Exibir avaliação por estrelas (5.0 ★)
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontSize: 13, color: 'var(--text-primary)' }}>
                <input 
                  type="checkbox" 
                  checked={showChannel} 
                  onChange={e => setShowChannel(e.target.checked)}
                  style={{ width: 16, height: 16, accentColor: 'var(--accent)' }}
                />
                Exibir identificador do canal (Google, Trustpilot, etc.)
              </label>
            </div>

            {/* Token de Segurança */}
            <div style={{ padding: 18, background: 'rgba(99,102,241,0.06)', borderRadius: 12, border: '1px solid rgba(99,102,241,0.2)', marginBottom: 24 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <ShieldCheck size={15} color="var(--accent)" /> Token de Segurança
                </span>
                <button 
                  className="btn-icon" 
                  title="Gerar novo token de segurança" 
                  onClick={handleRotateToken}
                  disabled={rotating}
                  style={{ 
                    background: 'none', border: 'none', cursor: 'pointer', 
                    color: 'var(--accent)', display: 'flex', alignItems: 'center', gap: 4,
                    fontSize: 12, fontWeight: 600
                  }}
                >
                  <RefreshCw size={14} style={{ animation: rotating ? 'spin 1s linear infinite' : 'none' }} />
                  Atualizar Token
                </button>
              </div>
              <code style={{ 
                fontSize: 11, color: '#a5b4fc', wordBreak: 'break-all', 
                fontFamily: 'monospace', display: 'block', background: 'rgba(0,0,0,0.3)',
                padding: '8px 12px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.05)'
              }}>
                {widgetToken || 'Gerando token...'}
              </code>
            </div>

            {/* Botão Salvar Alterações */}
            <button 
              onClick={handleSaveConfig}
              disabled={saving}
              className="btn btn-primary" 
              style={{ width: '100%', padding: '12px', fontWeight: 700, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
            >
              {saving ? <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> : <Save size={16} />}
              {saving ? 'Salvando...' : 'Salvar Alterações'}
            </button>
          </div>

          {/* Coluna 2: Código de Incorporação & Pré-visualização ao vivo */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
            
            {/* Embed Code Card */}
            <div className="card" style={{ padding: 24, background: 'var(--bg-card)', borderRadius: 16, border: '1px solid var(--border)' }}>
              <div className="section-title" style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, fontSize: 16, fontWeight: 700 }}>
                <div style={{ width: 32, height: 32, borderRadius: 8, background: 'rgba(99,102,241,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent, #6366f1)' }}>
                  <Code size={18} />
                </div>
                Código de Incorporação
              </div>
              <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 16, lineHeight: 1.5 }}>
                Copie o script abaixo e cole no local desejado do seu site (HTML, WordPress, Wix, Shopify):
              </p>

              <div style={{ position: 'relative' }}>
                <pre style={{ 
                  background: '#070b14', padding: 18, borderRadius: 12, 
                  fontSize: 12, color: '#a5b4fc', whiteSpace: 'pre-wrap', 
                  border: '1px solid var(--border)', lineHeight: 1.6,
                  fontFamily: 'monospace', overflowX: 'auto'
                }}>
                  {embedCode}
                </pre>
                <button 
                  onClick={copyCode}
                  disabled={!widgetToken}
                  style={{ 
                    position: 'absolute', top: 12, right: 12, 
                    background: copied ? '#10b981' : 'var(--accent)', color: 'white',
                    border: 'none', borderRadius: 8, padding: '7px 14px', fontSize: 12,
                    display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer',
                    fontWeight: 700, boxShadow: '0 2px 8px rgba(0,0,0,0.2)'
                  }}
                >
                  {copied ? <><Check size={14} /> Copiado!</> : <><Copy size={14} /> Copiar Código</>}
                </button>
              </div>
            </div>

            {/* Pré-visualização Interativa ao vivo */}
            <div className="card" style={{ padding: 24, background: 'var(--bg-card)', borderRadius: 16, border: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>
                  <Eye size={16} color="var(--accent)" /> Pré-visualização ao vivo
                </div>
                <span style={{ fontSize: 11, padding: '4px 10px', borderRadius: 20, background: 'rgba(16,185,129,0.12)', color: '#10b981', border: '1px solid rgba(16,185,129,0.2)', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 4 }}>
                  <Sparkles size={12} /> Atualização em Tempo Real
                </span>
              </div>

              {/* Simulação visual do Widget na página */}
              <div style={{ 
                background: theme === 'dark' ? '#111827' : '#f8fafc', 
                border: `1px solid ${theme === 'dark' ? '#374151' : '#e2e8f0'}`, 
                borderRadius: 14, padding: 20, 
                boxShadow: '0 4px 14px rgba(0,0,0,0.1)',
                transition: 'all 0.3s ease'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, borderBottom: `1px solid ${theme === 'dark' ? '#374151' : '#e2e8f0'}`, paddingBottom: 12 }}>
                  <div style={{ fontWeight: 700, color: theme === 'dark' ? '#f9fafb' : '#111827', fontSize: 15 }}>
                    O que dizem sobre {businessName}
                  </div>
                  <div style={{ fontSize: 12, color: '#10b981', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 4 }}>
                    ✓ Selo Verificado
                  </div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  {displayReviews.map((rev, idx) => (
                    <div key={idx} style={{ 
                      paddingBottom: idx === displayReviews.length - 1 ? 0 : 14, 
                      borderBottom: idx === displayReviews.length - 1 ? 'none' : `1px solid ${theme === 'dark' ? '#374151' : '#f1f5f9'}`
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                        <span style={{ fontWeight: 600, fontSize: 13, color: theme === 'dark' ? '#f3f4fb' : '#374151' }}>
                          {rev.author_name || 'Cliente'}
                        </span>
                        {showChannel && rev.channel && (
                          <span style={{ fontSize: 10, opacity: 0.75, padding: '2px 6px', background: theme === 'dark' ? 'rgba(255,255,255,0.1)' : '#e2e8f0', color: theme === 'dark' ? '#cbd5e1' : '#475569', borderRadius: 4 }}>
                            {rev.channel}
                          </span>
                        )}
                      </div>
                      {showScore && (
                        <div style={{ color: '#f59e0b', fontSize: 12, letterSpacing: 1, marginBottom: 4 }}>
                          {'★'.repeat(rev.rating || 5)}{'☆'.repeat(5 - (rev.rating || 5))}
                        </div>
                      )}
                      <p style={{ fontSize: 12.5, color: theme === 'dark' ? '#9ca3af' : '#4b5563', lineHeight: 1.5, fontStyle: 'italic', margin: 0 }}>
                        "{rev.body}"
                      </p>
                    </div>
                  ))}
                </div>

                <div style={{ fontSize: 11, color: '#9ca3af', textAlign: 'center', marginTop: 16, paddingTop: 10, borderTop: `1px dashed ${theme === 'dark' ? '#374151' : '#e2e8f0'}` }}>
                  Monitorado por <strong style={{ color: 'var(--accent, #6366f1)' }}>Reputei</strong>
                </div>
              </div>
            </div>

          </div>
        </div>
      )}
    </div>
  )
}
