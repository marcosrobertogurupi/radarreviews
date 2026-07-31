import http from 'node:http'
import { supabaseAdmin } from '../lib/supabase.js'
import { logger } from '../lib/logger.js'
import { setCors, getAuthUser } from './server.js'
import { generateAutoReply } from '../services/ai/autoReplyGenerator.js'
import { recordApprovedReply } from '../services/ai/learningService.js'
import { sendDirectResponse } from '../services/ai/responder.js'
import { AutoReplySettingsSchema, type AutoReplySettings } from '../types/autoReply.js'

async function readJsonBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let body = ''
    req.on('data', (chunk) => (body += chunk))
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {})
      } catch (e) {
        reject(e)
      }
    })
  })
}

export async function handleAutoReplyRoutes(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  urlPath: string
): Promise<boolean> {
  if (!urlPath.startsWith('/api/auto-reply')) return false

  setCors(req, res)
  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    res.end()
    return true
  }

  try {
    const user = await getAuthUser(req.headers.authorization)
    if (!user) {
      res.writeHead(401, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Não autorizado' }))
      return true
    }

    // 1. GET /api/auto-reply/settings?business_id=xxx
    if (req.method === 'GET' && urlPath.startsWith('/api/auto-reply/settings')) {
      const urlParams = new URL(req.url || '', `http://${req.headers.host}`).searchParams
      const businessId = urlParams.get('business_id')

      if (!businessId) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'business_id é obrigatório' }))
        return true
      }

      const { data: business, error } = await supabaseAdmin
        .from('monitored_businesses')
        .select('id, name, auto_reply_settings')
        .eq('id', businessId)
        .single()

      if (error || !business) {
        res.writeHead(404, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Empresa não encontrada' }))
        return true
      }

      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ settings: business.auto_reply_settings || {} }))
      return true
    }

    // 2. PATCH /api/auto-reply/settings
    if (req.method === 'PATCH' && urlPath === '/api/auto-reply/settings') {
      const body = await readJsonBody(req)
      const { business_id, settings } = body

      if (!business_id || !settings) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'business_id e settings são obrigatórios' }))
        return true
      }

      const validatedSettings = AutoReplySettingsSchema.parse(settings)

      const { error } = await supabaseAdmin
        .from('monitored_businesses')
        .update({ auto_reply_settings: validatedSettings })
        .eq('id', business_id)

      if (error) {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Falha ao atualizar configurações de auto-resposta' }))
        return true
      }

      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ success: true, settings: validatedSettings }))
      return true
    }

    // 3. POST /api/auto-reply/generate
    if (req.method === 'POST' && urlPath === '/api/auto-reply/generate') {
      const { review_id } = await readJsonBody(req)

      if (!review_id) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'review_id é obrigatório' }))
        return true
      }

      const { data: review } = await supabaseAdmin
        .from('reviews')
        .select('*, monitored_businesses(id, name, auto_reply_settings)')
        .eq('id', review_id)
        .single()

      if (!review) {
        res.writeHead(404, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Review não encontrado' }))
        return true
      }

      const business = review.monitored_businesses
      const settings: AutoReplySettings = business?.auto_reply_settings || {
        enabled: true,
        mode: 'hybrid',
        signature: 'Gestor de Atendimento',
        tone_of_voice: 'cordial e profissional',
        mention_staff_names: true,
        auto_publish_min_rating: 4,
        channels: ['google_maps', 'tripadvisor', 'facebook', 'instagram', 'reclame_aqui', 'consumidor_gov', 'trustpilot', 'reddit', 'booking'],
      }

      const result = await generateAutoReply({
        review,
        settings,
        businessName: business?.name || 'Empresa',
      })

      // Atualiza o review com o rascunho gerado pela IA
      await supabaseAdmin
        .from('reviews')
        .update({
          response_text: result.reply_text,
          response_status: 'draft',
        })
        .eq('id', review_id)

      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ success: true, draft: result }))
      return true
    }

    // 4. POST /api/auto-reply/approve
    if (req.method === 'POST' && urlPath === '/api/auto-reply/approve') {
      const { review_id, response_text } = await readJsonBody(req)

      if (!review_id) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'review_id é obrigatório' }))
        return true
      }

      const { data: review } = await supabaseAdmin
        .from('reviews')
        .select('*, monitored_businesses(tenant_id)')
        .eq('id', review_id)
        .single()

      if (!review) {
        res.writeHead(404, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Review não encontrado' }))
        return true
      }

      const textToSend = response_text || review.response_text
      if (!textToSend) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Nenhum texto de resposta fornecido' }))
        return true
      }

      // a) Dispara para o canal externo
      const dispatchResult = await sendDirectResponse(review_id, textToSend, user.userId)

      if (!dispatchResult.success) {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: dispatchResult.error || 'Falha ao enviar resposta ao canal' }))
        return true
      }

      // b) Salva na memória de aprendizado contínuo (RAG + Few-Shot)
      await recordApprovedReply({
        tenantId: review.tenant_id,
        businessId: review.business_id,
        reviewId: review.id,
        channel: review.channel,
        rating: review.rating,
        reviewText: review.body || review.title || '',
        userApprovedText: textToSend,
        wasEditedByUser: textToSend !== review.response_text,
      })

      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ success: true, externalResponseId: dispatchResult.externalResponseId }))
      return true
    }

    res.writeHead(404, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'Rota de auto-resposta não encontrada' }))
    return true
  } catch (err) {
    logger.error('[autoReplyRoutes] Erro ao processar requisição:', { error: err })
    res.writeHead(500, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'Erro interno no servidor' }))
    return true
  }
}
