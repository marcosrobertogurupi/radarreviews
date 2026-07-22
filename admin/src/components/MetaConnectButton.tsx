import { useState } from 'react'

interface MetaConnectButtonProps {
  tenantId: string
  businessId: string
}

export function MetaConnectButton({ tenantId, businessId }: MetaConnectButtonProps) {
  const [loading, setLoading] = useState(false)

  const handleConnect = () => {
    setLoading(true)
    const apiBase = import.meta.env.VITE_API_URL || 'https://reputei-api-production.up.railway.app'
    // Remove trailing slash if exists
    const cleanApiBase = apiBase.replace(/\/$/, '')
    
    const connectUrl = `${cleanApiBase}/api/auth/meta/connect?tenant_id=${tenantId}&business_id=${businessId}`
    
    try {
      if (window.top && window.top !== window) {
        window.top.location.href = connectUrl
      } else {
        window.location.href = connectUrl
      }
    } catch (e) {
      // Caso haja bloqueio de segurança/CORS ao tentar acessar window.top, abre em uma nova aba como fallback
      window.open(connectUrl, '_blank')
    }
  }

  return (
    <div style={{ 
      background: 'rgba(24, 119, 242, 0.1)', 
      border: '1px solid rgba(24, 119, 242, 0.2)', 
      borderRadius: 12, 
      padding: 20, 
      marginTop: 20,
      display: 'flex',
      flexDirection: 'column',
      gap: 12,
      alignItems: 'center',
      textAlign: 'center'
    }}>
      <div style={{ display: 'flex', gap: 8, fontSize: 24 }}>
        📘 📸
      </div>
      <div style={{ fontWeight: 600, color: '#e4e6eb' }}>
        Conectar Facebook & Instagram
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', maxWidth: 300 }}>
        Conecte as páginas sociais do assinante para monitorar comentários negativos em tempo real com análise de IA.
      </div>
      
      <button 
        onClick={handleConnect}
        disabled={loading || !businessId}
        style={{
          background: '#1877f2',
          color: 'white',
          border: 'none',
          padding: '10px 20px',
          borderRadius: 8,
          fontWeight: 600,
          cursor: (loading || !businessId) ? 'not-allowed' : 'pointer',
          opacity: (loading || !businessId) ? 0.6 : 1,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          transition: 'transform 0.2s',
          marginTop: 8
        }}
        onMouseEnter={e => !loading && (e.currentTarget.style.transform = 'scale(1.02)')}
        onMouseLeave={e => !loading && (e.currentTarget.style.transform = 'scale(1)')}
      >
        {loading ? 'Redirecionando...' : 'Conectar via Meta'}
      </button>
      
      {!businessId && (
        <div style={{ fontSize: 10, color: '#f87171' }}>
          Selecione um assinante primeiro.
        </div>
      )}
    </div>
  )
}
