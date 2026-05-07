import React, { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useToast } from '../components/Toast'
import {
  Briefcase, Search, Plus, MapPin, Phone, Mail, Award,
  Sparkles, Check, ChevronDown, ChevronUp, Trash2, ArrowRight,
  Loader2, Star, Megaphone, FileText, Globe, Building, CheckSquare, Square
} from 'lucide-react'

const API_URL = (import.meta.env.VITE_API_URL ?? 'https://reputei-api-production.up.railway.app').replace(/\/+$/, '')

interface Score {
  id: string
  target_type: 'company' | 'branch'
  target_id: string
  channel: 'google_maps' | 'reclame_aqui' | 'consumidor_gov' | 'tripadvisor' | 'booking' | 'ifood' | 'anatel' | 'ans' | 'outro'
  score: number
  score_max: number
  score_pct: number
  reputation_label?: string
  review_highlight?: string
  review_sentiment?: 'positive' | 'negative' | 'neutral'
  source_url?: string
}

interface Branch {
  id: string
  company_id: string
  name: string
  city?: string
  state?: string
  region?: string
  address?: string
  place_id_google?: string
  contact_name?: string
  phone?: string
  email?: string
  target_role?: string
  commercial_context?: string
  approach_argument?: string
  scores?: Score[]
}

interface Company {
  id: string
  name: string
  cnpj?: string
  segment_id: string
  notes?: string
  total_branches: number
  brand_scores: Score[]
  avg_score_pct: number | null
}

interface CampaignOption {
  id: string
  slug: string
  name: string
  campaign_date: string
  total_leads: number
}

const SEGMENT_LABELS: Record<string, string> = {
  seg_saude: 'Clínicas & Odonto',
  seg_plano_saude: 'Planos de Saúde',
  seg_imobi: 'Imobiliário & Construtoras',
  seg_auto: 'Automotivo & Concessionárias',
  seg_edu: 'Educação & IES',
  seg_hotel: 'Hotelaria & Turismo',
  seg_telecom: 'Telecom & Provedores',
  seg_varejo: 'Varejo & Franquias',
  seg_logistica: 'Transporte & Logística',
  seg_seguros: 'Seguradoras & Corretoras'
}

