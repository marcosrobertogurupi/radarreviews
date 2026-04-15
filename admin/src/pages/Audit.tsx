import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Connector, SyncJob, SourceChannel } from '../lib/supabase'
import { CHANNEL_LABELS, CHANNEL_ICONS, formatDate, timeAgo } from '../lib/utils'
import { AlertCircle, CheckCircle2, Clock, History, Search, ShieldAlert } from 'lucide-react'

interface QuietFailure {
  connector: Connector
  consecutiveZeroes: number
}

export default function Audit() {
  const [errorConnectors, setErrorConnectors] = useState<Connector[]>([])
  const [recentJobs, setRecentJobs] = useState<SyncJob[]>([])
  const [quietFailures, setQuietFailures] = useState<QuietFailure[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadAuditData()
    const handleRefresh = () => loadAuditData()
    window.addEventListener('refresh_data', handleRefresh)
    return () => window.removeEventListener('refresh_data', handleRefresh)
  }, [])

  async function loadAuditData() {
    setLoading(true)

    // 1. Buscar conectores em ERRO explicito
    const { data: errConns } = await supabase
      .from('channel_connectors')
      .select('*, monitored_businesses(name)')
      .eq('status', 'error')
      .order('updated_at', { ascending: false })

    // 2. Buscar ultimos Jobs (log de execucao)
    const { data: jobs } = await supabase
      .from('sync_jobs')
      .select('*')
      .order('started_at', { ascending: false })
      .limit(50)

    // 3. Detectar "Falhas Silenciosas"
    // Pegar todos os conectores ativos
    const { data: allActive } = await supabase
      .from('channel_connectors')
      .select('*, monitored_businesses(name)')
      .eq('status', 'active')

    const qFailures: QuietFailure[] = []
    
    if (allActive && jobs) {
      for (const conn of allActive) {
        // Encontrar os ultimos 3 jobs deste conector
        const connJobs = jobs.filter(j => j.connector_id === conn.id).slice(0, 3)
        
        // Se houver pelo menos 2 jobs e todos trouxeram 0 reviews novos e 0 buscados 
        // em canais de scraping (Reclame Aqui)
        if (connJobs.length >= 2 && conn.channel === 'reclame_aqui') {
           const allZero = connJobs.every(j => j.reviews_fetched === 0)
           if (allZero) {
             qFailures.push({ connector: conn, consecutiveZeroes: connJobs.length })
           }
        }
      }
    }

    setErrorConnectors(errConns || [])
    setRecentJobs(jobs || [])
    setQuietFailures(qFailures)
    setLoading(false)
  }

  return (
    <div className="audit-page">
      <div className="page-header">
        <h1 className="page-title">Auditoria do Sistema</h1>
        <p className="page-subtitle">Monitoramento proativo de integridade dos robôs e extração de dados.</p>
      </div>

      <div className="kpi-grid">
        <div className="card kpi-card" style={{ '--kpi-color': '#f87171' } as any}>
          <div className="kpi-label">Falhas Críticas</div>
          <div className="kpi-value">{errorConnectors.length}</div>
          <p style={{ fontSize: 11, color: 'var(--text-muted)' }}>Conectores com erro explícito</p>
        </div>
        <div className="card kpi-card" style={{ '--kpi-color': '#fbbf24' } as any}>
          <div className="kpi-label">Falhas Silenciosas</div>
          <div className="kpi-value">{quietFailures.length}</div>
          <p style={{ fontSize: 11, color: 'var(--text-muted)' }}>Capturando 0 reviews (Suspeito)</p>
        </div>
        <div className="card kpi-card" style={{ '--kpi-color': '#34d399' } as any}>
          <div className="kpi-label">Saúde Global</div>
          <div className="kpi-value">{loading ? '...' : (100 - (errorConnectors.length * 5)).toFixed(0)}%</div>
          <p style={{ fontSize: 11, color: 'var(--text-muted)' }}>Disponibilidade dos robôs</p>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
        
        {/* Coluna 1: Problemas Atuais */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          
          <section>
            <h3 style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
              <ShieldAlert size={20} color="#f87171" /> Falhas Críticas em Aberto
            </h3>
            {errorConnectors.length === 0 ? (
              <div className="card" style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)' }}>
                ✅ Nenhum erro crítico detectado no momento.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {errorConnectors.map(c => (
                  <div key={c.id} className="card" style={{ padding: 16, borderLeft: '4px solid #ef4444' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                      <span style={{ fontWeight: 600 }}>{c.monitored_businesses?.name}</span>
                      <span className="badge badge-critical">{CHANNEL_ICONS[c.channel]} {CHANNEL_LABELS[c.channel]}</span>
                    </div>
                    <div style={{ fontSize: 13, color: '#fca5a5', background: 'rgba(239,68,68,0.1)', padding: 8, borderRadius: 4, fontFamily: 'monospace' }}>
                      {c.error_message || 'Erro desconhecido na extração'}
                    </div>
                    <div style={{ marginTop: 8, fontSize: 11, color: 'var(--text-muted)' }}>
                      Foco do Desastre: {formatDate(c.updated_at ?? c.last_sync_at ?? c.created_at)} ({timeAgo(c.updated_at ?? c.last_sync_at ?? c.created_at)})
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section>
            <h3 style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
              <AlertCircle size={20} color="#fbbf24" /> Suspeita de Falha Silenciosa
            </h3>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>
              Canais que estão concluindo a sincronização, mas não trazem dados. 
              Pode indicar bloqueio ou mudança de HTML.
            </p>
            {quietFailures.length === 0 ? (
              <div className="card" style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)' }}>
                ✅ Nenhuma anomalia de volume detectada.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {quietFailures.map(q => (
                  <div key={q.connector.id} className="card" style={{ padding: 16, borderLeft: '4px solid #f59e0b' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                      <span style={{ fontWeight: 600, fontSize: 14 }}>{q.connector.monitored_businesses?.name}</span>
                      <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{CHANNEL_ICONS[q.connector.channel]} {CHANNEL_LABELS[q.connector.channel]}</span>
                    </div>
                    <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                      ⚠️ Alerta: <strong>{q.consecutiveZeroes} coletas seguidas</strong> retornaram 0 reviews.
                    </div>
                    <div style={{ marginTop: 8, fontSize: 11, color: '#fbbf24' }}>
                      Ação recomendada: Inspecionar o extrator para {q.connector.external_id}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

        </div>

        {/* Coluna 2: Histórico de Sincronização */}
        <div>
          <h3 style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
            <History size={20} color="var(--accent)" /> Log de Sincronização (Jobs)
          </h3>
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: 'rgba(255,255,255,0.03)', borderBottom: '1px solid var(--border)' }}>
                  <th style={{ padding: 12, textAlign: 'left' }}>Data/Hora</th>
                  <th style={{ padding: 12, textAlign: 'left' }}>Status</th>
                  <th style={{ padding: 12, textAlign: 'center' }}>Buscados</th>
                  <th style={{ padding: 12, textAlign: 'center' }}>Novos</th>
                </tr>
              </thead>
              <tbody>
                {recentJobs.map(j => (
                  <tr key={j.id} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: 12, color: 'var(--text-muted)', fontSize: 11 }}>
                      {formatDate(j.started_at)}
                    </td>
                    <td style={{ padding: 12 }}>
                      <span style={{ 
                        color: j.status === 'done' ? '#10b981' : '#ef4444',
                        display: 'flex', alignItems: 'center', gap: 4, fontWeight: 500
                      }}>
                        {j.status === 'done' ? <CheckCircle2 size={12} /> : <ShieldAlert size={12} />}
                        {j.status === 'done' ? 'Sucesso' : 'Falha'}
                      </span>
                    </td>
                    <td style={{ padding: 12, textAlign: 'center' }}>{j.reviews_fetched}</td>
                    <td style={{ padding: 12, textAlign: 'center', fontWeight: 600, color: j.reviews_new > 0 ? '#a5b4fc' : 'inherit' }}>
                      {j.reviews_new}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

      </div>
    </div>
  )
}
