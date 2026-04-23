import { 
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, 
  CartesianGrid, Tooltip, Legend 
} from 'recharts'
import type { TimelinePoint } from '../../services/reputation'

interface Props {
  data: TimelinePoint[]
  loading?: boolean
}

export default function ReputationTimeline({ data, loading }: Props) {
  if (loading) {
    return (
      <div className="card" style={{ height: 300, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div className="skeleton" style={{ width: '80%', height: '60%' }} />
      </div>
    )
  }

  const chartData = data.map(p => ({
    ...p,
    formattedDate: new Date(p.date).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
  }))

  return (
    <div className="card" style={{ padding: 24 }}>
      <div style={{ marginBottom: 20 }}>
        <h3 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>Evolução da Reputação</h3>
        <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '4px 0 0' }}>
          Nota média consolidada nos últimos 30 dias
        </p>
      </div>

      <div style={{ height: 260, width: '100%' }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
            <defs>
              <linearGradient id="colorRating" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3}/>
                <stop offset="95%" stopColor="#6366f1" stopOpacity={0}/>
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.05)" />
            <XAxis 
              dataKey="formattedDate" 
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 11, fill: 'var(--text-muted)' }}
              minTickGap={20}
            />
            <YAxis 
              domain={[0, 5]} 
              ticks={[0, 1, 2, 3, 4, 5]}
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 11, fill: 'var(--text-muted)' }}
            />
            <Tooltip 
              contentStyle={{ 
                background: 'var(--bg-dark)', 
                border: '1px solid var(--border)',
                borderRadius: 8,
                fontSize: 12
              }}
              itemStyle={{ color: '#a5b4fc' }}
            />
            <Area 
              type="monotone" 
              dataKey="avgRating" 
              name="Nota Média"
              stroke="#6366f1" 
              strokeWidth={3}
              fillOpacity={1} 
              fill="url(#colorRating)" 
              animationDuration={1500}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      
      <div style={{ 
        marginTop: 16, 
        paddingTop: 16, 
        borderTop: '1px solid var(--border)',
        display: 'flex',
        justifyContent: 'center',
        gap: 24
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 12, height: 3, background: '#6366f1', borderRadius: 2 }} />
          <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Nota Média Diária</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 12, height: 12, background: 'rgba(99,102,241,0.1)', borderRadius: 2, border: '1px solid #6366f120' }} />
          <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Volume de Atividade</span>
        </div>
      </div>
    </div>
  )
}
