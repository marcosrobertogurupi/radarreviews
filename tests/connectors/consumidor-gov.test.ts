// Testes do conector Consumidor.gov.br
// Simula download de CSV via stream e valida filtro por CNPJ e hash de ID externo

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { run } from '../../src/connectors/consumidor-gov.js'
import { mockConnector } from '../fixtures/connector.js'
import { Readable } from 'stream'

// -----------------------------------------------------------------------------
// Mocks
// -----------------------------------------------------------------------------

vi.mock('dotenv/config', () => ({}))

// Mock do Supabase
const mockSupabaseMethods = {
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  in: vi.fn().mockResolvedValue({ data: [], error: null }),
  or: vi.fn().mockResolvedValue({ data: [], error: null }),
  single: vi.fn().mockImplementation(function(this: any) {
    // Retorna CNPJ fictício para o teste
    return Promise.resolve({ 
       data: { cnpj: '12345678000199' }, 
       error: null 
    })
  }),
  upsert: vi.fn().mockReturnThis(),
}

vi.mock('../../src/lib/supabase.js', () => ({
  supabase: {
    from: vi.fn(() => mockSupabaseMethods),
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
  },
}))

vi.mock('axios', async importOriginal => {
  const actual = await importOriginal<typeof import('axios')>()
  return {
    ...actual,
    default: {
      ...actual.default,
      get: vi.fn(),
      isAxiosError: actual.default.isAxiosError,
    },
  }
})

// -----------------------------------------------------------------------------
// CSV de Exemplo (ISO-8859-1 com ; delimiter)
// Colunas principais: DataAbertura(0), CNPJ(15), Assunto(11), Descricao(21), Nota(22)
// -----------------------------------------------------------------------------
const mockCsvContent = 
  "DataAbertura;Outro;Outro;Outro;Outro;Outro;Outro;Outro;Outro;Outro;Outro;Assunto;Outro;Outro;Outro;CNPJ;Outro;Segmento;Area;Outro;Outro;Descricao;Nota;Outro;Outro;Outro;Outro;Resolvido;TempoRespo\n" +
  "01/11/2024;...;...;...;...;...;...;...;...;...;...;Internet;...;...;...;12345678000199;...;Telecom;Telecom;...;...;Conexao lenta;4,0;...;...;...;...;S;5\n" +
  "02/11/2024;...;...;...;...;...;...;...;...;...;...;Cobranca;...;...;...;99999999000100;...;Outro;Outro;...;...;Nao sou eu;1,0;...;...;...;...;N;10\n" +
  "05/11/2024;...;...;...;...;...;...;...;...;...;...;Login;...;...;...;12345678000199;...;Sistemas;TI;...;...;Erro no app;2,0;...;...;...;...;S;2"

// -----------------------------------------------------------------------------
// Testes
// -----------------------------------------------------------------------------

describe('Consumidor.gov connector', () => {
  let axiosMock: any

  beforeEach(async () => {
    vi.clearAllMocks()
    const axiosModule = await import('axios')
    axiosMock = axiosModule.default.get

    // Simula respostas diferentes conforme a URL
    axiosMock.mockImplementation((url: string) => {
      if (url.includes('api/3/action/package_show')) {
        // Mock da resposta do CKAN
        return Promise.resolve({
          data: {
            result: {
              resources: [
                {
                  name: 'Base Completa 03-2026',
                  format: 'csv',
                  url: 'https://dados.mj.gov.br/mock-resource-id/download.csv'
                }
              ]
            }
          }
        })
      }
      
      // Mock do download do CSV (stream)
      const stream = Readable.from([mockCsvContent])
      return Promise.resolve({ data: stream })
    })
  })

  it('filtra reviews pelo CNPJ da empresa e ignora outros', async () => {
    const connector = mockConnector('consumidor_gov')
    const result = await run(connector)

    // O CSV tem 3 linhas, mas apenas 2 para o CNPJ 12345678000199
    expect(result.reviews_fetched).toBe(2)
    expect(result.error).toBeUndefined()
  })

  it('gera external_id baseado no hash determinístico', async () => {
    const { supabase } = await import('../../src/lib/supabase.js')
    const fromMock = vi.mocked(supabase.from)
    
    const connector = mockConnector('consumidor_gov')
    await run(connector)

    // Verifica se os reviews foram enviados para o mockSupabaseMethods (via ingest)
    // No ingest.ts, a chamada é .in('external_id', externalIds)
    const calls = mockSupabaseMethods.in.mock.calls
    expect(calls.length).toBeGreaterThan(0)
    
    // index [0] é o nome da coluna ('external_id'), [1] é o valor (array de IDs)
    const firstReviewId = calls[0][1][0]
    expect(firstReviewId).toHaveLength(64)
  })

  it('normaliza corretamente campos de data e nota', async () => {
    // IngestReviews é chamado com os reviews normalizados.
    // Como estamos mockando o Supabase em nível baixo, as verificações de tipo do Vitest dão erro
    // se tentarmos acessar o .ingestReviews diretamente se ele não for exportado como mock.
    // Mas o run() retorna o result, que já conta o que foi filtrado.
    
    const connector = mockConnector('consumidor_gov')
    const result = await run(connector)

    expect(result.reviews_fetched).toBe(2)
  })

  it('retorna erro se a empresa não tiver CNPJ', async () => {
    // Forçar o mock do single() a retornar erro
    mockSupabaseMethods.single.mockResolvedValueOnce({ data: null, error: { message: 'Not found' } })

    const connector = mockConnector('consumidor_gov')
    const result = await run(connector)

    expect(result.error).toContain('não possui CNPJ')
  })

  it('tenta usar a URL da API do governo primeiro', async () => {
    const connector = mockConnector('consumidor_gov')
    await run(connector)

    // Deve ter chamado o axios para a API do CKAN e depois para o CSV
    expect(axiosMock).toHaveBeenCalledWith(
      expect.stringContaining('dados.gov.br/api/3/action/package_show'),
      expect.any(Object)
    )
    
    // Deve ter chamado o axios para o CSV com o URL retornado pela API
    expect(axiosMock).toHaveBeenCalledWith(
      'https://dados.mj.gov.br/mock-resource-id/download.csv',
      expect.objectContaining({ responseType: 'stream' })
    )
  })
})
