import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { Plus, Trash2, Search, BarChart2 } from 'lucide-react'

interface Competitor {
  id: string
  name: string
  place_id: string
  created_at: string
}

export default function Competitors() {
  const [competitors, setCompetitors] = useState<Competitor[]>([])
  const [loading, setLoading] = useState(true)
  const [newComp, setNewComp] = useState({ name: '', place_id: '' })
  const [businesses, setBusinesses] = useState<any[]>([])
  const [selectedBusinessId, setSelectedBusinessId] = useState('')

  useEffect(() => {
    loadBusinesses()
  }, [])

  useEffect(() => {
    if (selectedBusinessId) loadCompetitors()
  }, [selectedBusinessId])

  async function loadBusinesses() {
    const { data } = await supabase.from('monitored_businesses').select('id, name')
    setBusinesses(data || [])
    if (data && data.length > 0) setSelectedBusinessId(data[0].id)
  }

  async function loadCompetitors() {
    setLoading(true)
    const { data } = await supabase
      .from('competitor_businesses')
      .select('*')
      .eq('business_id', selectedBusinessId)
    setCompetitors(data || [])
    setLoading(false)
  }

  async function addCompetitor(e: React.FormEvent) {
    e.preventDefault()
    if (!newComp.name || !newComp.place_id) return

    const { error } = await supabase
      .from('competitor_businesses')
      .insert({
        business_id: selectedBusinessId,
        name: newComp.name,
        place_id: newComp.place_id
      })

    if (error) {
      alert('Erro ao adicionar concorrente: ' + error.message)
    } else {
      setNewComp({ name: '', place_id: '' })
      loadCompetitors()
    }
  }

  async function removeCompetitor(id: string) {
    if (!confirm('Deseja remover este concorrente?')) return
    await supabase.from('competitor_businesses').delete().eq('id', id)
    loadCompetitors()
  }

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Benchmarking</h1>
        <p className="page-subtitle">Monitore seus principais concorrentes e compare sua performance no Google Maps.</p>
      </div>

      <div className="card" style={{ marginBottom: 24, padding: 20 }}>
        <div className="modal-label">Selecione sua empresa</div>
        <select 
          value={selectedBusinessId} 
          onChange={e => setSelectedBusinessId(e.target.value)}
          className="filter-select"
          style={{ width: '100%', maxWidth: 400 }}
        >
          {businesses.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
      </div>

      <div className="grid-2">
        <div className="card">
          <div className="section-title"><Plus size={16} /> Adicionar Concorrente</div>
          <form onSubmit={addCompetitor} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div>
              <label className="modal-label">Nome do Concorrente</label>
              <input 
                type="text" 
                className="filter-search" 
                style={{ width: '100%' }}
                value={newComp.name}
                onChange={e => setNewComp({...newComp, name: e.target.value})}
                placeholder="Ex: Pizzaria do Zé"
              />
            </div>
            <div>
              <label className="modal-label">Google Place ID</label>
              <div style={{ display: 'flex', gap: 8 }}>
                <input 
                  type="text" 
                  className="filter-search" 
                  style={{ width: '100%', fontFamily: 'monospace' }}
                  value={newComp.place_id}
                  onChange={e => setNewComp({...newComp, place_id: e.target.value})}
                  placeholder="Ex: ChIJN1t_tDeuEmsRUsoyG83frY4"
                />
              </div>
              <p style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 6 }}>
                💡 Encontre o Place ID usando o <a href="https://developers.google.com/maps/documentation/places/web-service/place-id" target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>ID Finder do Google</a>.
              </p>
            </div>
            <button type="submit" className="btn btn-primary">Salvar Concorrente</button>
          </form>
        </div>

        <div className="card" style={{ padding: 0 }}>
          <div style={{ padding: 20, borderBottom: '1px solid var(--border)', fontWeight: 700 }}>
            Concorrentes Monitorados ({competitors.length})
          </div>
          <div className="list">
            {loading ? (
              <div style={{ padding: 20 }}>Carregando...</div>
            ) : competitors.length === 0 ? (
              <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
                Nenhum concorrente cadastrado para esta empresa.
              </div>
            ) : (
              competitors.map(c => (
                <div key={c.id} style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{c.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'monospace' }}>ID: {c.place_id}</div>
                  </div>
                  <button 
                    onClick={() => removeCompetitor(c.id)}
                    className="btn-icon" 
                    style={{ color: '#ef4444' }}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      <div className="card" style={{ marginTop: 24, background: 'rgba(99,102,241,0.05)', border: '1px dotted var(--accent)' }}>
        <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
          <div style={{ padding: 12, background: 'var(--accent)', borderRadius: 12 }}>
            <BarChart2 color="white" />
          </div>
          <div>
            <h4 style={{ margin: 0, fontSize: 16 }}>Comparação de Performance</h4>
            <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--text-secondary)' }}>
              As métricas de comparação aparecerão automaticamente no seu Dashboard principal após a configuração.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