export default function Commercial() {
  const { toast } = useToast()
  const [loading, setLoading] = useState(true)
  const [companies, setCompanies] = useState<Company[]>([])
  const [campaigns, setCampaigns] = useState<CampaignOption[]>([])
  const [search, setSearch] = useState('')

  // Modais e seleções
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(null)
  const [selectedCompany, setSelectedCompany] = useState<Company & { branches: Branch[] } | null>(null)
  const [isNewCompanyOpen, setIsNewCompanyOpen] = useState(false)
  const [isPushOpen, setIsPushOpen] = useState(false)

  // Estados Nova Empresa
  const [newCompanyName, setNewCompanyName] = useState('')
  const [newCompanyCnpj, setNewCompanyCnpj] = useState('')
  const [newCompanySegment, setNewCompanySegment] = useState('seg_saude')
  const [newCompanyNotes, setNewCompanyNotes] = useState('')
  const [newBranches, setNewBranches] = useState<Array<Partial<Branch>>>([{ name: '' }])

  // Estados do Push (Exportação)
  const [selectedBranchIds, setSelectedBranchIds] = useState<Record<string, boolean>>({})
  const [pushCampaignType, setPushCampaignType] = useState<'existing' | 'new'>('existing')
  const [selectedCampaignSlug, setSelectedCampaignSlug] = useState('')
  const [newCampaignSlug, setNewCampaignSlug] = useState('')
  const [newCampaignName, setNewCampaignName] = useState('')
  const [newCampaignDate, setNewCampaignDate] = useState(new Date().toISOString().split('T')[0])
  const [pushing, setPushing] = useState(false)

  // Expansão de filiais no modal de detalhes
  const [expandedBranchId, setExpandedBranchId] = useState<string | null>(null)

  // Geradores de IA e Edições inline
  const [generatingArgumentId, setGeneratingArgumentId] = useState<string | null>(null)
  const [editingScores, setEditingScores] = useState<Record<string, Partial<Score>>>({})

  // Estados de Edição da Empresa Matriz
  const [isEditingCompany, setIsEditingCompany] = useState(false)
  const [editCompName, setEditCompName] = useState('')
  const [editCompCnpj, setEditCompCnpj] = useState('')
  const [editCompSegment, setEditCompSegment] = useState('')
  const [editCompNotes, setEditCompNotes] = useState('')

  useEffect(() => {
    loadData()
  }, [])

  async function loadData() {
    setLoading(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const headers = {
        'Content-Type': 'application/json',
        'Authorization': session ? `Bearer ${session.access_token}` : ''
      }

      // 1. Carregar Empresas
      const respComp = await fetch(`${API_URL}/api/admin/commercial/companies`, { headers })
      if (!respComp.ok) throw new Error('Erro ao carregar empresas')
      const dataComp = await respComp.json()
      setCompanies(dataComp)

      // 2. Carregar Campanhas para seleção
      const respCamp = await fetch(`${API_URL}/api/admin/commercial/campaigns-for-select`, { headers })
      if (respCamp.ok) {
        const dataCamp = await respCamp.json()
        setCampaigns(dataCamp)
        if (dataCamp.length > 0) setSelectedCampaignSlug(dataCamp[0].slug)
      }
    } catch (err: any) {
      toast(`Falha na sincronização: ${err.message}`, 'error')
    } finally {
      setLoading(false)
    }
  }

  async function loadCompanyDetails(id: string) {
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const resp = await fetch(`${API_URL}/api/admin/commercial/companies/${id}`, {
        headers: { 'Authorization': session ? `Bearer ${session.access_token}` : '' }
      })
      if (!resp.ok) throw new Error('Erro ao carregar detalhes')
      const data = await resp.json()
      setSelectedCompany(data)
      setSelectedCompanyId(id)

      // Inicializar estados de edição da matriz
      setEditCompName(data.name)
      setEditCompCnpj(data.cnpj || '')
      setEditCompSegment(data.segment_id)
      setEditCompNotes(data.notes || '')
      setIsEditingCompany(false)

      // Resetar seleção de filiais para exportação
      const initialBranchSelect: Record<string, boolean> = {}
      data.branches.forEach((b: Branch) => { initialBranchSelect[b.id] = true })
      setSelectedBranchIds(initialBranchSelect)
    } catch (err: any) {
      toast(`Erro ao carregar empresa: ${err.message}`, 'error')
    }
  }

  async function handleDeleteCompany(id: string) {
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const resp = await fetch(`${API_URL}/api/admin/commercial/companies/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': session ? `Bearer ${session.access_token}` : '' }
      })

      if (!resp.ok) throw new Error('Erro ao excluir do servidor')
      toast('Empresa excluída com sucesso!', 'success')
      setSelectedCompany(null)
      setSelectedCompanyId(null)
      loadData()
    } catch (err: any) {
      toast(`Falha ao excluir: ${err.message}`, 'error')
    }
  }

  async function handleUpdateCompany(updatedFields: { name?: string; cnpj?: string; segment_id?: string; notes?: string }) {
    if (!selectedCompanyId) return
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const resp = await fetch(`${API_URL}/api/admin/commercial/companies/${selectedCompanyId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': session ? `Bearer ${session.access_token}` : ''
        },
        body: JSON.stringify(updatedFields)
      })

      if (!resp.ok) throw new Error('Falha ao atualizar dados da matriz')
      toast('Informações da empresa matriz salvas!', 'success')
      setIsEditingCompany(false)
      loadCompanyDetails(selectedCompanyId)
      loadData()
    } catch (err: any) {
      toast(`Erro ao salvar matriz: ${err.message}`, 'error')
    }
  }

  // Criar empresa e filiais iniciais
  async function handleCreateCompany(e: React.FormEvent) {
    e.preventDefault()
    if (!newCompanyName) return toast('Nome da empresa é obrigatório', 'warning')

    try {
      const { data: { session } } = await supabase.auth.getSession()
      const branchesToSubmit = newBranches.filter(b => b.name)

      const payload = {
        company: {
          name: newCompanyName,
          cnpj: newCompanyCnpj || undefined,
          segment_id: newCompanySegment,
          notes: newCompanyNotes || undefined
        },
        branches: branchesToSubmit,
        scores: [] // scores podem ser adicionados no modal de edição inline após criação
      }

      const resp = await fetch(`${API_URL}/api/admin/commercial/companies`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': session ? `Bearer ${session.access_token}` : ''
        },
        body: JSON.stringify(payload)
      })

      if (!resp.ok) throw new Error('Erro ao salvar no servidor')
      toast('Empresa criada com sucesso!', 'success')
      setIsNewCompanyOpen(false)
      
      // Limpar campos
      setNewCompanyName('')
      setNewCompanyCnpj('')
      setNewCompanyNotes('')
      setNewBranches([{ name: '' }])

      loadData()
    } catch (err: any) {
      toast(`Falha ao criar: ${err.message}`, 'error')
    }
  }

  // Atualizar filial física
  async function handleUpdateBranch(branch: Branch, updatedFields: Partial<Branch>) {
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const resp = await fetch(`${API_URL}/api/admin/commercial/branches/${branch.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': session ? `Bearer ${session.access_token}` : ''
        },
        body: JSON.stringify(updatedFields)
      })

      if (!resp.ok) throw new Error('Falha ao atualizar dados')
      toast('Informações da filial salvas!', 'success')
      if (selectedCompanyId) loadCompanyDetails(selectedCompanyId)
    } catch (err: any) {
      toast(`Erro ao salvar: ${err.message}`, 'error')
    }
  }

  function updateBranchLocalState(branchId: string, fields: Partial<Branch>) {
    if (!selectedCompany) return
    setSelectedCompany(prev => {
      if (!prev) return null
      return {
        ...prev,
        branches: prev.branches.map(b => {
          if (b.id === branchId) {
            return { ...b, ...fields }
          }
          return b
        })
      }
    })
  }

  async function handleFetchGoogleMapsRating(branchId: string, placeId: string) {
    if (!placeId) return
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const resp = await fetch(`${API_URL}/api/admin/commercial/google-rating/${placeId}`, {
        headers: {
          'Authorization': session ? `Bearer ${session.access_token}` : ''
        }
      })
      if (!resp.ok) throw new Error('Falha ao obter nota do Google')
      const info = await resp.json()
      
      if (info.rating !== null && info.rating !== undefined) {
        const val = parseFloat(info.rating)
        setEditingScores(prev => ({
          ...prev,
          [`${branchId}-google_maps`]: { score: val, score_max: 5.0 }
        }))

        const scorePayload = {
          target_type: 'branch',
          target_id: branchId,
          channel: 'google_maps',
          score: val,
          score_max: 5.0,
          reputation_label: `${val}/5.0`,
          source_url: `https://www.google.com/maps/place/?q=place_id:${placeId}`
        }

        const scoreResp = await fetch(`${API_URL}/api/admin/commercial/scores`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': session ? `Bearer ${session.access_token}` : ''
          },
          body: JSON.stringify(scorePayload)
        })

        if (scoreResp.ok) {
          toast(`Nota do Google Maps (${val}) importada e salva automaticamente!`, 'success')
          if (selectedCompanyId) loadCompanyDetails(selectedCompanyId)
        }
      }
    } catch (err: any) {
      toast(`Não foi possível obter nota via Place ID: ${err.message}`, 'warning')
    }
  }

  // Adicionar score/nota de reputação
  async function handleUpsertScore(targetType: 'company' | 'branch', targetId: string, channel: string) {
    const editKey = `${targetId}-${channel}`
    const scoreData = editingScores[editKey]

    if (!scoreData || scoreData.score === undefined) {
      return toast('Por favor, informe a nota.', 'warning')
    }

    try {
      const { data: { session } } = await supabase.auth.getSession()
      const resp = await fetch(`${API_URL}/api/admin/commercial/scores`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': session ? `Bearer ${session.access_token}` : ''
        },
        body: JSON.stringify({
          target_type: targetType,
          target_id: targetId,
          channel,
          score: Number(scoreData.score),
          score_max: Number(scoreData.score_max ?? 5.0),
          reputation_label: scoreData.reputation_label,
          review_highlight: scoreData.review_highlight,
          review_sentiment: scoreData.review_sentiment || 'neutral',
          source_url: scoreData.source_url
        })
      })

      if (!resp.ok) throw new Error('Falha ao salvar nota')
      toast('Nota de reputação atualizada!', 'success')
      
      // Limpar estado de edição temporário
      setEditingScores(prev => {
        const copy = { ...prev }
        delete copy[editKey]
        return copy
      })

      if (selectedCompanyId) loadCompanyDetails(selectedCompanyId)
      loadData()
    } catch (err: any) {
      toast(`Erro ao salvar nota: ${err.message}`, 'error')
    }
  }

  // Gerar argumento de vendas inteligente usando Claude IA
  async function handleGenerateArgument(branchId: string) {
    setGeneratingArgumentId(branchId)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const resp = await fetch(`${API_URL}/api/admin/commercial/generate-argument`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': session ? `Bearer ${session.access_token}` : ''
        },
        body: JSON.stringify({ branch_id: branchId })
      })

      if (!resp.ok) throw new Error('Erro na resposta do gerador com IA')
      const data = await resp.json()
      toast('Argumento gerado com Claude IA com sucesso!', 'success')
      if (selectedCompanyId) loadCompanyDetails(selectedCompanyId)
    } catch (err: any) {
      toast(`Falha na IA: ${err.message}`, 'error')
    } finally {
      setGeneratingArgumentId(null)
    }
  }

  // Enviar Leads para a Esteira de Prospecção Outbound
  async function handlePushToProspect() {
    const branchIds = Object.keys(selectedBranchIds).filter(id => selectedBranchIds[id])

    if (branchIds.length === 0) {
      return toast('Selecione ao menos uma filial para prospecção', 'warning')
    }

    const campaignSlug = pushCampaignType === 'existing' ? selectedCampaignSlug : newCampaignSlug
    if (!campaignSlug) {
      return toast('Selecione ou crie uma campanha outbound', 'warning')
    }

    setPushing(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const resp = await fetch(`${API_URL}/api/admin/commercial/push-to-prospect`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': session ? `Bearer ${session.access_token}` : ''
        },
        body: JSON.stringify({
          campaign_slug: campaignSlug,
          campaign_name: pushCampaignType === 'new' ? newCampaignName || campaignSlug : undefined,
          campaign_date: pushCampaignType === 'new' ? newCampaignDate : undefined,
          branch_ids: branchIds
        })
      })

      if (!resp.ok) throw new Error('Falha ao exportar leads')
      const resData = await resp.json()

      toast(`Sucesso! ${resData.leads_added} leads exportados para a prospecção!`, 'success')
      setIsPushOpen(false)
      loadData()
    } catch (err: any) {
      toast(`Falha no envio: ${err.message}`, 'error')
    } finally {
      setPushing(false)
    }
  }

  // Filtrar lista de empresas
  const filteredCompanies = companies.filter(c => {
    const term = search.toLowerCase()
    return (
      c.name.toLowerCase().includes(term) ||
      (c.cnpj && c.cnpj.includes(term)) ||
      (SEGMENT_LABELS[c.segment_id] || '').toLowerCase().includes(term)
    )
  })

  // Calcular estatísticas agregadas corporativas
  const mappedCompaniesCount = companies.length
  const mappedBranchesCount = companies.reduce((acc, curr) => acc + curr.total_branches, 0)
  const avgScoresList = companies.map(c => c.avg_score_pct).filter((v): v is number => v !== null)
  const averageNetworkReputation = avgScoresList.length > 0 
    ? Math.round(avgScoresList.reduce((x, y) => x + y, 0) / avgScoresList.length) 
    : 0

  return (
    <div style={{ padding: '24px', fontFamily: 'Inter, system-ui, sans-serif', color: '#e2e8f0', background: '#090a0f', minHeight: '100vh' }}>
      <style>{`
        .glass-card {
          background: rgba(17, 18, 28, 0.7);
          backdrop-filter: blur(12px);
          border: 1px solid rgba(255, 255, 255, 0.06);
          border-radius: 16px;
        }
        .text-gradient {
          background: linear-gradient(135deg, #818cf8 0%, #c084fc 100%);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
        }
        .button-premium {
          background: linear-gradient(135deg, #6366f1 0%, #a855f7 100%);
          border: none;
          color: white;
          border-radius: 8px;
          cursor: pointer;
          font-weight: 500;
          transition: all 0.2s ease-in-out;
          box-shadow: 0 0 15px rgba(99, 102, 241, 0.4);
        }
        .button-premium:hover {
          transform: translateY(-2px);
          box-shadow: 0 0 25px rgba(168, 85, 247, 0.6);
        }
        .progress-bar-container {
          height: 8px;
          border-radius: 4px;
          background: rgba(255, 255, 255, 0.08);
          overflow: hidden;
        }
        .input-premium {
          background: rgba(30, 31, 46, 0.5);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 8px;
          color: white;
          padding: 8px 12px;
          outline: none;
          transition: border 0.2s;
        }
        .input-premium:focus {
          border-color: #6366f1;
        }
      `}</style>

      {/* ── HEADER ────────────────────────────────────────── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '32px' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
            <Briefcase size={24} style={{ color: '#818cf8' }} />
            <span style={{ fontSize: '13px', textTransform: 'uppercase', letterSpacing: '0.1em', color: '#818cf8', fontWeight: 600 }}>Time Comercial</span>
          </div>
          <h1 style={{ fontSize: '32px', fontWeight: 700, margin: 0 }}>
            Área de <span className="text-gradient">Prospecção Inteligente</span>
          </h1>
          <p style={{ color: '#94a3b8', fontSize: '14px', marginTop: '6px' }}>Mapeie corporações, monitore scores locais e gere abordagens de alto impacto usando IA.</p>
        </div>

        <button className="button-premium" style={{ padding: '12px 20px', display: 'flex', alignItems: 'center', gap: '8px' }} onClick={() => setIsNewCompanyOpen(true)}>
          <Plus size={18} />
          <span>Cadastrar Empresa-Alvo</span>
        </button>
      </div>

      {/* ── STATS SECTION ───────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '20px', marginBottom: '32px' }}>
        <div className="glass-card" style={{ padding: '20px', display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div style={{ width: '48px', height: '48px', borderRadius: '12px', background: 'rgba(99, 102, 241, 0.15)', display: 'flex', justifyContent: 'center', alignItems: 'center', color: '#6366f1' }}>
            <Building size={22} />
          </div>
          <div>
            <div style={{ fontSize: '13px', color: '#94a3b8' }}>Empresas Mapeadas</div>
            <div style={{ fontSize: '24px', fontWeight: 700 }}>{mappedCompaniesCount}</div>
          </div>
        </div>

        <div className="glass-card" style={{ padding: '20px', display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div style={{ width: '48px', height: '48px', borderRadius: '12px', background: 'rgba(168, 85, 247, 0.15)', display: 'flex', justifyContent: 'center', alignItems: 'center', color: '#a855f7' }}>
            <MapPin size={22} />
          </div>
          <div>
            <div style={{ fontSize: '13px', color: '#94a3b8' }}>Filiais Ativas Mapeadas</div>
            <div style={{ fontSize: '24px', fontWeight: 700 }}>{mappedBranchesCount}</div>
          </div>
        </div>

        <div className="glass-card" style={{ padding: '20px', display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div style={{ width: '48px', height: '48px', borderRadius: '12px', background: 'rgba(234, 179, 8, 0.15)', display: 'flex', justifyContent: 'center', alignItems: 'center', color: '#eab308' }}>
            <Star size={22} />
          </div>
          <div style={{ flexGrow: 1 }}>
            <div style={{ fontSize: '13px', color: '#94a3b8' }}>Reputação Média Geral</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
              <span style={{ fontSize: '24px', fontWeight: 700 }}>{averageNetworkReputation}%</span>
              <span style={{ fontSize: '12px', color: averageNetworkReputation >= 70 ? '#22c55e' : averageNetworkReputation >= 45 ? '#eab308' : '#ef4444' }}>
                ({averageNetworkReputation >= 70 ? 'Excelente' : averageNetworkReputation >= 45 ? 'Regular' : 'Crítica'})
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* ── BUSCA & FILTRO ──────────────────────────────────── */}
      <div style={{ display: 'flex', gap: '12px', marginBottom: '24px', position: 'relative' }}>
        <div style={{ position: 'relative', flexGrow: 1 }}>
          <Search size={18} style={{ position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)', color: '#64748b' }} />
          <input
            type="text"
            className="input-premium"
            placeholder="Pesquise por nome corporativo, CNPJ ou segmento comercial..."
            style={{ width: '100%', paddingLeft: '44px', boxSizing: 'border-box', height: '48px', fontSize: '14px' }}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* ── COMPANIES GRID ──────────────────────────────────── */}
      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px', padding: '64px 0' }}>
          <Loader2 size={32} className="animate-spin" style={{ color: '#6366f1' }} />
          <div style={{ fontSize: '14px', color: '#94a3b8' }}>Acessando base comercial do Reputei...</div>
        </div>
      ) : filteredCompanies.length === 0 ? (
        <div className="glass-card" style={{ padding: '64px', textAlign: 'center' }}>
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>🔍</div>
          <h3 style={{ fontSize: '18px', fontWeight: 600, margin: '0 0 8px 0' }}>Nenhuma empresa encontrada</h3>
          <p style={{ color: '#94a3b8', fontSize: '14px', margin: 0 }}>Tente mudar o termo da pesquisa ou crie um novo lead corporativo frio usando o botão acima.</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: '24px' }}>
          {filteredCompanies.map(c => {
            const scoreColor = c.avg_score_pct !== null && c.avg_score_pct >= 80 ? '#22c55e' : c.avg_score_pct !== null && c.avg_score_pct >= 50 ? '#eab308' : '#ef4444'

            return (
              <div key={c.id} className="glass-card" style={{ padding: '24px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', height: '240px', transition: 'transform 0.2s, border-color 0.2s' }}>
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
                    <span style={{ fontSize: '11px', background: 'rgba(99,102,241,0.15)', color: '#818cf8', fontWeight: 600, padding: '4px 8px', borderRadius: '6px', textTransform: 'uppercase' }}>
                      {SEGMENT_LABELS[c.segment_id] || c.segment_id}
                    </span>
                    <span style={{ fontSize: '12px', color: '#64748b', fontWeight: 500 }}>
                      {c.total_branches} {c.total_branches === 1 ? 'filial' : 'filiais'}
                    </span>
                  </div>

                  <h3 style={{ fontSize: '18px', fontWeight: 700, margin: '0 0 6px 0', color: 'white' }}>{c.name}</h3>
                  {c.cnpj && <div style={{ fontSize: '12px', color: '#64748b', marginBottom: '16px' }}>CNPJ: {c.cnpj}</div>}

                  {/* Barra de reputação corporativa */}
                  <div style={{ marginBottom: '16px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginBottom: '6px', color: '#94a3b8' }}>
                      <span>Reputação da Marca</span>
                      <span style={{ fontWeight: 600, color: scoreColor }}>{c.avg_score_pct !== null ? `${c.avg_score_pct}%` : 'Não pontuado'}</span>
                    </div>
                    {c.avg_score_pct !== null ? (
                      <div className="progress-bar-container">
                        <div style={{ width: `${c.avg_score_pct}%`, height: '100%', background: scoreColor }} />
                      </div>
                    ) : (
                      <div style={{ fontSize: '11px', color: '#64748b', fontStyle: 'italic' }}>Cadastre notas corporativas abrindo os detalhes do lead corporativo.</div>
                    )}
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '8px', borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '16px' }}>
                  <button
                    className="input-premium"
                    style={{ flexGrow: 1, cursor: 'pointer', padding: '8px', fontSize: '13px', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '6px' }}
                    onClick={() => loadCompanyDetails(c.id)}
                  >
                    <span>Mapeamento & Detalhes</span>
                    <ArrowRight size={14} />
                  </button>

                  <button
                    className="button-premium"
                    style={{ cursor: 'pointer', padding: '8px 16px', fontSize: '13px', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '6px' }}
                    onClick={async () => {
                      await loadCompanyDetails(c.id)
                      setIsPushOpen(true)
                    }}
                  >
                    <Megaphone size={14} />
                    <span>Prospectar</span>
                  </button>

                  <button
                    className="button-premium"
                    style={{ background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.2)', color: '#ef4444', cursor: 'pointer', padding: '8px 12px', fontSize: '13px', display: 'flex', justifyContent: 'center', alignItems: 'center' }}
                    title="Excluir Empresa"
                    onClick={() => {
                      if (confirm(`Tem certeza que deseja excluir a empresa "${c.name}" e todas as suas filiais do sistema comercial?`)) {
                        handleDeleteCompany(c.id)
                      }
                    }}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* ── MODAL: NOVA EMPRESA (PASSO-A-PASSO) ────────────────── */}
      {isNewCompanyOpen && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(5, 5, 10, 0.8)', backdropFilter: 'blur(10px)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000, padding: '24px' }}>
          <div className="glass-card" style={{ width: '100%', maxWidth: '600px', padding: '32px', boxSizing: 'border-box', maxHeight: '90vh', overflowY: 'auto' }}>
            <h2 style={{ fontSize: '24px', fontWeight: 700, margin: '0 0 8px 0', color: 'white' }}>Cadastrar Empresa-Alvo</h2>
            <p style={{ color: '#94a3b8', fontSize: '14px', margin: '0 0 24px 0' }}>Mapeie marcas nacionais e adicione suas unidades físicas para geração posterior de argumentos com IA.</p>

            <form onSubmit={handleCreateCompany} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ fontSize: '13px', fontWeight: 500, color: '#94a3b8' }}>Nome Corporativo (Marca Principal) *</label>
                <input
                  type="text"
                  required
                  className="input-premium"
                  placeholder="Ex: OdontoCompany"
                  value={newCompanyName}
                  onChange={(e) => setNewCompanyName(e.target.value)}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={{ fontSize: '13px', fontWeight: 500, color: '#94a3b8' }}>CNPJ (Opcional)</label>
                  <input
                    type="text"
                    className="input-premium"
                    placeholder="Ex: 00.000.000/0000-00"
                    value={newCompanyCnpj}
                    onChange={(e) => setNewCompanyCnpj(e.target.value)}
                  />
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={{ fontSize: '13px', fontWeight: 500, color: '#94a3b8' }}>Segmento Comercial</label>
                  <select
                    className="input-premium"
                    style={{ height: '42px', cursor: 'pointer' }}
                    value={newCompanySegment}
                    onChange={(e) => setNewCompanySegment(e.target.value)}
                  >
                    {Object.entries(SEGMENT_LABELS).map(([val, lbl]) => (
                      <option key={val} value={val} style={{ background: '#090a0f' }}>{lbl}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ fontSize: '13px', fontWeight: 500, color: '#94a3b8' }}>Notas / Observações Corporativas</label>
                <textarea
                  className="input-premium"
                  style={{ resize: 'none', height: '60px' }}
                  placeholder="Observações sob concorrência, canais mapeados ou contato corporativo geral."
                  value={newCompanyNotes}
                  onChange={(e) => setNewCompanyNotes(e.target.value)}
                />
              </div>

              {/* Seção Filiais Iniciais */}
              <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '16px', marginTop: '8px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                  <label style={{ fontSize: '14px', fontWeight: 600, color: 'white' }}>Unidades / Filiais Iniciais</label>
                  <button
                    type="button"
                    className="input-premium"
                    style={{ padding: '4px 8px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer' }}
                    onClick={() => setNewBranches(prev => [...prev, { name: '' }])}
                  >
                    <Plus size={14} />
                    <span>Adicionar mais uma</span>
                  </button>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {newBranches.map((b, idx) => (
                    <div key={idx} style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                      <input
                        type="text"
                        className="input-premium"
                        style={{ flexGrow: 1 }}
                        placeholder={`Unidade ${idx + 1} (Ex: OdontoCompany Palmas Sul)`}
                        value={b.name || ''}
                        onChange={(e) => {
                          const val = e.target.value
                          setNewBranches(prev => {
                            const copy = [...prev]
                            copy[idx] = { ...copy[idx], name: val }
                            return copy
                          })
                        }}
                      />
                      {newBranches.length > 1 && (
                        <button
                          type="button"
                          className="input-premium"
                          style={{ padding: '8px', color: '#ef4444', borderColor: 'rgba(239, 68, 68, 0.2)', cursor: 'pointer' }}
                          onClick={() => setNewBranches(prev => prev.filter((_, i) => i !== idx))}
                        >
                          <Trash2 size={16} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <div style={{ display: 'flex', gap: '12px', borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '24px', marginTop: '16px' }}>
                <button type="button" className="input-premium" style={{ flexGrow: 1, cursor: 'pointer' }} onClick={() => setIsNewCompanyOpen(false)}>Cancelar</button>
                <button type="submit" className="button-premium" style={{ flexGrow: 1, cursor: 'pointer', height: '42px' }}>Salvar Empresa</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── MODAL: MAPEAMENTO & DETALHES ────────────────────────── */}
      {selectedCompanyId && selectedCompany && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(5, 5, 10, 0.8)', backdropFilter: 'blur(10px)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000, padding: '24px' }}>
          <div className="glass-card" style={{ width: '100%', maxWidth: '900px', padding: '32px', boxSizing: 'border-box', maxHeight: '90vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '24px' }}>
            
            {/* Header Detalhes */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: '16px' }}>
              {isEditingCompany ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', flexGrow: 1, marginRight: '24px' }}>
                  <div style={{ display: 'flex', gap: '12px' }}>
                    <div style={{ flex: 2 }}>
                      <label style={{ fontSize: '11px', color: '#64748b', display: 'block', marginBottom: '4px' }}>Nome Corporativo</label>
                      <input
                        type="text"
                        className="input-premium"
                        style={{ width: '100%', boxSizing: 'border-box' }}
                        value={editCompName}
                        onChange={(e) => setEditCompName(e.target.value)}
                      />
                    </div>
                    <div style={{ flex: 1 }}>
                      <label style={{ fontSize: '11px', color: '#64748b', display: 'block', marginBottom: '4px' }}>CNPJ (Opcional)</label>
                      <input
                        type="text"
                        className="input-premium"
                        style={{ width: '100%', boxSizing: 'border-box' }}
                        value={editCompCnpj}
                        onChange={(e) => setEditCompCnpj(e.target.value)}
                      />
                    </div>
                  </div>
                  <div>
                    <label style={{ fontSize: '11px', color: '#64748b', display: 'block', marginBottom: '4px' }}>Segmento Comercial</label>
                    <select
                      className="input-premium"
                      style={{ width: '100%', boxSizing: 'border-box', height: '38px', cursor: 'pointer' }}
                      value={editCompSegment}
                      onChange={(e) => setEditCompSegment(e.target.value)}
                    >
                      {Object.entries(SEGMENT_LABELS).map(([val, lbl]) => (
                        <option key={val} value={val} style={{ background: '#090a0f' }}>{lbl}</option>
                      ))}
                    </select>
                  </div>
                  <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
                    <button
                      type="button"
                      className="button-premium"
                      style={{ padding: '6px 12px', fontSize: '12px', cursor: 'pointer' }}
                      onClick={() => handleUpdateCompany({ name: editCompName, cnpj: editCompCnpj || undefined, segment_id: editCompSegment, notes: editCompNotes || undefined })}
                    >
                      Salvar Matriz
                    </button>
                    <button
                      type="button"
                      className="input-premium"
                      style={{ padding: '6px 12px', fontSize: '12px', cursor: 'pointer' }}
                      onClick={() => setIsEditingCompany(false)}
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              ) : (
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <span style={{ fontSize: '11px', background: 'rgba(99,102,241,0.15)', color: '#818cf8', fontWeight: 600, padding: '4px 8px', borderRadius: '6px', textTransform: 'uppercase' }}>
                      {SEGMENT_LABELS[selectedCompany.segment_id] || selectedCompany.segment_id}
                    </span>
                    <button
                      type="button"
                      className="input-premium"
                      style={{ padding: '2px 8px', fontSize: '11px', cursor: 'pointer', borderColor: 'rgba(99,102,241,0.2)', color: '#818cf8' }}
                      onClick={() => setIsEditingCompany(true)}
                    >
                      Editar Matriz
                    </button>
                  </div>
                  <h2 style={{ fontSize: '28px', fontWeight: 700, color: 'white', margin: '4px 0 0 0' }}>{selectedCompany.name}</h2>
                  {selectedCompany.cnpj && <p style={{ fontSize: '13px', color: '#64748b', margin: '2px 0 0 0' }}>CNPJ: {selectedCompany.cnpj}</p>}
                </div>
              )}
              <button className="input-premium" style={{ cursor: 'pointer' }} onClick={() => { setSelectedCompany(null); setSelectedCompanyId(null) }}>Fechar</button>
            </div>

            {/* Grid Detalhes Corporativo */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.5fr', gap: '24px' }}>
              
              {/* Notas e Scores Corporativos */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <h3 style={{ fontSize: '16px', fontWeight: 600, margin: 0, display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Award size={16} style={{ color: '#818cf8' }} />
                  <span>Reputação Nível Corporativo</span>
                </h3>

                {/* Editor/Visualizador de Notas por Canal */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', background: 'rgba(30, 31, 46, 0.3)', padding: '16px', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.04)' }}>
                  {['reclame_aqui', 'google_maps', 'ifood', 'tripadvisor'].map(channel => {
                    const sc = selectedCompany.brand_scores.find(s => s.channel === channel)
                    const editKey = `${selectedCompany.id}-${channel}`
                    const editVal = editingScores[editKey]

                    return (
                      <div key={channel} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.03)', paddingBottom: '8px' }}>
                        <div>
                          <div style={{ fontSize: '12px', fontWeight: 600, textTransform: 'uppercase', color: '#94a3b8' }}>
                            {channel.replace('_', ' ')}
                          </div>
                          <div style={{ fontSize: '13px', color: sc ? '#22c55e' : '#64748b', fontWeight: 600 }}>
                            {sc ? `${sc.score} / ${sc.score_max}` : 'Não mapeada'}
                          </div>
                        </div>

                        {/* Form em Linha */}
                        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                          <input
                            type="number"
                            step="0.1"
                            className="input-premium"
                            style={{ width: '60px', padding: '4px', textAlign: 'center', fontSize: '12px' }}
                            placeholder="Nota"
                            value={editVal?.score !== undefined ? editVal.score : sc?.score || ''}
                            onChange={(e) => {
                              const val = parseFloat(e.target.value)
                              setEditingScores(prev => ({
                                ...prev,
                                [editKey]: { ...prev[editKey], score: isNaN(val) ? undefined : val, score_max: channel === 'reclame_aqui' ? 10.0 : 5.0 }
                              }))
                            }}
                          />
                          <button
                            className="input-premium"
                            style={{ padding: '4px 8px', fontSize: '11px', cursor: 'pointer', borderColor: 'rgba(99,102,241,0.2)', color: '#818cf8' }}
                            onClick={() => handleUpsertScore('company', selectedCompany.id, channel)}
                          >
                            Salvar
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={{ fontSize: '12px', color: '#64748b' }}>Notas do Operador</label>
                  {isEditingCompany ? (
                    <textarea
                      className="input-premium"
                      style={{ width: '100%', boxSizing: 'border-box', height: '80px', fontSize: '13px', color: '#ffffff', resize: 'vertical' }}
                      placeholder="Adicione observações corporativas da matriz..."
                      value={editCompNotes}
                      onChange={(e) => setEditCompNotes(e.target.value)}
                    />
                  ) : (
                    <p style={{ fontSize: '13px', color: '#94a3b8', background: 'rgba(255,255,255,0.02)', padding: '12px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.04)', margin: 0 }}>
                      {selectedCompany.notes || 'Sem observações corporativas cadastradas.'}
                    </p>
                  )}
                </div>
              </div>

              {/* Gestão das Filiais Físicas */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <h3 style={{ fontSize: '16px', fontWeight: 600, margin: 0, display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <MapPin size={16} style={{ color: '#a855f7' }} />
                    <span>Unidades Ativas ({selectedCompany.branches.length})</span>
                  </h3>

                  <button
                    className="input-premium"
                    style={{ padding: '4px 8px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer' }}
                    onClick={async () => {
                      const name = prompt('Nome da nova filial física:')
                      if (name) {
                        const { data: { session } } = await supabase.auth.getSession()
                        const resp = await fetch(`${API_URL}/api/admin/commercial/branches`, {
                          method: 'POST',
                          headers: {
                            'Content-Type': 'application/json',
                            'Authorization': session ? `Bearer ${session.access_token}` : ''
                          },
                          body: JSON.stringify({ company_id: selectedCompany.id, name })
                        })
                        if (resp.ok) {
                          toast('Filial adicionada com sucesso!', 'success')
                          loadCompanyDetails(selectedCompany.id)
                        }
                      }
                    }}
                  >
                    <Plus size={12} />
                    <span>Adicionar</span>
                  </button>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', maxHeight: '420px', overflowY: 'auto', paddingRight: '8px' }}>
                  {selectedCompany.branches.map(branch => {
                    const isExpanded = expandedBranchId === branch.id
                    const branchGoogleScore = branch.scores?.find(s => s.target_type === 'branch' && s.channel === 'google_maps')?.score

                    return (
                      <div key={branch.id} className="glass-card" style={{ padding: '16px', border: '1px solid rgba(255,255,255,0.04)', borderRadius: '12px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <div>
                            <div style={{ fontWeight: 600, color: 'white', fontSize: '14px' }}>{branch.name}</div>
                            <div style={{ fontSize: '12px', color: '#64748b', display: 'flex', alignItems: 'center', gap: '4px', marginTop: '2px' }}>
                              <MapPin size={12} />
                              <span>{branch.city || 'N/A'} - {branch.state || 'N/A'}</span>
                              <span style={{ margin: '0 4px' }}>·</span>
                              <Star size={12} style={{ color: '#eab308' }} />
                              <span>Google: {branchGoogleScore ? `${branchGoogleScore}/5` : 'N/A'}</span>
                            </div>
                          </div>

                          <div style={{ display: 'flex', gap: '6px' }}>
                            <button
                              className="input-premium"
                              style={{ padding: '6px', cursor: 'pointer' }}
                              onClick={() => setExpandedBranchId(isExpanded ? null : branch.id)}
                            >
                              {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                            </button>
                          </div>
                        </div>

                        {/* Painel Expansível de Abordagem Comercial */}
                        {isExpanded && (
                          <div style={{ marginTop: '16px', borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                            
                            {/* Inputs de Contato e Localidade */}
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                <label style={{ fontSize: '11px', color: '#64748b' }}>Contato / Gestor</label>
                                <input
                                  type="text"
                                  className="input-premium"
                                  style={{ padding: '6px', fontSize: '12px' }}
                                  value={branch.contact_name || ''}
                                  placeholder="Nome"
                                  onChange={(e) => updateBranchLocalState(branch.id, { contact_name: e.target.value })}
                                  onBlur={(e) => handleUpdateBranch(branch, { contact_name: e.target.value })}
                                />
                              </div>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                <label style={{ fontSize: '11px', color: '#64748b' }}>Cargo / Decisor</label>
                                <input
                                  type="text"
                                  className="input-premium"
                                  style={{ padding: '6px', fontSize: '12px' }}
                                  value={branch.target_role || ''}
                                  placeholder="Ex: Diretor Técnico"
                                  onChange={(e) => updateBranchLocalState(branch.id, { target_role: e.target.value })}
                                  onBlur={(e) => handleUpdateBranch(branch, { target_role: e.target.value })}
                                />
                              </div>
                            </div>

                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1.2fr', gap: '12px' }}>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                <label style={{ fontSize: '11px', color: '#64748b' }}>Telefone</label>
                                <input
                                  type="text"
                                  className="input-premium"
                                  style={{ padding: '6px', fontSize: '12px' }}
                                  value={branch.phone || ''}
                                  placeholder="Ex: 6399999999"
                                  onChange={(e) => updateBranchLocalState(branch.id, { phone: e.target.value })}
                                  onBlur={(e) => handleUpdateBranch(branch, { phone: e.target.value })}
                                />
                              </div>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                <label style={{ fontSize: '11px', color: '#64748b' }}>Cidade</label>
                                <input
                                  type="text"
                                  className="input-premium"
                                  style={{ padding: '6px', fontSize: '12px' }}
                                  value={branch.city || ''}
                                  placeholder="Palmas"
                                  onChange={(e) => updateBranchLocalState(branch.id, { city: e.target.value })}
                                  onBlur={(e) => handleUpdateBranch(branch, { city: e.target.value })}
                                />
                              </div>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                <label style={{ fontSize: '11px', color: '#64748b' }}>E-mail de Contato</label>
                                <input
                                  type="email"
                                  className="input-premium"
                                  style={{ padding: '6px', fontSize: '12px' }}
                                  value={branch.email || ''}
                                  placeholder="contato@empresa.com"
                                  onChange={(e) => updateBranchLocalState(branch.id, { email: e.target.value })}
                                  onBlur={(e) => handleUpdateBranch(branch, { email: e.target.value })}
                                />
                              </div>
                            </div>

                            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                              <label style={{ fontSize: '11px', color: '#64748b' }}>Contexto Local / Observações da Unidade</label>
                              <textarea
                                className="input-premium"
                                style={{ height: '50px', fontSize: '12px', resize: 'none' }}
                                placeholder="Notas de abordagem anteriores, detalhes sobre a concorrência local..."
                                value={branch.commercial_context || ''}
                                onChange={(e) => updateBranchLocalState(branch.id, { commercial_context: e.target.value })}
                                onBlur={(e) => handleUpdateBranch(branch, { commercial_context: e.target.value })}
                              />
                            </div>

                             {/* Editor de Notas por Canal específico da filial (Ex: Google Maps e Place ID) */}
                             <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '12px', alignItems: 'flex-end', background: 'rgba(255,255,255,0.01)', padding: '10px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.03)' }}>
                               <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                 <label style={{ fontSize: '11px', color: '#64748b' }}>Google Place ID (Gera nota automática)</label>
                                 <input
                                   type="text"
                                   className="input-premium"
                                   style={{ padding: '6px', fontSize: '12px' }}
                                   placeholder="Ex: ChIJs089F..."
                                   value={branch.place_id_google || ''}
                                   onChange={(e) => updateBranchLocalState(branch.id, { place_id_google: e.target.value })}
                                   onBlur={(e) => {
                                     const trimmed = e.target.value.trim()
                                     handleUpdateBranch(branch, { place_id_google: trimmed })
                                     if (trimmed) handleFetchGoogleMapsRating(branch.id, trimmed)
                                   }}
                                 />
                               </div>
                               <div>
                                 <label style={{ fontSize: '11px', color: '#64748b' }}>Nota Google Maps desta filial</label>
                                 <div style={{ display: 'flex', gap: '6px', marginTop: '4px' }}>
                                   <input
                                     type="number"
                                     step="0.1"
                                     className="input-premium"
                                     style={{ width: '70px', padding: '4px', fontSize: '12px' }}
                                     placeholder="Google"
                                     value={editingScores[`${branch.id}-google_maps`]?.score !== undefined ? editingScores[`${branch.id}-google_maps`].score : branchGoogleScore || ''}
                                     onChange={(e) => {
                                       const val = parseFloat(e.target.value)
                                       setEditingScores(prev => ({
                                         ...prev,
                                         [`${branch.id}-google_maps`]: { score: isNaN(val) ? undefined : val, score_max: 5.0 }
                                       }))
                                     }}
                                   />
                                   <button
                                     className="input-premium"
                                     style={{ padding: '4px 8px', fontSize: '11px', cursor: 'pointer' }}
                                     onClick={() => handleUpsertScore('branch', branch.id, 'google_maps')}
                                   >
                                     Salvar Nota
                                   </button>
                                 </div>
                               </div>
                             </div>

                            {/* Argumento Comercial gerado por IA */}
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', background: 'rgba(99,102,241,0.04)', padding: '12px', borderRadius: '10px', border: '1px solid rgba(99,102,241,0.1)' }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <span style={{ fontSize: '12px', fontWeight: 600, color: '#818cf8', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                  <Sparkles size={14} />
                                  <span>Argumento de Vendas IA (Claude)</span>
                                </span>

                                <button
                                  type="button"
                                  className="button-premium"
                                  style={{ padding: '4px 10px', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '4px' }}
                                  disabled={generatingArgumentId !== null}
                                  onClick={() => handleGenerateArgument(branch.id)}
                                >
                                  {generatingArgumentId === branch.id ? (
                                    <>
                                      <Loader2 size={12} className="animate-spin" />
                                      <span>Formulando...</span>
                                    </>
                                  ) : (
                                    <>
                                      <Sparkles size={12} />
                                      <span>Gerar com IA</span>
                                    </>
                                  )}
                                </button>
                              </div>

                              <textarea
                                className="input-premium"
                                style={{ height: '80px', fontSize: '12px', background: 'rgba(10,11,18,0.5)', border: '1px solid rgba(99,102,241,0.15)', color: '#e2e8f0' }}
                                value={branch.approach_argument || ''}
                                placeholder="Gere e salve uma abordagem personalizada clicando no botão acima."
                                onChange={(e) => updateBranchLocalState(branch.id, { approach_argument: e.target.value })}
                                onBlur={(e) => handleUpdateBranch(branch, { approach_argument: e.target.value })}
                              />
                            </div>

                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>

            </div>

            <div style={{ display: 'flex', gap: '12px', borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '24px', justifyContent: 'flex-end' }}>
              <button className="input-premium" style={{ cursor: 'pointer' }} onClick={() => { setSelectedCompany(null); setSelectedCompanyId(null) }}>Fechar Detalhes</button>
            </div>

          </div>
        </div>
      )}

      {/* ── MODAL: EXPORTAR PARA PROSPECÇÃO OUTBOUND ────────────── */}
      {isPushOpen && selectedCompany && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(5, 5, 10, 0.8)', backdropFilter: 'blur(10px)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000, padding: '24px' }}>
          <div className="glass-card" style={{ width: '100%', maxWidth: '550px', padding: '32px', boxSizing: 'border-box', maxHeight: '90vh', overflowY: 'auto' }}>
            <h2 style={{ fontSize: '24px', fontWeight: 700, margin: '0 0 8px 0', color: 'white', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Megaphone size={22} style={{ color: '#818cf8' }} />
              <span>Enviar para Esteira de Outbound</span>
            </h2>
            <p style={{ color: '#94a3b8', fontSize: '14px', margin: '0 0 24px 0' }}>Exporte os dados das filiais selecionadas para uma campanha de prospecção e cadenciamento de e-mail/WhatsApp.</p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              
              {/* Seleção de Filiais */}
              <div>
                <label style={{ fontSize: '13px', fontWeight: 600, color: 'white', marginBottom: '8px', display: 'block' }}>Selecionar Filiais Destinatárias</label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', background: 'rgba(255,255,255,0.02)', padding: '12px', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.04)', maxHeight: '180px', overflowY: 'auto' }}>
                  {selectedCompany.branches.map(b => {
                    const isChecked = !!selectedBranchIds[b.id]
                    return (
                      <div key={b.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }} onClick={() => setSelectedBranchIds(prev => ({ ...prev, [b.id]: !isChecked }))}>
                        {isChecked ? <CheckSquare size={16} style={{ color: '#6366f1' }} /> : <Square size={16} style={{ color: '#64748b' }} />}
                        <span style={{ fontSize: '13px', color: isChecked ? 'white' : '#94a3b8' }}>{b.name}</span>
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* Escolha Campanha */}
              <div>
                <label style={{ fontSize: '13px', fontWeight: 600, color: 'white', marginBottom: '8px', display: 'block' }}>Campanha Outbound de Destino</label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '12px' }}>
                  <button className="input-premium" style={{ borderColor: pushCampaignType === 'existing' ? '#6366f1' : 'rgba(255,255,255,0.06)', color: pushCampaignType === 'existing' ? 'white' : '#64748b', cursor: 'pointer', fontSize: '13px' }} onClick={() => setPushCampaignType('existing')}>
                    Campanha Existente
                  </button>
                  <button className="input-premium" style={{ borderColor: pushCampaignType === 'new' ? '#6366f1' : 'rgba(255,255,255,0.06)', color: pushCampaignType === 'new' ? 'white' : '#64748b', cursor: 'pointer', fontSize: '13px' }} onClick={() => setPushCampaignType('new')}>
                    + Criar Nova Campanha
                  </button>
                </div>

                {pushCampaignType === 'existing' ? (
                  <select className="input-premium" style={{ width: '100%', cursor: 'pointer' }} value={selectedCampaignSlug} onChange={(e) => setSelectedCampaignSlug(e.target.value)}>
                    {campaigns.map(c => (
                      <option key={c.id} value={c.slug} style={{ background: '#090a0f' }}>{c.name} ({c.total_leads} leads)</option>
                    ))}
                  </select>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    <input
                      type="text"
                      className="input-premium"
                      placeholder="Identificador (Ex: odonto_leads_nordeste)"
                      value={newCampaignSlug}
                      onChange={(e) => setNewCampaignSlug(e.target.value)}
                    />
                    <input
                      type="text"
                      className="input-premium"
                      placeholder="Nome da Campanha (Ex: Campanha Odonto Nordeste)"
                      value={newCampaignName}
                      onChange={(e) => setNewCampaignName(e.target.value)}
                    />
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      <label style={{ fontSize: '11px', color: '#64748b' }}>Data de Referência</label>
                      <input
                        type="date"
                        className="input-premium"
                        value={newCampaignDate}
                        onChange={(e) => setNewCampaignDate(e.target.value)}
                      />
                    </div>
                  </div>
                )}
              </div>

              <div style={{ display: 'flex', gap: '12px', borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '24px', marginTop: '16px' }}>
                <button type="button" className="input-premium" style={{ flexGrow: 1, cursor: 'pointer' }} onClick={() => setIsPushOpen(false)}>Cancelar</button>
                <button type="button" className="button-premium" style={{ flexGrow: 1, cursor: 'pointer', height: '42px', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '6px' }} disabled={pushing} onClick={handlePushToProspect}>
                  {pushing ? (
                    <>
                      <Loader2 size={16} className="animate-spin" />
                      <span>Exportando...</span>
                    </>
                  ) : (
                    <>
                      <Megaphone size={16} />
                      <span>Exportar Leads Comerciais</span>
                    </>
                  )}
                </button>
              </div>

            </div>
          </div>
        </div>
      )}

    </div>
  )
}
