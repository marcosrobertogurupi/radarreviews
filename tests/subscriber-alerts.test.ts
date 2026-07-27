import { describe, it, expect, vi, beforeEach } from 'vitest'
import { checkAlerts } from '../src/lib/alerts.js'
import { runSubscriberMonitorJob } from '../src/services/subscriber-monitor.js'
import { emailService } from '../src/services/emailService.js'
import type { NormalizedReview } from '../src/types/review.js'

// Mock do supabase e emailService
vi.mock('../src/lib/supabase.js', () => {
  const mockAlertEvents: any[] = []
  const mockAlertRules: any[] = [
    {
      id: 'rule-1',
      tenant_id: 'tenant-1',
      business_id: 'biz-1',
      name: 'Avaliação Crítica (IA)',
      condition_type: 'critical_review',
      threshold: 80,
      notify_email: true,
      is_active: true
    }
  ]
  const mockTenants: any[] = [
    {
      id: 'tenant-1',
      name: 'Empresa Teste Assinante',
      admin_email: 'admin@empresa.com',
      is_active: true
    }
  ]
  const mockBusinesses: any[] = [
    {
      id: 'biz-1',
      tenant_id: 'tenant-1',
      name: 'Empresa Teste'
    }
  ]
  const mockReviews: any[] = [
    {
      id: 'rev-1',
      tenant_id: 'tenant-1',
      business_id: 'biz-1',
      connector_id: 'conn-1',
      channel: 'reclame_aqui',
      external_id: 'ext-critical-100',
      rating: null,
      title: 'Reclamação grave no Reclame Aqui',
      body: 'Problema crítico com cobrança e atendimento péssimo',
      sentiment: 'critical',
      dissatisfaction_score: 95,
      published_at: new Date().toISOString(),
      raw_data: {}
    }
  ]

  const supabaseMock = {
    from: (table: string) => {
      const query: any = {
        select: () => query,
        eq: () => query,
        neq: () => query,
        or: () => query,
        in: () => query,
        gte: () => query,
        limit: () => query,
        single: () => {
          if (table === 'tenants') return Promise.resolve({ data: mockTenants[0], error: null })
          return Promise.resolve({ data: null, error: null })
        },
        insert: (data: any) => {
          const inserted = (Array.isArray(data) ? data : [data]).map((item, i) => ({
            id: `inserted-${i}-${Math.random()}`,
            ...item
          }))
          if (table === 'alert_events') {
            mockAlertEvents.push(...inserted)
          }
          return {
            select: () => ({
              single: () => Promise.resolve({ data: inserted[0], error: null }),
              then: (cb: any) => Promise.resolve({ data: inserted, error: null }).then(cb)
            }),
            then: (cb: any) => Promise.resolve({ data: inserted, error: null }).then(cb)
          }
        },
        update: (data: any) => ({
          eq: () => Promise.resolve({ data: [], error: null }),
          then: (cb: any) => Promise.resolve({ data: [], error: null }).then(cb)
        }),
        then: (cb: any) => {
          let res: any = { data: [], error: null }
          if (table === 'alert_rules') res = { data: mockAlertRules, error: null }
          if (table === 'reviews') res = { data: mockReviews, error: null }
          if (table === 'tenants') res = { data: mockTenants, error: null }
          if (table === 'monitored_businesses') res = { data: mockBusinesses, error: null }
          if (table === 'alert_events') res = { data: mockAlertEvents, error: null }
          return Promise.resolve(res).then(cb)
        }
      }
      return query
    },
    rpc: () => Promise.resolve({ data: null, error: null }),
    _mockState: { mockAlertEvents, mockAlertRules, mockTenants, mockBusinesses, mockReviews }
  }

  return { supabase: supabaseMock }
})

describe('Subscriber Critical Alert & Monitor Agent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(emailService, 'sendReviewAlertEmail').mockResolvedValue()
  })

  it('deve disparar alerta com notified=false para review crítico mesmo sem regra específica', async () => {
    const criticalReview: NormalizedReview = {
      tenant_id: 'tenant-1',
      business_id: 'biz-1',
      connector_id: 'conn-1',
      channel: 'reclame_aqui',
      external_id: 'ext-test-critical-999',
      rating: null,
      title: 'Divergência grave e descaso',
      body: 'Insatisfação com veículo zero e dados com problema grave',
      sentiment: 'critical',
      dissatisfaction_score: 95,
      published_at: new Date().toISOString(),
      raw_data: {}
    }

    await checkAlerts([criticalReview], 'biz-1', 'reclame_aqui')

    const { supabase } = await import('../src/lib/supabase.js')
    const state = (supabase as any)._mockState

    expect(state.mockAlertEvents.length).toBeGreaterThan(0)
    const createdEvent = state.mockAlertEvents.find((e: any) => e.detail.review_external_id === 'ext-test-critical-999')
    expect(createdEvent).toBeDefined()
    expect(createdEvent.notified).toBe(false) // Deve permanecer PENDENTE no portal
    expect(emailService.sendReviewAlertEmail).toHaveBeenCalledWith('admin@empresa.com', expect.objectContaining({ external_id: 'ext-test-critical-999' }), expect.any(String))
  })

  it('deve rodar o Agente de Monitoramento de Assinantes e criar alertas ausentes', async () => {
    const stats = await runSubscriberMonitorJob()
    expect(stats.tenants_audited).toBeGreaterThan(0)
    expect(stats.reviews_checked).toBeGreaterThan(0)
  })
})
