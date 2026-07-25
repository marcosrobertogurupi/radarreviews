import type { Browser } from 'playwright-core'
import { logger } from './logger.js'

/**
 * Fecha um browser Playwright de forma GARANTIDAMENTE limitada no tempo.
 *
 * Motivação: sob pressão de memória (o mesmo cenário que o semáforo Playwright
 * do scheduler tenta mitigar), o Chromium pode "zumbificar" e `browser.close()`
 * — que tenta um shutdown gracioso via CDP — trava esperando uma resposta que
 * nunca chega. Como o `close()` fica no bloco `finally` dos scrapers, um close
 * travado impede o `runConnector` de retornar e, por consequência, o
 * `PLAYWRIGHT_SEMAPHORE.release()` nunca é chamado → o slot vaza permanentemente.
 * Três slots vazados = semáforo morto = todos os jobs seguintes estouram no
 * acquire ("Semaphore acquire timeout").
 *
 * Esta função dá ao `close()` uma janela curta. Se estourar, ABANDONA a espera
 * (o `finally` completa e o slot do semáforo é liberado) e tenta, best-effort,
 * matar o processo do Chromium com SIGKILL para liberar a memória. Nota: o
 * `Browser` obtido via `launch()` não expõe `.process()` em todas as versões do
 * playwright-core, por isso o kill é opcional e protegido por checagem em runtime.
 */
export async function closeBrowserSafely(browser: Browser | null | undefined, timeoutMs = 10_000): Promise<void> {
  if (!browser) return

  // Captura o processo ANTES (enquanto o objeto ainda está íntegro), caso a
  // versão do playwright-core exponha .process() no Browser de launch().
  const maybeProc = (browser as unknown as { process?: () => { kill?: (s?: string) => void; killed?: boolean } | null })
  const proc = typeof maybeProc.process === 'function' ? maybeProc.process() : null

  try {
    await Promise.race([
      browser.close(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`browser.close() timeout apos ${(timeoutMs / 1000).toFixed(0)}s`)), timeoutMs)
      ),
    ])
  } catch (err) {
    logger.warn('[browser] close() travou/falhou — abandonando espera e tentando matar o processo do Chromium', {
      error: err instanceof Error ? err.message : String(err),
    })
    try {
      if (proc && typeof proc.kill === 'function' && !proc.killed) proc.kill('SIGKILL')
    } catch (killErr) {
      logger.warn('[browser] Falha ao forçar kill do processo do navegador', {
        error: killErr instanceof Error ? killErr.message : String(killErr),
      })
    }
  }
}

/**
 * Tenta matar processos Chromium/chrome-headless-shell órfãos no container.
 * Executado na inicialização do scheduler ou periodicamente para evitar acúmulo de zumbis.
 */
export async function cleanupOrphanChromiumProcesses(): Promise<void> {
  if (process.platform === 'win32') return

  const { exec } = await import('node:child_process')
  return new Promise((resolve) => {
    // pkill -f chrome-headless-shell / chromium
    exec('pkill -9 -f chrome-headless-shell || pkill -9 -f chromium || true', (err) => {
      if (err) {
        logger.debug('[browser] Nenhum processo órfão de Chromium encontrado para limpeza', { error: err.message })
      } else {
        logger.info('[browser] Limpeza de processos Chromium órfãos executada com sucesso')
      }
      resolve()
    })
  })
}
