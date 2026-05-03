import { createContext, useContext, useState, useCallback, useRef } from 'react'
import { CheckCircle2, AlertCircle, Info, X, AlertTriangle } from 'lucide-react'

type ToastType = 'success' | 'error' | 'info' | 'warning'

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
    setTimeout(() => removeToast(id), 5000)
  }, [])

  const removeToast = (id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }

  const config: Record<ToastType, { color: string, icon: any, bg: string }> = {
    success: { color: '#10b981', icon: <CheckCircle2 size={18} />, bg: 'rgba(16, 185, 129, 0.1)' },
    error:   { color: '#ef4444', icon: <AlertCircle size={18} />, bg: 'rgba(239, 68, 68, 0.1)' },
    warning: { color: '#f59e0b', icon: <AlertTriangle size={18} />, bg: 'rgba(245, 158, 11, 0.1)' },
    info:    { color: '#6366f1', icon: <Info size={18} />, bg: 'rgba(99, 102, 241, 0.1)' },
  }

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div style={{ 
        position: 'fixed', 
        top: 24, 
        right: 24, 
        zIndex: 9999, 
        display: 'flex', 
        flexDirection: 'column', 
        gap: 12, 
        alignItems: 'flex-end',
        pointerEvents: 'none'
      }}>
        {toasts.map(t => (
          <div key={t.id} style={{
            background: 'rgba(15, 15, 25, 0.85)',
            backdropFilter: 'blur(12px)',
            WebkitBackdropFilter: 'blur(12px)',
            border: `1px solid ${config[t.type].bg.replace('0.1', '0.2')}`,
            borderLeft: `4px solid ${config[t.type].color}`,
            color: '#ffffff',
            padding: '14px 20px',
            borderRadius: '12px',
            width: '320px',
            fontSize: '14px',
            boxShadow: '0 10px 30px rgba(0,0,0,0.3)',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            animation: 'toast-in 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
            pointerEvents: 'auto',
            position: 'relative'
          }}>
            <div style={{ color: config[t.type].color, display: 'flex' }}>
              {config[t.type].icon}
            </div>
            <div style={{ flex: 1, fontWeight: 500, lineHeight: 1.4 }}>
              {t.message}
            </div>
            <button 
              onClick={() => removeToast(t.id)}
              style={{ 
                background: 'transparent', 
                border: 'none', 
                color: 'rgba(255,255,255,0.4)', 
                cursor: 'pointer',
                padding: 4,
                display: 'flex',
                borderRadius: '4px',
                transition: 'all 0.2s'
              }}
            >
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
      <style>{`
        @keyframes toast-in { 
          from { opacity: 0; transform: translateX(32px); } 
          to { opacity: 1; transform: translateX(0); } 
        }
      `}</style>
    </ToastContext.Provider>
  )
}

export function useToast() {
  return useContext(ToastContext)
}
