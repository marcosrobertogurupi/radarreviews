import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { FileText, Download, Calendar, RefreshCw, AlertCircle, FileSearch, CheckCircle2 } from 'lucide-react'
import { format, subMonths } from 'date-fns'
import { ptBR } from 'date-fns/locale'

interface Props {
  tenantId: string
}

export default function Reports({ tenantId }: Props) {
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [history, setHistory] = useState<any[]>([])
  const [status, setStatus] = useState<{ type: 'success' | 'error', msg: string } | null>(null)

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

  async function handleGenerate(monthOffset = 0) {
    setGenerating(true)
    setStatus(null)
    
    const targetDate = subMonths(new Date(), monthOffset)
    const monthYear = format(targetDate, 'yyyy-MM')

    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch('https://reputei-api.railway.app/api/reports/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session?.access_token}`
        },
        body: JSON.stringify({ tenantId, monthYear })
      })

      const result = await res.json()

      if (res.ok) {
        setStatus({ type: 'success', msg: `Relatório de ${format(targetDate, 'MMMM', { locale: ptBR })} gerado com sucesso!` })
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

  const currentMonth = format(new Date(), 'yyyy-MM')
  const hasCurrentMonth = history.some(r => r.month_year === currentMonth)

  return (
    <div className="fade-in">
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1 className="page-title">Relatórios Executivos</h1>
          <p className="page-subtitle">Acompanhe sua evolução mensal com documentos prontos para apresentação.</p>
        </div>
        {!hasCurrentMonth && (
          <button 
            className="btn-primary" 
            onClick={() => handleGenerate(0)}
            disabled={generating}
          >
            {generating ? <RefreshCw className="spin" size={16} /> : <FileText size={16} />}
            {generating ? 'Gerando...' : 'Gerar Relatório Atual'}
          </button>
        )}
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
          <div className="card" style={{ borderStyle: 'dashed', textAlign: 'center', padding: 40, background: 'transparent' }}>
            <div style={{ fontSize: 40, marginBottom: 16 }}>📊</div>
            <h3 style={{ margin: '0 0 8px 0' }}>Nenhum histórico</h3>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 20 }}>Gere seu primeiro relatório executivo agora mesmo.</p>
            <button className="btn" onClick={() => handleGenerate(0)}>Começar Agora</button>
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
                  <tr key={report.id} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '16px 20px', fontSize: 14, fontWeight: 600, textTransform: 'capitalize' }}>
                      {format(new Date(`${report.month_year}-01T12:00:00Z`), 'MMMM yyyy', { locale: ptBR })}
                    </td>
                    <td style={{ padding: '16px 20px', fontSize: 13, color: 'var(--text-secondary)' }}>
                      {format(new Date(report.created_at), 'dd/MM/yyyy HH:mm')}
                    </td>
                    <td style={{ padding: '16px 20px', textAlign: 'right' }}>
                      <a 
                        href={report.pdf_url} 
                        target="_blank" 
                        rel="noreferrer"
                        className="btn-icon" 
                        style={{ display: 'inline-flex', padding: 8, background: 'rgba(99,102,241,0.1)', borderRadius: 8 }}
                      >
                        <Download size={16} color="var(--accent)" />
                      </a>
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
