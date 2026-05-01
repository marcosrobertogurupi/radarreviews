import { useEffect } from 'react'
import { AlertTriangle } from 'lucide-react'

interface Props {
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  dangerous?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDialog({ title, message, confirmLabel = 'Confirmar', cancelLabel = 'Cancelar', dangerous = false, onConfirm, onCancel }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
      if (e.key === 'Enter') onConfirm()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onConfirm, onCancel])

  return (
    <div className="modal-overlay" onClick={onCancel} style={{ zIndex: 9999 }}>
      <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: 420 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          <div style={{ padding: 10, borderRadius: 8, background: dangerous ? 'rgba(239,68,68,0.1)' : 'rgba(99,102,241,0.1)', flexShrink: 0 }}>
            <AlertTriangle size={20} color={dangerous ? '#f87171' : '#a5b4fc'} />
          </div>
          <h3 style={{ margin: 0, fontSize: 16, color: 'var(--text-primary)' }}>{title}</h3>
        </div>
        <p style={{ margin: '0 0 24px 0', fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6, whiteSpace: 'pre-line' }}>{message}</p>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button
            className="btn"
            style={{ background: 'transparent', border: '1px solid var(--border)' }}
            onClick={onCancel}
          >
            {cancelLabel}
          </button>
          <button
            className="btn"
            style={{ background: dangerous ? '#dc2626' : 'var(--accent)', color: '#fff' }}
            onClick={onConfirm}
            autoFocus
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
