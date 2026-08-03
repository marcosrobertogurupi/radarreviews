import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useToast } from '../components/Toast'
import {
  Calendar, Clock, Plus, X, Check, RefreshCw, Video,
  User, Building2, ChevronLeft, ChevronRight, Edit3,
  AlertCircle, CheckCircle2, XCircle, SkipForward, Phone, Mail
} from 'lucide-react'

// ─── Tipos ─────────────────────────────────────────────────────────────────

interface Meeting {
  id: string
  title: string
  description?: string
  scheduled_at: string
  duration_min: number
  status: 'agendada' | 'realizada' | 'cancelada' | 'no_show' | 'reagendada'
  meeting_link?: string
  notes?: string
  outcome?: string
  source: string
  created_at: string
  company_id?: string
  decidor_id?: string
  lead_id?: string
  prospect_companies?: { name: string; cnpj?: string; city?: string; state?: string }
  prospect_decidors?: { name: string; role?: string; email?: string; phone?: string }
}

interface MeetingFormData {
  title: string
  description: string
  scheduled_at: string
  duration_min: number
  meeting_link: string
  notes: string
  company_search: string
  decidor_search: string
  company_id: string
  decidor_id: string
}

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string; icon: any }> = {
  agendada:   { label: 'Agendada',    color: '#6366f1', bg: 'rgba(99, 102, 241, 0.12)', icon: Calendar },
  realizada:  { label: 'Realizada',   color: '#10b981', bg: 'rgba(16, 185, 129, 0.12)', icon: CheckCircle2 },
  cancelada:  { label: 'Cancelada',   color: '#ef4444', bg: 'rgba(239, 68, 68, 0.12)',  icon: XCircle },
  no_show:    { label: 'No-show',     color: '#f59e0b', bg: 'rgba(245, 158, 11, 0.12)', icon: AlertCircle },
  reagendada: { label: 'Reagendada',  color: '#8b5cf6', bg: 'rgba(139, 92, 246, 0.12)', icon: RefreshCw },
}

const OUTCOME_OPTIONS = [
  'Demo realizada com sucesso',
  'Proposta enviada',
  'Cliente solicitou mais informações',
  'Negociação em andamento',
  'Fechamento previsto',
  'Perdido — preço',
  'Perdido — concorrente',
  'Perdido — sem interesse',
  'Reagendar necessário',
]

const DURATION_OPTIONS = [15, 20, 30, 45, 60, 90]

const DAYS_PT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']
const MONTHS_PT = [
  'Janeiro','Fevereiro','Março','Abril','Maio','Junho',
  'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'
]

