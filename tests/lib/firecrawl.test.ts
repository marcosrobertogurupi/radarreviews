import { describe, it, expect, vi, beforeEach } from 'vitest'
import axios from 'axios'
import { getFirecrawlApiKey, scrapePageViaFirecrawl } from '../../src/lib/firecrawl.js'
import {
  parseNextDataJson,
  parseDomFromHtmlString,
  runFirecrawlCollector,
} from '../../src/connectors/reclame-aqui.js'
import { mockConnector } from '../fixtures/connector.js'

vi.mock('axios')

// Mock do Supabase
const mockSupabaseMethods = {
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  gte: vi.fn().mockReturnThis(),
  limit: vi.fn().mockReturnThis(),
  order: vi.fn().mockReturnThis(),
  in: vi.fn().mockReturnThis(),
  or: vi.fn().mockResolvedValue({ data: [], error: null }),
  upsert: vi.fn().mockReturnThis(),
  single: vi.fn().mockResolvedValue({ data: { id: 'job-123' }, error: null }),
  update: vi.fn().mockReturnThis(),
  insert: vi.fn().mockReturnThis(),
}

vi.mock('../../src/lib/supabase.js', () => ({
  supabase: {
    from: vi.fn(() => mockSupabaseMethods),
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
  },
}))

describe('Firecrawl API & Fallback Scraper', () => {
  const ORIGINAL_ENV = process.env

  beforeEach(() => {
    vi.clearAllMocks()
    process.env = { ...ORIGINAL_ENV }
  })

  describe('getFirecrawlApiKey', () => {
    it('deve retornar undefined se a variável não estiver definida', () => {
      delete process.env['FIRECRAWL_API_KEY']
      expect(getFirecrawlApiKey()).toBeUndefined()
    })

    it('deve retornar a chave quando configurada em FIRECRAWL_API_KEY', () => {
      process.env['FIRECRAWL_API_KEY'] = 'fc-test-key-123'
      expect(getFirecrawlApiKey()).toBe('fc-test-key-123')
    })
  })

  describe('scrapePageViaFirecrawl', () => {
    it('deve lançar erro se FIRECRAWL_API_KEY não estiver configurada', async () => {
      delete process.env['FIRECRAWL_API_KEY']
      await expect(scrapePageViaFirecrawl('https://example.com')).rejects.toThrow(
        'FIRECRAWL_API_KEY não está configurada'
      )
    })

    it('deve fazer requisição POST para a API do Firecrawl e retornar HTML', async () => {
      process.env['FIRECRAWL_API_KEY'] = 'fc-test-key-123'
      const mockHtml = '<html><body><h1>Reclame Aqui</h1></body></html>'

      vi.mocked(axios.post).mockResolvedValueOnce({
        data: {
          success: true,
          data: {
            html: mockHtml,
            markdown: '# Reclame Aqui',
            metadata: { statusCode: 200 },
          },
        },
      })

      const res = await scrapePageViaFirecrawl('https://www.reclameaqui.com.br/empresa/teste/lista-reclamacoes/')

      expect(axios.post).toHaveBeenCalledWith(
        'https://api.firecrawl.dev/v1/scrape',
        expect.objectContaining({
          url: 'https://www.reclameaqui.com.br/empresa/teste/lista-reclamacoes/',
          formats: ['html', 'markdown'],
        }),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer fc-test-key-123',
          }),
        })
      )

      expect(res.success).toBe(true)
      expect(res.html).toBe(mockHtml)
    })
  })

  describe('parseNextDataJson', () => {
    it('deve extrair reclamações do JSON de __NEXT_DATA__', () => {
      const nextDataJson = JSON.stringify({
        props: {
          pageProps: {
            complaints: [
              {
                id: 'REC-100',
                title: 'Produto não entregue',
                description: 'Comprei e não recebi',
                status: 'Não resolvido',
                created: '2026-07-20T10:00:00Z',
              },
            ],
          },
        },
      })

      const complaints = parseNextDataJson(nextDataJson, 'empresa-teste')
      expect(complaints).toHaveLength(1)
      expect(complaints[0]?.id).toBe('REC-100')
      expect(complaints[0]?.title).toBe('Produto não entregue')
      expect(complaints[0]?.status).toBe('Não resolvido')
    })
  })

  describe('parseDomFromHtmlString', () => {
    it('deve extrair reclamações a partir de tags HTML com Cheerio', () => {
      const sampleHtml = `
        <html>
          <body>
            <div class="complain-list">
              <div class="item">
                <a href="/empresa/empresa-teste/reclamacao/produto-com-defeito-123456/">
                  <h4 class="title">Produto com Defeito</h4>
                </a>
                <span class="status">Resolvido</span>
                <time datetime="2026-07-25T14:00:00Z">25/07/2026</time>
              </div>
            </div>
          </body>
        </html>
      `

      const complaints = parseDomFromHtmlString(sampleHtml, 'empresa-teste')
      expect(complaints.length).toBeGreaterThan(0)
      expect(complaints[0]?.title).toBe('Produto com Defeito')
      expect(complaints[0]?.status).toBe('Resolvido')
    })
  })

  describe('runFirecrawlCollector', () => {
    it('deve executar o collector e retornar o JobResult com dados ingeridos', async () => {
      process.env['FIRECRAWL_API_KEY'] = 'fc-test-key-123'

      const mockNextData = JSON.stringify({
        props: {
          pageProps: {
            complaints: [
              {
                id: 'REC-999',
                title: 'Cobrança indevida no cartão',
                description: 'Fui cobrado duas vezes no cartão de crédito',
                status: 'Resolvido',
                created: '2026-07-22T12:00:00Z',
              },
            ],
          },
        },
      })

      const sampleHtml = `
        <html>
          <body>
            <script id="__NEXT_DATA__" type="application/json">${mockNextData}</script>
          </body>
        </html>
      `

      vi.mocked(axios.post).mockResolvedValueOnce({
        data: {
          success: true,
          data: {
            html: sampleHtml,
          },
        },
      })

      const connector = mockConnector('reclame_aqui', { external_id: 'empresa-teste' })
      const result = await runFirecrawlCollector(connector, 'empresa-teste', 'empresa-teste')

      expect(result.reviews_fetched).toBe(1)
      expect(result.error).toBeUndefined()
    })
  })
})
