// Fixtures compartilhadas para os testes de conectores
// Cria objetos ChannelConnector de exemplo para cada canal

import type { ChannelConnector } from '../../src/types/connector.js'
import type { SourceChannel } from '../../src/types/review.js'

/** UUID fixo de teste — não existe no banco real */
export const TEST_TENANT_ID = '00000000-0000-0000-0000-000000000001'
export const TEST_BUSINESS_ID = '00000000-0000-0000-0000-000000000002'
export const TEST_CONNECTOR_ID = '00000000-0000-0000-0000-000000000003'

/**
 * Cria um ChannelConnector de teste para o canal informado.
 * Sobrescreva propriedades conforme necessário em cada teste.
 */
export function mockConnector(
  channel: SourceChannel,
  overrides: Partial<ChannelConnector> = {}
): ChannelConnector {
  const defaults: Record<SourceChannel, Partial<ChannelConnector>> = {
    google_maps: {
      external_id: 'ChIJN1t_tDeuEmsRUsoyG83frY4', // Sydney Opera House (exemplo público)
      config: { interval_minutes: 1440 },
    },
    tripadvisor: {
      external_id: '187791',
      config: { interval_minutes: 1440 },
    },
    consumidor_gov: {
      external_id: null,
      config: { cnpj: '12345678000199', interval_minutes: 43200 },
    },
    trustpilot: {
      external_id: 'nubank.com.br',
      config: { interval_minutes: 720 },
    },
    reddit: {
      external_id: null,
      config: {
        keywords: ['Nubank', 'Nu Pagamentos'],
        interval_minutes: 60,
      },
    },
    facebook: {
      external_id: '123456789',
      vault_secret_id: '00000000-0000-0000-0000-000000000099',
      config: { interval_minutes: 360 },
    },
    instagram: {
      external_id: '987654321',
      vault_secret_id: '00000000-0000-0000-0000-000000000099',
      config: {
        feedback_keywords: ['ruim', 'péssimo', 'ótimo', 'excelente'],
        interval_minutes: 360,
      },
    },
    reclame_aqui: {
      external_id: 'nubank',
      config: { interval_minutes: 720 },
    },
  }

  return {
    id: TEST_CONNECTOR_ID,
    business_id: TEST_BUSINESS_ID,
    tenant_id: TEST_TENANT_ID,
    channel,
    status: 'active',
    external_id: null,
    vault_secret_id: null,
    config: {},
    last_sync_at: null,
    next_sync_at: null,
    error_message: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...defaults[channel],
    ...overrides,
  }
}
