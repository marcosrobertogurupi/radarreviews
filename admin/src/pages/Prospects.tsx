import React, { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import {
  Target, Users, Send, CheckCircle, AlertOctagon, HelpCircle,
  Play, Check, Edit3, Trash2, Mail, MessageSquare, ExternalLink, Loader2, ArrowRight
} from 'lucide-react'

interface Campaign {
  id: string
  slug: string
  name: string
  description?: string
  total_leads: number
  is_active: boolean
  created_at: string
}

interface Lead {
  id: string
  campaign_id: string
  segment_id: string
  company_name: string
  contact_name?: string
  phone?: string
  email?: string
  city?: string
  target_role?: string
  variables: Record<string, any>
  status: 'new' | 'contacted' | 'responded' | 'converted' | 'failed'
  created_at: string
}

interface Followup {
  id: string
  lead_id: string
  channel: 'email' | 'whatsapp'
  step: number
  scheduled_at: string
  status: 'pending' | 'sent' | 'failed' | 'canceled'
  sent_at?: string
  error_message?: string
  prospect_leads: Lead
}

const SEGMENT_NAMES: Record<string, { label: string; priority: 'alta' | 'media'; tips: string[] }> = {
  seg_plano_saude: {
    label: 'Plano de Saúde',
    priority: 'alta',
    tips: [
      'Mencionar "portabilidade" aumenta a urgência — beneficiário pesquisa antes de migrar.',
      'Melhor horário de disparo WhatsApp: terças e quintas, entre 9h e 11h.'
    ]
  },
  seg_imobi: {
    label: 'Imobiliária / Construtora',
    priority: 'alta',
    tips: [
      'Para construtoras: citar "período de entrega de chaves" aumenta o engajamento.',
      'Aborde o sócio ou diretor — gerentes operacionais raramente tomam decisão.'
    ]
  },
  seg_edu: {
    label: 'Educação (IES / cursos)',
    priority: 'alta',
    tips: [
      'Melhor período de abordagem: 2 meses antes do vestibular/matrícula (jan/fev e jun/jul).',
      'Mencionar "taxa de conversão de matrículas" ressoa bem.'
    ]
  },
  seg_hotel: {
    label: 'Hotelaria / Turismo',
    priority: 'media',
    tips: [
      'Hotelaria já entende bem o impacto de avaliações — foque no pitch de proteção.',
      'Abordar antes de alta temporada aumenta receptividade.'
    ]
  },
  seg_saude: {
    label: 'Clínica / Hospital',
    priority: 'alta',
    tips: [
      'Focar em "novos pacientes" e "agendamentos online" como métrica impactada.',
      'Para hospitais públicos: aborde a assessoria de comunicação, não o financeiro.'
    ]
  },
  seg_auto: {
    label: 'Automotivo / Concessionária',
    priority: 'alta',
    tips: [
      'Citar "pós-venda" e "SAC" é mais eficaz do que falar em reputação geral.',
      'Gerente de pós-venda sente a dor mais diretamente do que o gerente comercial.'
    ]
  },
  seg_telecom: {
    label: 'Telecom / Energia',
    priority: 'alta',
    tips: [
      'Evite dizer "sua reputação é ruim" — foque no impacto em novas adesões e churn.',
      'Ouvidoria pode ser um aliado interno para defender a compra.'
    ]
  },
  seg_varejo: {
    label: 'Varejo / Supermercado',
    priority: 'media',
    tips: [
      'Para redes de supermercado: abordar o gerente regional tem mais resultado.',
      'Para farmácias: mencionar que concorrentes estão monitorando cria senso de urgência.'
    ]
  }
}

export default function Prospects() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [selectedCampId, setSelectedCampId] = useState('')
  const [leads, setLeads] = useState<Lead[]>([])
  const [followups, setFollowups] = useState<Followup[]>([])
  const [selectedSegId, setSelectedSegId] = useState('seg_plano_saude')
  const [loading, setLoading] = useState(true)
  const [importing, setImporting] = useState(false)
  const [xmlText, setXmlText] = useState('')
  const [showImportModal, setShowImportModal] = useState(false)
  const [editingLeadId, setEditingLeadId] = useState<string | null>(null)
  const [editVars, setEditVars] = useState<Record<string, any>>({})
  const [activeTab, setActiveTab] = useState<'leads' | 'queue'>('leads')

  useEffect(() => {
    loadCampaigns()
  }, [])

  useEffect(() => {
    if (selectedCampId) {
      loadLeadsAndFollowups()
    }
  }, [selectedCampId])

  async function loadCampaigns() {
    try {
      const { data, error } = await supabase
        .from('prospect_campaigns')
        .select('*')
        .order('created_at', { ascending: false })
      if (error) throw error
      setCampaigns(data ?? [])
      if (data?.length && !selectedCampId) {
        setSelectedCampId(data[0].id)
      }
    } catch (err) {
      console.error('Erro ao carregar campanhas:', err)
    } finally {
      setLoading(false)
    }
  }

  async function loadLeadsAndFollowups() {
    setLoading(true)
    try {
      // Buscar leads
      const { data: leadsData, error: lErr } = await supabase
        .from('prospect_leads')
        .select('*')
        .eq('campaign_id', selectedCampId)
        .order('created_at', { ascending: true })
      if (lErr) throw lErr
      setLeads(leadsData ?? [])

      // Buscar followups
      const { data: fuData, error: fErr } = await supabase
        .from('prospect_followup_queue')
        .select('*, prospect_leads!inner(*)')
        .eq('prospect_leads.campaign_id', selectedCampId)
        .order('scheduled_at', { ascending: true })
      if (fErr) throw fErr
      setFollowups(fuData ?? [])
    } catch (err) {
      console.error('Erro ao carregar dados:', err)
    } finally {
      setLoading(false)
    }
  }

  // Parse XML para JSON e importar
  async function handleImportXML() {
    if (!xmlText.trim()) return
    setImporting(true)
    try {
      // Parser XML simplificado em frontend (robusto o suficiente para o formato fornecido)
      const parser = new DOMParser()
      const xmlDoc = parser.parseFromString(xmlText, 'text/xml')

      const campanhaEl = xmlDoc.querySelector('campanha')
      if (!campanhaEl) throw new Error('Elemento <campanha> não localizado.')

      const name = xmlDoc.querySelector('meta > nome')?.textContent || 'Campanha Outbound'
      const slug = campanhaEl.getAttribute('id') || 'campanha_custom'
      const description = xmlDoc.querySelector('meta > descricao')?.textContent || ''

      // Extrair segmentos e seus templates
      const templates: any[] = []
      const leadsList: any[] = []

      const segmentosEls = xmlDoc.querySelectorAll('segmentos > segmento')
      segmentosEls.forEach(seg => {
        const segId = seg.getAttribute('id') || ''
        
        // Templates
        const templatesEls = seg.querySelectorAll('templates > template')
        templatesEls.forEach(t => {
          const channel = t.getAttribute('canal') || ''
          const subject = t.querySelector('assunto')?.textContent?.trim() || ''
          const body = t.querySelector('corpo')?.textContent?.trim() || t.querySelector('mensagem')?.textContent?.trim() || ''
          templates.push({ segment_id: segId, channel, subject, body })
        })

        // Leads
        const leadsEls = seg.querySelectorAll('leads > lead')
        leadsEls.forEach(l => {
          const company_name = l.querySelector('empresa')?.textContent || ''
          const city = l.querySelector('cidade')?.textContent || ''
          const target_role = l.querySelector('cargo_alvo')?.textContent || ''
          leadsList.push({
            segment_id: segId,
            company_name,
            city,
            target_role,
            variables: {
              nota_google: 4.0,
              qtd_reclamacoes: 0
            }
          })
        })
      })

      const payload = {
        campaign: { slug, name, description },
        templates,
        leads: leadsList
      }

      // Enviar para API
      const response = await fetch('/api/admin/prospects/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })

      const resData = await response.json()
      if (resData.error) throw new Error(resData.error)

      setShowImportModal(false)
      setXmlText('')
      await loadCampaigns()
      if (resData.campaignId) {
        setSelectedCampId(resData.campaignId)
      }
    } catch (err: any) {
      alert(`Erro na importação: ${err.message}`)
    } finally {
      setImporting(false)
    }
  }

  // Atualizar variáveis de forma inline
  async function handleSaveVariables(leadId: string) {
    try {
      const response = await fetch(`/api/admin/prospects/leads/${leadId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ variables: editVars })
      })
      if (!response.ok) throw new Error('Erro ao salvar')
      setEditingLeadId(null)
      loadLeadsAndFollowups()
    } catch (err) {
      console.error(err)
    }
  }

  // Atualizar status do lead manualmente
  async function handleUpdateStatus(leadId: string, status: string) {
    try {
      const response = await fetch(`/api/admin/prospects/leads/${leadId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status })
      })
      if (!response.ok) throw new Error('Erro ao atualizar status')
      loadLeadsAndFollowups()
    } catch (err) {
      console.error(err)
    }
  }

  // Cancelar followup agendado
  async function handleCancelFollowup(fuId: string) {
    try {
      const response = await fetch('/api/admin/prospects/followups/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: fuId })
      })
      if (!response.ok) throw new Error('Erro ao cancelar')
      loadLeadsAndFollowups()
    } catch (err) {
      console.error(err)
    }
  }

  // Disparar passo comercial
  async function handleDispatch(lead: Lead, step: number, channel: 'email' | 'whatsapp') {
    try {
      let text = ''
      let subject = ''

      // Mock templates para frontend se os do banco não estiverem carregados localmente
      if (channel === 'whatsapp') {
        text = step === 1 
          ? `Oi, ${lead.contact_name || 'Gestor'}! Sou Consultor da Reputei. Vi que a ${lead.company_name} tem nota ${lead.variables.nota_google || 'N/A'} no Google Maps. Oferecemos 30 dias grátis pra monitorar e evitar reclamações. Quer conhecer em 10 min?`
          : `Oi, ${lead.contact_name || 'Gestor'}! Só passando pra retomar nosso papo sobre a reputação da ${lead.company_name}.`
      } else {
        subject = `Reputação online da ${lead.company_name}`
        text = `Olá, ${lead.contact_name || 'Gestor'}. Represento a Reputei, plataforma de reputação online. Notamos oportunidades de melhorar suas avaliações no Google. Gostaria de 30 dias grátis de trial?`
      }

      const response = await fetch('/api/admin/prospects/dispatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lead_id: lead.id,
          channel,
          step,
          text,
          subject
        })
      })

      const resData = await response.json()
      if (resData.error) throw new Error(resData.error)

      alert(resData.message || 'Disparado com sucesso!')
      loadLeadsAndFollowups()
    } catch (err: any) {
      alert(`Falha no envio: ${err.message}`)
    }
  }

  // Filtrar leads do segmento ativo
  const filteredLeads = leads.filter(l => l.segment_id === selectedSegId)
  const currentSeg = SEGMENT_NAMES[selectedSegId]

  // Stats
  const statTotal = leads.length
  const statContacted = leads.filter(l => l.status === 'contacted').length
  const statResponded = leads.filter(l => l.status === 'responded').length
  const statConverted = leads.filter(l => l.status === 'converted').length
  const pendingQueue = followups.filter(f => f.status === 'pending').length

  return (
    <div className="prospects-container" style={{ padding: 24, maxWidth: 1400, margin: '0 auto' }}>
      
      {/* Cabeçalho */}
      <div className="prospects-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h1 style={{ display: 'flex', alignItems: 'center', gap: 10, margin: 0, fontSize: 28, fontWeight: 700 }}>
            <Target size={28} color="var(--accent)" /> Outbound & Prospecção Comercial
          </h1>
          <p style={{ color: 'var(--text-secondary)', margin: '4px 0 0 0', fontSize: 14 }}>
            Importe listas de leads, preencha variáveis inline e gerencie esteiras completas de follow-up automático.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 12 }}>
          <select
            value={selectedCampId}
            onChange={e => setSelectedCampId(e.target.value)}
            style={{
              background: 'var(--bg-card)',
              color: 'var(--text-main)',
              border: '1px solid var(--border-color)',
              borderRadius: 8,
              padding: '8px 16px',
              fontSize: 14,
              outline: 'none',
              cursor: 'pointer'
            }}
          >
            {campaigns.map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <button 
            className="btn btn-primary"
            onClick={() => setShowImportModal(true)}
            style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 16px', borderRadius: 8 }}
          >
            Importar Campanha XML
          </button>
        </div>
      </div>

      {/* KPI Cards Section */}
      <div className="prospects-kpis-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 24 }}>
        <div className="kpi-card" style={{ background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.15), rgba(79, 70, 229, 0.05))', border: '1px solid rgba(99, 102, 241, 0.25)', borderRadius: 12, padding: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 13, color: 'var(--text-secondary)', fontWeight: 600, textTransform: 'uppercase' }}>Total de Leads</span>
            <Users size={20} color="#6366f1" />
          </div>
          <div style={{ fontSize: 28, fontWeight: 700, marginTop: 8 }}>{statTotal}</div>
        </div>

        <div className="kpi-card" style={{ background: 'linear-gradient(135deg, rgba(245, 158, 11, 0.15), rgba(217, 119, 6, 0.05))', border: '1px solid rgba(245, 158, 11, 0.25)', borderRadius: 12, padding: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 13, color: 'var(--text-secondary)', fontWeight: 600, textTransform: 'uppercase' }}>Follow-ups na Fila</span>
            <Send size={20} color="#f59e0b" />
          </div>
          <div style={{ fontSize: 28, fontWeight: 700, marginTop: 8 }}>{pendingQueue}</div>
        </div>

        <div className="kpi-card" style={{ background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.15), rgba(5, 150, 105, 0.05))', border: '1px solid rgba(16, 185, 129, 0.25)', borderRadius: 12, padding: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 13, color: 'var(--text-secondary)', fontWeight: 600, textTransform: 'uppercase' }}>Leads Respondidos</span>
            <MessageSquare size={20} color="#10b981" />
          </div>
          <div style={{ fontSize: 28, fontWeight: 700, marginTop: 8 }}>{statResponded} <span style={{ fontSize: 14, color: 'var(--text-secondary)', fontWeight: 500 }}>({statTotal ? Math.round((statResponded / statTotal) * 100) : 0}%)</span></div>
        </div>

        <div className="kpi-card" style={{ background: 'linear-gradient(135deg, rgba(244, 63, 94, 0.15), rgba(225, 29, 72, 0.05))', border: '1px solid rgba(244, 63, 94, 0.25)', borderRadius: 12, padding: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 13, color: 'var(--text-secondary)', fontWeight: 600, textTransform: 'uppercase' }}>Conversão (Trial 30D)</span>
            <CheckCircle size={20} color="#f43f5e" />
          </div>
          <div style={{ fontSize: 28, fontWeight: 700, marginTop: 8 }}>{statConverted} <span style={{ fontSize: 14, color: 'var(--text-secondary)', fontWeight: 500 }}>({statTotal ? Math.round((statConverted / statTotal) * 100) : 0}%)</span></div>
        </div>
      </div>

      {/* Tabs Menu Lateral / Controle */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border-color)', marginBottom: 20, gap: 16 }}>
        <button
          onClick={() => setActiveTab('leads')}
          style={{
            background: 'none',
            border: 'none',
            borderBottom: activeTab === 'leads' ? '2px solid var(--accent)' : '2px solid transparent',
            color: activeTab === 'leads' ? 'var(--text-main)' : 'var(--text-secondary)',
            padding: '8px 16px',
            fontSize: 15,
            fontWeight: 600,
            cursor: 'pointer',
            outline: 'none'
          }}
        >
          Esteira Comercial por Segmentos
        </button>
        <button
          onClick={() => setActiveTab('queue')}
          style={{
            background: 'none',
            border: 'none',
            borderBottom: activeTab === 'queue' ? '2px solid var(--accent)' : '2px solid transparent',
            color: activeTab === 'queue' ? 'var(--text-main)' : 'var(--text-secondary)',
            padding: '8px 16px',
            fontSize: 15,
            fontWeight: 600,
            cursor: 'pointer',
            outline: 'none'
          }}
        >
          Monitor de Fila de Follow-up ({pendingQueue})
        </button>
      </div>

      {activeTab === 'leads' && (
        <div className="prospects-content-layout" style={{ display: 'grid', gridTemplateColumns: '260px 1fr', gap: 24 }}>
          
          {/* Menu Lateral de Segmentos */}
          <aside className="segments-sidebar" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: 4 }}>Segmentos de Dor</div>
            {Object.entries(SEGMENT_NAMES).map(([key, value]) => (
              <button
                key={key}
                onClick={() => setSelectedSegId(key)}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  background: selectedSegId === key ? 'rgba(99, 102, 241, 0.12)' : 'transparent',
                  color: selectedSegId === key ? '#818cf8' : 'var(--text-main)',
                  border: selectedSegId === key ? '1px solid rgba(99, 102, 241, 0.3)' : '1px solid transparent',
                  borderRadius: 8,
                  padding: '10px 14px',
                  textAlign: 'left',
                  fontSize: 13.5,
                  fontWeight: selectedSegId === key ? 600 : 500,
                  cursor: 'pointer',
                  transition: 'all 0.15s ease'
                }}
              >
                <span>{value.label}</span>
                <span style={{
                  fontSize: 9,
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  padding: '2px 6px',
                  borderRadius: 4,
                  background: value.priority === 'alta' ? 'rgba(239, 68, 68, 0.15)' : 'rgba(245, 158, 11, 0.15)',
                  color: value.priority === 'alta' ? '#f87171' : '#fbbf24'
                }}>
                  {value.priority}
                </span>
              </button>
            ))}
          </aside>

          {/* Tabela Principal e Dicas */}
          <main style={{ minWidth: 0 }}>
            {/* Dicas Operacionais do Segmento */}
            {currentSeg && (
              <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: 10, padding: 16, marginBottom: 20 }}>
                <h3 style={{ margin: '0 0 10px 0', fontSize: 14, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
                  💡 Dicas Operacionais para {currentSeg.label}
                </h3>
                <ul style={{ margin: 0, paddingLeft: 20, fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                  {currentSeg.tips.map((tip, idx) => <li key={idx}>{tip}</li>)}
                </ul>
              </div>
            )}

            {/* Leads Table */}
            <div className="table-responsive" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: 10, overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13.5, textAlign: 'left' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border-color)', background: 'rgba(255,255,255,0.02)' }}>
                    <th style={{ padding: '14px 16px', color: 'var(--text-secondary)' }}>Empresa / Decisor</th>
                    <th style={{ padding: '14px 16px', color: 'var(--text-secondary)' }}>Contato</th>
                    <th style={{ padding: '14px 16px', color: 'var(--text-secondary)' }}>Cidade / Cargo</th>
                    <th style={{ padding: '14px 16px', color: 'var(--text-secondary)' }}>Variáveis Inline</th>
                    <th style={{ padding: '14px 16px', color: 'var(--text-secondary)' }}>Status</th>
                    <th style={{ padding: '14px 16px', color: 'var(--text-secondary)', textAlign: 'right' }}>Ações de Prospecção</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredLeads.map(lead => (
                    <tr key={lead.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                      <td style={{ padding: '14px 16px' }}>
                        <div style={{ fontWeight: 600 }}>{lead.company_name}</div>
                        <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
                          {lead.contact_name || 'Decisor pendente'}
                        </div>
                      </td>
                      <td style={{ padding: '14px 16px' }}>
                        <div>{lead.phone || '—'}</div>
                        <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{lead.email || '—'}</div>
                      </td>
                      <td style={{ padding: '14px 16px' }}>
                        <div>{lead.city || '—'}</div>
                        <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{lead.target_role || '—'}</div>
                      </td>
                      <td style={{ padding: '14px 16px' }}>
                        {editingLeadId === lead.id ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                            <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                              <span style={{ fontSize: 11, color: 'var(--text-secondary)', width: 45 }}>Nota:</span>
                              <input
                                type="number"
                                step="0.1"
                                value={editVars.nota_google ?? ''}
                                onChange={e => setEditVars({ ...editVars, nota_google: parseFloat(e.target.value) })}
                                style={{ width: 60, background: 'var(--bg-main)', border: '1px solid var(--border-color)', borderRadius: 4, color: 'var(--text-main)', padding: '2px 4px' }}
                              />
                            </div>
                            <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                              <span style={{ fontSize: 11, color: 'var(--text-secondary)', width: 45 }}>Recl:</span>
                              <input
                                type="number"
                                value={editVars.qtd_reclamacoes ?? ''}
                                onChange={e => setEditVars({ ...editVars, qtd_reclamacoes: parseInt(e.target.value) })}
                                style={{ width: 60, background: 'var(--bg-main)', border: '1px solid var(--border-color)', borderRadius: 4, color: 'var(--text-main)', padding: '2px 4px' }}
                              />
                            </div>
                            <button
                              onClick={() => handleSaveVariables(lead.id)}
                              className="btn btn-sm btn-primary"
                              style={{ padding: '2px 6px', fontSize: 11, display: 'flex', alignItems: 'center', gap: 2, alignSelf: 'flex-start' }}
                            >
                              <Check size={10} /> Salvar
                            </button>
                          </div>
                        ) : (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                            <div style={{ fontSize: 12 }}>⭐ Google: <strong style={{ color: 'var(--accent)' }}>{lead.variables.nota_google ?? '—'}</strong></div>
                            <div style={{ fontSize: 12 }}>⚠️ RA: <strong style={{ color: '#f43f5e' }}>{lead.variables.qtd_reclamacoes ?? '0'}</strong></div>
                            <button
                              onClick={() => { setEditingLeadId(lead.id); setEditVars(lead.variables || {}) }}
                              style={{ background: 'none', border: 'none', color: 'var(--accent)', fontSize: 11, padding: 0, textDecoration: 'underline', cursor: 'pointer', alignSelf: 'flex-start' }}
                            >
                              Editar
                            </button>
                          </div>
                        )}
                      </td>
                      <td style={{ padding: '14px 16px' }}>
                        <select
                          value={lead.status}
                          onChange={e => handleUpdateStatus(lead.id, e.target.value)}
                          style={{
                            background: lead.status === 'converted' ? 'rgba(244,63,94,0.12)' : lead.status === 'responded' ? 'rgba(16,185,129,0.12)' : 'var(--bg-main)',
                            color: lead.status === 'converted' ? '#f43f5e' : lead.status === 'responded' ? '#34d399' : 'var(--text-main)',
                            border: '1px solid var(--border-color)',
                            borderRadius: 6,
                            padding: '4px 8px',
                            fontSize: 12,
                            fontWeight: 600,
                            outline: 'none',
                            cursor: 'pointer'
                          }}
                        >
                          <option value="new">Novo</option>
                          <option value="contacted">Abordado</option>
                          <option value="responded">Respondeu</option>
                          <option value="converted">Convertido (Trial)</option>
                          <option value="failed">Perdido</option>
                        </select>
                      </td>
                      <td style={{ padding: '14px 16px', textAlign: 'right' }}>
                        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                          {/* Botão de Envio Manual via WhatsApp Web */}
                          <a
                            href={`https://api.whatsapp.com/send?phone=${lead.phone?.replace(/\D/g, '')}&text=${encodeURIComponent(
                              `Oi, ${lead.contact_name || 'Gestor'}! Tudo bem? Sou Consultor da Reputei. Notamos que a ${lead.company_name} tem oportunidade de melhorar as avaliações no Google Maps (nota atual: ${lead.variables.nota_google || 'N/A'}). Oferecemos 30 dias de trial grátis. Faz sentido em 10 minutos?`
                            )}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="btn btn-sm"
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 4,
                              background: 'rgba(37, 211, 102, 0.1)',
                              color: '#4ade80',
                              border: '1px solid rgba(37, 211, 102, 0.2)',
                              padding: '4px 8px',
                              borderRadius: 6,
                              fontSize: 12,
                              textDecoration: 'none'
                            }}
                          >
                            <ExternalLink size={12} /> WhatsApp Web
                          </a>

                          {/* WhatsApp Automático */}
                          <button
                            onClick={() => handleDispatch(lead, 1, 'whatsapp')}
                            className="btn btn-sm btn-ghost"
                            style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 8px', borderRadius: 6 }}
                          >
                            <MessageSquare size={12} /> WhatsApp API (P1)
                          </button>

                          {/* E-mail Automático */}
                          <button
                            onClick={() => handleDispatch(lead, 2, 'email')}
                            className="btn btn-sm btn-ghost"
                            style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 8px', borderRadius: 6 }}
                          >
                            <Mail size={12} /> E-mail (P2)
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {filteredLeads.length === 0 && (
                    <tr>
                      <td colSpan={6} style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-secondary)' }}>
                        Nenhum lead localizado neste segmento de prospecção.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </main>
        </div>
      )}

      {activeTab === 'queue' && (
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: 10, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13.5, textAlign: 'left' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-color)', background: 'rgba(255,255,255,0.02)' }}>
                <th style={{ padding: '14px 16px', color: 'var(--text-secondary)' }}>Empresa</th>
                <th style={{ padding: '14px 16px', color: 'var(--text-secondary)' }}>Canal de Envio</th>
                <th style={{ padding: '14px 16px', color: 'var(--text-secondary)' }}>Passo</th>
                <th style={{ padding: '14px 16px', color: 'var(--text-secondary)' }}>Disparo Agendado</th>
                <th style={{ padding: '14px 16px', color: 'var(--text-secondary)' }}>Status da Esteira</th>
                <th style={{ padding: '14px 16px', color: 'var(--text-secondary)', textAlign: 'right' }}>Ações de Controle</th>
              </tr>
            </thead>
            <tbody>
              {followups.map(item => (
                <tr key={item.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                  <td style={{ padding: '14px 16px' }}>
                    <div style={{ fontWeight: 600 }}>{item.prospect_leads?.company_name}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{item.prospect_leads?.contact_name}</div>
                  </td>
                  <td style={{ padding: '14px 16px' }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      {item.channel === 'whatsapp' ? <MessageSquare size={14} color="#4ade80" /> : <Mail size={14} color="#60a5fa" />}
                      {item.channel.toUpperCase()}
                    </span>
                  </td>
                  <td style={{ padding: '14px 16px' }}>Passo {item.step}</td>
                  <td style={{ padding: '14px 16px' }}>{new Date(item.scheduled_at).toLocaleString('pt-BR')}</td>
                  <td style={{ padding: '14px 16px' }}>
                    <span style={{
                      fontSize: 11,
                      fontWeight: 700,
                      textTransform: 'uppercase',
                      padding: '2px 8px',
                      borderRadius: 12,
                      background: item.status === 'pending' ? 'rgba(245,158,11,0.12)' : item.status === 'canceled' ? 'rgba(107,114,128,0.12)' : 'rgba(16,185,129,0.12)',
                      color: item.status === 'pending' ? '#fbbf24' : item.status === 'canceled' ? '#9ca3af' : '#34d399'
                    }}>
                      {item.status === 'pending' ? 'AGENDADO' : item.status === 'canceled' ? 'CANCELADO' : 'ENVIADO'}
                    </span>
                  </td>
                  <td style={{ padding: '14px 16px', textAlign: 'right' }}>
                    {item.status === 'pending' && (
                      <button
                        onClick={() => handleCancelFollowup(item.id)}
                        className="btn btn-sm"
                        style={{ background: 'rgba(239,68,68,0.12)', color: '#f87171', border: '1px solid rgba(239,68,68,0.2)' }}
                      >
                        Interromper Envio
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {followups.length === 0 && (
                <tr>
                  <td colSpan={6} style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-secondary)' }}>
                    Nenhum followup pendente na fila comercial no momento.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal para colar XML de Prospecção */}
      {showImportModal && (
        <div className="modal-overlay" style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000 }}>
          <div className="modal-content" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: 12, padding: 24, width: 600, maxWidth: '90%' }}>
            <h2 style={{ margin: '0 0 8px 0', fontSize: 18, fontWeight: 700 }}>Importar Campanha via Prompt XML</h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: 13, margin: '0 0 16px 0' }}>
              Cole o escopo ou prompt XML da campanha contendo os templates, segmentos de dores e a lista de leads comerciais.
            </p>
            <textarea
              value={xmlText}
              onChange={e => setXmlText(e.target.value)}
              placeholder="Cole o código XML aqui..."
              style={{
                width: '100%',
                height: 300,
                background: 'var(--bg-main)',
                color: 'var(--text-main)',
                border: '1px solid var(--border-color)',
                borderRadius: 8,
                padding: 12,
                fontSize: 12.5,
                fontFamily: 'monospace',
                outline: 'none',
                resize: 'none',
                marginBottom: 16
              }}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
              <button
                onClick={() => { setShowImportModal(false); setXmlText('') }}
                className="btn btn-ghost"
                style={{ padding: '8px 16px', borderRadius: 8 }}
              >
                Cancelar
              </button>
              <button
                onClick={handleImportXML}
                disabled={importing || !xmlText.trim()}
                className="btn btn-primary"
                style={{ padding: '8px 16px', borderRadius: 8, display: 'flex', alignItems: 'center', gap: 6 }}
              >
                {importing ? <Loader2 size={14} className="spin" /> : <Check size={14} />} Importar e Gerar Leads
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}
