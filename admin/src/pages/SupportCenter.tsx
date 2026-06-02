import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { API_URL, timeAgo } from '../lib/utils'
import { 
  LifeBuoy, MessageSquare, BookOpen, BarChart2, ArrowUpRight
} from 'lucide-react'

interface SupportStats {
  total: number
  open: number
  ai_handled: number
  critical: number
  avg_csat: string
  sla_breaches: number
}

export default function SupportCenter() {
  const [tab, setTab] = useState<'tickets' | 'kb' | 'stats'>('tickets')
  const [stats, setStats] = useState<SupportStats | null>(null)
  const [tickets, setTickets] = useState<any[]>([])
  const [kbDocs, setKbDocs] = useState<any[]>([])

  useEffect(() => {
    loadAll()
  }, [tab])

  async function loadAll() {
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const headers = { Authorization: `Bearer ${session?.access_token}` }

      if (tab === 'stats') {
        const res = await fetch(`${API_URL}/api/admin/support/stats`, { headers })
        if (res.ok) setStats(await res.json())
      } else if (tab === 'tickets') {
        const res = await fetch(`${API_URL}/api/admin/support/tickets`, { headers })
        if (res.ok) setTickets(await res.json())
      } else if (tab === 'kb') {
        const res = await fetch(`${API_URL}/api/admin/support/kb`, { headers })
        if (res.ok) setKbDocs(await res.json())
      }
    } catch (err) {
      console.error(err)
    }
  }

  async function updateDocStatus(id: string, status: 'active' | 'archived') {
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(`${API_URL}/api/admin/support/kb/${id}`, {
        method: 'PATCH',
        headers: { 
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.access_token}` 
        },
        body: JSON.stringify({ status })
      })
      if (res.ok) loadAll()
    } catch (err) {
      console.error(err)
    }
  }

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 32, height: 32, borderRadius: 8, background: 'linear-gradient(135deg, #f59e0b, #ef4444)', flexShrink: 0 }}>
              <LifeBuoy size={17} color="white" />
            </span>
            Centro de Suporte Admin
          </h1>
          <p className="page-subtitle">Gestão global de chamados, base de conhecimento e performance de IA.</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="tabs" style={{ marginBottom: 24, display: 'flex', gap: 8, borderBottom: '1px solid var(--border)', paddingBottom: 0 }}>
        <button className={`tab ${tab === 'tickets' ? 'active' : ''}`} onClick={() => setTab('tickets')}>
          <MessageSquare size={16} /> Chamados
        </button>
        <button className={`tab ${tab === 'kb' ? 'active' : ''}`} onClick={() => setTab('kb')}>
          <BookOpen size={16} /> Base de Conhecimento
        </button>
        <button className={`tab ${tab === 'stats' ? 'active' : ''}`} onClick={() => setTab('stats')}>
          <BarChart2 size={16} /> Analytics & KPIs
        </button>
      </div>

      {tab === 'stats' && stats && (
        <div className="stats-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 20 }}>
          <div className="card stat-card">
            <div className="stat-label">Total de Chamados</div>
            <div className="stat-value">{stats.total}</div>
          </div>
          <div className="card stat-card">
            <div className="stat-label">Pendentes</div>
            <div className="stat-value" style={{ color: '#f59e0b' }}>{stats.open}</div>
          </div>
          <div className="card stat-card">
            <div className="stat-label">Resolvidos por IA</div>
            <div className="stat-value" style={{ color: '#10b981' }}>{stats.ai_handled}</div>
          </div>
          <div className="card stat-card">
            <div className="stat-label">Críticos</div>
            <div className="stat-value" style={{ color: '#ef4444' }}>{stats.critical}</div>
          </div>
          <div className="card stat-card">
            <div className="stat-label">Média CSAT</div>
            <div className="stat-value">{stats.avg_csat} / 5.0</div>
          </div>
          <div className="card stat-card">
            <div className="stat-label">Violações de SLA</div>
            <div className="stat-value" style={{ color: '#ef4444' }}>{stats.sla_breaches}</div>
          </div>
        </div>
      )}

      {tab === 'tickets' && (
        <div className="card" style={{ padding: 0 }}>
          <table className="admin-table">
            <thead>
              <tr>
                <th>Ticket</th>
                <th>Assinante</th>
                <th>Assunto</th>
                <th>Status</th>
                <th>SLA</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {tickets.map(t => (
                <tr key={t.id}>
                  <td style={{ fontFamily: 'monospace', fontSize: 12 }}>#{t.ticket_number}</td>
                  <td>
                    <div style={{ fontWeight: 600 }}>{t.tenants?.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>ID: {t.tenant_id.slice(0, 8)}</div>
                  </td>
                  <td>
                    <div style={{ fontWeight: 500 }}>{t.subject}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{t.ticket_categories?.name || 'Geral'}</div>
                  </td>
                  <td>
                    <span className={`status-badge ${t.status}`}>{t.status}</span>
                  </td>
                  <td>
                    {t.is_sla_breached ? (
                      <span style={{ color: '#ef4444', fontWeight: 700, fontSize: 11 }}>🚨 BREACHED</span>
                    ) : (
                      <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>{new Date(t.sla_deadline).toLocaleString('pt-BR')}</span>
                    )}
                  </td>
                  <td>
                    <button className="btn btn-ghost btn-sm"><ArrowUpRight size={14} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'kb' && (
        <div className="kb-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(350px, 1fr))', gap: 20 }}>
          {kbDocs.map(doc => (
            <div key={doc.id} className="card kb-card">
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
                <span className={`status-badge ${doc.status}`}>{doc.status}</span>
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Confiança: {Math.round(doc.confidence_score * 100)}%</span>
              </div>
              <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 8 }}>{doc.title}</h3>
              <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 16, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                {doc.solution_summary}
              </p>
              <div style={{ display: 'flex', gap: 8 }}>
                {doc.status === 'draft' && (
                  <button className="btn btn-primary btn-sm" style={{ flex: 1 }} onClick={() => updateDocStatus(doc.id, 'active')}>Aprovar</button>
                )}
                <button className="btn btn-ghost btn-sm" style={{ flex: 1 }}>Editar</button>
              </div>
            </div>
          ))}
        </div>
      )}

      <style>{`
        .tabs { margin-bottom: 24px; }
        .tab { 
          padding: 10px 20px; background: none; border: none; color: var(--text-muted); 
          cursor: pointer; font-weight: 600; display: flex; align-items: center; gap: 8px;
          border-bottom: 2px solid transparent; transition: all 0.2s;
        }
        .tab.active { color: var(--accent); border-bottom-color: var(--accent); }
        .tab:hover { color: var(--text-primary); }
        
        .admin-table { width: 100%; border-collapse: collapse; }
        .admin-table th { text-align: left; padding: 12px 20px; font-size: 11px; text-transform: uppercase; color: var(--text-muted); border-bottom: 1px solid var(--border); }
        .admin-table td { padding: 16px 20px; border-bottom: 1px solid var(--border); font-size: 13px; }
        
        .kb-card { padding: 20px; display: flex; flex-direction: column; }
        
        .status-badge { 
          padding: 2px 8px; border-radius: 4px; font-size: 10px; font-weight: 700; 
          text-transform: uppercase; background: var(--bg-darker); color: var(--text-muted);
        }
        .status-badge.open, .status-badge.reopened { background: #6366f120; color: #6366f1; }
        .status-badge.active, .status-badge.resolved { background: #10b98120; color: #10b981; }
        .status-badge.draft { background: #f59e0b20; color: #f59e0b; }
      `}</style>
    </div>
  )
}
