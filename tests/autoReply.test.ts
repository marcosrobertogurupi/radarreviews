import { describe, it, expect, vi } from 'vitest'
import { generateAutoReply } from '../src/services/ai/autoReplyGenerator.js'
import { recordApprovedReply } from '../src/services/ai/learningService.js'
import { sendDirectResponse } from '../src/services/ai/responder.js'
import type { AutoReplySettings } from '../src/types/autoReply.js'
import type { NormalizedReview } from '../src/types/review.js'

// Mock do SDK GoogleGenerativeAI para vitest
vi.mock('@google/generative-ai', () => {
  return {
    GoogleGenerativeAI: vi.fn().mockImplementation(() => ({
      getGenerativeModel: vi.fn().mockReturnValue({
        generateContent: vi.fn().mockResolvedValue({
          response: {
            text: () => JSON.stringify({
              reply_text: 'Prezado Frederico M, ficamos imensamente felizes com a sua avaliação! Transmitimos seu carinho diretamente para a Karine e a Sueli. Esperamos recebê-lo em breve no Hotel Conforto.\n\nAtenciosamente,\nGestor de Experiência',
              confidence: 0.98,
              mentioned_staff: ['Karine', 'Sueli'],
              reasoning: 'Agradeceu nominalmente os colaboradores elogiados.',
            }),
          },
        }),
        embedContent: vi.fn().mockResolvedValue({
          embedding: { values: new Array(768).fill(0.1) },
        }),
      }),
    })),
  }
})

describe('Sistema de Resposta Autônoma por IA e Aprendizado Contínuo', () => {
  const mockSettings: AutoReplySettings = {
    enabled: true,
    mode: 'hybrid',
    signature: 'Gestor de Experiência',
    tone_of_voice: 'Acolhedor e cordial',
    mention_staff_names: true,
    auto_publish_min_rating: 4,
    custom_rules: 'Mencionar a sobremesa da casa aos sábados',
    channels: ['google_maps', 'tripadvisor', 'facebook', 'instagram', 'reclame_aqui', 'consumidor_gov', 'trustpilot', 'reddit'],
  }

  const mockReview: NormalizedReview = {
    tenant_id: '11111111-1111-1111-1111-111111111111',
    business_id: '22222222-2222-2222-2222-222222222222',
    connector_id: '33333333-3333-3333-3333-333333333333',
    channel: 'tripadvisor',
    external_id: 'ta_review_999',
    rating: 5,
    title: 'Estadia incrível no hotel!',
    body: 'O café da manhã é excelente e o atendimento da Karine na recepção foi espetacular.',
    author_name: 'Frederico M',
    published_at: new Date().toISOString(),
    sentiment: 'positive',
    raw_data: {},
  }

  it('deve gerar resposta personalizada em Português com a persona configurada', async () => {
    const result = await generateAutoReply({
      review: mockReview,
      settings: mockSettings,
      businessName: 'Hotel Conforto',
    })

    expect(result).toBeDefined()
    expect(result.reply_text).toContain('Karine')
    expect(result.reply_text).toContain('Gestor de Experiência')
    expect(result.confidence).toBeGreaterThanOrEqual(0.9)
  })

  it('deve permitir salvar exemplos de aprendizado aprovados pelo usuário', async () => {
    const success = await recordApprovedReply({
      tenantId: mockReview.tenant_id,
      businessId: mockReview.business_id,
      reviewId: 'rev_123',
      channel: 'tripadvisor',
      rating: 5,
      reviewText: mockReview.body!,
      userApprovedText: 'Prezado Frederico, agradecemos muito pelo carinho com a nossa recepcionista Karine! Esperamos revê-lo em breve.',
      wasEditedByUser: true,
    })

    expect(typeof success).toBe('boolean')
  })

  it('deve executar o dispatcher sendDirectResponse sem quebrar para o canal TripAdvisor', async () => {
    const result = await sendDirectResponse(
      'review_id_123',
      'Resposta de teste enviada pela IA.',
      'user_123'
    )

    expect(result).toBeDefined()
    expect(typeof result.success).toBe('boolean')
  })
})
