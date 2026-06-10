import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useToast } from '../components/Toast'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { Plus, Save, X, Trash2, Edit, CreditCard, Check } from 'lucide-react'
import { API_URL } from '../lib/utils'

interface Plan {
  id: string
  slug: string
  name: string
  description?: string
  price_monthly: number
  max_channels: number
  color: string
  is_active: boolean
  is_public: boolean
  is_popular: boolean
  sort_order: number
  benefits: string[]
}

export default function Plans() {
  const [plans, setPlans] = useState<Plan[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [editing, setEditing] = useState<Plan | null>(null)
  const [isNew, setIsNew] = useState(false)
  const [confirmDialog, setConfirmDialog] = useState<{
    title: string; message: string; confirmLabel?: string
    dangerous?: boolean; onConfirm: () => void
  } | null>(null)

  const { toast } = useToast()

  useEffect(() => { loadPlans() }, [])

  async function loadPlans() {
    setLoading(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) throw new Error('Não autenticado')
      const res = await fetch(`${API_URL}/api/admin/plans`, {
        headers: { 'Authorization': `Bearer ${session.access_token}` }
      })
      if (!res.ok) throw new Error('Falha ao carregar planos')
      setPlans(await res.json())
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Erro ao carregar planos', 'error')
    } finally {
      setLoading(false)
    }
  }

  async function handleSave() {
    if (!editing) return
    setSaving(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) throw new Error('Não autenticado')
      const method = isNew ? 'POST' : 'PATCH'
      const url = isNew
        ? `${API_URL}/api/admin/plans`
        : `${API_URL}/api/admin/plans/${editing.id}`
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
        body: JSON.stringify(editing)
      })
      if (!res.ok) {
        const errData = await res.json()
        throw new Error(errData.error || 'Erro ao salvar plano')
      }
      toast(isNew ? 'Plano criado com sucesso!' : 'Plano atualizado!', 'success')
      setEditing(null)
      loadPlans()
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Erro ao salvar', 'error')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(plan: Plan) {
    setConfirmDialog({
      title: 'Excluir Plano',
      message: `Tem certeza que deseja excluir o plano "${plan.name}"?`,
      confirmLabel: 'Excluir',
      dangerous: true,
      onConfirm: async () => {
        try {
          const { data: { session } } = await supabase.auth.getSession()
          if (!session) throw new Error('Não autenticado')
          const res = await fetch(`${API_URL}/api/admin/plans/${plan.id}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${session.access_token}` }
          })
          if (!res.ok) throw new Error('Erro ao excluir')
          toast('Plano removido!', 'success')
          loadPlans()
        } catch (err) {
          toast(err instanceof Error ? err.message : 'Erro ao excluir', 'error')
        } finally {
          setConfirmDialog(null)
        }
      }
    })
  }

  function startEdit(plan: Plan) {
    setIsNew(false)
    setEditing({ ...plan })
  }

  function startNew() {
    setIsNew(true)
    setEditing({
      id: '', slug: '', name: '', price_monthly: 0,
      max_channels: 3, color: '#6366f1',
      is_active: true, is_public: true, is_popular: false,
      sort_order: plans.length, benefits: []
    })
  }

  function addBenefit() {
    if (!editing) return
    setEditing({ ...editing, benefits: [...editing.benefits, ''] })
  }

  function updateBenefit(index: number, value: string) {
    if (!editing) return
    const b = [...editing.benefits]; b[index] = value
    setEditing({ ...editing, benefits: b })
  }

  function removeBenefit(index: number) {
    if (!editing) return
    setEditing({ ...editing, benefits: editing.benefits.filter((_, i) => i !== index) })
  }

  if (loading && plans.length === 0) {
    return (
      <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)' }}>
        ⌛ Carregando planos...
      </div>
    )
  }

  return (
    <div style={{ padding: 32 }}>
      {/* Cabeçalho */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 28 }}>
        <div>
          <h1 style={{ fontFamily: 'Outfit', fontSize: 22, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
            <CreditCard size={20} color="var(--accent)" /> Gestão de Planos
          </h1>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 4 }}>
            Configuração de ofertas e preços do SaaS
          </p>
        </div>
        <button
          onClick={startNew}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '10px 18px', background: 'var(--accent)',
            border: 'none', borderRadius: 'var(--radius-sm)',
            color: '#fff', fontWeight: 600, fontSize: 13,
            cursor: 'pointer'
          }}
        >
          <Plus size={16} /> Novo Plano
        </button>
      </div>

      {/* Grid de planos */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 20 }}>
        {plans.map(plan => (
          <div
            key={plan.id}
            className="card"
            style={{ padding: 20, borderTop: `3px solid ${plan.color}`, display: 'flex', flexDirection: 'column' }}
          >
            {/* Topo do card */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 2 }}>{plan.name}</div>
                <code style={{ fontSize: 11, color: 'var(--text-muted)', background: 'rgba(255,255,255,0.05)', padding: '2px 6px', borderRadius: 4 }}>
                  /{plan.slug}
                </code>
              </div>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                {!plan.is_active && <span className="badge badge-negative" style={{ fontSize: 10 }}>Inativo</span>}
                {!plan.is_public && <span className="badge badge-neutral" style={{ fontSize: 10 }}>Oculto</span>}
                {plan.is_popular && <span className="badge" style={{ fontSize: 10, background: 'rgba(99,102,241,0.15)', color: '#a5b4fc', border: '1px solid rgba(99,102,241,0.3)' }}>Popular</span>}
              </div>
            </div>

            {/* Preço */}
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontFamily: 'Outfit', fontWeight: 800, fontSize: 28, color: plan.color }}>
                R$ {plan.price_monthly.toLocaleString('pt-BR')}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>por mês · {plan.max_channels === 999 ? 'ilimitado' : plan.max_channels} canais</div>
            </div>

            {/* Benefícios */}
            <div style={{ flex: 1, marginBottom: 16 }}>
              <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)', marginBottom: 8 }}>
                Benefícios
              </div>
              <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 5 }}>
                {(plan.benefits ?? []).slice(0, 4).map((b, i) => (
                  <li key={i} style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Check size={11} color="var(--positive)" /> {b}
                  </li>
                ))}
                {plan.benefits?.length > 4 && (
                  <li style={{ fontSize: 12, color: 'var(--text-muted)', fontStyle: 'italic' }}>
                    + {plan.benefits.length - 4} outros...
                  </li>
                )}
                {(!plan.benefits || plan.benefits.length === 0) && (
                  <li style={{ fontSize: 12, color: 'var(--text-muted)', fontStyle: 'italic' }}>Nenhum benefício</li>
                )}
              </ul>
            </div>

            {/* Ações */}
            <div style={{ display: 'flex', gap: 8, borderTop: '1px solid var(--border)', paddingTop: 14 }}>
              <button
                onClick={() => startEdit(plan)}
                style={{
                  flex: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                  padding: '8px 12px', background: 'rgba(99,102,241,0.1)',
                  border: '1px solid rgba(99,102,241,0.25)', borderRadius: 'var(--radius-sm)',
                  color: '#a5b4fc', fontSize: 13, fontWeight: 600, cursor: 'pointer'
                }}
              >
                <Edit size={14} /> Editar
              </button>
              <button
                onClick={() => handleDelete(plan)}
                style={{
                  padding: '8px 10px', background: 'rgba(239,68,68,0.08)',
                  border: '1px solid rgba(239,68,68,0.2)', borderRadius: 'var(--radius-sm)',
                  color: '#ef4444', cursor: 'pointer', display: 'inline-flex', alignItems: 'center'
                }}
              >
                <Trash2 size={14} />
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* ── Modal de Edição ── usa as classes nativas do admin (.modal-overlay / .modal-content) */}
      {editing && (
        <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) setEditing(null) }}>
          <div className="modal-content" style={{ maxWidth: 680, maxHeight: '88vh' }}>

            {/* Header do modal */}
            <div className="modal-title">
              <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {isNew ? <Plus size={18} color="var(--accent)" /> : <Edit size={18} color="var(--accent)" />}
                {isNew ? 'Novo Plano' : `Editar: ${editing.name}`}
              </span>
              <button className="modal-close" onClick={() => setEditing(null)}><X size={20} /></button>
            </div>

            {/* Campos */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>

              {/* Nome + Slug */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                <div>
                  <div className="modal-label">Nome do Plano</div>
                  <input
                    type="text" value={editing.name}
                    onChange={e => setEditing({ ...editing, name: e.target.value })}
                    placeholder="Ex: Completo"
                    style={inputStyle}
                  />
                </div>
                <div>
                  <div className="modal-label">Slug (identificador)</div>
                  <input
                    type="text" value={editing.slug}
                    onChange={e => setEditing({ ...editing, slug: e.target.value })}
                    placeholder="ex-completo" disabled={!isNew}
                    style={{ ...inputStyle, opacity: isNew ? 1 : 0.5 }}
                  />
                </div>
              </div>

              {/* Preço + Canais + Cor */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14 }}>
                <div>
                  <div className="modal-label">Preço Mensal (R$)</div>
                  <input
                    type="number" value={editing.price_monthly}
                    onChange={e => setEditing({ ...editing, price_monthly: Number(e.target.value) })}
                    style={inputStyle}
                  />
                </div>
                <div>
                  <div className="modal-label">Máx. Canais</div>
                  <input
                    type="number" value={editing.max_channels}
                    onChange={e => setEditing({ ...editing, max_channels: Number(e.target.value) })}
                    style={inputStyle}
                  />
                </div>
                <div>
                  <div className="modal-label">Cor do Tema</div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <input
                      type="color" value={editing.color}
                      onChange={e => setEditing({ ...editing, color: e.target.value })}
                      style={{ width: 40, height: 36, padding: 2, border: 'none', background: 'transparent', cursor: 'pointer' }}
                    />
                    <input
                      type="text" value={editing.color}
                      onChange={e => setEditing({ ...editing, color: e.target.value })}
                      style={{ ...inputStyle, flex: 1, fontFamily: 'monospace', textTransform: 'uppercase' }}
                    />
                  </div>
                </div>
              </div>

              {/* Descrição */}
              <div>
                <div className="modal-label">Descrição (opcional)</div>
                <textarea
                  value={editing.description || ''}
                  onChange={e => setEditing({ ...editing, description: e.target.value })}
                  placeholder="Resumo do que o plano oferece..."
                  rows={2}
                  style={{ ...inputStyle, resize: 'vertical' }}
                />
              </div>

              {/* Ordem + Flags */}
              <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr 1fr 1fr', gap: 14, alignItems: 'end' }}>
                <div>
                  <div className="modal-label">Ordem</div>
                  <input
                    type="number" value={editing.sort_order}
                    onChange={e => setEditing({ ...editing, sort_order: Number(e.target.value) })}
                    style={inputStyle}
                  />
                </div>
                {([
                  ['is_active', 'Ativo'],
                  ['is_public', 'Público'],
                  ['is_popular', '⭐ Popular'],
                ] as [keyof Plan, string][]).map(([key, label]) => (
                  <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', paddingBottom: 10 }}>
                    <input
                      type="checkbox"
                      checked={!!editing[key]}
                      onChange={e => setEditing({ ...editing, [key]: e.target.checked })}
                      style={{ width: 16, height: 16, cursor: 'pointer', accentColor: 'var(--accent)' }}
                    />
                    <span style={{ fontSize: 13, fontWeight: key === 'is_popular' ? 700 : 400, color: key === 'is_popular' ? '#a5b4fc' : 'var(--text-secondary)' }}>
                      {label}
                    </span>
                  </label>
                ))}
              </div>

              {/* Benefícios */}
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <div className="modal-label" style={{ margin: 0 }}>Lista de Benefícios</div>
                  <button
                    onClick={addBenefit}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}
                  >
                    <Plus size={12} /> Adicionar
                  </button>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {editing.benefits.map((benefit, i) => (
                    <div key={i} style={{ display: 'flex', gap: 8 }}>
                      <input
                        type="text" value={benefit}
                        onChange={e => updateBenefit(i, e.target.value)}
                        placeholder={`Benefício ${i + 1}`}
                        style={{ ...inputStyle, flex: 1 }}
                      />
                      <button onClick={() => removeBenefit(i)} style={{ padding: '0 8px', background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer' }}>
                        <Trash2 size={15} />
                      </button>
                    </div>
                  ))}
                  {editing.benefits.length === 0 && (
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', fontStyle: 'italic', padding: '10px 0' }}>
                      Nenhum benefício. Clique em "Adicionar" acima.
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Rodapé */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 24, paddingTop: 18, borderTop: '1px solid var(--border)' }}>
              <button
                onClick={() => setEditing(null)} disabled={saving}
                style={{ padding: '9px 18px', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 13 }}
              >
                Cancelar
              </button>
              <button
                onClick={handleSave}
                disabled={saving || !editing.name || !editing.slug}
                style={{
                  padding: '9px 22px', background: saving ? 'rgba(99,102,241,0.5)' : 'var(--accent)',
                  border: 'none', borderRadius: 'var(--radius-sm)',
                  color: '#fff', fontWeight: 700, fontSize: 13, cursor: saving ? 'not-allowed' : 'pointer',
                  display: 'inline-flex', alignItems: 'center', gap: 6
                }}
              >
                {saving ? 'Salvando...' : <><Save size={15} /> Salvar Plano</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmDialog && (
        <ConfirmDialog
          title={confirmDialog.title}
          message={confirmDialog.message}
          confirmLabel={confirmDialog.confirmLabel}
          dangerous={confirmDialog.dangerous}
          onConfirm={confirmDialog.onConfirm}
          onCancel={() => setConfirmDialog(null)}
        />
      )}
    </div>
  )
}

// Estilo base reutilizável para inputs
const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '9px 12px',
  background: 'rgba(255,255,255,0.05)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-sm)',
  color: 'var(--text-primary)',
  fontSize: 13,
  fontFamily: 'Inter, sans-serif',
  outline: 'none',
}
