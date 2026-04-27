import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Connector, SyncJob, SourceChannel } from '../lib/supabase'
import { CHANNEL_LABELS, CHANNEL_ICONS, formatDate, timeAgo } from '../lib/utils'
import { AlertCircle, CheckCircle2, Clock, History, Search, ShieldAlert } from 'lucide-react'

interface QuietFailure {
  connector: Connector
  consecutiveZeroes: number
}

  const [auditLogs, setAuditLogs] = useState<any[]>([])
  const [tab, setTab] = useState<'robots' | 'users'>('robots')

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
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) return

      const resp = await fetch(`${import.meta.env.VITE_API_URL}/api/admin/relatorios/auditoria`, {
        headers: { 'Authorization': `Bearer ${session.access_token}` }
      })
      if (resp.ok) {
        const data = await resp.json()
        setAuditLogs(data)
      }
    } catch (e) {
      console.error('Erro ao carregar logs de auditoria:', e)
    }
  }

  async function loadAuditData(silent = false) {
    if (!silent) setLoading(true)
    else setRefreshing(true)

    // ... (restante do código original de robots permanece igual)
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
    setRecentJobs(jobs || [])
    setQuietFailures(qFailures)
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
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              <section>
                <h3 style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <ShieldAlert size={20} color="#f87171" /> Falhas Críticas
                </h3>
                {errorConnectors.map(c => (
                  <div key={c.id} className="card" style={{ padding: 16, borderLeft: '4px solid #ef4444', marginBottom: 12 }}>
                    <span style={{ fontWeight: 600 }}>{c.monitored_businesses?.name}</span>
                    <div style={{ fontSize: 13, color: '#fca5a5' }}>{c.error_message || 'Erro na extração'}</div>
                  </div>
                ))}
              </section>
            </div>
            <div>
              <h3 style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
                <History size={20} color="var(--accent)" /> Histórico de Sincronização
              </h3>
              {/* ... (Tabela de jobs simplificada aqui) */}
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
            </div>
          </div>
        </>
      ) : (
        <section>
          <h3 style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
            <History size={20} color="var(--accent)" /> Log de Auditoria — Ações Administrativas
          </h3>
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
                {auditLogs.length === 0 ? (
                  <tr><td colSpan={5} style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>Nenhum log encontrado.</td></tr>
                ) : (
                  auditLogs.map(log => (
                    <tr key={log.id} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: 12, color: 'var(--text-muted)', fontSize: 11 }}>{formatDate(log.data_hora)}</td>
                      <td style={{ padding: 12 }}>
                        <div style={{ fontWeight: 500 }}>{log.usuario_nome}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{log.usuario_perfil}</div>
                      </td>
                      <td style={{ padding: 12 }}>
                        <span className="badge" style={{ background: 'rgba(99,102,241,0.1)', color: '#a5b4fc', fontSize: 10 }}>{log.operacao}</span>
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
