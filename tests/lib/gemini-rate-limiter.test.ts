import { describe, it, expect } from 'vitest'
import { GeminiRateLimiter } from '../../src/lib/gemini-rate-limiter'

describe('GeminiRateLimiter', () => {
  it('nao executa mais que maxTokens jobs antes do refill', async () => {
    const rateLimiter = new GeminiRateLimiter(5, 100) // 100ms refill
    const calls: number[] = []
    const jobs = Array.from({ length: 8 }, (_, i) =>
      rateLimiter.schedule(async () => {
        calls.push(i)
        return i
      })
    )
    await new Promise((r) => setTimeout(r, 50))
    expect(calls.length).toBeLessThanOrEqual(5)
    await Promise.all(jobs)
    expect(calls.length).toBe(8)
  })
})
