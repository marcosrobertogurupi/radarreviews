import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockUpdateSelect = vi.fn()
const mockInsert = vi.fn().mockResolvedValue({ error: null })
const mockPost = vi.fn().mockResolvedValue({ status: 200 })

vi.mock('axios', () => ({
  default: {
    post: (...args: unknown[]) => mockPost(...args),
  },
}))

vi.mock('../../src/lib/supabase.js', () => ({
  supabase: {
    from: vi.fn((table: string) => {
      if (table === 'system_notifications') {
        return {
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                select: mockUpdateSelect,
              }),
            }),
          }),
          insert: mockInsert,
        }
      }
      if (table === 'system_settings') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: { admin_whatsapp: '5511999999999' } }),
            }),
          }),
        }
      }
      if (table === 'monitored_businesses') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: { name: 'Empresa Teste' } }),
            }),
          }),
        }
      }
      return {}
    }),
  },
}))

import { systemNotifications } from '../../src/lib/system-notifications.js'
import type { ChannelConnector } from '../../src/types/connector.js'

describe('systemNotifications.notifyRecovery', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env['N8N_SYSTEM_ALERTS_WEBHOOK'] = 'https://n8n.test/webhook'
  })

  it('NÃO deve disparar webhook do N8N/WhatsApp se não houver alerta prévio de falha', async () => {
    mockUpdateSelect.mockResolvedValueOnce({ data: [], error: null })

    const connector: ChannelConnector = {
      id: 'conn-1',
      business_id: 'biz-1',
      tenant_id: 'tenant-1',
      channel: 'reclame_aqui',
      status: 'active',
      external_id: 'slug-empresa',
      vault_secret_id: null,
      config: {},
      last_sync_at: new Date().toISOString(),
      next_sync_at: null,
      error_message: null,
      error_count: 1,
      first_error_at: new Date().toISOString(),
      alert_6h_sent: false,
      alert_24h_sent: false,
      alert_48h_sent: false,
      alert_72h_sent: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }

    await systemNotifications.notifyRecovery(connector)

    // Deve registrar no banco (sininho Admin)
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'recovery_success',
        channel: 'reclame_aqui',
        status: 'resolvido',
      })
    )

    // NÃO deve disparar webhook N8N
    expect(mockPost).not.toHaveBeenCalled()
  })

  it('DEVE disparar webhook do N8N/WhatsApp se houver alerta de 6h/24h prévio', async () => {
    mockUpdateSelect.mockResolvedValueOnce({ data: [], error: null })

    const connector: ChannelConnector = {
      id: 'conn-2',
      business_id: 'biz-1',
      tenant_id: 'tenant-1',
      channel: 'reclame_aqui',
      status: 'active',
      external_id: 'slug-empresa',
      vault_secret_id: null,
      config: {},
      last_sync_at: new Date().toISOString(),
      next_sync_at: null,
      error_message: null,
      error_count: 10,
      first_error_at: new Date().toISOString(),
      alert_6h_sent: true, // Alerta prévio disparado
      alert_24h_sent: false,
      alert_48h_sent: false,
      alert_72h_sent: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }

    await systemNotifications.notifyRecovery(connector)

    // Deve registrar no banco
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'recovery_success',
      })
    )

    // DEVE disparar webhook N8N
    expect(mockPost).toHaveBeenCalledWith(
      'https://n8n.test/webhook',
      expect.objectContaining({
        event: 'system_health_alert',
        status: 'RESOLVIDO',
        channel: 'reclame_aqui',
      }),
      expect.any(Object)
    )
  })

  it('DEVE disparar webhook do N8N/WhatsApp se houver notificação pendente no banco (erro fatal/auth)', async () => {
    mockUpdateSelect.mockResolvedValueOnce({ data: [{ id: 'notif-123' }], error: null })

    const connector: ChannelConnector = {
      id: 'conn-3',
      business_id: 'biz-1',
      tenant_id: 'tenant-1',
      channel: 'reclame_aqui',
      status: 'active',
      external_id: 'slug-empresa',
      vault_secret_id: null,
      config: {},
      last_sync_at: new Date().toISOString(),
      next_sync_at: null,
      error_message: null,
      error_count: 1,
      first_error_at: new Date().toISOString(),
      alert_6h_sent: false,
      alert_24h_sent: false,
      alert_48h_sent: false,
      alert_72h_sent: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }

    await systemNotifications.notifyRecovery(connector)

    // DEVE disparar webhook N8N
    expect(mockPost).toHaveBeenCalledWith(
      'https://n8n.test/webhook',
      expect.objectContaining({
        event: 'system_health_alert',
        status: 'RESOLVIDO',
      }),
      expect.any(Object)
    )
  })
})
