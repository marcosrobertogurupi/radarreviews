import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Connector, SyncJob } from '../lib/supabase'
import { formatDate } from '../lib/utils'
import { History, ShieldAlert, Activity, Ghost, ShieldCheck } from 'lucide-react'

interface QuietFailure {
  connector: Connector
  consecutiveZeroes: number
}

export default function Audit() {
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [errorConnectors, setErrorConnectors] = useState<Connector[]>([])
  const [healingConnectors, setHealingConnectors] = useState<Connector[]>([])
  const [recentJobs, setRecentJobs] = useState<SyncJob[]>([])
  const [quietFailures, setQuietFailures] = useState<QuietFailure[]>([])
  const [auditLogs, setAuditLogs] = useState<any[]>([])
  const [tab, setTab] = useState<'robots' | 'users'>('robots')
  const [filters, setFilters] = useState({ from: '', to: '', usuario: '', operacao: '', status: '' })
  const [loadingLogs, setLoadingLogs] = useState(false)
  const [totalActiveCount, setTotalActiveCount] = useState(0)
  const [totalErrorCount, setTotalErrorCount] = useState(0)

  useEffect(() => {
    loadAuditData()
    if (tab === 'users') loadUserLogs()
    const handleRefresh = () => {
      loadAuditData(true)
      if (tab === 'users') loadUserLogs()
    }
    window.addEventListener('refresh_data', handleRefresh)
    return () => window.removeEventListener('refresh_data', handleRefresh)
  }, [tab])

  async function loadUserLogs() {
    try {
      setLoadingLogs(true)
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) return

      const params = new URLSearchParams()
      if (filters.from)     params.set('from', filters.from)
      if (filters.to)       params.set('to', filters.to)
      if (filters.usuario)  params.set('usuario', filters.usuario)
      if (filters.operacao) params.set('operacao', filters.operacao)
      if (filters.status)   params.set('status', filters.status)

      const resp = await fetch(
        `${import.meta.env.VITE_API_URL}/api/admin/relatorios/auditoria?${params}`,
        { headers: { 'Authorization': `Bearer ${session.access_token}` } }
      )
      if (resp.ok) setAuditLogs(await resp.json())
    } catch (e) {
      console.error('Erro ao carregar logs de auditoria:', e)
    } finally {
      setLoadingLogs(false)
    }
  }

  async function loadAuditData(silent = false) {
    if (!silent) setLoading(true)
    else setRefreshing(true)

    const { data: allErrors } = await supabase
      .from('channel_connectors')
      .select('*, monitored_businesses(name)')
      .eq('status', 'error')
      .order('updated_at', { ascending: false })

    const { data: jobs } = await supabase
      .from('sync_jobs')
      .select('*')
      .order('started_at', { ascending: false })
      .limit(50)

    const { data: allActive } = await supabase
      .from('channel_connectors')
      .select('*, monitored_businesses(name)')
      .eq('status', 'active')

    const now = new Date()
    const critical: Connector[] = []
    const healing: Connector[] = []

    if (allErrors) {
      allErrors.forEach(c => {
        const firstError = c.first_error_at ? new Date(c.first_error_at) : new Date(c.updated_at || c.created_at)
        const hoursDiff = (now.getTime() - firstError.getTime()) / (1000 * 60 * 60)
        if (c.is_auth_error || hoursDiff >= 24) critical.push(c)
        else healing.push(c)
      })
    }

    const qFailures: QuietFailure[] = []
    if (allActive && jobs) {
      for (const conn of allActive) {
        const connJobs = jobs.filter(j => j.connector_id === conn.id).slice(0, 3)
        if (connJobs.length >= 2 && conn.channel === 'reclame_aqui') {
           if (connJobs.every(j => j.reviews_fetched === 0)) {
             qFailures.push({ connector: conn, consecutiveZeroes: connJobs.length })
           }
        }
      }
    }

    setErrorConnectors(critical)
    setHealingConnectors(healing)
    setRecentJobs((jobs || []) as SyncJob[])
    setQuietFailures(qFailures)
    setTotalActiveCount(allActive?.length || 0)
    setTotalErrorCount(allErrors?.length || 0)
    setLoading(false)
    setRefreshing(false)
  }

  return (
    <div className="audit-page">
      <div className="page-header" style={{ marginBottom: 20 }}>
        <div>
          <h1 className="page-title">Auditoria do Sistema</h1>
          <p className="page-subtitle">Monitoramento de integridade e registro de ações críticas.</p>
        </div>
        <div style={{ display: 'flex', gap: 12, marginTop: 16 }}>
          <button 
            className={`btn ${tab === 'robots' ? 'active' : ''}`} 
            onClick={() => setTab('robots')}
            style={{ background: tab === 'robots' ? 'var(--accent)' : 'transparent', border: '1px solid var(--border)' }}
          >
            Robôs e Coleta
          </button>
          <button 
            className={`btn ${tab === 'users' ? 'active' : ''}`} 
            onClick={() => setTab('users')}
            style={{ background: tab === 'users' ? 'var(--accent)' : 'transparent', border: '1px solid var(--border)' }}
          >
            Ações de Usuários
          </button>
        </div>
      </div>

      {tab === 'robots' ? (
        <>
          <div className="kpi-grid">
            <div className="card kpi-card" style={{ '--kpi-color': '#f87171' } as any}>
              <div className="kpi-label">Falhas Críticas</div>
              <div className="kpi-value">{(errorConnectors || []).length}</div>
            </div>
            <div className="card kpi-card" style={{ '--kpi-color': '#60a5fa' } as any}>
              <div className="kpi-label">Em Autocura</div>
              <div className="kpi-value">{(healingConnectors || []).length}</div>
            </div>
            <div className="card kpi-card" style={{ '--kpi-color': '#34d399' } as any}>
              <div className="kpi-label">Saúde Global</div>
              <div className="kpi-value">{loading ? '...' : Math.max(0, 100 - ((errorConnectors || []).length * 5)).toFixed(0)}%</div>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
              {/* Seção 1: Falhas Críticas */}
              <section>
                <h3 style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <ShieldAlert size={20} color="#f87171" /> Falhas Críticas
                </h3>
                {errorConnectors.map(c => (
                  <div key={c.id} className="card" style={{ padding: 16, borderLeft: '4px solid #ef4444', marginBottom: 12 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
                      <span style={{ fontWeight: 600 }}>{(c as any).monitored_businesses?.name}</span>
                      <span className="badge" style={{ fontSize: 10, background: 'rgba(239,68,68,0.1)', color: '#f87171' }}>{c.channel.toUpperCase()}</span>
                    </div>
                    <div style={{ fontSize: 13, color: '#fca5a5', marginTop: 4 }}>{c.error_message || 'Erro na extração'}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8 }}>Em erro desde: {formatDate(c.first_error_at || c.updated_at || c.created_at)}</div>
                  </div>
                ))}
                {errorConnectors.length === 0 && !loading && (
                  <div className="card" style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)' }}>
                    Nenhuma falha crítica encontrada.
                  </div>
                )}
              </section>

              {/* Seção 2: Em Autocura */}
              <section>
                <h3 style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Activity size={20} color="#60a5fa" /> Canais em Autocura
                </h3>
                {healingConnectors.map(c => (
                  <div key={c.id} className="card" style={{ padding: 16, borderLeft: '4px solid #3b82f6', marginBottom: 12 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
                      <span style={{ fontWeight: 600 }}>{(c as any).monitored_businesses?.name}</span>
                      <span className="badge" style={{ fontSize: 10, background: 'rgba(59,130,246,0.1)', color: '#60a5fa' }}>{c.channel.toUpperCase()}</span>
                    </div>
                    <div style={{ fontSize: 13, color: '#93c5fd', marginTop: 4 }}>{c.error_message || 'Instabilidade temporária'}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8 }}>Última tentativa: {formatDate(c.updated_at || c.created_at)}</div>
                  </div>
                ))}
                {healingConnectors.length === 0 && !loading && (
                  <div className="card" style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)' }}>
                    Nenhum canal em processo de autocura.
                  </div>
                )}
              </section>

              {/* Seção 3: Falhas Silenciosas */}
              {quietFailures.length > 0 && (
                <section>
                  <h3 style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Ghost size={20} color="#fcd34d" /> Falhas Silenciosas (Inconsistência)
                  </h3>
                  <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>Canais ativos que não coletaram dados nos últimos ciclos.</p>
                  {quietFailures.map(q => (
                    <div key={q.connector.id} className="card" style={{ padding: 16, borderLeft: '4px solid #f59e0b', marginBottom: 12 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
                        <span style={{ fontWeight: 600 }}>{(q.connector as any).monitored_businesses?.name}</span>
                        <span className="badge" style={{ fontSize: 10, background: 'rgba(245,158,11,0.1)', color: '#fbbf24' }}>{q.connector.channel.toUpperCase()}</span>
                      </div>
                      <div style={{ fontSize: 13, color: '#fde68a', marginTop: 4 }}>{q.consecutiveZeroes} ciclos consecutivos sem novos reviews.</div>
                    </div>
                  ))}
                </section>
              )}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
              {/* Seção 4: Histórico de Sincronização */}
              <section>
                <h3 style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <History size={20} color="var(--accent)" /> Histórico Recente de Sincronização
                </h3>
                <div className="card" style={{ padding: 0 }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                    <thead>
                      <tr style={{ background: 'rgba(255,255,255,0.03)', borderBottom: '1px solid var(--border)' }}>
                        <th style={{ padding: 10, textAlign: 'left' }}>Data</th>
                        <th style={{ padding: 10, textAlign: 'center' }}>Novos</th>
                        <th style={{ padding: 10, textAlign: 'center' }}>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recentJobs.slice(0, 15).map(j => (
                        <tr key={j.id} style={{ borderBottom: '1px solid var(--border)' }}>
                          <td style={{ padding: 10, color: 'var(--text-muted)' }}>{formatDate(j.started_at)}</td>
                          <td style={{ padding: 10, textAlign: 'center' }}>{j.reviews_new}</td>
                          <td style={{ padding: 10, textAlign: 'center', color: j.status === 'done' ? '#10b981' : '#ef4444' }}>{j.status}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              {/* Seção 5: Resumo de Integridade */}
              <section>
                <h3 style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <ShieldCheck size={20} color="#10b981" /> Resumo de Integridade
                </h3>
                <div className="card" style={{ padding: 20 }}>
                  <div style={{ fontSize: 14, marginBottom: 12 }}>Status dos Conectores:</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                      <span>Críticos (Ação Manual)</span>
                      <span style={{ color: '#ef4444', fontWeight: 600 }}>{errorConnectors.length}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                      <span>Instáveis (Autocura)</span>
                      <span style={{ color: '#3b82f6', fontWeight: 600 }}>{healingConnectors.length}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                      <span>Saudáveis</span>
                      <span style={{ color: '#10b981', fontWeight: 600 }}>{Math.max(0, totalActiveCount)}</span>
                    </div>
                  </div>
                </div>
              </section>
            </div>
          </div>
        </>
      ) : (
        <section>
          <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={{ fontSize: 11, color: 'var(--text-muted)' }}>De</label>
              <input type="date" value={filters.from} onChange={e => setFilters(f => ({ ...f, from: e.target.value }))}
                style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6, padding: '6px 10px', color: 'var(--text)', fontSize: 13 }} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={{ fontSize: 11, color: 'var(--text-muted)' }}>Até</label>
              <input type="date" value={filters.to} onChange={e => setFilters(f => ({ ...f, to: e.target.value }))}
                style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6, padding: '6px 10px', color: 'var(--text)', fontSize: 13 }} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={{ fontSize: 11, color: 'var(--text-muted)' }}>Usuário (e-mail)</label>
              <input type="text" placeholder="Filtrar por e-mail..." value={filters.usuario}
                onChange={e => setFilters(f => ({ ...f, usuario: e.target.value }))}
                style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6, padding: '6px 10px', color: 'var(--text)', fontSize: 13, minWidth: 200 }} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={{ fontSize: 11, color: 'var(--text-muted)' }}>Operação</label>
              <select value={filters.operacao} onChange={e => setFilters(f => ({ ...f, operacao: e.target.value }))}
                style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6, padding: '6px 10px', color: 'var(--text)', fontSize: 13 }}>
                <option value="">Todas</option>
                <option value="LOGIN">LOGIN</option>
                <option value="LOGIN_FALHA">LOGIN_FALHA</option>
                <option value="EXCLUIR_ASSINANTE">EXCLUIR_ASSINANTE</option>
                <option value="ALTERAR_ASSINANTE">ALTERAR_ASSINANTE</option>
                <option value="ATIVAR_ASSINANTE">ATIVAR_ASSINANTE</option>
                <option value="DESATIVAR_ASSINANTE">DESATIVAR_ASSINANTE</option>
              </select>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={{ fontSize: 11, color: 'var(--text-muted)' }}>Status</label>
              <select value={filters.status} onChange={e => setFilters(f => ({ ...f, status: e.target.value }))}
                style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6, padding: '6px 10px', color: 'var(--text)', fontSize: 13 }}>
                <option value="">Todos</option>
                <option value="success">Sucesso</option>
                <option value="error">Erro</option>
              </select>
            </div>
            <button onClick={loadUserLogs} disabled={loadingLogs}
              style={{ background: 'var(--accent)', border: 'none', borderRadius: 6, padding: '8px 18px', color: '#fff', fontSize: 13, cursor: 'pointer', alignSelf: 'flex-end' }}>
              {loadingLogs ? 'Buscando...' : 'Filtrar'}
            </button>
            <button onClick={() => { setFilters({ from: '', to: '', usuario: '', operacao: '', status: '' }); loadUserLogs() }}
              style={{ background: 'transparent', border: '1px solid var(--border)', borderRadius: 6, padding: '8px 14px', color: 'var(--text-muted)', fontSize: 13, cursor: 'pointer', alignSelf: 'flex-end' }}>
              Limpar
            </button>
          </div>

          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: 'rgba(255,255,255,0.03)', borderBottom: '1px solid var(--border)' }}>
                  <th style={{ padding: 12, textAlign: 'left' }}>Data/Hora</th>
                  <th style={{ padding: 12, textAlign: 'left' }}>Usuário</th>
                  <th style={{ padding: 12, textAlign: 'left' }}>Operação</th>
                  <th style={{ padding: 12, textAlign: 'left' }}>Descrição</th>
                  <th style={{ padding: 12, textAlign: 'left' }}>IP</th>
                </tr>
              </thead>
              <tbody>
                {loadingLogs ? (
                  <tr><td colSpan={5} style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>Carregando...</td></tr>
                ) : auditLogs.length === 0 ? (
                  <tr><td colSpan={5} style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>Nenhum log encontrado.</td></tr>
                ) : (
                  auditLogs.map(log => (
                    <tr key={log.id} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: 12, color: 'var(--text-muted)', fontSize: 11 }}>{formatDate(log.data_hora)}</td>
                      <td style={{ padding: 12 }}>
                        <div style={{ fontWeight: 500 }}>{log.usuario_nome}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{log.usuario_email}</div>
                      </td>
                      <td style={{ padding: 12 }}>
                        <span className="badge" style={{
                          background: log.status === 'error' ? 'rgba(239,68,68,0.1)' : 'rgba(99,102,241,0.1)',
                          color: log.status === 'error' ? '#fca5a5' : '#a5b4fc',
                          fontSize: 10, padding: '3px 8px', borderRadius: 4
                        }}>{log.operacao}</span>
                      </td>
                      <td style={{ padding: 12, fontSize: 12 }}>{log.descricao}</td>
                      <td style={{ padding: 12, color: 'var(--text-muted)', fontSize: 11 }}>{log.ip_origem || '-'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  )
}
