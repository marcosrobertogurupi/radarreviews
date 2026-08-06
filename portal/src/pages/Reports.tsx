import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { FileText, Download, Calendar, RefreshCw, AlertCircle, FileSearch, CheckCircle2, Trash2 } from 'lucide-react'
import { format, subMonths } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { API_URL } from '../lib/utils'

interface Props {
  tenantId: string
}

export default function Reports({ tenantId }: Props) {
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)        // id do relatório sendo excluído
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null) // id aguardando confirmação
  const [history, setHistory] = useState<any[]>([])
  const [status, setStatus] = useState<{ type: 'success' | 'error', msg: string } | null>(null)
  const [selectedMonth, setSelectedMonth] = useState(format(new Date(), 'yyyy-MM'))
  const [reportType, setReportType] = useState<'monthly' | 'custom'>('monthly')
  const [startDate, setStartDate] = useState(format(subMonths(new Date(), 1), 'yyyy-MM-dd'))
  const [endDate, setEndDate] = useState(format(new Date(), 'yyyy-MM-dd'))

  useEffect(() => {
    loadHistory()
  }, [tenantId])

  async function loadHistory() {
    setLoading(true)
    const { data } = await supabase
      .from('reports')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('month_year', { ascending: false })
    setHistory(data || [])
    setLoading(false)
  }

  async function handleGenerate(monthStr?: string) {
    setGenerating(true)
    setStatus(null)
    
    const isCustom = reportType === 'custom'
    const payload: any = { tenantId }
    
    if (isCustom) {
      payload.startDate = startDate
      payload.endDate = endDate
    } else {
      payload.monthYear = monthStr || format(new Date(), 'yyyy-MM')
    }

    const targetLabel = isCustom 
      ? `período ${format(new Date(startDate), 'dd/MM')} a ${format(new Date(endDate), 'dd/MM')}`
      : `mês ${format(new Date(`${payload.monthYear}-01T12:00:00Z`), 'MMMM yyyy', { locale: ptBR })}`

    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(`${API_URL}/api/reports/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session?.access_token}`
        },
        body: JSON.stringify(payload)
      })

      const result = await res.json()

      if (res.ok) {
        setStatus({ type: 'success', msg: `Relatório do ${targetLabel} gerado com sucesso!` })
        loadHistory()
      } else {
        setStatus({ type: 'error', msg: result.error || 'Falha ao gerar relatório.' })
      }
    } catch (err) {
      setStatus({ type: 'error', msg: 'Erro ao conectar com o serviço de relatórios.' })
    } finally {
      setGenerating(false)
    }
  }

  async function handleDelete(reportId: string) {
    setDeleting(reportId)
    setConfirmDelete(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(`${API_URL}/api/reports/${reportId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${session?.access_token}` }
      })
      if (res.ok) {
        setStatus({ type: 'success', msg: 'Relatório excluído com sucesso.' })
        setHistory(prev => prev.filter(r => r.id !== reportId))
      } else {
        const result = await res.json()
        setStatus({ type: 'error', msg: result.error || 'Falha ao excluir relatório.' })
      }
    } catch {
      setStatus({ type: 'error', msg: 'Erro ao conectar com o serviço.' })
    } finally {
      setDeleting(null)
    }
  }

  const currentMonth = format(new Date(), 'yyyy-MM')
  const hasCurrentMonth = history.some(r => r.month_year === currentMonth)

  return (
    <div className="fade-in">
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1 className="page-title">Relatórios Executivos</h1>
          <p className="page-subtitle">Acompanhe sua evolução mensal com documentos prontos para apresentação.</p>
        </div>
        {reportType === 'monthly' ? (
          <div style={{ display: 'flex', gap: 12 }}>
            <select 
              value={selectedMonth} 
              onChange={e => setSelectedMonth(e.target.value)}
              className="input"
              style={{ padding: '8px 12px', background: 'var(--bg-darker)', border: '1px solid var(--border)', borderRadius: 8, color: 'white' }}
            >
              {Array.from({ length: 12 }).map((_, i) => {
                const d = subMonths(new Date(), i)
                const val = format(d, 'yyyy-MM')
                return <option key={val} value={val}>{format(d, 'MMMM yyyy', { locale: ptBR })}</option>
              })}
            </select>
            <button 
              className="btn-primary" 
              onClick={() => handleGenerate(selectedMonth)}
              disabled={generating}
            >
              {generating ? <RefreshCw className="spin" size={16} /> : <FileText size={16} />}
              {generating ? 'Gerando...' : 'Gerar Relatório'}
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <input 
              type="date" value={startDate} onChange={e => setStartDate(e.target.value)} 
              className="input" style={{ padding: '8px 12px', background: 'var(--bg-darker)', border: '1px solid var(--border)', borderRadius: 8, color: 'white' }} 
            />
            <span style={{ color: 'var(--text-muted)' }}>até</span>
            <input 
              type="date" value={endDate} onChange={e => setEndDate(e.target.value)} 
              className="input" style={{ padding: '8px 12px', background: 'var(--bg-darker)', border: '1px solid var(--border)', borderRadius: 8, color: 'white' }} 
            />
            <button 
              className="btn-primary" 
              onClick={() => handleGenerate()}
              disabled={generating}
            >
              {generating ? <RefreshCw className="spin" size={16} /> : <FileText size={16} />}
              {generating ? 'Gerando...' : 'Gerar Relatório'}
            </button>
          </div>
        )}
      </div>

      <div style={{ display: 'flex', gap: 20, marginBottom: 24, borderBottom: '1px solid var(--border)' }}>
        <button 
          onClick={() => setReportType('monthly')}
          style={{ 
            padding: '12px 16px', border: 'none', background: 'none', color: reportType === 'monthly' ? 'var(--accent)' : 'var(--text-muted)',
            borderBottom: reportType === 'monthly' ? '2px solid var(--accent)' : 'none', cursor: 'pointer', fontWeight: 600
          }}
        >
          Mensal Individual
        </button>
        <button 
          onClick={() => setReportType('custom')}
          style={{ 
            padding: '12px 16px', border: 'none', background: 'none', color: reportType === 'custom' ? 'var(--accent)' : 'var(--text-muted)',
            borderBottom: reportType === 'custom' ? '2px solid var(--accent)' : 'none', cursor: 'pointer', fontWeight: 600
          }}
        >
          Período Personalizado
        </button>
      </div>

      {status && (
        <div style={{ 
          padding: '12px 16px', borderRadius: 8, marginBottom: 24, 
          background: status.type === 'success' ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)',
          color: status.type === 'success' ? '#10b981' : '#ef4444',
          display: 'flex', alignItems: 'center', gap: 10, fontSize: 14,
          border: `1px solid ${status.type === 'success' ? 'rgba(16,185,129,0.2)' : 'rgba(239,68,68,0.2)'}`
        }}>
          {status.type === 'success' ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}
          {status.msg}
        </div>
      )}

      <div className="grid-3">
        {/* Card de Relatório Atual (se já existir) */}
        {hasCurrentMonth && (
          <div className="card" style={{ border: '1px solid var(--accent)', background: 'rgba(99,102,241,0.03)' }}>
            <div style={{ padding: 20 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
                <div style={{ background: 'var(--accent)', color: 'white', padding: '4px 8px', borderRadius: 6, fontSize: 10, fontWeight: 700, textTransform: 'uppercase' }}>
                  Novo
                </div>
                <Calendar size={18} color="var(--accent)" />
              </div>
              <h3 style={{ margin: '0 0 4px 0', fontSize: 18 }}>Relatório Mensal</h3>
              <p style={{ margin: 0, fontSize: 14, color: 'var(--text-muted)', textTransform: 'capitalize' }}>
                {format(new Date(), 'MMMM yyyy', { locale: ptBR })}
              </p>
              <a 
                href={history.find(r => r.month_year === currentMonth)?.pdf_url} 
                target="_blank" 
                rel="noreferrer"
                className="btn-primary" 
                style={{ width: '100%', marginTop: 20, justifyContent: 'center' }}
              >
                <Download size={16} /> Baixar PDF
              </a>
            </div>
          </div>
        )}

        {/* Sugestão de meses anteriores se não houver no histórico */}
        {history.length === 0 && !generating && (
          <div className="card" style={{ borderStyle: 'dashed', textAlign: 'center', padding: 40, background: 'transparent', gridColumn: 'span 3' }}>
            <div style={{ fontSize: 40, marginBottom: 16 }}>📊</div>
            <h3 style={{ margin: '0 0 8px 0' }}>Nenhum relatório gerado</h3>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 20 }}>Escolha um mês acima e clique em Gerar Relatório para começar.</p>
          </div>
        )}
      </div>

      <div style={{ marginTop: 40 }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 20, display: 'flex', alignItems: 'center', gap: 8 }}>
          <FileSearch size={18} color="var(--accent)" /> Histórico de Relatórios
        </h2>

        {loading ? (
          <div className="skeleton" style={{ height: 200 }} />
        ) : history.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', background: 'var(--bg-darker)', borderRadius: 12, border: '1px solid var(--border)' }}>
            <p style={{ color: 'var(--text-muted)', fontSize: 14 }}>Seu histórico aparecerá aqui conforme novos relatórios forem gerados.</p>
          </div>
        ) : (
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'rgba(255,255,255,0.02)', borderBottom: '1px solid var(--border)' }}>
                  <th style={{ textAlign: 'left', padding: '12px 20px', fontSize: 12, color: 'var(--text-muted)', fontWeight: 600 }}>MÊS DE REFERÊNCIA</th>
                  <th style={{ textAlign: 'left', padding: '12px 20px', fontSize: 12, color: 'var(--text-muted)', fontWeight: 600 }}>DATA DE GERAÇÃO</th>
                  <th style={{ textAlign: 'right', padding: '12px 20px', fontSize: 12, color: 'var(--text-muted)', fontWeight: 600 }}>AÇÕES</th>
                </tr>
              </thead>
              <tbody>
                {history.map(report => (
                  <tr key={report.id} style={{ borderBottom: '1px solid var(--border)', opacity: deleting === report.id ? 0.5 : 1, transition: 'opacity 0.2s' }}>
                    <td style={{ padding: '16px 20px', fontSize: 14, fontWeight: 600, textTransform: 'capitalize' }}>
                      {report.month_year.includes('_') 
                        ? (() => {
                            const [start, end] = report.month_year.split('_')
                            return `${format(new Date(start), 'dd/MM/yy')} a ${format(new Date(end), 'dd/MM/yy')}`
                          })()
                        : format(new Date(`${report.month_year}-01T12:00:00Z`), 'MMMM yyyy', { locale: ptBR })
                      }
                    </td>
                    <td style={{ padding: '16px 20px', fontSize: 13, color: 'var(--text-secondary)' }}>
                      {format(
                        new Date(new Date(report.created_at).toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' })),
                        'dd/MM/yyyy HH:mm'
                      )}
                      <span style={{ fontSize: 10, color: 'var(--text-muted)', marginLeft: 4 }}>(Brasília)</span>
                    </td>
                    <td style={{ padding: '16px 20px', textAlign: 'right' }}>
                      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', alignItems: 'center' }}>
                        {confirmDelete === report.id ? (
                          // Confirmação inline
                          <>
                            <span style={{ fontSize: 12, color: '#ef4444', marginRight: 4 }}>Confirmar exclusão?</span>
                            <button
                              onClick={() => handleDelete(report.id)}
                              disabled={deleting === report.id}
                              style={{ padding: '4px 10px', background: '#ef4444', color: 'white', border: 'none', borderRadius: 6, fontSize: 12, cursor: 'pointer', fontWeight: 600 }}
                            >
                              Sim, excluir
                            </button>
                            <button
                              onClick={() => setConfirmDelete(null)}
                              style={{ padding: '4px 10px', background: 'var(--bg-darker)', color: 'var(--text-muted)', border: '1px solid var(--border)', borderRadius: 6, fontSize: 12, cursor: 'pointer' }}
                            >
                              Cancelar
                            </button>
                          </>
                        ) : (
                          // Botões normais
                          <>
                            <a 
                              href={report.pdf_url} 
                              target="_blank" 
                              rel="noreferrer"
                              className="btn-icon" 
                              style={{ display: 'inline-flex', padding: 8, background: 'rgba(99,102,241,0.1)', borderRadius: 8 }}
                            >
                              <Download size={16} color="var(--accent)" />
                            </a>
                            <button
                              onClick={() => setConfirmDelete(report.id)}
                              disabled={deleting === report.id}
                              title="Excluir relatório"
                              style={{ display: 'inline-flex', padding: 8, background: 'rgba(239,68,68,0.1)', borderRadius: 8, border: 'none', cursor: 'pointer' }}
                            >
                              <Trash2 size={16} color="#ef4444" />
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
