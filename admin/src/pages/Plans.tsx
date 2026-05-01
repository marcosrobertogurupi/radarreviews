import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useToast } from '../components/Toast'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { Plus, Save, X, Trash2, Edit, CreditCard, Check, AlertCircle } from 'lucide-react'

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
    title: string
    message: string
    confirmLabel?: string
    dangerous?: boolean
    onConfirm: () => void
  } | null>(null)

  const { toast } = useToast()
  const baseUrl = (import.meta.env.VITE_API_URL ?? 'https://reputei-api.railway.app').replace(/\/+$/, '')

  useEffect(() => {
    loadPlans()
  }, [])

  async function loadPlans() {
    setLoading(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) throw new Error('Não autenticado')

      const res = await fetch(`${baseUrl}/api/admin/plans`, {
        headers: { 'Authorization': `Bearer ${session.access_token}` }
      })

      if (!res.ok) throw new Error('Falha ao carregar planos')
      const data = await res.json()
      setPlans(data)
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
      const url = isNew ? `${baseUrl}/api/admin/plans` : `${baseUrl}/api/admin/plans/${editing.id}`

      const res = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`
        },
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
      message: `Tem certeza que deseja excluir o plano "${plan.name}"? Esta ação não pode ser desfeita.`,
      confirmLabel: 'Excluir',
      dangerous: true,
      onConfirm: async () => {
        try {
          const { data: { session } } = await supabase.auth.getSession()
          if (!session) throw new Error('Não autenticado')

          const res = await fetch(`${baseUrl}/api/admin/plans/${plan.id}`, {
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
    setEditing({ ...plan })
    setIsNew(false)
  }

  function startNew() {
    setEditing({
      id: '',
      slug: '',
      name: '',
      price_monthly: 0,
      max_channels: 3,
      color: '#6b7280',
      is_active: true,
      is_public: true,
      is_popular: false,
      sort_order: plans.length,
      benefits: []
    })
    setIsNew(true)
  }

  function addBenefit() {
    if (!editing) return
    setEditing({ ...editing, benefits: [...editing.benefits, ''] })
  }

  function updateBenefit(index: number, value: string) {
    if (!editing) return
    const newBenefits = [...editing.benefits]
    newBenefits[index] = value
    setEditing({ ...editing, benefits: newBenefits })
  }

  function removeBenefit(index: number) {
    if (!editing) return
    setEditing({ ...editing, benefits: editing.benefits.filter((_, i) => i !== index) })
  }

  if (loading && plans.length === 0) {
    return (
      <div className="p-8 text-center text-muted-foreground">
        <div className="animate-spin mb-4">⌛</div>
        Carregando planos...
      </div>
    )
  }

  return (
    <div className="p-8">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <CreditCard className="text-primary" />
            Gestão de Planos
          </h1>
          <p className="text-muted-foreground mt-1">Configuração de ofertas e preços do SaaS</p>
        </div>
        <button onClick={startNew} className="btn btn-primary flex items-center gap-2">
          <Plus size={18} /> Novo Plano
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
        {plans.map(plan => (
          <div key={plan.id} className="card p-6 flex flex-col" style={{ borderTop: `4px solid ${plan.color}` }}>
            <div className="flex justify-between items-start mb-4">
              <div>
                <h3 className="font-bold text-lg">{plan.name}</h3>
                <code className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">/{plan.slug}</code>
              </div>
              <div className="flex gap-1">
                {!plan.is_active && <span className="badge badge-error text-[10px]">Inativo</span>}
                {!plan.is_public && <span className="badge badge-warning text-[10px]">Oculto</span>}
                {plan.is_popular && <span className="badge badge-primary text-[10px]">Popular</span>}
              </div>
            </div>

            <div className="mb-6">
              <div className="text-2xl font-black">R$ {plan.price_monthly}</div>
              <div className="text-xs text-muted-foreground">por mês</div>
              <div className="mt-2 text-sm">
                <strong>{plan.max_channels}</strong> canais monitorados
              </div>
            </div>

            <div className="flex-1 mb-6">
              <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">Benefícios</h4>
              <ul className="space-y-1.5">
                {plan.benefits.slice(0, 4).map((b, i) => (
                  <li key={i} className="text-xs flex items-start gap-2">
                    <Check size={12} className="text-green-500 mt-0.5 shrink-0" />
                    <span>{b}</span>
                  </li>
                ))}
                {plan.benefits.length > 4 && (
                  <li className="text-xs text-muted-foreground italic">+ {plan.benefits.length - 4} outros...</li>
                )}
              </ul>
            </div>

            <div className="flex gap-2 pt-4 border-t">
              <button onClick={() => startEdit(plan)} className="btn btn-ghost flex-1 flex items-center justify-center gap-2 text-sm">
                <Edit size={14} /> Editar
              </button>
              <button onClick={() => handleDelete(plan)} className="btn btn-ghost flex-none p-2 text-red-400 hover:text-red-500 hover:bg-red-500/10">
                <Trash2 size={14} />
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Modal de Edição */}
      {editing && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-card border w-full max-w-2xl max-h-[90vh] overflow-hidden rounded-xl flex flex-col shadow-2xl">
            <div className="p-6 border-b flex justify-between items-center bg-muted/30">
              <h2 className="text-xl font-bold flex items-center gap-2">
                {isNew ? <Plus className="text-primary" /> : <Edit className="text-primary" />}
                {isNew ? 'Novo Plano' : `Editar Plano: ${editing.name}`}
              </h2>
              <button onClick={() => setEditing(null)} className="text-muted-foreground hover:text-foreground">
                <X size={24} />
              </button>
            </div>

            <div className="p-6 overflow-y-auto flex-1 space-y-6">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-bold uppercase text-muted-foreground">Nome do Plano</label>
                  <input
                    type="text"
                    value={editing.name}
                    onChange={e => setEditing({ ...editing, name: e.target.value })}
                    className="input w-full"
                    placeholder="Ex: Completo"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-bold uppercase text-muted-foreground">Slug (identificador)</label>
                  <input
                    type="text"
                    value={editing.slug}
                    onChange={e => setEditing({ ...editing, slug: e.target.value })}
                    className="input w-full"
                    placeholder="ex-completo"
                    disabled={!isNew}
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-bold uppercase text-muted-foreground">Preço Mensal (R$)</label>
                  <input
                    type="number"
                    value={editing.price_monthly}
                    onChange={e => setEditing({ ...editing, price_monthly: Number(e.target.value) })}
                    className="input w-full"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-bold uppercase text-muted-foreground">Máx. Canais</label>
                  <input
                    type="number"
                    value={editing.max_channels}
                    onChange={e => setEditing({ ...editing, max_channels: Number(e.target.value) })}
                    className="input w-full"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-bold uppercase text-muted-foreground">Cor do Tema</label>
                  <div className="flex gap-2">
                    <input
                      type="color"
                      value={editing.color}
                      onChange={e => setEditing({ ...editing, color: e.target.value })}
                      className="w-10 h-10 p-0 border-none bg-transparent cursor-pointer"
                    />
                    <input
                      type="text"
                      value={editing.color}
                      onChange={e => setEditing({ ...editing, color: e.target.value })}
                      className="input flex-1 text-xs font-mono uppercase"
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold uppercase text-muted-foreground">Descrição (opcional)</label>
                <textarea
                  value={editing.description || ''}
                  onChange={e => setEditing({ ...editing, description: e.target.value })}
                  className="input w-full h-20 py-2"
                  placeholder="Resumo do que o plano oferece..."
                />
              </div>

              <div className="grid grid-cols-4 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-bold uppercase text-muted-foreground">Ordem</label>
                  <input
                    type="number"
                    value={editing.sort_order}
                    onChange={e => setEditing({ ...editing, sort_order: Number(e.target.value) })}
                    className="input w-full"
                  />
                </div>
                <div className="flex items-center gap-2 pt-6">
                  <input
                    type="checkbox"
                    id="is_active"
                    checked={editing.is_active}
                    onChange={e => setEditing({ ...editing, is_active: e.target.checked })}
                  />
                  <label htmlFor="is_active" className="text-sm cursor-pointer">Ativo</label>
                </div>
                <div className="flex items-center gap-2 pt-6">
                  <input
                    type="checkbox"
                    id="is_public"
                    checked={editing.is_public}
                    onChange={e => setEditing({ ...editing, is_public: e.target.checked })}
                  />
                  <label htmlFor="is_public" className="text-sm cursor-pointer">Público</label>
                </div>
                <div className="flex items-center gap-2 pt-6">
                  <input
                    type="checkbox"
                    id="is_popular"
                    checked={editing.is_popular}
                    onChange={e => setEditing({ ...editing, is_popular: e.target.checked })}
                  />
                  <label htmlFor="is_popular" className="text-sm cursor-pointer font-bold text-primary">Popular</label>
                </div>
              </div>

              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <label className="text-xs font-bold uppercase text-muted-foreground">Lista de Benefícios</label>
                  <button onClick={addBenefit} className="text-xs text-primary font-bold hover:underline flex items-center gap-1">
                    <Plus size={12} /> Adicionar Benefício
                  </button>
                </div>
                <div className="space-y-2">
                  {editing.benefits.map((benefit, i) => (
                    <div key={i} className="flex gap-2">
                      <input
                        type="text"
                        value={benefit}
                        onChange={e => updateBenefit(i, e.target.value)}
                        className="input flex-1 text-sm h-9"
                        placeholder={`Benefício ${i + 1}`}
                      />
                      <button onClick={() => removeBenefit(i)} className="text-red-400 hover:text-red-500 p-1">
                        <Trash2 size={16} />
                      </button>
                    </div>
                  ))}
                  {editing.benefits.length === 0 && (
                    <div className="text-sm text-muted-foreground italic bg-muted/20 p-4 rounded-lg text-center">
                      Nenhum benefício listado. Clique em "Adicionar Benefício" acima.
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="p-6 border-t bg-muted/30 flex justify-end gap-3">
              <button
                onClick={() => setEditing(null)}
                className="btn btn-ghost"
                disabled={saving}
              >
                Cancelar
              </button>
              <button
                onClick={handleSave}
                className="btn btn-primary px-8 flex items-center gap-2"
                disabled={saving || !editing.name || !editing.slug}
              >
                {saving ? 'Salvando...' : <><Save size={18} /> Salvar Plano</>}
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
