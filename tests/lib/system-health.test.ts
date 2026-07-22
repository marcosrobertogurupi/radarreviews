import { describe, it, expect, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => {
  return {
    notifyError: vi.fn().mockResolvedValue(undefined),
    sendWhatsAppMessage: vi.fn().mockResolvedValue({ success: true }),
  }
})

// Mock supabase client
const mockUpdate = vi.fn().mockReturnThis()
const mockEq = vi.fn().mockResolvedValue({ data: null, error: null })
const mockSupabaseMethods = {
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  in: vi.fn().mockReturnThis(),
  not: vi.fn().mockReturnThis(),
  update: mockUpdate,
  insert: vi.fn().mockResolvedValue({ error: null }),
}
mockUpdate.mockImplementation(() => ({
  eq: mockEq
}))

vi.mock('../../src/lib/supabase.js', () => ({
  supabase: {
    from: vi.fn(() => mockSupabaseMethods),
  },
}))

// Mock systemNotifications
vi.mock('../../src/lib/system-notifications.js', () => ({
  systemNotifications: {
    notifyError: mocks.notifyError,
  },
}))

// Mock sendWhatsAppMessage
vi.mock('../../src/services/whatsapp/uazapi.js', () => ({
  sendWhatsAppMessage: mocks.sendWhatsAppMessage,
}))

import { checkSystemHealth } from '../../src/lib/system-health-job.js'

describe('checkSystemHealth', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env['ADMIN_PHONE'] = '5511999999999'
    process.env['UAZAPI_TOKEN'] = 'test-token'
  })

  it('deve disparar alerta de 48h e enviar mensagem de WhatsApp', async () => {
    const errorConnectors = [
      {
        id: 'conn-1',
        channel: 'google_maps',
        status: 'error',
        error_message: 'API Key expirada',
        first_error_at: new Date(Date.now() - 50 * 60 * 60 * 1000).toISOString(), // 50 horas atrás
        alert_6h_sent: true,
        alert_24h_sent: true,
        alert_48h_sent: false,
        alert_72h_sent: false,
        last_sync_at: new Date(Date.now() - 50 * 60 * 60 * 1000).toISOString(),
        created_at: new Date(Date.now() - 60 * 60 * 60 * 1000).toISOString(),
        monitored_businesses: {
          tenant_id: 'tenant-123',
          name: 'Empresa Teste',
          is_active: true,
          tenants: {
            id: 'tenant-123',
            is_active: true,
            subscription_status: 'active',
          },
        },
      },
    ]

    mockSupabaseMethods.in.mockResolvedValueOnce({ data: errorConnectors, error: null })

    await checkSystemHealth()

    expect(mocks.sendWhatsAppMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        number: '5511999999999',
        token: 'test-token',
        text: expect.stringContaining('Empresa Teste'),
      })
    )

    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        alert_48h_sent: true,
        alert_24h_sent: true,
        alert_6h_sent: true,
      })
    )
  })
})
