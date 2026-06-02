/**
 * @file rateLimit.security.test.ts
 * @description Testes de Rate Limiting para /api/whatsapp/send e /api/copilot.
 * Refs: C7 (DoW/DoS), OWASP A05
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

describe('[C7] Rate Limiting — /api/whatsapp/send', () => {

  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // [APPSEC C7-A] Deve permitir requisições dentro do limite
  it('deve permitir até 20 requisições por minuto por tenant', async () => {
    const { checkRateLimit } = await import('../src/api/server.js') as any

    const results: boolean[] = []
    for (let i = 0; i < 20; i++) {
      results.push(checkRateLimit('tenant-x', 20, 60000))
    }
    expect(results.every(r => r === true)).toBe(true)
  })

  // [APPSEC C7-B] A 21ª requisição deve ser bloqueada
  it('deve bloquear a 21ª requisição no mesmo minuto', async () => {
    const { checkRateLimit } = await import('../src/api/server.js') as any

    for (let i = 0; i < 20; i++) {
      checkRateLimit('tenant-y', 20, 60000)
    }
    const blocked = checkRateLimit('tenant-y', 20, 60000)
    expect(blocked).toBe(false)
  })

  // [APPSEC C7-C] Após 60 segundos a janela deve resetar
  it('deve resetar o contador após a janela de 60 segundos', async () => {
    const { checkRateLimit } = await import('../src/api/server.js') as any

    for (let i = 0; i < 20; i++) checkRateLimit('tenant-z', 20, 60000)
    expect(checkRateLimit('tenant-z', 20, 60000)).toBe(false)

    vi.advanceTimersByTime(61_000)
    expect(checkRateLimit('tenant-z', 20, 60000)).toBe(true)
  })

  // [APPSEC C7-D] Isolamento: limite de um tenant não afeta outro
  it('deve isolar o rate limit entre tenants diferentes', async () => {
    const { checkRateLimit } = await import('../src/api/server.js') as any

    for (let i = 0; i < 20; i++) checkRateLimit('tenant-esgotado', 20, 60000)
    expect(checkRateLimit('tenant-esgotado', 20, 60000)).toBe(false)

    // Tenant diferente não deve ser afetado
    expect(checkRateLimit('tenant-novo', 20, 60000)).toBe(true)
  })
})

describe('[C7] Rate Limiting — /api/copilot', () => {

  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  // [APPSEC C7-E] Copilot tem limite independente do WhatsApp
  it('deve ter limite independente do whatsapp para o mesmo tenant', async () => {
    const { checkRateLimit } = await import('../src/api/server.js') as any

    for (let i = 0; i < 20; i++) checkRateLimit('tenant-dual', 20, 60000)
    // Mesmo tenant, canal diferente — não deve estar bloqueado
    expect(checkRateLimit('copilot-tenant-dual', 30, 60000)).toBe(true)
  })

  // [APPSEC C7-F] Deve bloquear após 30 req/min no copilot
  it('deve bloquear após 30 requisições por minuto no copilot', async () => {
    const { checkRateLimit } = await import('../src/api/server.js') as any

    for (let i = 0; i < 30; i++) checkRateLimit('tenant-copilot', 30, 60000)
    expect(checkRateLimit('tenant-copilot', 30, 60000)).toBe(false)
  })
})
