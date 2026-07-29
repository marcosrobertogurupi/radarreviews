import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { API_URL, CHANNEL_LABELS, CHANNEL_ICONS } from '../lib/utils'
import { Bot, Sparkles, Save, CheckCircle2, AlertCircle } from 'lucide-react'
import { useToast } from '../components/Toast'

interface Props {
  tenantId: string
}

export default function AutoReplySettings({ tenantId }: Props) {
  const { toast } = useToast()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [businessId, setBusinessId] = useState<string>('')

  const [enabled, setEnabled] = useState(false)
  const [mode, setMode] = useState<'autopilot' | 'copilot' | 'hybrid'>('hybrid')
  const [signature, setSignature] = useState('Gestor de Atendimento')
  const [toneOfVoice, setToneOfVoice] = useState('cordial, acolhedor e profissional')
  const [mentionStaff, setMentionStaff] = useState(true)
  const [minRating, setMinRating] = useState(4)
  const [customRules, setCustomRules] = useState('')
  const [selectedChannels, setSelectedChannels] = useState<string[]>([
    'google_maps',
    'tripadvisor',
    'facebook',
    'instagram',
    'reclame_aqui',
    'consumidor_gov',
    'trustpilot',
    'reddit',
  ])

  useEffect(() => {
    async function loadSettings() {
      setLoading(true)
      try {
        // Busca a primeira empresa monitorada do tenant
        const { data: business } = await supabase
          .from('monitored_businesses')
          .select('id, auto_reply_settings')
          .eq('tenant_id', tenantId)
          .limit(1)
          .single()

        if (business) {
          setBusinessId(business.id)
          const cfg = business.auto_reply_settings || {}
          setEnabled(cfg.enabled ?? false)
          setMode(cfg.mode ?? 'hybrid')
          setSignature(cfg.signature ?? 'Gestor de Atendimento')
          setToneOfVoice(cfg.tone_of_voice ?? 'cordial, acolhedor e profissional')
          setMentionStaff(cfg.mention_staff_names ?? true)
          setMinRating(cfg.auto_publish_min_rating ?? 4)
          setCustomRules(cfg.custom_rules ?? '')
          if (Array.isArray(cfg.channels)) setSelectedChannels(cfg.channels)
        }
      } catch (err) {
        console.error('Erro ao carregar configurações de auto-resposta:', err)
      }
      setLoading(false)
    }

    if (tenantId) loadSettings()
  }, [tenantId])

  async function handleSave() {
    if (!businessId) return
    setSaving(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token

      const payload = {
        business_id: businessId,
        settings: {
          enabled,
          mode,
          signature,
          tone_of_voice: toneOfVoice,
          mention_staff_names: mentionStaff,
          auto_publish_min_rating: minRating,
          custom_rules: customRules,
          channels: selectedChannels,
        },
      }

      const res = await fetch(`${API_URL}/api/auto-reply/settings`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(payload),
      })

      const json = await res.json()
      if (json.success) {
        toast('Configurações de Auto-Resposta por IA salvas com sucesso!', 'success')
      } else {
        toast(`Erro ao salvar: ${json.error}`, 'error')
      }
    } catch {
      toast('Erro de conexão ao salvar configurações.', 'error')
    }
    setSaving(false)
  }

  function toggleChannel(ch: string) {
    setSelectedChannels(prev =>
      prev.includes(ch) ? prev.filter(c => c !== ch) : [...prev, ch]
    )
  }

  if (loading) {
    return (
      <div className="card" style={{ padding: '40px', textAlign: 'center' }}>
        <p>Carregando configurações de IA...</p>
      </div>
    )
  }

  return (
    <div style={{ maxWidth: '900px', margin: '0 auto' }}>
      <div className="page-header" style={{ marginBottom: '24px' }}>
        <div>
          <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <Bot className="text-primary" size={28} /> Resposta Autônoma por IA (Todos os Canais)
          </h1>
          <p className="page-subtitle">
            Configure a inteligência artificial para responder automaticamente suas avaliações, citar colaboradores elogiados e aprender com o estilo da sua marca.
          </p>
        </div>
      </div>

      <div className="card" style={{ padding: '24px', marginBottom: '24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <div>
            <h3 style={{ fontSize: '1.1rem', fontWeight: 600, margin: 0 }}>Ativar Resposta Autônoma</h3>
            <p style={{ fontSize: '0.875rem', color: '#6b7280', margin: '4px 0 0' }}>
              Permite que a IA gere e envie respostas aos clientes nos canais conectados.
            </p>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={enabled}
              onChange={e => setEnabled(e.target.checked)}
              style={{ width: '20px', height: '20px', accentColor: '#4f46e5' }}
            />
          </label>
        </div>

        {enabled && (
          <>
            <hr style={{ border: 'none', borderTop: '1px solid #e5e7eb', margin: '20px 0' }} />

            {/* Modo de Execução */}
            <div style={{ marginBottom: '24px' }}>
              <label style={{ fontWeight: 600, display: 'block', marginBottom: '8px' }}>Modo de Execução</label>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '12px' }}>
                <div
                  onClick={() => setMode('hybrid')}
                  style={{
                    padding: '16px',
                    borderRadius: '8px',
                    border: mode === 'hybrid' ? '2px solid #4f46e5' : '1px solid #e5e7eb',
                    backgroundColor: mode === 'hybrid' ? '#f5f3ff' : '#fff',
                    cursor: 'pointer',
                  }}
                >
                  <strong style={{ display: 'block', color: '#1e1b4b' }}>🛡️ Híbrido (Recomendado)</strong>
                  <span style={{ fontSize: '0.8rem', color: '#4b5563' }}>
                    Posta 100% automático em avaliações de 4 a 5 estrelas. Solicita aprovação em 1 clique para neutros/negativos.
                  </span>
                </div>

                <div
                  onClick={() => setMode('copilot')}
                  style={{
                    padding: '16px',
                    borderRadius: '8px',
                    border: mode === 'copilot' ? '2px solid #4f46e5' : '1px solid #e5e7eb',
                    backgroundColor: mode === 'copilot' ? '#f5f3ff' : '#fff',
                    cursor: 'pointer',
                  }}
                >
                  <strong style={{ display: 'block', color: '#1e1b4b' }}>✍️ Co-Piloto (Aprovação em 1 Clique)</strong>
                  <span style={{ fontSize: '0.8rem', color: '#4b5563' }}>
                    A IA gera o rascunho de todos os reviews e aguarda sua aprovação rápida antes de publicar.
                  </span>
                </div>

                <div
                  onClick={() => setMode('autopilot')}
                  style={{
                    padding: '16px',
                    borderRadius: '8px',
                    border: mode === 'autopilot' ? '2px solid #4f46e5' : '1px solid #e5e7eb',
                    backgroundColor: mode === 'autopilot' ? '#f5f3ff' : '#fff',
                    cursor: 'pointer',
                  }}
                >
                  <strong style={{ display: 'block', color: '#1e1b4b' }}>⚡ Autopiloto Total</strong>
                  <span style={{ fontSize: '0.8rem', color: '#4b5563' }}>
                    A IA responde e publica automaticamente todas as avaliações sem interrupção humana.
                  </span>
                </div>
              </div>
            </div>

            {/* Persona e Assinatura */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '20px' }}>
              <div>
                <label style={{ fontWeight: 600, display: 'block', marginBottom: '6px' }}>Assinatura Oficial</label>
                <input
                  type="text"
                  className="input"
                  value={signature}
                  onChange={e => setSignature(e.target.value)}
                  placeholder="Ex: Gestor de Experiência, recepção ou Gerência"
                  style={{ width: '100%' }}
                />
              </div>

              <div>
                <label style={{ fontWeight: 600, display: 'block', marginBottom: '6px' }}>Tom de Voz da Marca</label>
                <input
                  type="text"
                  className="input"
                  value={toneOfVoice}
                  onChange={e => setToneOfVoice(e.target.value)}
                  placeholder="Ex: Cordial, acolhedor, formal e atencioso"
                  style={{ width: '100%' }}
                />
              </div>
            </div>

            {/* Mencionador de Colaboradores e Regras */}
            <div style={{ marginBottom: '20px' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontWeight: 600 }}>
                <input
                  type="checkbox"
                  checked={mentionStaff}
                  onChange={e => setMentionStaff(e.target.checked)}
                />
                Mencionar nomes de colaboradores elogiados nos reviews (ex: Karine, Sueli, Marcos)
              </label>
            </div>

            <div style={{ marginBottom: '20px' }}>
              <label style={{ fontWeight: 600, display: 'block', marginBottom: '6px' }}>Regras Personalizadas de Atendimento</label>
              <textarea
                className="input"
                rows={3}
                value={customRules}
                onChange={e => setCustomRules(e.target.value)}
                placeholder="Ex: Sempre convidar clientes satisfeitos para o nosso brunch de sábado. Nunca prometer reembolso sem autorização."
                style={{ width: '100%', resize: 'vertical' }}
              />
            </div>

            {/* Canais Selecionados */}
            <div style={{ marginBottom: '24px' }}>
              <label style={{ fontWeight: 600, display: 'block', marginBottom: '8px' }}>Canais Habilitados para Auto-Resposta</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
                {(['google_maps', 'tripadvisor', 'facebook', 'instagram', 'reclame_aqui', 'consumidor_gov', 'trustpilot', 'reddit'] as const).map(ch => {
                  const isSel = selectedChannels.includes(ch)
                  return (
                    <button
                      key={ch}
                      type="button"
                      onClick={() => toggleChannel(ch)}
                      style={{
                        padding: '8px 14px',
                        borderRadius: '20px',
                        border: isSel ? '1px solid #4f46e5' : '1px solid #d1d5db',
                        backgroundColor: isSel ? '#4f46e5' : '#f9fafb',
                        color: isSel ? '#fff' : '#374151',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        fontSize: '0.85rem',
                      }}
                    >
                      {CHANNEL_ICONS[ch]} {CHANNEL_LABELS[ch]}
                    </button>
                  )
                })}
              </div>
            </div>
          </>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '20px' }}>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Save size={16} /> {saving ? 'Salvando...' : 'Salvar Configurações'}
          </button>
        </div>
      </div>
    </div>
  )
}
