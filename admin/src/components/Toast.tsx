import { createContext, useContext, useState, useCallback, useRef } from 'react'

type ToastType = 'success' | 'error' | 'info'

interface Toast {
  id: number
  message: string
  type: ToastType
}

interface ToastContextValue {
  toast: (message: string, type?: ToastType) => void
}

const ToastContext = createContext<ToastContextValue>({ toast: () => {} })

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const counter = useRef(0)

  const toast = useCallback((message: string, type: ToastType = 'info') => {
    const id = ++counter.current
    setToasts(prev => [...prev, { id, message, type }])
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4000)
  }, [])

  const colors: Record<ToastType, string> = {
    success: '#10b981',
    error:   '#ef4444',
    info:    '#6366f1',
  }

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 9999, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {toasts.map(t => (
          <div key={t.id} style={{
            background: '#1e1e2e',
            border: `1px solid ${colors[t.type]}`,
            borderLeft: `4px solid ${colors[t.type]}`,
            color: '#e2e8f0',
            padding: '12px 18px',
            borderRadius: 8,
            maxWidth: 380,
            fontSize: 14,
            boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
            animation: 'slideIn 0.2s ease',
          }}>
            {t.message}
          </div>
        ))}
      </div>
      <style>{`@keyframes slideIn { from { opacity:0; transform: translateX(40px) } to { opacity:1; transform: translateX(0) } }`}</style>
    </ToastContext.Provider>
  )
}

export function useToast() {
  return useContext(ToastContext)
}
