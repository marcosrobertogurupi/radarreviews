import { logger } from './logger.js'

type Job<T> = () => Promise<T>

export class GeminiRateLimiter {
  private queue: Array<() => void> = []
  private tokens: number
  private readonly maxTokens: number
  private processing = false

  constructor(maxTokens = 5, private refillIntervalMs = 60_000) {
    this.maxTokens = maxTokens
    this.tokens = maxTokens
    setInterval(() => {
      this.tokens = this.maxTokens
      this.drain()
    }, this.refillIntervalMs).unref()
  }

  schedule<T>(fn: Job<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      this.queue.push(async () => {
        try {
          resolve(await fn())
        } catch (err) {
          reject(err)
        }
      })
      this.drain()
    })
  }

  private async drain() {
    if (this.processing) return
    this.processing = true
    while (this.queue.length > 0 && this.tokens > 0) {
      this.tokens--
      const job = this.queue.shift()!
      await job()
      await new Promise((r) => setTimeout(r, 500)) // espaçamento extra
    }
    this.processing = false
  }
}

// 5 req/min = mesmo limite do Free Tier atual; ajustar quando migrar de tier
export const geminiRateLimiter = new GeminiRateLimiter(5, 60_000)

export async function callGeminiWithRetry<T>(fn: Job<T>, maxRetries = 3): Promise<T> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await geminiRateLimiter.schedule(fn)
    } catch (err: any) {
      const is429 = err?.status === 429 || String(err).includes('429') || err?.message?.includes('429')
      if (is429 && attempt < maxRetries) {
        const retryInfo = err?.errorDetails?.find((d: any) =>
          d['@type']?.includes('RetryInfo')
        )
        const retryDelaySeconds = retryInfo
          ? parseInt(String(retryInfo.retryDelay).replace('s', ''), 10)
          : (attempt + 1) * 10
        logger.warn(
          '[gemini] 429 recebido, aguardando retryDelay antes de tentar novamente',
          { attempt, retryDelaySeconds }
        )
        await new Promise((r) => setTimeout(r, retryDelaySeconds * 1000))
        continue
      }
      throw err
    }
  }
  throw new Error('Gemini: numero maximo de tentativas excedido')
}