function formatDate(iso: string) {
  const d = new Date(iso)
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function formatTime(iso: string) {
  const d = new Date(iso)
  return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

function formatDateTimeLocal(iso: string) {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// ─── Componente principal ────────────────────────────────────────────────────

export default function Meetings() {
  const { toast } = useToast()

  const [meetings, setMeetings] = useState<Meeting[]>([])
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState<'calendar' | 'list'>('calendar')
  const [showModal, setShowModal] = useState(false)
  const [editingMeeting, setEditingMeeting] = useState<Meeting | null>(null)
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const now = new Date()
    return { year: now.getFullYear(), month: now.getMonth() }
  })
  const [filterStatus, setFilterStatus] = useState<string>('all')
  const [companies, setCompanies] = useState<any[]>([])
  const [decidors, setDecidors] = useState<any[]>([])
  const [savingMeeting, setSavingMeeting] = useState(false)
  const [statusModal, setStatusModal] = useState<Meeting | null>(null)

  const emptyForm = (): MeetingFormData => ({
    title: 'Reunião Comercial Reputei',
    description: '',
    scheduled_at: new Date(Date.now() + 24*60*60*1000).toISOString().slice(0,16),
    duration_min: 30,
    meeting_link: '',
    notes: '',
    company_search: '',
    decidor_search: '',
    company_id: '',
    decidor_id: '',
  })

  const [form, setForm] = useState<MeetingFormData>(emptyForm())

  // ── Carregar reuniões ────────────────────────────────────────────────────
  const loadMeetings = useCallback(async () => {
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('prospect_meetings')
        .select(`
          *,
          prospect_companies (name, cnpj, city, state),
          prospect_decidors (name, role, email, phone)
        `)
        .order('scheduled_at', { ascending: true })

      if (error) throw error
      setMeetings(data ?? [])
    } catch (err: any) {
      toast(`Erro ao carregar reuniões: ${err.message}`, 'error')
    } finally {
      setLoading(false)
    }
  }, [])

  // ── Carregar empresas e decisores para o formulário ─────────────────────
  const loadCompanies = useCallback(async () => {
    const { data } = await supabase
      .from('prospect_companies')
      .select('id, name, cnpj, city, state')
      .order('name', { ascending: true })
      .limit(200)
    setCompanies(data ?? [])
  }, [])

  const loadDecidors = useCallback(async (companyId?: string) => {
    let query = supabase
      .from('prospect_decidors')
      .select('id, name, role, email, phone, prospect_company_id')
      .order('name', { ascending: true })
      .limit(200)

    if (companyId) query = query.eq('prospect_company_id', companyId)

    const { data } = await query
    setDecidors(data ?? [])
  }, [])

  useEffect(() => {
    loadMeetings()
    loadCompanies()
    loadDecidors()
  }, [])

  // ── Salvar reunião ──────────────────────────────────────────────────────
  async function handleSaveMeeting() {
    if (!form.title || !form.scheduled_at) {
      toast('Título e data/hora são obrigatórios', 'error')
      return
    }
    setSavingMeeting(true)
    try {
      const payload: any = {
        title: form.title,
        description: form.description || null,
        scheduled_at: new Date(form.scheduled_at).toISOString(),
        duration_min: form.duration_min,
        meeting_link: form.meeting_link || null,
        notes: form.notes || null,
        company_id: form.company_id || null,
        decidor_id: form.decidor_id || null,
        source: 'manual',
      }

      if (editingMeeting) {
        const { error } = await supabase
          .from('prospect_meetings')
          .update({ ...payload, updated_at: new Date().toISOString() })
          .eq('id', editingMeeting.id)
        if (error) throw error
        toast('Reunião atualizada com sucesso!', 'success')
      } else {
        const { error } = await supabase
          .from('prospect_meetings')
          .insert(payload)
        if (error) throw error
        toast('Reunião agendada com sucesso!', 'success')
      }

      setShowModal(false)
      setEditingMeeting(null)
      setForm(emptyForm())
      loadMeetings()
    } catch (err: any) {
      toast(`Erro ao salvar: ${err.message}`, 'error')
    } finally {
      setSavingMeeting(false)
    }
  }

  // ── Atualizar status ─────────────────────────────────────────────────────
  async function handleUpdateStatus(id: string, status: string, outcome?: string) {
    try {
      const { error } = await supabase
        .from('prospect_meetings')
        .update({ status, outcome: outcome || null, updated_at: new Date().toISOString() })
        .eq('id', id)
      if (error) throw error
      toast(`Status atualizado para "${STATUS_CONFIG[status]?.label}"`, 'success')
      setStatusModal(null)
      loadMeetings()
    } catch (err: any) {
      toast(`Erro: ${err.message}`, 'error')
    }
  }

  async function handleDeleteMeeting(id: string) {
    if (!confirm('Excluir esta reunião?')) return
    const { error } = await supabase.from('prospect_meetings').delete().eq('id', id)
    if (error) { toast('Erro ao excluir', 'error'); return }
    toast('Reunião excluída', 'success')
    loadMeetings()
  }

  // ── Calendário ───────────────────────────────────────────────────────────
  function buildCalendarDays() {
    const { year, month } = calendarMonth
    const firstDay = new Date(year, month, 1).getDay()
    const daysInMonth = new Date(year, month + 1, 0).getDate()
    const days: (number | null)[] = Array(firstDay).fill(null)
    for (let d = 1; d <= daysInMonth; d++) days.push(d)
    while (days.length % 7 !== 0) days.push(null)
    return days
  }

  function getMeetingsForDay(day: number) {
    const { year, month } = calendarMonth
    return meetings.filter(m => {
      const d = new Date(m.scheduled_at)
      return d.getFullYear() === year && d.getMonth() === month && d.getDate() === day
    })
  }

  const today = new Date()
  const todayStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`

  // ── Stats ────────────────────────────────────────────────────────────────
  const statsAgendadas  = meetings.filter(m => m.status === 'agendada').length
  const statsRealizadas = meetings.filter(m => m.status === 'realizada').length
  const statsCanceladas = meetings.filter(m => m.status === 'cancelada' || m.status === 'no_show').length
  const statsTotal      = meetings.length

  // ── Reuniões filtradas para a lista ─────────────────────────────────────
  const filteredMeetings = filterStatus === 'all'
    ? meetings
    : meetings.filter(m => m.status === filterStatus)

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div style={{ padding: 24, maxWidth: 1400, margin: '0 auto', fontFamily: 'Inter, system-ui, sans-serif' }}>

      {/* Cabeçalho */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 28, flexWrap: 'wrap', gap: 16 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 26, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 10, color: 'var(--text-main)' }}>
            <Calendar size={26} color="#6366f1" /> Agenda de Reuniões
          </h1>
          <p style={{ margin: '6px 0 0', fontSize: 14, color: 'var(--text-secondary)' }}>
            Gerencie reuniões comerciais com seus prospects em um único lugar
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          {/* Toggle View */}
          <div style={{ display: 'flex', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-color)', borderRadius: 8, overflow: 'hidden' }}>
            {(['calendar', 'list'] as const).map(v => (
              <button
                key={v}
                onClick={() => setView(v)}
                style={{
                  padding: '8px 16px', fontSize: 13, fontWeight: 600, border: 'none', cursor: 'pointer',
                  background: view === v ? '#6366f1' : 'transparent',
                  color: view === v ? '#fff' : 'var(--text-secondary)',
                }}
              >
                {v === 'calendar' ? '📅 Calendário' : '📋 Lista'}
              </button>
            ))}
          </div>
          <button
            onClick={() => { setEditingMeeting(null); setForm(emptyForm()); setShowModal(true) }}
            style={{
              display: 'flex', alignItems: 'center', gap: 8, padding: '10px 20px',
              background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
              color: '#fff', border: 'none', borderRadius: 10, fontWeight: 700,
              fontSize: 14, cursor: 'pointer', boxShadow: '0 4px 14px rgba(99,102,241,0.35)',
            }}
          >
            <Plus size={18} /> Nova Reunião
          </button>
        </div>
      </div>

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 14, marginBottom: 28 }}>
        {[
          { label: 'Total', value: statsTotal, color: '#94a3b8', icon: Calendar },
          { label: 'Agendadas', value: statsAgendadas, color: '#6366f1', icon: Clock },
          { label: 'Realizadas', value: statsRealizadas, color: '#10b981', icon: CheckCircle2 },
          { label: 'Canceladas / No-show', value: statsCanceladas, color: '#ef4444', icon: XCircle },
        ].map(({ label, value, color, icon: Icon }) => (
          <div key={label} style={{
            background: 'var(--bg-card)', border: '1px solid var(--border-color)',
            borderRadius: 12, padding: '16px 20px',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <Icon size={16} color={color} />
              <span style={{ fontSize: 12, color: 'var(--text-secondary)', fontWeight: 600 }}>{label}</span>
            </div>
            <div style={{ fontSize: 28, fontWeight: 800, color }}>{value}</div>
          </div>
        ))}
      </div>

      {/* ── CALENDÁRIO ─────────────────────────────────────────────────────── */}
      {view === 'calendar' && (
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: 14, overflow: 'hidden' }}>
          {/* Navegação */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '18px 24px', borderBottom: '1px solid var(--border-color)' }}>
            <button
              onClick={() => setCalendarMonth(prev => {
                const d = new Date(prev.year, prev.month - 1)
                return { year: d.getFullYear(), month: d.getMonth() }
              })}
              style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-color)', borderRadius: 8, padding: '6px 12px', cursor: 'pointer', color: 'var(--text-main)' }}
            >
              <ChevronLeft size={18} />
            </button>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: 'var(--text-main)' }}>
              {MONTHS_PT[calendarMonth.month]} {calendarMonth.year}
            </h2>
            <button
              onClick={() => setCalendarMonth(prev => {
                const d = new Date(prev.year, prev.month + 1)
                return { year: d.getFullYear(), month: d.getMonth() }
              })}
              style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-color)', borderRadius: 8, padding: '6px 12px', cursor: 'pointer', color: 'var(--text-main)' }}
            >
              <ChevronRight size={18} />
            </button>
          </div>

          {/* Grade dos dias da semana */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)' }}>
            {DAYS_PT.map(d => (
              <div key={d} style={{ padding: '10px 0', textAlign: 'center', fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', borderBottom: '1px solid var(--border-color)' }}>
                {d}
              </div>
            ))}

            {buildCalendarDays().map((day, idx) => {
              const dayMeetings = day ? getMeetingsForDay(day) : []
              const isToday = day !== null && `${calendarMonth.year}-${String(calendarMonth.month+1).padStart(2,'0')}-${String(day).padStart(2,'0')}` === todayStr
              return (
                <div
                  key={idx}
                  onClick={() => day && setSelectedDate(`${calendarMonth.year}-${String(calendarMonth.month+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`)}
                  style={{
                    minHeight: 90, padding: 8,
                    borderRight: '1px solid var(--border-color)',
                    borderBottom: '1px solid var(--border-color)',
                    background: day ? (isToday ? 'rgba(99,102,241,0.06)' : 'transparent') : 'rgba(0,0,0,0.1)',
                    cursor: day ? 'pointer' : 'default',
                    position: 'relative',
                  }}
                >
                  {day && (
                    <>
                      <div style={{
                        width: 26, height: 26, borderRadius: '50%',
                        background: isToday ? '#6366f1' : 'transparent',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 13, fontWeight: isToday ? 700 : 400,
                        color: isToday ? '#fff' : 'var(--text-main)',
                        marginBottom: 4,
                      }}>
                        {day}
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                        {dayMeetings.slice(0, 3).map(m => {
                          const cfg = STATUS_CONFIG[m.status]
                          return (
                            <div
                              key={m.id}
                              onClick={e => { e.stopPropagation(); setStatusModal(m) }}
                              style={{
                                background: cfg.bg, borderLeft: `3px solid ${cfg.color}`,
                                borderRadius: '0 4px 4px 0', padding: '2px 6px',
                                fontSize: 11, fontWeight: 600, color: cfg.color,
                                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                                cursor: 'pointer',
                              }}
                              title={m.title}
                            >
                              {formatTime(m.scheduled_at)} {m.title}
                            </div>
                          )
                        })}
                        {dayMeetings.length > 3 && (
                          <div style={{ fontSize: 10, color: 'var(--text-secondary)', paddingLeft: 6 }}>
                            +{dayMeetings.length - 3} mais
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ── LISTA ──────────────────────────────────────────────────────────── */}
      {view === 'list' && (
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: 14, overflow: 'hidden' }}>
          {/* Filtros */}
          <div style={{ display: 'flex', gap: 8, padding: '16px 20px', borderBottom: '1px solid var(--border-color)', flexWrap: 'wrap' }}>
            {['all', 'agendada', 'realizada', 'cancelada', 'no_show', 'reagendada'].map(s => (
              <button
                key={s}
                onClick={() => setFilterStatus(s)}
                style={{
                  padding: '6px 14px', borderRadius: 8, fontSize: 12, fontWeight: 600,
                  cursor: 'pointer', border: 'none',
                  background: filterStatus === s
                    ? (s === 'all' ? '#6366f1' : STATUS_CONFIG[s]?.color || '#6366f1')
                    : 'rgba(255,255,255,0.05)',
                  color: filterStatus === s ? '#fff' : 'var(--text-secondary)',
                }}
              >
                {s === 'all' ? 'Todas' : STATUS_CONFIG[s]?.label}
              </button>
            ))}
            <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-secondary)', alignSelf: 'center' }}>
              {filteredMeetings.length} reuniões
            </span>
          </div>

          {/* Linhas */}
          {loading ? (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-secondary)' }}>Carregando...</div>
          ) : filteredMeetings.length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-secondary)' }}>
              <Calendar size={40} style={{ opacity: 0.3, display: 'block', margin: '0 auto 12px' }} />
              Nenhuma reunião encontrada
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: 'rgba(255,255,255,0.02)' }}>
                  {['Data / Hora', 'Título', 'Empresa / Decisor', 'Duração', 'Status', 'Resultado', 'Ações'].map(h => (
                    <th key={h} style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 700, fontSize: 11, color: 'var(--text-secondary)', borderBottom: '1px solid var(--border-color)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredMeetings.map((m, idx) => {
                  const cfg = STATUS_CONFIG[m.status]
                  const Icon = cfg.icon
                  return (
                    <tr key={m.id} style={{ borderBottom: '1px solid var(--border-color)', background: idx % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.01)' }}>
                      <td style={{ padding: '14px 16px' }}>
                        <div style={{ fontWeight: 700, color: 'var(--text-main)' }}>{formatDate(m.scheduled_at)}</div>
                        <div style={{ fontSize: 12, color: '#6366f1', fontWeight: 600 }}>{formatTime(m.scheduled_at)}</div>
                      </td>
                      <td style={{ padding: '14px 16px' }}>
                        <div style={{ fontWeight: 600, color: 'var(--text-main)', marginBottom: 2 }}>{m.title}</div>
                        {m.meeting_link && (
                          <a href={m.meeting_link} target="_blank" rel="noopener noreferrer"
                            style={{ fontSize: 11, color: '#6366f1', display: 'flex', alignItems: 'center', gap: 4 }}>
                            <Video size={10} /> Link da reunião
                          </a>
                        )}
                      </td>
                      <td style={{ padding: '14px 16px' }}>
                        {m.prospect_companies && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                            <Building2 size={12} color="#94a3b8" />
                            <span style={{ fontWeight: 600, color: 'var(--text-main)', fontSize: 12 }}>{m.prospect_companies.name}</span>
                          </div>
                        )}
                        {m.prospect_decidors && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <User size={12} color="#94a3b8" />
                            <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{m.prospect_decidors.name} {m.prospect_decidors.role ? `(${m.prospect_decidors.role})` : ''}</span>
                          </div>
                        )}
                      </td>
                      <td style={{ padding: '14px 16px', color: 'var(--text-secondary)', fontSize: 12 }}>
                        <Clock size={12} style={{ marginRight: 4 }} />{m.duration_min} min
                      </td>
                      <td style={{ padding: '14px 16px' }}>
                        <span style={{
                          display: 'inline-flex', alignItems: 'center', gap: 5,
                          background: cfg.bg, color: cfg.color,
                          padding: '4px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700
                        }}>
                          <Icon size={10} /> {cfg.label}
                        </span>
                      </td>
                      <td style={{ padding: '14px 16px', fontSize: 11, color: 'var(--text-secondary)', maxWidth: 180 }}>
                        {m.outcome || '—'}
                      </td>
                      <td style={{ padding: '14px 16px' }}>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button
                            onClick={() => setStatusModal(m)}
                            title="Atualizar status"
                            style={{ background: 'rgba(99,102,241,0.12)', color: '#6366f1', border: 'none', borderRadius: 6, padding: '5px 8px', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
                          >
                            <Check size={13} />
                          </button>
                          <button
                            onClick={() => {
                              setEditingMeeting(m)
                              setForm({
                                title: m.title,
                                description: m.description || '',
                                scheduled_at: formatDateTimeLocal(m.scheduled_at),
                                duration_min: m.duration_min,
                                meeting_link: m.meeting_link || '',
                                notes: m.notes || '',
                                company_search: m.prospect_companies?.name || '',
                                decidor_search: m.prospect_decidors?.name || '',
                                company_id: m.company_id || '',
                                decidor_id: m.decidor_id || '',
                              })
                              setShowModal(true)
                            }}
                            title="Editar"
                            style={{ background: 'rgba(255,255,255,0.05)', color: 'var(--text-secondary)', border: 'none', borderRadius: 6, padding: '5px 8px', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
                          >
                            <Edit3 size={13} />
                          </button>
                          <button
                            onClick={() => handleDeleteMeeting(m.id)}
                            title="Excluir"
                            style={{ background: 'rgba(239,68,68,0.08)', color: '#ef4444', border: 'none', borderRadius: 6, padding: '5px 8px', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
                          >
                            <X size={13} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ── MODAL: Status da Reunião ────────────────────────────────────────── */}
      {statusModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(8px)', zIndex: 9999, display: 'flex', justifyContent: 'center', alignItems: 'center', padding: 20 }}>
          <div style={{ background: '#0f111a', border: '1px solid rgba(99,102,241,0.4)', borderRadius: 16, width: '100%', maxWidth: 520, padding: 28, boxShadow: '0 20px 50px rgba(0,0,0,0.8)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: '#f8fafc' }}>Atualizar Reunião</h2>
              <button onClick={() => setStatusModal(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8' }}><X size={20} /></button>
            </div>

            <p style={{ margin: '0 0 20px', fontSize: 14, color: '#94a3b8' }}>
              <strong style={{ color: '#f8fafc' }}>{statusModal.title}</strong><br />
              {formatDate(statusModal.scheduled_at)} às {formatTime(statusModal.scheduled_at)}
            </p>

            <p style={{ margin: '0 0 12px', fontSize: 13, color: '#94a3b8', fontWeight: 600 }}>Novo Status:</p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10, marginBottom: 20 }}>
              {Object.entries(STATUS_CONFIG).map(([key, cfg]) => {
                const Icon = cfg.icon
                return (
                  <button
                    key={key}
                    onClick={() => handleUpdateStatus(statusModal.id, key)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px',
                      background: statusModal.status === key ? cfg.bg : 'rgba(255,255,255,0.04)',
                      border: `1px solid ${statusModal.status === key ? cfg.color : 'rgba(255,255,255,0.1)'}`,
                      borderRadius: 8, cursor: 'pointer', color: cfg.color, fontWeight: 600, fontSize: 13,
                    }}
                  >
                    <Icon size={15} /> {cfg.label}
                  </button>
                )
              })}
            </div>

            <p style={{ margin: '0 0 10px', fontSize: 13, color: '#94a3b8', fontWeight: 600 }}>Resultado da Reunião:</p>
            <select
              onChange={e => handleUpdateStatus(statusModal.id, statusModal.status, e.target.value)}
              defaultValue={statusModal.outcome || ''}
              style={{ width: '100%', background: '#1e2130', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 8, padding: '10px 14px', color: '#fff', fontSize: 14, outline: 'none' }}
            >
              <option value="">Selecionar resultado...</option>
              {OUTCOME_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          </div>
        </div>
      )}

      {/* ── MODAL: Nova / Editar Reunião ─────────────────────────────────────── */}
      {showModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(8px)', zIndex: 9999, display: 'flex', justifyContent: 'center', alignItems: 'center', padding: 20 }}>
          <div style={{ background: '#0f111a', border: '1px solid rgba(99,102,241,0.4)', borderRadius: 16, width: '100%', maxWidth: 620, maxHeight: '90vh', overflowY: 'auto', padding: 28, boxShadow: '0 20px 50px rgba(0,0,0,0.8)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
              <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: '#f8fafc', display: 'flex', alignItems: 'center', gap: 10 }}>
                <Calendar size={20} color="#818cf8" />
                {editingMeeting ? 'Editar Reunião' : 'Agendar Nova Reunião'}
              </h2>
              <button onClick={() => { setShowModal(false); setEditingMeeting(null) }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8' }}><X size={22} /></button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {/* Título */}
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#94a3b8', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Título da Reunião *</label>
                <input
                  type="text"
                  value={form.title}
                  onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                  style={{ width: '100%', background: '#1e2130', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 8, padding: '11px 14px', color: '#fff', fontSize: 14, outline: 'none', boxSizing: 'border-box' }}
                  placeholder="Ex: Demo Reputei — Hospital São Paulo"
                />
              </div>

              {/* Data/Hora + Duração */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 140px', gap: 12 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#94a3b8', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Data & Hora *</label>
                  <input
                    type="datetime-local"
                    value={form.scheduled_at}
                    onChange={e => setForm(f => ({ ...f, scheduled_at: e.target.value }))}
                    style={{ width: '100%', background: '#1e2130', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 8, padding: '11px 14px', color: '#fff', fontSize: 14, outline: 'none', boxSizing: 'border-box' }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#94a3b8', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Duração</label>
                  <select
                    value={form.duration_min}
                    onChange={e => setForm(f => ({ ...f, duration_min: Number(e.target.value) }))}
                    style={{ width: '100%', background: '#1e2130', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 8, padding: '11px 14px', color: '#fff', fontSize: 14, outline: 'none' }}
                  >
                    {DURATION_OPTIONS.map(d => <option key={d} value={d}>{d} min</option>)}
                  </select>
                </div>
              </div>

              {/* Empresa */}
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#94a3b8', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  <Building2 size={12} style={{ marginRight: 4 }} /> Empresa (Prospect)
                </label>
                <select
                  value={form.company_id}
                  onChange={e => {
                    setForm(f => ({ ...f, company_id: e.target.value, decidor_id: '' }))
                    loadDecidors(e.target.value)
                  }}
                  style={{ width: '100%', background: '#1e2130', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 8, padding: '11px 14px', color: '#fff', fontSize: 14, outline: 'none' }}
                >
                  <option value="">Selecionar empresa...</option>
                  {companies.map(c => <option key={c.id} value={c.id}>{c.name}{c.city ? ` — ${c.city}/${c.state}` : ''}</option>)}
                </select>
              </div>

              {/* Decisor */}
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#94a3b8', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  <User size={12} style={{ marginRight: 4 }} /> Decisor / Contato
                </label>
                <select
                  value={form.decidor_id}
                  onChange={e => setForm(f => ({ ...f, decidor_id: e.target.value }))}
                  style={{ width: '100%', background: '#1e2130', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 8, padding: '11px 14px', color: '#fff', fontSize: 14, outline: 'none' }}
                >
                  <option value="">Selecionar decisor...</option>
                  {decidors.map(d => <option key={d.id} value={d.id}>{d.name}{d.role ? ` (${d.role})` : ''}</option>)}
                </select>
              </div>

              {/* Link da reunião */}
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#94a3b8', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  <Video size={12} style={{ marginRight: 4 }} /> Link da Reunião (Google Meet / Zoom)
                </label>
                <input
                  type="url"
                  value={form.meeting_link}
                  onChange={e => setForm(f => ({ ...f, meeting_link: e.target.value }))}
                  style={{ width: '100%', background: '#1e2130', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 8, padding: '11px 14px', color: '#fff', fontSize: 14, outline: 'none', boxSizing: 'border-box' }}
                  placeholder="https://meet.google.com/..."
                />
              </div>

              {/* Descrição */}
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#94a3b8', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Pauta / Descrição</label>
                <textarea
                  value={form.description}
                  onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  rows={3}
                  style={{ width: '100%', background: '#1e2130', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 8, padding: '11px 14px', color: '#fff', fontSize: 14, outline: 'none', resize: 'vertical', boxSizing: 'border-box' }}
                  placeholder="Tópicos a discutir, contexto, objetivos..."
                />
              </div>

              {/* Notas */}
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#94a3b8', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Observações Internas</label>
                <textarea
                  value={form.notes}
                  onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                  rows={2}
                  style={{ width: '100%', background: '#1e2130', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 8, padding: '11px 14px', color: '#fff', fontSize: 14, outline: 'none', resize: 'vertical', boxSizing: 'border-box' }}
                  placeholder="Notas privadas da equipe comercial..."
                />
              </div>

              {/* Botões */}
              <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
                <button
                  onClick={() => { setShowModal(false); setEditingMeeting(null) }}
                  style={{ flex: 1, padding: '12px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, color: '#94a3b8', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
                >
                  Cancelar
                </button>
                <button
                  onClick={handleSaveMeeting}
                  disabled={savingMeeting}
                  style={{
                    flex: 2, padding: '12px', background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
                    border: 'none', borderRadius: 8, color: '#fff', fontSize: 14, fontWeight: 700,
                    cursor: 'pointer', boxShadow: '0 4px 14px rgba(99,102,241,0.4)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                  }}
                >
                  {savingMeeting ? <RefreshCw size={16} className="animate-spin" /> : <Check size={16} />}
                  {editingMeeting ? 'Salvar Alterações' : 'Agendar Reunião'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
