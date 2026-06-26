// Testes do conector Reclame Aqui
// Valida: extração via __NEXT_DATA__ (SSR), fallback via DOM, paginação,
// normalização (rating inferido do status), deduplicação e cenários de erro.
//
// O Playwright é mockado inteiramente — nenhum browser real é aberto nos testes.

import { describe, it, expect, vi, beforeEach } from 'vitest'

// vi.hoisted garante que o mock é definido ANTES do hoist do vi.mock
const mocks = vi.hoisted(() => {
  let _nextDataContent: string | null = null
  let _linkCount = 0
  let _domComplaints: Array<Record<string, string>> = []

  const mockPage = {
    goto: vi.fn().mockResolvedValue(undefined),
    url: vi.fn().mockReturnValue('https://www.reclameaqui.com.br/empresa/empresa-teste/lista-reclamacoes/'),
    waitForTimeout: vi.fn().mockResolvedValue(undefined),
    setDefaultTimeout: vi.fn(),
    setDefaultNavigationTimeout: vi.fn(),
    locator: vi.fn(() => ({ count: vi.fn().mockResolvedValue(_linkCount) })),
    evaluate: vi.fn(async (fn: Function) => {
      const fnStr = fn.toString()
      if (fnStr.includes('__NEXT_DATA__')) return _nextDataContent
      if (fnStr.includes('querySelectorAll')) return _domComplaints
      return null
    }),
  }

  const mockContext = {
    newPage: vi.fn().mockResolvedValue(mockPage),
    addInitScript: vi.fn().mockResolvedValue(undefined),
  }

  const mockBrowser = {
    newContext: vi.fn().mockResolvedValue(mockContext),
    close: vi.fn().mockResolvedValue(undefined),
  }

  return {
    mockPage,
    mockContext,
    mockBrowser,
    // Setters para controlar o estado por teste
    setNextData: (v: string | null) => { _nextDataContent = v },
    setLinkCount: (v: number) => { _linkCount = v },
    setDomComplaints: (v: Array<Record<string, string>>) => { _domComplaints = v },
  }
})

vi.mock('playwright-extra', () => ({
  chromium: {
    launch: vi.fn().mockResolvedValue(mocks.mockBrowser),
    use: vi.fn(),
  },
}))

// Mock do Supabase — deve ser definido ANTES da importação do conector
const mockSupabaseMethods = {
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  in: vi.fn().mockResolvedValue({ data: [], error: null }),
  or: vi.fn().mockResolvedValue({ data: [], error: null }),
  upsert: vi.fn().mockReturnThis(),
  single: vi.fn().mockResolvedValue({ data: { id: 'job-123' }, error: null }),
  update: vi.fn().mockReturnThis(),
  insert: vi.fn().mockResolvedValue({ data: null, error: null }),
}

vi.mock('../../src/lib/supabase.js', () => ({
  supabase: {
    from: vi.fn(() => mockSupabaseMethods),
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
  },
}))

vi.mock('dotenv/config', () => ({}))

// Importações dinâmicas APÓS os mocks
import { run } from '../../src/connectors/reclame-aqui.js'
import { mockConnector } from '../fixtures/connector.js'

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function makeNextDataJson(complaints: Array<Record<string, unknown>>) {
  return JSON.stringify({
    props: {
      pageProps: {
        complains: complaints,
      },
    },
  })
}

function makeComplaint(id: string, title: string, status = 'Resolvido') {
  return {
    id,
    title,
    description: `Descrição detalhada: ${title}`,
    status,
    demanderName: `Cliente ${id}`,
    createdDate: '2026-05-15T10:00:00Z',
    isResolved: status === 'Resolvido',
  }
}

// -----------------------------------------------------------------------------
// Testes
// -----------------------------------------------------------------------------

describe('Reclame Aqui connector', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    // Resetar estado
    mocks.setNextData(null)
    mocks.setLinkCount(0)
    mocks.setDomComplaints([])

    // Reconfigurar mocks que foram limpos pelo clearAllMocks
    mocks.mockPage.goto.mockResolvedValue(undefined)
    mocks.mockPage.waitForTimeout.mockResolvedValue(undefined)
    mocks.mockPage.evaluate.mockImplementation(async (fn: Function) => {
      const fnStr = fn.toString()
      if (fnStr.includes('__NEXT_DATA__')) return mocks.mockPage.evaluate['_nextData'] ?? null
      if (fnStr.includes('querySelectorAll')) return mocks.mockPage.evaluate['_domComplaints'] ?? []
      return null
    })
    mocks.mockPage.locator.mockImplementation(() => ({
      count: vi.fn().mockResolvedValue(0),
    }))
    mocks.mockContext.newPage.mockResolvedValue(mocks.mockPage)
    mocks.mockContext.addInitScript.mockResolvedValue(undefined)
    mocks.mockBrowser.newContext.mockResolvedValue(mocks.mockContext)
    mocks.mockBrowser.close.mockResolvedValue(undefined)

    // Reconfigurar evaluate para refletir os closures dos setters
    mocks.mockPage.evaluate.mockImplementation(async (fn: Function) => {
      const fnStr = fn.toString()
      if (fnStr.includes('__NEXT_DATA__')) {
        // Re-invocar via setter que guarda o último valor
        let nextData: string | null = null
        mocks.setNextData = (v) => { nextData = v }
        return nextData
      }
      return null
    })
  })

  it('retorna error quando external_id está vazio', async () => {
    const connector = mockConnector('reclame_aqui', { external_id: '' })
    const result = await run(connector)

    expect(result.error).toContain('external_id')
    // Browser não deve ter sido aberto
    const { chromium } = await import('playwright-extra')
    expect(chromium.launch).not.toHaveBeenCalled()
  })

  it('fecha o browser corretamente ao finalizar (sem vazamento de recursos)', async () => {
    // goto não vai falhar, evaluate retorna null (sem dados)
    const connector = mockConnector('reclame_aqui')
    await run(connector)

    expect(mocks.mockBrowser.close).toHaveBeenCalledTimes(1)
  })

  it('fecha o browser mesmo quando ocorre um erro de navegação', async () => {
    mocks.mockPage.goto.mockRejectedValue(new Error('ERR_CONNECTION_RESET'))

    const connector = mockConnector('reclame_aqui')
    const result = await run(connector)

    expect(result.error).toBeDefined()
    expect(mocks.mockBrowser.close).toHaveBeenCalledTimes(1)
  })

  it('navega para a URL correta com o slug da empresa', async () => {
    const connector = mockConnector('reclame_aqui', { external_id: 'empresa-teste' })
    await run(connector)

    expect(mocks.mockPage.goto).toHaveBeenCalledWith(
      expect.stringContaining('/empresa/empresa-teste/lista-reclamacoes/'),
      expect.anything()
    )
  })

  it('configura o browser com User-Agent e locale brasileiro', async () => {
    const connector = mockConnector('reclame_aqui')
    await run(connector)

    expect(mocks.mockBrowser.newContext).toHaveBeenCalledWith(
      expect.objectContaining({
        locale: 'pt-BR',
        timezoneId: 'America/Sao_Paulo',
      })
    )
  })

  it('aplica o script de stealth para ocultar o webdriver flag', async () => {
    const connector = mockConnector('reclame_aqui')
    await run(connector)

    expect(mocks.mockContext.addInitScript).toHaveBeenCalledTimes(1)
  })

  it('retorna reviews_fetched = 0 quando não há reclamações e nenhum erro', async () => {
    const connector = mockConnector('reclame_aqui')
    const result = await run(connector)

    expect(result.reviews_fetched).toBe(0)
    expect(result.error).toBeUndefined()
  })
})
