import { useEffect, useState, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import type { Connector, SourceChannel } from '../lib/supabase'
import { API_URL, CHANNEL_LABELS, CHANNEL_ICONS, formatDate, timeAgo } from '../lib/utils'
import { Trash2, AlertTriangle, Activity, Settings, ServerCrash, Clock } from 'lucide-react'
import { MetaConnectButton } from '../components/MetaConnectButton'
import { useToast } from '../components/Toast'

// Limites para alertas de saúde do sistema
const STUCK_RUNNING_THRESHOLD_MIN = 45  // Conectores em 'running' por mais de X min → scheduler morto
const OVERDUE_SYNC_THRESHOLD_HOURS = 3  // Última sync há mais de X horas → scheduler atrasado

// ──────────────────────────────────────────────────────────────
// Página Conectores
// ──────────────────────────────────────────────────────────────

const STATUS_LABEL: Record<string, string> = {
  active:         'Ativo',
  paused:         'Pausado',
  error:          'Erro',
  pending:        'Aguardando',
  pending_config: 'Config. Pendente',
  running:        'Sincronizando',
}

const STATUS_DOT: Record<string, string> = {
  active:         '🟢',
  paused:         '⚫',
  error:          '🔴',
  pending:        '🟡',
  pending_config: '🟠',
  running:        '🔵',
}

// Todos os 8 canais suportados pelo sistema
const ALL_CHANNELS = [
  'google_maps', 'tripadvisor', 'trustpilot', 'reclame_aqui',
  'consumidor_gov', 'reddit', 'facebook', 'instagram'
]

interface ConnectorStats {
  connector_id: string
  total: number
  last30: number
  negativeRate: number
  avgScore: number
}

export default function Connectors() {
  const { toast } = useToast()
  const [connectors, setConnectors] = useState<Connector[]>([])
  const [stats, setStats] = useState<Record<string, ConnectorStats>>({})
  const [businesses, setBusinesses] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<Connector | null>(null)
  const [editingConfig, setEditingConfig] = useState(false)
  const [intervalMinutes, setIntervalMinutes] = useState(60)
  const [editingExternalId, setEditingExternalId] = useState('')
  const [editingConfigJson, setEditingConfigJson] = useState('')

  // Estados de saúde da API de coleta (Railway)
  const [apiStatus, setApiStatus] = useState<'checking' | 'online' | 'offline'>('checking')
  const [apiLatency, setApiLatency] = useState<number | null>(null)
  const [apiErrorMsg, setApiErrorMsg] = useState<string | null>(null)

  const [resettingAll, setResettingAll] = useState(false)

  // Filtros da tabela
  const [filterChannel, setFilterChannel] = useState('')
  const [filterBusiness, setFilterBusiness] = useState('')

  // Estados do novo conector
  const [allBusinesses, setAllBusinesses] = useState<{id: string, name: string, tenant_id: string}[]>([])
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [newConn, setNewConn] = useState({ 
    business_id: '', 
    channel: 'google_maps', 
    external_id: '',
    instagram_username: '',
    hashtags: '',
    fb_url: ''
  })

  // Hook para verificar a saúde da API (Railway)
  useEffect(() => {
    async function checkApiHealth() {
      const start = Date.now()
      try {
        const res = await fetch(`${API_URL}/health`, { signal: AbortSignal.timeout(6000) })
        const duration = Date.now() - start
        if (res.ok) {
          const data = await res.json()
          if (data && data.ok) {
            setApiStatus('online')
            setApiLatency(duration)
            setApiErrorMsg(null)
          } else {
            setApiStatus('offline')
            setApiErrorMsg(`Resposta inesperada do servidor: ${JSON.stringify(data)}`)
          }
        } else {
          setApiStatus('offline')
          setApiErrorMsg(`Erro HTTP ${res.status} (${res.statusText})`)
        }
      } catch (err: any) {
        setApiStatus('offline')
        setApiErrorMsg(err.message || 'Falha na conexão de rede (CORS, DNS ou Servidor inativo)')
      }
    }

    checkApiHealth()
    const interval = setInterval(checkApiHealth, 25_000) // Verifica a cada 25s
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    loadAll()
    const handleRefresh = () => loadAll()
    window.addEventListener('refresh_data', handleRefresh)
    
    // ──────────────────────────────────────────────────────────────
    // Supabase Realtime - Atualizar status, criação e remoção sem F5
    // ──────────────────────────────────────────────────────────────
    const channel = supabase
      .channel('public:channel_connectors')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'channel_connectors' },
        (payload) => {
          console.log('[Realtime] Mudança detectada no conector:', payload.eventType, payload.new || payload.old)
          
          if (payload.eventType === 'INSERT') {
            loadAll() // Recarregar tudo para pegar joins
          } else if (payload.eventType === 'UPDATE') {
            const updated = payload.new as Connector
            setConnectors(current => 
              current.map(c => {
                if (c.id === updated.id) return { ...c, ...updated }
                return c
              })
            )
          } else if (payload.eventType === 'DELETE') {
            const deletedId = (payload.old as any).id
            setConnectors(current => current.filter(c => c.id !== deletedId))
          }
        }
      )
      .subscribe()

    return () => {
      window.removeEventListener('refresh_data', handleRefresh)
      supabase.removeChannel(channel)
    }
  }, [])

  useEffect(() => {
    if (selected) {
      setIntervalMinutes((selected.config?.interval_minutes as number) || 60)
      setEditingExternalId(selected.external_id || '')
      
      const { interval_minutes, ...restConfig } = selected.config || {}
      setEditingConfigJson(Object.keys(restConfig).length > 0 ? JSON.stringify(restConfig, null, 2) : '')
      
      setEditingConfig(false)
    }
  }, [selected])

  async function updateConfig() {
    if (!selected) return
    let parsedConfig = selected.config || {}
    try {
      if (editingConfigJson.trim()) {
        parsedConfig = JSON.parse(editingConfigJson)
      }
    } catch {
      toast('Formato JSON inválido na Configuração Avançada.', 'error')
      return
    }
    const newConfig = { ...parsedConfig, interval_minutes: intervalMinutes }
    try {
      const resp = await fetch(`${API_URL}/api/admin/connector/${selected.id}/config`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: newConfig, external_id: editingExternalId, status: 'active' }),
      })
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: resp.statusText }))
        toast('Erro ao salvar: ' + (err.error ?? resp.statusText), 'error')
        return
      }
      toast('Configuração salva com sucesso!', 'success')
      setSelected({ ...selected, config: newConfig, external_id: editingExternalId, status: 'active' })
      setEditingConfig(false)
      loadAll()
    } catch {
      toast('Não foi possível conectar à API.', 'error')
    }
  }

  async function forceSync() {
    if (!selected) return
    try {
      await fetch(`${API_URL}/api/admin/connector/${selected.id}/force-sync`, { method: 'PATCH' })
      const now = new Date().toISOString()
      toast('Busca forçada enviada! Os dados serão atualizados em alguns instantes.', 'info')
      setSelected({ ...selected, next_sync_at: now, status: 'active' })
      loadAll()
    } catch {
      toast('Não foi possível conectar à API.', 'error')
    }
  }

  async function resetAllConnectors() {
    if (!window.confirm(`Resetar todos os ${systemHealth.stuckRunning.length} conectores travados?\n\nEles voltarão para o estado "Erro" e serão reprocessados no próximo ciclo do scheduler (~2 min).`)) return
    setResettingAll(true)
    try {
      const resp = await fetch(`${API_URL}/api/admin/connectors/reset-stuck`, { method: 'POST' })
      const data = await resp.json().catch(() => ({}))
      if (!resp.ok) {
        toast('Erro ao resetar: ' + (data.error ?? resp.statusText), 'error')
        return
      }
      toast(`${data.reset ?? 0} conector(es) resetado(s). O scheduler vai reprocessar em ~2 min.`, 'success')
      loadAll()
    } catch {
      toast('Não foi possível conectar à API.', 'error')
    } finally {
      setResettingAll(false)
    }
  }

  async function deleteConnector(id: string, _businessId: string, channel: string) {
    const confirmed = window.confirm(
      `ATENÇÃO CRÍTICA:\n\nDeseja realmente excluir este conector?\n\nIsso irá apagar permanentemente o conector e TODOS os reviews coletados deste canal (${CHANNEL_LABELS[channel as SourceChannel]}) para esta empresa.`
    )
    if (!confirmed) return

    setLoading(true)
    try {
      // Usa o backend (service role key) para contornar o RLS que bloqueia
      // o delete em system_notifications via anon key
      const resp = await fetch(`${API_URL}/api/admin/connector/${id}`, { method: 'DELETE' })
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: resp.statusText }))
        throw new Error(err.error ?? resp.statusText)
      }

      toast('Conector e todos os dados associados foram excluídos com sucesso.', 'success')
      setSelected(null)
      loadAll()
    } catch (err: unknown) {
      console.error('Falha na exclusão:', err)
      toast(err instanceof Error ? err.message : String(err), 'error')
      setLoading(false)
    }
  }

  async function saveNewConnector(e: React.FormEvent) {
    e.preventDefault()
    try {
      const resp = await fetch(`${API_URL}/api/admin/connector`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_id: newConn.business_id,
          channel: newConn.channel,
          external_id: newConn.channel === 'instagram' ? newConn.instagram_username : (newConn.channel === 'facebook' ? newConn.fb_url : newConn.external_id),
          config: { 
            interval_minutes: 120,
            username: newConn.instagram_username,
            hashtags: newConn.hashtags,
            fb_url: newConn.fb_url
          },
        }),
      })
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: resp.statusText }))
        return toast('Erro ao salvar: ' + (err.error ?? resp.statusText), 'error')
      }
      const result = await resp.json().catch(() => ({}))
      if (result.reactivated) {
        toast('Conector já existia e foi reativado com sucesso!', 'success')
      } else {
        toast('Conector criado com sucesso!', 'success')
      }
      setShowCreateModal(false)
      setNewConn({ ...newConn, external_id: '', instagram_username: '', hashtags: '', fb_url: '' })
      loadAll()
    } catch {
      toast('Não foi possível conectar à API.', 'error')
    }
  }

  async function loadAll() {
    setLoading(true)
    await Promise.all([loadConnectors(), loadStats()])
    setLoading(false)
  }

  async function loadConnectors() {
    const { data } = await supabase
      .from('channel_connectors')
      .select('*, monitored_businesses(name, cnpj)')
      .order('channel')

    setConnectors(data ?? [])

    const { data: bData } = await supabase.from('monitored_businesses').select('id, name, tenant_id').order('name')
    const sortedBusinesses = (bData || []).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' }))
    setAllBusinesses(sortedBusinesses)
    if (sortedBusinesses.length > 0 && !newConn.business_id) {
      setNewConn(prev => ({ ...prev, business_id: sortedBusinesses[0].id }))
    }

    // Mapa business_id → nome
    const bmap: Record<string, string> = {}
    for (const c of data ?? []) {
      if (c.monitored_businesses?.name) {
        bmap[c.business_id] = c.monitored_businesses.name
      }
    }
    setBusinesses(bmap)
  }

  async function loadStats() {
    const { data } = await supabase
      .from('reviews')
      .select('connector_id, sentiment, dissatisfaction_score, published_at')

    if (!data) return

    const now = Date.now()
    const ms30 = 30 * 24 * 60 * 60 * 1000

    const statsMap: Record<string, ConnectorStats> = {}
    const connectorIds = [...new Set(data.map(r => r.connector_id).filter(Boolean))]
    for (const connector_id of connectorIds) {
      const rows = data.filter(r => r.connector_id === connector_id)
      const recent = rows.filter(r => now - new Date(r.published_at).getTime() < ms30)
      const neg = rows.filter(r => r.sentiment === 'negative' || r.sentiment === 'critical')
      const scores = rows.filter(r => r.dissatisfaction_score != null).map(r => r.dissatisfaction_score as number)
      statsMap[connector_id] = {
        connector_id,
        total: rows.length,
        last30: recent.length,
        negativeRate: rows.length ? Math.round((neg.length / rows.length) * 100) : 0,
        avgScore: scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0,
      }
    }
    setStats(statsMap)
  }

  // Filtro da tabela
  const visibleConnectors = connectors.filter(c => {
    if (filterChannel  && c.channel     !== filterChannel)  return false
    if (filterBusiness && c.business_id !== filterBusiness) return false
    return true
  })

  // Agrupar conectores por canal
  const connectorsByChannel: Record<string, Connector[]> = {}
  for (const c of connectors) {
    if (!connectorsByChannel[c.channel]) connectorsByChannel[c.channel] = []
    connectorsByChannel[c.channel].push(c)
  }

  // Canais sem conector configurado
  const unconfigured = ALL_CHANNELS.filter(ch => !connectorsByChannel[ch])

  const totalActive = connectors.filter(c => c.status === 'active').length
  const totalError = connectors.filter(c => c.status === 'error').length

  // ── Detecção de saúde do scheduler ──────────────────────────────
  const systemHealth = useMemo(() => {
    const now = Date.now()

    // 1. Conectores em 'running' há muito tempo → scheduler travado/morto
    const stuckRunning = connectors.filter(c => {
      if (c.status !== 'running') return false
      const updatedAt = (c as any).updated_at
      if (!updatedAt) return true
      const ageMin = (now - new Date(updatedAt).getTime()) / 60_000
      return ageMin > STUCK_RUNNING_THRESHOLD_MIN
    })

    // 2. Maioria dos conectores ativos com sync muito atrasada → scheduler lento/parado
    const activeConns = connectors.filter(c => c.status === 'active')
    const overdueActive = activeConns.filter(c => {
      if (!c.last_sync_at) return false
      const hoursAgo = (now - new Date(c.last_sync_at).getTime()) / 3_600_000
      return hoursAgo > OVERDUE_SYNC_THRESHOLD_HOURS
    })
    const syncOverdue = activeConns.length > 0 &&
      overdueActive.length / activeConns.length >= 0.5 // >= 50% atrasados

    // Última sync de qualquer conector
    const lastSyncDates = connectors
      .filter(c => c.last_sync_at)
      .map(c => new Date(c.last_sync_at!).getTime())
    const mostRecentSync = lastSyncDates.length > 0 ? Math.max(...lastSyncDates) : null
    const hoursWithoutSync = mostRecentSync
      ? (now - mostRecentSync) / 3_600_000
      : null

    // 3. Conectores atualmente em estado de erro (falha de coleta)
    const failedConnectors = connectors.filter(c => c.status === 'error')

    return { stuckRunning, syncOverdue, overdueActive, hoursWithoutSync, failedConnectors }
  }, [connectors])

  return (
    <div>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 className="page-title">Conectores</h1>
          <p className="page-subtitle">
            Status dos 8 canais de coleta · {totalActive} ativos
            {totalError > 0 && <span style={{ color: '#ef4444' }}> · {totalError} com erro</span>}
          </p>
        </div>
        <button className="btn" onClick={() => setShowCreateModal(true)}>+ Novo Conector</button>
      </div>

      {/* ── Banner: API SERVER INACESSÍVEL (Problema de Infraestrutura/Railway/CORS/DNS) ── */}
      {apiStatus === 'offline' && (
        <div style={{
          background: 'rgba(239,68,68,0.1)',
          border: '2px dashed rgba(239,68,68,0.6)',
          borderRadius: 10,
          padding: '18px 22px',
          marginBottom: 20,
          display: 'flex',
          gap: 16,
          alignItems: 'flex-start',
        }}>
          <ServerCrash size={26} color="#ef4444" style={{ flexShrink: 0, marginTop: 2 }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 800, fontSize: 15, color: '#f87171', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
              🚨 ERRO CRÍTICO DE INFRAESTRUTURA: API DE COLETA FORA DO AR
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: 12 }}>
              O painel admin não conseguiu se conectar com o servidor principal de sincronização (Railway). 
              Ações como <strong>"Forçar Busca"</strong> e <strong>"Salvar Conector"</strong> não funcionarão até que a conexão seja restabelecida.
            </div>
            <div style={{ background: 'rgba(0,0,0,0.25)', borderRadius: 8, padding: '10px 14px', marginBottom: 12, border: '1px solid var(--border)' }}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4, fontWeight: 600 }}>DETALHES DA CONEXÃO:</div>
              <div style={{ fontSize: 12, fontFamily: 'monospace', color: '#fda4af', marginBottom: 4 }}>
                <strong>URL Solicitada:</strong> {API_URL}
              </div>
              <div style={{ fontSize: 12, fontFamily: 'monospace', color: '#fca5a5' }}>
                <strong>Causa do Erro:</strong> {apiErrorMsg || 'Tempo limite excedido ou servidor inacessível.'}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
              <a
                href="https://status.railway.com"
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  padding: '6px 14px', borderRadius: 6, fontSize: 12, fontWeight: 700,
                  background: '#ef4444', color: 'white',
                  border: 'none', textDecoration: 'none',
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  boxShadow: '0 2px 4px rgba(0,0,0,0.2)'
                }}
              >
                🔍 Acompanhar Status do Railway
              </a>
              <span style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.4 }}>
                💡 <strong>Dica de Correção:</strong> Se o servidor no Railway foi reiniciado e o domínio mudou, atualize a variável <code>VITE_API_URL</code> nas configurações do projeto na Vercel para <code>https://api-production-24e1.up.railway.app</code>.
              </span>
            </div>
          </div>
        </div>
      )}

      {/* ── Banner: SCHEDULER MORTO (conectores presos em 'running') ── */}
      {systemHealth.stuckRunning.length > 0 && (
        <div style={{
          background: 'rgba(239,68,68,0.08)',
          border: '1px solid rgba(239,68,68,0.4)',
          borderRadius: 10,
          padding: '16px 20px',
          marginBottom: 16,
          display: 'flex',
          gap: 14,
          alignItems: 'flex-start',
        }}>
          <ServerCrash size={22} color="#ef4444" style={{ flexShrink: 0, marginTop: 1 }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 14, color: '#f87171', marginBottom: 6 }}>
              ⚠️ Scheduler parado — {systemHealth.stuckRunning.length} conector{systemHealth.stuckRunning.length > 1 ? 'es estão' : ' está'} travado{systemHealth.stuckRunning.length > 1 ? 's' : ''} em "Sincronizando"
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: 10 }}>
              O motor de coleta de reviews parece estar inativo ou travado. Isso pode indicar uma queda no servidor de backend (Railway/Heroku).
              Nenhum review novo está sendo coletado no momento.
            </div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
              <button
                onClick={resetAllConnectors}
                disabled={resettingAll}
                style={{
                  padding: '6px 14px', borderRadius: 6, fontSize: 12, fontWeight: 600,
                  background: resettingAll ? 'rgba(239,68,68,0.07)' : 'rgba(239,68,68,0.22)',
                  color: resettingAll ? 'rgba(252,165,165,0.5)' : '#fca5a5',
                  border: '1px solid rgba(239,68,68,0.3)',
                  cursor: resettingAll ? 'not-allowed' : 'pointer',
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                }}
              >
                {resettingAll ? '⏳ Resetando...' : '🔄 Resetar conectores travados'}
              </button>
              <a
                href="https://status.railway.com"
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  padding: '6px 14px', borderRadius: 6, fontSize: 12, fontWeight: 600,
                  background: 'rgba(239,68,68,0.15)', color: '#fca5a5',
                  border: '1px solid rgba(239,68,68,0.3)', textDecoration: 'none',
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                }}
              >
                🔍 Ver status Railway
              </a>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                Travados há mais de {STUCK_RUNNING_THRESHOLD_MIN} min ·
                Serão auto-resetados pelo watchdog quando o servidor voltar
              </span>
            </div>
          </div>
        </div>
      )}

      {/* ── Banner: ERRO DE COLETA (conectores em estado de erro) ── */}
      {systemHealth.failedConnectors.length > 0 && (
        <div style={{
          background: 'rgba(239, 68, 68, 0.08)',
          border: '1px solid rgba(239, 68, 68, 0.35)',
          borderRadius: 10,
          padding: '16px 20px',
          marginBottom: 16,
          display: 'flex',
          gap: 14,
          alignItems: 'flex-start',
        }}>
          <AlertTriangle size={22} color="#ef4444" style={{ flexShrink: 0, marginTop: 1 }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 14, color: '#f87171', marginBottom: 6 }}>
              ⚠️ Erro de coleta — {systemHealth.failedConnectors.length} conector{systemHealth.failedConnectors.length > 1 ? 'es apresentam' : ' apresenta'} falhas críticas que impedem a busca de reviews
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: 10 }}>
              Alguns canais estão inoperantes. Caso a falha persista por mais de 48h (2 dias), os administradores serão alertados diretamente via WhatsApp. Verifique os conectores abaixo:
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {systemHealth.failedConnectors.map(c => {
                const businessName = businesses[c.business_id] || 'Empresa Desconhecida'
                const firstErrorText = c.first_error_at ? `desde ${new Date(c.first_error_at).toLocaleString()}` : ''
                const hoursAgo = c.first_error_at 
                  ? Math.floor((Date.now() - new Date(c.first_error_at).getTime()) / 3_600_000)
                  : 0
                return (
                  <div key={c.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, background: 'rgba(239,68,68,0.04)', borderRadius: 6, padding: '8px 12px', border: '1px solid rgba(239,68,68,0.1)' }}>
                    <div style={{ fontSize: 13, color: 'var(--text-primary)' }}>
                      <span style={{ marginRight: 6 }}>{CHANNEL_ICONS[c.channel] || '📱'}</span>
                      <strong>{CHANNEL_LABELS[c.channel] || c.channel}</strong>
                      <span style={{ color: 'var(--text-muted)', fontSize: 12, marginLeft: 8 }}>
                        {businessName} · com erro {firstErrorText} ({hoursAgo}h atrás)
                      </span>
                    </div>
                    <div style={{ fontSize: 12, color: '#fca5a5', fontFamily: 'monospace', maxWidth: '40%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={c.error_message || 'Erro desconhecido'}>
                      {c.error_message || 'Erro desconhecido'}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {/* ── Banner: SYNC ATRASADA (scheduler lento ou parado) ── */}
      {systemHealth.stuckRunning.length === 0 && systemHealth.syncOverdue && (
        <div style={{
          background: 'rgba(245,158,11,0.07)',
          border: '1px solid rgba(245,158,11,0.35)',
          borderRadius: 10,
          padding: '16px 20px',
          marginBottom: 16,
          display: 'flex',
          gap: 14,
          alignItems: 'flex-start',
        }}>
          <Clock size={22} color="#f59e0b" style={{ flexShrink: 0, marginTop: 1 }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 14, color: '#fbbf24', marginBottom: 6 }}>
              🕐 Coleta atrasada — {systemHealth.overdueActive.length} conector{systemHealth.overdueActive.length > 1 ? 'es sem' : ' sem'} sync há mais de {OVERDUE_SYNC_THRESHOLD_HOURS}h
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
              {systemHealth.hoursWithoutSync != null
                ? `Última coleta registrada: há ${Math.round(systemHealth.hoursWithoutSync)}h. `
                : ''}
              O scheduler pode estar sobrecarregado ou ter reiniciado recentemente.
              Se o padrão persistir por mais de 1 hora, verifique os logs do servidor.
            </div>
          </div>
        </div>
      )}

      {/* ── Banner: conectores aguardando configuração ────────── */}
      {(() => {
        const pending = connectors.filter(c => c.status === 'pending_config')
        if (pending.length === 0) return null
        return (
          <div style={{
            background: 'rgba(245,158,11,0.08)',
            border: '1px solid rgba(245,158,11,0.35)',
            borderRadius: 10,
            padding: '14px 18px',
            marginBottom: 24,
            display: 'flex',
            gap: 14,
            alignItems: 'flex-start',
          }}>
            <AlertTriangle size={20} color="#f59e0b" style={{ flexShrink: 0, marginTop: 2 }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700, fontSize: 14, color: '#fbbf24', marginBottom: 8 }}>
                {pending.length} conector{pending.length > 1 ? 'es precisam' : ' precisa'} de configuração manual
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {pending.map(c => (
                  <div key={c.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, background: 'rgba(245,158,11,0.06)', borderRadius: 6, padding: '6px 10px' }}>
                    <div style={{ fontSize: 13, color: 'var(--text-primary)' }}>
                      <span style={{ marginRight: 6 }}>{CHANNEL_ICONS[c.channel as SourceChannel]}</span>
                      <strong>{CHANNEL_LABELS[c.channel as SourceChannel] || c.channel}</strong>
                      <span style={{ color: 'var(--text-muted)', fontSize: 12, marginLeft: 8 }}>
                        {businesses[c.business_id] || '—'}
                      </span>
                    </div>
                    <button
                      className="btn"
                      style={{ padding: '4px 10px', fontSize: 11, display: 'flex', alignItems: 'center', gap: 4, background: 'rgba(245,158,11,0.15)', color: '#fbbf24', border: '1px solid rgba(245,158,11,0.3)', flexShrink: 0 }}
                      onClick={() => setSelected(c)}
                    >
                      <Settings size={12} /> Configurar
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )
      })()}

      {/* ── Cards de status por canal ─────────────────────────── */}
      {loading ? (
        <div className="connector-grid">
          {ALL_CHANNELS.map(ch => (
            <div key={ch} className="card connector-card">
              <div className="skeleton" style={{ width: 40, height: 40, borderRadius: '50%', margin: '0 auto 10px' }} />
              <div className="skeleton" style={{ width: 100, height: 14, margin: '0 auto 8px' }} />
              <div className="skeleton" style={{ width: 60, height: 20, margin: '0 auto' }} />
            </div>
          ))}
        </div>
      ) : (
        <div className="connector-grid" style={{ marginBottom: 32 }}>
          {ALL_CHANNELS.map(channel => {
            const channelConns = connectorsByChannel[channel] || []
            const primaryConn = channelConns.find(c => c.status === 'active') || channelConns[0]
            const st = primaryConn ? stats[primaryConn.id] : undefined

            if (!primaryConn) {
              // Não configurado
              return (
                <div key={channel} className="card connector-card" style={{ opacity: 0.5 }}>
                  <div className="connector-icon">{CHANNEL_ICONS[channel as SourceChannel] || '📱'}</div>
                  <div className="connector-name">{CHANNEL_LABELS[channel as SourceChannel] || channel}</div>
                  <div className="connector-status status-pending">⬜ Não configurado</div>
                </div>
              )
            }

            return (
              <div
                key={channel}
                className="card connector-card"
                style={{ cursor: 'pointer' }}
                onClick={() => setSelected(primaryConn)}
              >
                <div className="connector-icon">{CHANNEL_ICONS[channel as SourceChannel] || '📱'}</div>
                <div className="connector-name">
                  {CHANNEL_LABELS[channel as SourceChannel] || channel}
                  {primaryConn.channel === 'facebook' && (primaryConn.config as any)?.page_name && (
                    <span style={{ fontSize: 10, opacity: 0.7, display: 'block', fontWeight: 400 }}>
                      ({(primaryConn.config as any).page_name})
                    </span>
                  )}
                  {primaryConn.channel === 'instagram' && (primaryConn.config as any)?.username && (
                    <span style={{ fontSize: 10, opacity: 0.7, display: 'block', fontWeight: 400 }}>
                      (@{(primaryConn.config as any).username})
                    </span>
                  )}
                </div>

                <div className={`connector-status status-${primaryConn.status}`}>
                  {STATUS_DOT[primaryConn.status]} {STATUS_LABEL[primaryConn.status]}
                </div>

                {primaryConn.last_sync_at && (
                  <div className="connector-last-sync">
                    Sync: {timeAgo(primaryConn.last_sync_at)}
                  </div>
                )}

                {primaryConn.status === 'error' && primaryConn.error_message && (
                  <div className="connector-error" title={primaryConn.error_message}>
                    ⚠️ {primaryConn.error_message}
                  </div>
                )}

                {st && st.total > 0 && (
                  <div style={{ marginTop: 10, borderTop: '1px solid var(--border)', paddingTop: 10 }}>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>
                      📦 {st.total} reviews · {st.last30} últimos 30d
                    </div>
                    <div style={{ fontSize: 11, display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
                      <span style={{ color: st.negativeRate > 30 ? '#ef4444' : '#10b981' }}>
                        {st.negativeRate}% neg.
                      </span>
                      <span style={{ color: 'var(--text-muted)' }}>·</span>
                      <span style={{ color: 'var(--text-muted)' }}>score ~{st.avgScore}</span>
                    </div>
                  </div>
                )}

                {channelConns.length > 1 && (
                  <div style={{ fontSize: 10, color: 'var(--accent)', marginTop: 6 }}>
                    +{channelConns.length - 1} empresa{channelConns.length > 2 ? 's' : ''}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* ── Detalhes dos conectores em tabela ─────────────────── */}
      {connectors.length > 0 && (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
            <div className="section-title" style={{ marginBottom: 0 }}>
              📋 Todos os conectores configurados
              <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--text-muted)', marginLeft: 8 }}>
                ({visibleConnectors.length} de {connectors.length})
              </span>
            </div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <select
                value={filterChannel}
                onChange={e => setFilterChannel(e.target.value)}
                style={{ padding: '6px 12px', background: 'var(--bg-darker)', border: '1px solid var(--border)', color: 'var(--text-primary)', borderRadius: 6, fontSize: 12, cursor: 'pointer' }}
              >
                <option value=''>Todos os canais</option>
                {ALL_CHANNELS.map(ch => (
                  <option key={ch} value={ch}>{CHANNEL_ICONS[ch as SourceChannel]} {CHANNEL_LABELS[ch as SourceChannel] || ch}</option>
                ))}
              </select>
              <select
                value={filterBusiness}
                onChange={e => setFilterBusiness(e.target.value)}
                style={{ padding: '6px 12px', background: 'var(--bg-darker)', border: '1px solid var(--border)', color: 'var(--text-primary)', borderRadius: 6, fontSize: 12, cursor: 'pointer' }}
              >
                <option value=''>Todos os assinantes</option>
                {allBusinesses.map(b => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            </div>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  {['Canal', 'Empresa', 'Status', 'Último Sync', 'Próximo Sync', 'ID Externo', ''].map(h => (
                    <th key={h} style={{ padding: '10px 20px', textAlign: h === '' ? 'center' : 'left', fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visibleConnectors.length === 0 ? (
                  <tr><td colSpan={6} style={{ padding: '24px 20px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>Nenhum conector encontrado com os filtros selecionados.</td></tr>
                ) : visibleConnectors.map(c => (
                  <tr
                    key={c.id}
                    style={{
                      borderBottom: '1px solid var(--border)',
                      cursor: 'pointer',
                      transition: 'background 0.15s',
                    }}
                    onClick={() => setSelected(c)}
                    onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.03)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                  >
                    <td style={{ padding: '12px 20px', fontSize: 13 }}>
                      {CHANNEL_ICONS[c.channel]} {CHANNEL_LABELS[c.channel]}
                      {c.channel === 'facebook' && (c.config as any)?.page_name && (
                        <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 6 }}>
                          ({(c.config as any).page_name})
                        </span>
                      )}
                      {c.channel === 'instagram' && (c.config as any)?.username && (
                        <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 6 }}>
                          (@{(c.config as any).username})
                        </span>
                      )}
                    </td>
                    <td style={{ padding: '12px 20px', fontSize: 13, color: 'var(--text-secondary)' }}>
                      {businesses[c.business_id] || '—'}
                    </td>
                    <td style={{ padding: '12px 20px' }}>
                      <span className={`connector-status status-${c.status}`}>
                        {STATUS_DOT[c.status]} {STATUS_LABEL[c.status]}
                      </span>
                    </td>
                    <td style={{ padding: '12px 20px', fontSize: 12, color: 'var(--text-muted)' }}>
                      {c.last_sync_at ? timeAgo(c.last_sync_at) : '—'}
                    </td>
                    <td style={{ padding: '12px 20px', fontSize: 12, color: 'var(--text-muted)' }}>
                      {c.next_sync_at ? timeAgo(c.next_sync_at) : '—'}
                    </td>
                    <td style={{ padding: '12px 20px', fontSize: 11, color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                      {c.external_id?.slice(0, 30) || '—'}
                    </td>
                    <td style={{ padding: '12px 20px', textAlign: 'center' }}>
                      <button 
                        className="btn-icon" 
                        style={{ color: '#ef4444', background: 'transparent', border: 'none', cursor: 'pointer', padding: 4 }}
                        onClick={(e) => {
                          e.stopPropagation()
                          deleteConnector(c.id, c.business_id, c.channel)
                        }}
                        title="Excluir Conector e Reviews"
                      >
                        <Trash2 size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Modal de detalhes do conector ───────────── */}
      {selected && (
        <div className="modal-overlay" onClick={() => setSelected(null)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-title">
              <span>{CHANNEL_ICONS[selected.channel]} {CHANNEL_LABELS[selected.channel]}</span>
              <button className="modal-close" onClick={() => setSelected(null)}>✕</button>
            </div>

            <div className="modal-section" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <div className="modal-label">Status</div>
                <div className={`connector-status status-${selected.status}`} style={{ display: 'inline-flex', fontSize: 13, padding: '4px 14px' }}>
                  {STATUS_DOT[selected.status]} {STATUS_LABEL[selected.status]}
                </div>
              </div>
              <button className="btn" style={{ background: 'rgba(99,102,241,0.1)', color: '#a5b4fc', border: '1px solid rgba(99,102,241,0.2)' }} onClick={forceSync}>
                Forçar Busca
              </button>
            </div>

            {businesses[selected.business_id] && (
              <div className="modal-section">
                <div className="modal-label">Empresa</div>
                <div className="modal-value modal-hl">{businesses[selected.business_id]}</div>
              </div>
            )}

            {!editingConfig ? (
              selected.external_id && (
                <div className="modal-section">
                  <div className="modal-label">ID Externo</div>
                  <div className="modal-value" style={{ fontFamily: 'monospace', fontSize: 12, wordBreak: 'break-all' }}>
                    {selected.external_id}
                  </div>
                </div>
              )
            ) : (
              <div className="modal-section" style={{ background: 'rgba(255,255,255,0.03)', borderRadius: 8, padding: 12 }}>
                <label className="modal-label">ID Externo do Canal</label>
                <input 
                  type="text" 
                  value={editingExternalId}
                  onChange={e => setEditingExternalId(e.target.value)}
                  style={{ width: '100%', padding: '6px 10px', marginTop: 4, background: 'var(--bg-dark)', border: '1px solid var(--border)', color: 'white', borderRadius: 4, fontFamily: 'monospace' }}
                  placeholder="Ex: nubank, place_id..."
                />
                <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginTop: 8 }}>
                  O código rastreador da empresa na URL ou base oficial da plataforma.
                </div>
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <div className="modal-section">
                <div className="modal-label">Último Sync</div>
                <div className="modal-value">{selected.last_sync_at ? formatDate(selected.last_sync_at) : 'Nunca'}</div>
              </div>
              <div className="modal-section">
                <div className="modal-label">Próximo Sync</div>
                <div className="modal-value">{selected.next_sync_at ? formatDate(selected.next_sync_at) : '—'}</div>
              </div>
            </div>

            {selected.error_message && (
              <div className="modal-section">
                <div className="modal-label">Erro</div>
                <div style={{ padding: '10px 14px', background: 'rgba(239,68,68,0.1)', borderRadius: 8, fontSize: 12, color: '#fca5a5', fontFamily: 'monospace', lineHeight: 1.6 }}>
                  {selected.error_message}
                </div>
              </div>
            )}

            {stats[selected.id] && (
              <div className="modal-section">
                <div className="modal-label">Estatísticas de reviews</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
                  {[
                    { label: 'Total coletado', value: stats[selected.id].total },
                    { label: 'Últimos 30 dias', value: stats[selected.id].last30 },
                    { label: 'Taxa negativa', value: `${stats[selected.id].negativeRate}%` },
                    { label: 'Score médio', value: `${stats[selected.id].avgScore}/100` },
                  ].map(({ label, value }) => (
                    <div key={label} style={{ background: 'rgba(255,255,255,0.04)', borderRadius: 8, padding: '10px 14px' }}>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>{label}</div>
                      <div style={{ fontSize: 18, fontWeight: 700, fontFamily: 'Outfit, sans-serif', color: 'var(--text-primary)' }}>{value}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="modal-section" style={{ borderTop: '1px solid var(--border)', paddingTop: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <div className="modal-label" style={{ margin: 0 }}>Configuração do Motor</div>
                {!editingConfig ? (
                  <button className="btn" style={{ padding: '4px 8px', fontSize: 11 }} onClick={() => setEditingConfig(true)}>Editar Configurações</button>
                ) : (
                  <button className="btn" style={{ padding: '4px 8px', fontSize: 11, background: 'var(--accent)' }} onClick={updateConfig}>Salvar</button>
                )}
              </div>
              
              {editingConfig ? (
                <div style={{ background: 'rgba(255,255,255,0.03)', borderRadius: 8, padding: 12 }}>
                  <label style={{ fontSize: 11, color: 'var(--text-muted)' }}>Intervalo de Busca (minutos)</label>
                  <input 
                    type="number" min="5" step="5"
                    value={intervalMinutes}
                    onChange={e => setIntervalMinutes(Number(e.target.value))}
                    style={{ width: '100%', padding: '6px 10px', marginTop: 4, background: 'var(--bg-dark)', border: '1px solid var(--border)', color: 'white', borderRadius: 4 }}
                  />
                  <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginTop: 8 }}>
                    Define de quanto em quanto tempo o motor visita a API para buscar reivews.
                  </div>

                  <div style={{ marginTop: 12 }}>
                    <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'flex', justifyContent: 'space-between' }}>
                      <span>Configuração Avançada (Objeto JSON)</span>
                      <span style={{color: '#f59e0b'}}>{editingConfigJson.trim() ? '' : 'Opcional'}</span>
                    </label>
                    <textarea 
                      value={editingConfigJson}
                      onChange={e => setEditingConfigJson(e.target.value)}
                      style={{ 
                        width: '100%', padding: '8px 10px', marginTop: 4, 
                        background: 'rgba(0,0,0,0.3)', border: '1px solid var(--border)', 
                        color: '#a5b4fc', borderRadius: 4, fontFamily: 'monospace', 
                        fontSize: 11, minHeight: 80, resize: 'vertical',
                        whiteSpace: 'pre'
                      }}
                      placeholder='{&#10;  "keywords": ["SuaMarca"]&#10;}'
                    />
                    <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginTop: 4, lineHeight: 1.4 }}>
                      Ex Node: Para Reddit insira <span style={{color:'white'}}>&#123;"keywords": ["SuaMarca"]&#125;</span><br/>
                      Para Trustpilot use <span style={{color:'white'}}>&#123;"filter_date": "last3months", "max_items": 20&#125;</span><br/>
                      Para ConsumidorGov insira <span style={{color:'white'}}>&#123;"resource_url": "URL_DO_CSV"&#125;</span>
                    </div>
                  </div>
                </div>
              ) : (
                <div style={{ background: 'rgba(255,255,255,0.03)', borderRadius: 8, padding: '10px 14px', display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>Frequência de Atualização:</span>
                  <span style={{ fontSize: 13, fontWeight: 'bold' }}>A cada {intervalMinutes} min</span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Modal de Novo Conector ───────────── */}
      {showCreateModal && (
        <div className="modal-overlay" onClick={() => setShowCreateModal(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-title">
              <span>Configurar Novo Conector</span>
              <button className="modal-close" onClick={() => setShowCreateModal(false)}>✕</button>
            </div>
            <form onSubmit={saveNewConnector}>
              <div className="modal-section">
                <label className="modal-label">Empresa Cliente</label>
                <select required value={newConn.business_id} onChange={e => setNewConn({...newConn, business_id: e.target.value})} style={{ width: '100%', padding: '10px 14px', background: 'var(--bg-dark)', border: '1px solid var(--border)', color: 'white', borderRadius: 6 }}>
                  <option value="" disabled>Selecione uma empresa...</option>
                  {allBusinesses.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </div>
              <div className="modal-section">
                <label className="modal-label">Canal Fonte</label>
                <select required value={newConn.channel} onChange={e => setNewConn({...newConn, channel: e.target.value})} style={{ width: '100%', padding: '10px 14px', background: 'var(--bg-dark)', border: '1px solid var(--border)', color: 'white', borderRadius: 6 }}>
                  {ALL_CHANNELS.map(c => <option key={c} value={c}>{CHANNEL_LABELS[c as SourceChannel] || c}</option>)}
                </select>
              </div>
              {newConn.channel === 'instagram' && (
                <div style={{ background: 'rgba(255,255,255,0.03)', padding: 16, borderRadius: 8, marginBottom: 16, border: '1px solid rgba(165,180,252,0.2)' }}>
                  <div className="modal-label" style={{ color: '#a5b4fc' }}>Configuração Apify (Recomendado)</div>
                  
                  <div style={{ marginBottom: 12 }}>
                    <label style={{ fontSize: 11, color: 'var(--text-muted)' }}>Usuário do Instagram (@)</label>
                    <input 
                      value={newConn.instagram_username} 
                      onChange={e => setNewConn({...newConn, instagram_username: e.target.value.replace('@', '')})} 
                      placeholder="ex: nubank" 
                      style={{ width: '100%', padding: '8px 12px', marginTop: 4, background: 'var(--bg-darker)', border: '1px solid var(--border)', color: 'white', borderRadius: 6 }} 
                    />
                  </div>

                  <div style={{ marginBottom: 12 }}>
                    <label style={{ fontSize: 11, color: 'var(--text-muted)' }}>Hashtags para Monitorar (opcional)</label>
                    <input 
                      value={newConn.hashtags} 
                      onChange={e => setNewConn({...newConn, hashtags: e.target.value})} 
                      placeholder="ex: #nubank, #cartaonubank" 
                      style={{ width: '100%', padding: '8px 12px', marginTop: 4, background: 'var(--bg-darker)', border: '1px solid var(--border)', color: 'white', borderRadius: 6 }} 
                    />
                    <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginTop: 4 }}>Separe por vírgula.</div>
                  </div>
                </div>
              )}

              {newConn.channel === 'facebook' && (
                <div style={{ background: 'rgba(255,255,255,0.03)', padding: 16, borderRadius: 8, marginBottom: 16, border: '1px solid rgba(165,180,252,0.2)' }}>
                  <div className="modal-label" style={{ color: '#a5b4fc' }}>Configuração Apify (Recomendado)</div>
                  <label style={{ fontSize: 11, color: 'var(--text-muted)' }}>URL da Página do Facebook</label>
                  <input 
                    value={newConn.fb_url} 
                    onChange={e => setNewConn({...newConn, fb_url: e.target.value})} 
                    placeholder="https://www.facebook.com/SuaEmpresa" 
                    style={{ width: '100%', padding: '8px 12px', marginTop: 4, background: 'var(--bg-darker)', border: '1px solid var(--border)', color: 'white', borderRadius: 6 }} 
                  />
                </div>
              )}

              {(newConn.channel === 'instagram' || newConn.channel === 'facebook') && (
                <div style={{ textAlign: 'center', marginBottom: 20 }}>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 12 }}>— OU CONECTE VIA API OFICIAL —</div>
                  <MetaConnectButton 
                    tenantId={allBusinesses.find(b => b.id === newConn.business_id)?.tenant_id || ''} 
                    businessId={newConn.business_id} 
                  />
                </div>
              )}

              {newConn.channel !== 'facebook' && newConn.channel !== 'instagram' && (
                <div className="modal-section">
                  <label className="modal-label">ID Externo / URL Slug</label>
                  <input required value={newConn.external_id} onChange={e => setNewConn({...newConn, external_id: e.target.value})} placeholder="ex: localiza-rent-a-car" style={{ width: '100%', padding: '10px 14px', background: 'var(--bg-dark)', border: '1px solid var(--border)', color: 'white', borderRadius: 6 }} />
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>O identificador da empresa na url do canal.</div>
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 24 }}>
                <button type="button" className="btn" style={{ background: 'transparent' }} onClick={() => setShowCreateModal(false)}>Cancelar</button>
                <button type="submit" className="btn" style={{ background: 'var(--accent)' }}>Salvar Conector</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
