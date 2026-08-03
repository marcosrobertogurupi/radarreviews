import React, { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useToast } from '../components/Toast'
import {
  Target, Users, Send, CheckCircle, AlertOctagon, HelpCircle,
  Play, Check, Edit3, Trash2, Mail, MessageSquare, ExternalLink, Loader2, ArrowRight
} from 'lucide-react'
import { API_URL } from '../lib/utils'

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
  const { toast } = useToast()
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [selectedCampId, setSelectedCampId] = useState('')
  const [leads, setLeads] = useState<Lead[]>([])
  const [followups, setFollowups] = useState<Followup[]>([])
  const [selectedSegId, setSelectedSegId] = useState('seg_plano_saude')
  const [importing, setImporting] = useState(false)
  const [xmlText, setXmlText] = useState('')
  const [showImportModal, setShowImportModal] = useState(false)
  const [editingLeadId, setEditingLeadId] = useState<string | null>(null)
  const [editVars, setEditVars] = useState<Record<string, any>>({})
  const [editContactName, setEditContactName] = useState('')
  const [editPhone, setEditPhone] = useState('')
  const [editEmail, setEditEmail] = useState('')
  const [activeTab, setActiveTab] = useState<'leads' | 'queue'>('leads')
  const [showPromptModal, setShowPromptModal] = useState(false)
  const [generatedPromptText, setGeneratedPromptText] = useState('')
  const [copiedPrompt, setCopiedPrompt] = useState(false)
  const [templates, setTemplates] = useState<any[]>([])
  const [showPreviewModal, setShowPreviewModal] = useState(false)
  const [previewLead, setPreviewLead] = useState<Lead | null>(null)
  const [previewChannel, setPreviewChannel] = useState<'email' | 'whatsapp'>('whatsapp')
  const [previewStep, setPreviewStep] = useState(1)
  const [previewText, setPreviewText] = useState('')
  const [previewSubject, setPreviewSubject] = useState('')
  const [sendingDispatch, setSendingDispatch] = useState(false)
  const [enrichingId, setEnrichingId] = useState<string | null>(null)
  const [searchKipflowModal, setSearchKipflowModal] = useState(false)
  const [kipflowQuery, setKipflowQuery] = useState('')
  const [kipflowState, setKipflowState] = useState('')
  const [kipflowResults, setKipflowResults] = useState<any[]>([])
  const [searchingKipflow, setSearchingKipflow] = useState(false)

  useEffect(() => {
    loadCampaigns()
  }, [])


  useEffect(() => {
    if (selectedCampId) {
      loadLeadsAndFollowups()
    }
  }, [selectedCampId])

  async function handleEnrichLead(leadId: string) {
    try {
      setEnrichingId(leadId)
      toast('Iniciando enriquecimento Kipflow + IA...', 'info')
      const session = (await supabase.auth.getSession()).data.session
      const res = await fetch(`${API_URL}/api/admin/prospects/enrich/${leadId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session?.access_token || ''}`
        }
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Falha ao enriquecer lead')
      toast(`Enriquecido com sucesso! ICP Score: ${data.icp_score} | ${data.decidors?.length || 0} decisores encontrados`, 'success')
      loadLeadsAndFollowups()
    } catch (err: any) {
      toast(err.message, 'error')
    } finally {
      setEnrichingId(null)
    }
  }

  async function handleSearchKipflow() {
    try {
      setSearchingKipflow(true)
      const session = (await supabase.auth.getSession()).data.session
      const res = await fetch(`${API_URL}/api/admin/prospects/kipflow/search`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session?.access_token || ''}`
        },
        body: JSON.stringify({
          query: kipflowQuery || undefined,
          state: kipflowState || undefined
        })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Erro na busca Kipflow')
      setKipflowResults(data || [])
      toast(`${data.length || 0} empresas encontradas na Kipflow`, 'info')
    } catch (err: any) {
      toast(err.message, 'error')
    } finally {
      setSearchingKipflow(false)
    }
  }

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
    }
  }

  async function loadLeadsAndFollowups() {
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

      // Buscar templates da campanha
      const { data: templatesData, error: tErr } = await supabase
        .from('prospect_templates')
        .select('*')
        .eq('campaign_id', selectedCampId)
      if (tErr) throw tErr
      setTemplates(templatesData ?? [])
    } catch (err) {
      console.error('Erro ao carregar dados:', err)
    }
  }

  // Parse XML para JSON e importar
  async function handleImportXML() {
    let cleanXml = xmlText.trim()
    
    // Remover marcações de bloco de código Markdown se o usuário colou com as crases (```xml)
    if (cleanXml.startsWith('```')) {
      cleanXml = cleanXml.replace(/^```[a-zA-Z]*\s*/, '')
      cleanXml = cleanXml.replace(/\s*```$/, '')
    }
    cleanXml = cleanXml.trim()

    if (!cleanXml) return
    setImporting(true)
    try {
      // Parser XML simplificado em frontend (robusto o suficiente para o formato fornecido)
      const parser = new DOMParser()
      const xmlDoc = parser.parseFromString(cleanXml, 'text/xml')

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
          const contact_name = l.querySelector('contato')?.textContent || l.querySelector('contato_nome')?.textContent || ''
          const phone = l.querySelector('telefone')?.textContent || l.querySelector('celular')?.textContent || ''
          const email = l.querySelector('email')?.textContent || ''
          const nota_google = parseFloat(l.querySelector('nota_google')?.textContent || '4.0') || 4.0
          const qtd_reclamacoes = parseInt(l.querySelector('qtd_reclamacoes')?.textContent || '0') || 0

          leadsList.push({
            segment_id: segId,
            company_name,
            contact_name,
            phone,
            email,
            city,
            target_role,
            variables: {
              nota_google,
              qtd_reclamacoes
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
      const { data: { session } } = await supabase.auth.getSession()
      const response = await fetch(`${API_URL}/api/admin/prospects/import`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': session ? `Bearer ${session.access_token}` : ''
        },
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
      toast('Campanha importada e leads gerados com sucesso!', 'success')
    } catch (err: any) {
      toast(`Erro na importação: ${err.message}`, 'error')
    } finally {
      setImporting(false)
    }
  }
 
  function fallbackCopyText(text: string) {
    const textArea = document.createElement("textarea")
    textArea.value = text
     
    // Evitar scroll ou visualização indesejada do elemento temporário
    textArea.style.top = "0"
    textArea.style.left = "0"
    textArea.style.position = "fixed"
    textArea.style.opacity = "0"
     
    document.body.appendChild(textArea)
    textArea.focus()
    textArea.select()
     
    try {
      const successful = document.execCommand('copy')
      if (successful) {
        setCopiedPrompt(true)
        toast('Prompt copiado para a área de transferência!', 'success')
        setTimeout(() => setCopiedPrompt(false), 2000)
      } else {
        toast('Selecione o texto e copie manualmente.', 'info')
      }
    } catch (err) {
      console.error('Fallback falhou:', err)
      toast('Selecione o texto e copie manualmente.', 'info')
    }
    
    document.body.removeChild(textArea)
  }

  function handleCopyPrompt() {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(generatedPromptText)
          .then(() => {
            setCopiedPrompt(true)
            toast('Prompt copiado para a área de transferência!', 'success')
            setTimeout(() => setCopiedPrompt(false), 2000)
          })
          .catch(err => {
            console.error('Falha ao usar clipboard API, tentando fallback:', err)
            fallbackCopyText(generatedPromptText)
          })
      } else {
        fallbackCopyText(generatedPromptText)
      }
    } catch (err) {
      console.error('Erro na cópia:', err)
      fallbackCopyText(generatedPromptText)
    }
  }

  function handleGeneratePromptForSegment(segId: string) {
    const segInfo = SEGMENT_NAMES[segId]
    if (!segInfo) return

    const segmentLabel = segInfo.label
    let painPoint = ""
    let samplePitch = ""

    switch (segId) {
      case 'seg_plano_saude':
        painPoint = "Dificuldade em portabilidade de carências, atendimento lento de corretores e concorrência forte. Notas baixas no Google Maps afastam potenciais compradores antes de ligar."
        samplePitch = "Mencione o impacto das notas nas buscas locais por corretores de planos de saúde."
        break
      case 'seg_imobi':
        painPoint = "Reclamações frequentes sobre devolução de caução, vistorias rígidas e atendimento na locação de imóveis. Imobiliárias perdem novos proprietários e locatários."
        samplePitch = "Foque na perda de novos contratos de locação devido às reclamações não respondidas no Reclame Aqui e Google."
        break
      case 'seg_edu':
        painPoint = "Críticas sobre burocracia de matrículas, suporte financeiro ou atendimento de professores que aparecem online e afastam novos alunos na fase do vestibular."
        samplePitch = "Mencione a taxa de conversão de leads de vestibular impactada por reclamações de ex-alunos."
        break
      case 'seg_hotel':
        painPoint = "Avaliações negativas sobre Wi-Fi lento, café da manhã ou limpeza do quarto em plataformas como Booking ou TripAdvisor, destruindo a reputação."
        samplePitch = "Aborde o impacto direto nas reservas diretas de hóspedes que pesquisam antes de fechar."
        break
      case 'seg_saude':
        painPoint = "Reclamações sobre atrasos em consultas e mau atendimento na recepção de clínicas e consultórios, espantando clientes de procedimentos particulares de alto ticket."
        samplePitch = "Foque em blindar o faturamento de consultas particulares de alto valor."
        break
      case 'seg_auto':
        painPoint = "Problemas de pós-venda, demora em peças de reposição e revisões com reclamações ativas que afastam compradores de seminovos."
        samplePitch = "Aborde o diretor ou gerente de pós-venda ressaltando o custo de atração de novos clientes."
        break
      case 'seg_telecom':
        painPoint = "Quedas de conexão, demora no suporte técnico local e cobranças consideradas indevidas. Provedores sofrem com cancelamento em massa (churn)."
        samplePitch = "Mostre como as avaliações ruins ajudam os concorrentes a roubarem clientes de fibra óptica."
        break
      case 'seg_varejo':
        painPoint = "Filas nos caixas, mau humor no atendimento físico e produtos indisponíveis que geram avaliações baixas e reduzem o tráfego físico à loja."
        samplePitch = "Foque em aumentar o fluxo de pedestres e as vendas locais."
        break
    }

    const promptText = `Atue como um Especialista em Inteligência Comercial e Outbound SaaS. Seu objetivo é estruturar uma campanha de prospecção fria gerando uma saída estritamente em formato XML válido de acordo com as especificações do sistema do Reputei.

Você deve criar templates de abordagens comerciais e uma lista de 5 leads comerciais altamente qualificados e verossímeis no segmento de "${segmentLabel}".

### 1. REGRAS DO SEGMENTO DE DOR
- Identificador do Segmento (ID obrigatório): \`${segId}\`
- Dor principal observada no mercado: ${painPoint}
- Foco da Abordagem comercial: ${samplePitch}

### 2. VARIÁVEIS DINÂMICAS QUE PODEM SER USADAS NOS TEMPLATES
Seu texto deve conter placeholders que o nosso sistema preenche em tempo real:
- [EMPRESA] -> Nome comercial da empresa prospectada.
- [CIDADE] -> Cidade onde atua.
- [NOTA_GOOGLE] -> Nota do Google Maps (Ex: 3.8).
- [QTD_RECLAMACOES] -> Número de reclamações no Reclame Aqui (Ex: 12).
- [NOME_CONTATO] -> Nome do decisor se houver (Ex: Carlos).

---

### 3. ESTRUTURA XML OBRIGATÓRIA (Siga rigidamente as tags abaixo)
Gerar a resposta contendo exatamente este formato XML:

<campanha id="outbound_${segId}_maio">
  <meta>
    <nome>Outbound Comercial - ${segmentLabel}</nome>
    <descricao>Campanha fria focada nas principais dores do segmento de ${segmentLabel}.</descricao>
  </meta>
  <segmentos>
    <segmento id="${segId}">
      <templates>
        <template canal="whatsapp">
          <corpo>Oi [NOME_CONTATO], tudo bem? Sou da Reputei. Vi que a [EMPRESA] em [CIDADE] tem nota [NOTA_GOOGLE] no Google Maps. Ajudamos a monitorar e automatizar suas avaliações para atrair mais clientes. Vamos bater um papo rápido de 10 minutos?</corpo>
        </template>
        <template canal="email">
          <assunto>Melhoria de avaliações online para a [EMPRESA]</assunto>
          <corpo>Olá, [NOME_CONTATO]. Sou consultor da Reputei. Vimos que a [EMPRESA] em [CIDADE] tem nota [NOTA_GOOGLE] no Google. Podemos liberar 30 dias de teste grátis da nossa plataforma para ajudar a gerenciar seus reviews e impulsionar suas vendas locais. Faz sentido conversarmos?</corpo>
        </template>
      </templates>
      <leads>
        <lead>
          <empresa>Nome de uma Empresa Real do segmento</empresa>
          <cidade>Nome da Cidade</cidade>
          <cargo_alvo>Sócio / Diretor / Gerente</cargo_alvo>
          <contato>Nome de exemplo do contato</contato>
          <telefone>11999998888</telefone>
          <email>contato@empresaexemplo.com.br</email>
          <nota_google>3.8</nota_google>
          <qtd_reclamacoes>15</qtd_reclamacoes>
        </lead>
        <!-- Forneça mais 4 leads seguindo a mesma estrutura exata acima -->
      </leads>
    </segmento>
  </segmentos>
</campanha>

---

REQUISITOS ADICIONAIS:
1. Retorne APENAS o bloco de código XML. Não insira introduções, observações nem comentários extras de markdown fora do bloco de código.
2. Certifique-se de fechar todas as tags XML corretamente.`

    setGeneratedPromptText(promptText)
    setCopiedPrompt(false)
    setShowPromptModal(true)
  }

  // Atualizar variáveis de forma inline
  async function handleSaveVariables(leadId: string) {
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const response = await fetch(`${API_URL}/api/admin/prospects/leads/${leadId}`, {
        method: 'PATCH',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': session ? `Bearer ${session.access_token}` : ''
        },
        body: JSON.stringify({
          contact_name: editContactName,
          phone: editPhone,
          email: editEmail,
          variables: editVars
        })
      })
      if (!response.ok) throw new Error('Erro ao salvar')
      setEditingLeadId(null)
      loadLeadsAndFollowups()
      toast('Lead atualizado com sucesso!', 'success')
    } catch (err: any) {
      console.error(err)
      toast(`Erro ao salvar lead: ${err.message}`, 'error')
    }
  }

  // Atualizar status do lead manualmente
  async function handleUpdateStatus(leadId: string, status: string) {
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const response = await fetch(`${API_URL}/api/admin/prospects/leads/${leadId}`, {
        method: 'PATCH',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': session ? `Bearer ${session.access_token}` : ''
        },
        body: JSON.stringify({ status })
      })
      if (!response.ok) throw new Error('Erro ao atualizar status')
      loadLeadsAndFollowups()
      toast('Status do lead atualizado!', 'success')
    } catch (err: any) {
      console.error(err)
      toast(`Erro ao atualizar status: ${err.message}`, 'error')
    }
  }

  // Cancelar followup agendado
  async function handleCancelFollowup(fuId: string) {
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const response = await fetch(`${API_URL}/api/admin/prospects/followups/cancel`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': session ? `Bearer ${session.access_token}` : ''
        },
        body: JSON.stringify({ id: fuId })
      })
      if (!response.ok) throw new Error('Erro ao cancelar')
      loadLeadsAndFollowups()
      toast('Follow-up cancelado com sucesso!', 'success')
    } catch (err: any) {
      console.error(err)
      toast(`Erro ao cancelar follow-up: ${err.message}`, 'error')
    }
  }

  // Substituir variáveis do template
  function replaceVariables(text: string, lead: Lead) {
    if (!text) return ''
    return text
      .replace(/\[NOME_CONTATO\]/gi, lead.contact_name || 'Gestor')
      .replace(/\[EMPRESA\]/gi, lead.company_name || '')
      .replace(/\[CIDADE\]/gi, lead.city || '')
      .replace(/\[NOTA_GOOGLE\]/gi, String(lead.variables?.nota_google ?? '—'))
      .replace(/\[QTD_RECLAMACOES\]/gi, String(lead.variables?.qtd_reclamacoes ?? '0'))
  }

  // Abrir preview de disparo de canal
  function openDispatchPreview(lead: Lead, step: number, channel: 'email' | 'whatsapp') {
    const template = templates.find(t => t.segment_id === lead.segment_id && t.channel === channel)
    let rawText = ''
    let rawSubject = ''

    if (template) {
      rawText = template.body
      rawSubject = template.subject || ''
    } else {
      if (channel === 'whatsapp') {
        rawText = step === 1 
          ? `Oi [NOME_CONTATO], tudo bem? Vi que a [EMPRESA] em [CIDADE] tem nota [NOTA_GOOGLE] no Google Maps. Oferecemos uma solução automatizada para monitorar e responder reviews negativos. Quer bater um papo de 10 min?`
          : `Oi [NOME_CONTATO]! Só passando pra retomar nosso papo sobre a reputação da [EMPRESA].`
      } else {
        rawSubject = `Oportunidade de Reputação Online para a [EMPRESA]`
        rawText = `Olá [NOME_CONTATO], sou da Reputei. Vi que a [EMPRESA] tem nota [NOTA_GOOGLE] no Google. Gostaria de 30 dias grátis de trial para melhorar suas avaliações?`
      }
    }

    const formattedText = replaceVariables(rawText, lead)
    const formattedSubject = replaceVariables(rawSubject, lead)

    setPreviewLead(lead)
    setPreviewChannel(channel)
    setPreviewStep(step)
    setPreviewText(formattedText)
    setPreviewSubject(formattedSubject)
    setShowPreviewModal(true)
  }

  // Confirmar e enviar do preview
  async function handleConfirmDispatch() {
    if (!previewLead) return
    setSendingDispatch(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const response = await fetch(`${API_URL}/api/admin/prospects/dispatch`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': session ? `Bearer ${session.access_token}` : ''
        },
        body: JSON.stringify({
          lead_id: previewLead.id,
          channel: previewChannel,
          step: previewStep,
          text: previewText,
          subject: previewSubject
        })
      })

      const resData = await response.json()
      if (resData.error) throw new Error(resData.error)
 
      toast(resData.message || 'Mensagem disparada com sucesso!', 'success')
      setShowPreviewModal(false)
      loadLeadsAndFollowups()
    } catch (err: any) {
      toast(`Falha no envio: ${err.message}`, 'error')
    } finally {
      setSendingDispatch(false)
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
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '8px 16px',
              borderRadius: 8,
              background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
              color: '#fff',
              border: 'none',
              fontWeight: 600,
              cursor: 'pointer'
            }}
            onClick={() => setSearchKipflowModal(true)}
          >
            <Search size={16} />
            Buscar Empresas (Kipflow)
          </button>
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
              <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 20, background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: 10, padding: 20, marginBottom: 20, alignItems: 'center' }}>
                <div>
                  <h3 style={{ margin: '0 0 10px 0', fontSize: 14, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
                    💡 Dicas Operacionais para {currentSeg.label}
                  </h3>
                  <ul style={{ margin: 0, paddingLeft: 20, fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                    {currentSeg.tips.map((tip, idx) => <li key={idx}>{tip}</li>)}
                  </ul>
                </div>
                <div>
                  <button
                    onClick={() => handleGeneratePromptForSegment(selectedSegId)}
                    className="btn btn-primary"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '12px 20px',
                      borderRadius: 8,
                      background: 'linear-gradient(135deg, #818cf8, #6366f1)',
                      color: '#fff',
                      border: 'none',
                      boxShadow: '0 4px 12px rgba(99, 102, 241, 0.25)',
                      cursor: 'pointer',
                      fontSize: 13.5,
                      fontWeight: 600,
                      transition: 'all 0.2s ease',
                    }}
                    onMouseEnter={e => {
                      e.currentTarget.style.transform = 'translateY(-2px)'
                      e.currentTarget.style.boxShadow = '0 6px 16px rgba(99, 102, 241, 0.35)'
                    }}
                    onMouseLeave={e => {
                      e.currentTarget.style.transform = 'none'
                      e.currentTarget.style.boxShadow = '0 4px 12px rgba(99, 102, 241, 0.25)'
                    }}
                  >
                    <Target size={16} /> 🪄 Criar Prompt IA para {currentSeg.label}
                  </button>
                </div>
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
                        {editingLeadId === lead.id ? (
                          <input
                            type="text"
                            placeholder="Nome do Decisor"
                            value={editContactName}
                            onChange={e => setEditContactName(e.target.value)}
                            style={{
                              width: '100%',
                              background: 'var(--bg-main)',
                              border: '1px solid var(--border-color)',
                              borderRadius: 4,
                              color: 'var(--text-main)',
                              padding: '4px 8px',
                              fontSize: 12,
                              marginTop: 4
                            }}
                          />
                        ) : (
                          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
                            {lead.contact_name || 'Decisor pendente'}
                          </div>
                        )}
                      </td>
                      <td style={{ padding: '14px 16px' }}>
                        {editingLeadId === lead.id ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                            <input
                              type="text"
                              placeholder="Telefone"
                              value={editPhone}
                              onChange={e => setEditPhone(e.target.value)}
                              style={{
                                width: '100%',
                                background: 'var(--bg-main)',
                                border: '1px solid var(--border-color)',
                                borderRadius: 4,
                                color: 'var(--text-main)',
                                padding: '4px 8px',
                                fontSize: 12
                              }}
                            />
                            <input
                              type="email"
                              placeholder="E-mail"
                              value={editEmail}
                              onChange={e => setEditEmail(e.target.value)}
                              style={{
                                width: '100%',
                                background: 'var(--bg-main)',
                                border: '1px solid var(--border-color)',
                                borderRadius: 4,
                                color: 'var(--text-main)',
                                padding: '4px 8px',
                                fontSize: 12
                              }}
                            />
                          </div>
                        ) : (
                          <>
                            <div>{lead.phone || '—'}</div>
                            <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{lead.email || '—'}</div>
                          </>
                        )}
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
                            <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                              <button
                                onClick={() => handleSaveVariables(lead.id)}
                                className="btn btn-sm btn-primary"
                                style={{ padding: '2px 8px', fontSize: 11, display: 'flex', alignItems: 'center', gap: 2 }}
                              >
                                <Check size={10} /> Salvar
                              </button>
                              <button
                                onClick={() => setEditingLeadId(null)}
                                className="btn btn-sm btn-ghost"
                                style={{ padding: '2px 8px', fontSize: 11, background: 'rgba(255,255,255,0.05)', color: 'var(--text-secondary)' }}
                              >
                                Cancelar
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                            <div style={{ fontSize: 12 }}>⭐ Google: <strong style={{ color: 'var(--accent)' }}>{lead.variables.nota_google ?? '—'}</strong></div>
                            <div style={{ fontSize: 12 }}>⚠️ RA: <strong style={{ color: '#f43f5e' }}>{lead.variables.qtd_reclamacoes ?? '0'}</strong></div>
                            <button
                              onClick={() => {
                                setEditingLeadId(lead.id)
                                setEditContactName(lead.contact_name || '')
                                setEditPhone(lead.phone || '')
                                setEditEmail(lead.email || '')
                                setEditVars(lead.variables || {})
                              }}
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
                          {/* Botão de Enriquecimento Kipflow + IA */}
                          <button
                            onClick={() => handleEnrichLead(lead.id)}
                            disabled={enrichingId === lead.id}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 4,
                              background: 'linear-gradient(135deg, #6366f1, #4f46e5)',
                              color: '#fff',
                              border: 'none',
                              padding: '4px 10px',
                              borderRadius: 6,
                              fontSize: 12,
                              fontWeight: 600,
                              cursor: 'pointer'
                            }}
                            title="Buscar na Kipflow e enriquecer contatos/decisores + IA Fit"
                          >
                            {enrichingId === lead.id ? <Loader2 size={12} className="animate-spin" /> : '⚡ Enriquecer'}
                          </button>

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
                            onClick={() => openDispatchPreview(lead, 1, 'whatsapp')}
                            className="btn btn-sm btn-ghost"
                            style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 8px', borderRadius: 6 }}
                          >
                            <MessageSquare size={12} /> WhatsApp API (P1)
                          </button>

                          {/* E-mail Automático */}
                          <button
                            onClick={() => openDispatchPreview(lead, 2, 'email')}
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

      {/* Modal para Visualizar / Copiar Prompt da IA */}
      {showPromptModal && (
        <div className="modal-overlay" style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000 }}>
          <div className="modal-content" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: 16, padding: 28, width: 700, maxWidth: '95%', maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8, color: '#818cf8' }}>
                <Target size={22} /> Prompt IA para {SEGMENT_NAMES[selectedSegId]?.label}
              </h2>
              <button
                onClick={() => setShowPromptModal(false)}
                style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', fontSize: 24, cursor: 'pointer', outline: 'none' }}
              >
                &times;
              </button>
            </div>
            <p style={{ color: 'var(--text-secondary)', fontSize: 13.5, margin: '0 0 16px 0', lineHeight: 1.5 }}>
              Copie o prompt detalhado abaixo e cole no ChatGPT, Claude ou similar para gerar automaticamente um arquivo XML de prospecção completo pronto para importação.
            </p>
            <div style={{ flex: 1, overflowY: 'auto', background: 'var(--bg-main)', border: '1px solid var(--border-color)', borderRadius: 10, padding: 16, fontFamily: 'monospace', fontSize: 12.5, color: 'var(--text-main)', whiteSpace: 'pre-wrap', marginBottom: 20, maxHeight: 350, textAlign: 'left' }}>
              {generatedPromptText}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
              <button
                onClick={() => setShowPromptModal(false)}
                className="btn btn-ghost"
                style={{ padding: '10px 20px', borderRadius: 8, fontWeight: 600 }}
              >
                Fechar
              </button>
              <button
                onClick={handleCopyPrompt}
                className="btn btn-primary"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '10px 24px',
                  borderRadius: 8,
                  fontWeight: 600,
                  background: copiedPrompt ? '#10b981' : 'linear-gradient(135deg, #818cf8, #6366f1)',
                  border: 'none',
                  color: '#fff',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease'
                }}
              >
                {copiedPrompt ? (
                  <>
                    <Check size={16} /> Prompt Copiado!
                  </>
                ) : (
                  <>
                    <ExternalLink size={16} /> Copiar Prompt
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
      
      {/* Modal de Preview de Envio */}
      {showPreviewModal && previewLead && (
        <div className="modal-overlay" style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(6px)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000 }}>
          <div className="modal-content" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: 16, padding: 28, width: 550, maxWidth: '95%', display: 'flex', flexDirection: 'column', gap: 16, boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.3)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-color)', paddingBottom: 12 }}>
              <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8, color: previewChannel === 'whatsapp' ? '#4ade80' : '#818cf8' }}>
                {previewChannel === 'whatsapp' ? <MessageSquare size={20} /> : <Mail size={20} />} 
                Visualizar Envio ({previewChannel === 'whatsapp' ? 'WhatsApp' : 'E-mail'} - P{previewStep})
              </h3>
              <button
                onClick={() => setShowPreviewModal(false)}
                style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', fontSize: 24, cursor: 'pointer', outline: 'none' }}
              >
                &times;
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, background: 'rgba(255,255,255,0.02)', padding: 12, borderRadius: 8, border: '1px solid var(--border-color)' }}>
              <div style={{ fontSize: 13 }}>🏢 <strong>Empresa:</strong> {previewLead.company_name}</div>
              <div style={{ fontSize: 13 }}>👤 <strong>Decisor:</strong> {previewLead.contact_name || 'Gestor'}</div>
              <div style={{ fontSize: 13 }}>📞 <strong>Destino:</strong> {previewChannel === 'whatsapp' ? previewLead.phone : previewLead.email}</div>
            </div>

            {previewChannel === 'email' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>Assunto do E-mail:</span>
                <input
                  type="text"
                  value={previewSubject}
                  onChange={e => setPreviewSubject(e.target.value)}
                  style={{
                    width: '100%',
                    background: 'var(--bg-main)',
                    color: 'var(--text-main)',
                    border: '1px solid var(--border-color)',
                    borderRadius: 8,
                    padding: '8px 12px',
                    fontSize: 13,
                    outline: 'none'
                  }}
                />
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>Mensagem (Você pode editar antes de enviar):</span>
              <textarea
                value={previewText}
                onChange={e => setPreviewText(e.target.value)}
                style={{
                  width: '100%',
                  height: 180,
                  background: 'var(--bg-main)',
                  color: 'var(--text-main)',
                  border: '1px solid var(--border-color)',
                  borderRadius: 8,
                  padding: 12,
                  fontSize: 13,
                  lineHeight: 1.5,
                  outline: 'none',
                  resize: 'none'
                }}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 8 }}>
              <button
                onClick={() => setShowPreviewModal(false)}
                className="btn btn-ghost"
                style={{ padding: '8px 16px', borderRadius: 8 }}
              >
                Cancelar
              </button>
              <button
                onClick={handleConfirmDispatch}
                disabled={sendingDispatch || !previewText.trim()}
                className="btn btn-primary"
                style={{
                  padding: '8px 20px',
                  borderRadius: 8,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  background: previewChannel === 'whatsapp' ? 'linear-gradient(135deg, #10b981, #059669)' : 'linear-gradient(135deg, #818cf8, #6366f1)',
                  border: 'none',
                  color: '#fff',
                  cursor: 'pointer'
                }}
              >
                {sendingDispatch ? <Loader2 size={14} className="spin" /> : <Check size={14} />} Confirmar e Enviar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Busca na Kipflow */}
      {searchKipflowModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 999, display: 'flex', justifyContent: 'center', alignItems: 'center', padding: 20 }}>
          <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: 12, width: '100%', maxWidth: 700, padding: 24, maxHeight: '85vh', overflowY: 'auto' }}>
            <h2 style={{ margin: '0 0 16px 0', fontSize: 20, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
              <Search size={20} color="#818cf8" /> Buscar Empresas no Kipflow
            </h2>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 20 }}>
              Pesquise na base de inteligência B2B por palavra-chave, segmento, CNPJ ou Estado.
            </p>

            <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
              <input
                type="text"
                placeholder="Ex: Odontologia, Hospital, Transportes..."
                value={kipflowQuery}
                onChange={e => setKipflowQuery(e.target.value)}
                style={{ flex: 1, background: 'var(--bg-main)', border: '1px solid var(--border-color)', borderRadius: 8, padding: '10px 14px', color: 'var(--text-main)', fontSize: 14 }}
              />
              <input
                type="text"
                placeholder="UF (Ex: SP, RJ)"
                maxLength={2}
                value={kipflowState}
                onChange={e => setKipflowState(e.target.value.toUpperCase())}
                style={{ width: 80, background: 'var(--bg-main)', border: '1px solid var(--border-color)', borderRadius: 8, padding: '10px 14px', color: 'var(--text-main)', fontSize: 14, textAlign: 'center' }}
              />
              <button
                onClick={handleSearchKipflow}
                disabled={searchingKipflow}
                style={{ background: 'linear-gradient(135deg, #6366f1, #8b5cf6)', border: 'none', color: '#fff', padding: '10px 20px', borderRadius: 8, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
              >
                {searchingKipflow ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />} Buscar
              </button>
            </div>

            {/* Resultados Kipflow */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {kipflowResults.map((item, idx) => (
                <div key={idx} style={{ background: 'var(--bg-main)', border: '1px solid var(--border-color)', borderRadius: 8, padding: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <strong style={{ fontSize: 15, display: 'block', color: 'var(--text-main)' }}>{item.company_name}</strong>
                    <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>CNPJ: {item.cnpj || '—'} | {item.city || ''} - {item.state || ''}</span>
                    <div style={{ fontSize: 12, color: '#818cf8', marginTop: 4 }}>{item.cnae_description || item.size || 'Empresa B2B'}</div>
                  </div>
                  <button
                    onClick={() => {
                      setSearchKipflowModal(false)
                      toast(`Empresa ${item.company_name} importada para o pipeline!`, 'success')
                    }}
                    style={{ background: 'rgba(34, 197, 94, 0.15)', color: '#22c55e', border: '1px solid rgba(34, 197, 94, 0.3)', borderRadius: 6, padding: '6px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
                  >
                    + Adicionar Lead
                  </button>
                </div>
              ))}

              {kipflowResults.length === 0 && !searchingKipflow && (
                <div style={{ textAlign: 'center', padding: '30px 0', color: 'var(--text-secondary)', fontSize: 13 }}>
                  Nenhuma busca realizada ainda. Digite os filtros acima e clique em Buscar.
                </div>
              )}
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 20 }}>
              <button
                onClick={() => setSearchKipflowModal(false)}
                className="btn btn-ghost"
                style={{ padding: '8px 16px', borderRadius: 8 }}
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
