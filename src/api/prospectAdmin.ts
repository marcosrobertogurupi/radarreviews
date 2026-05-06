import http from 'node:http'
import { supabaseAdmin } from '../lib/supabase.js'
import { sendWhatsAppMessage } from '../services/whatsapp/uazapi.js'

function json(res: http.ServerResponse, status: number, data: any) {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(data))
}

export async function handleProspectAdmin(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  auth: { userId: string; perfil: string }
): Promise<void> {
  const url = req.url || ''
  const method = req.method

  // Apenas admin ou operador
  if (!['admin', 'operador'].includes(auth.perfil)) {
    return json(res, 403, { error: 'Acesso negado' })
  }

  // GET /api/admin/prospects/campaigns
  if (url === '/api/admin/prospects/campaigns' && method === 'GET') {
    try {
      const { data, error } = await supabaseAdmin
        .from('prospect_campaigns')
        .select('*')
        .order('created_at', { ascending: false })
      if (error) throw error
      return json(res, 200, data)
    } catch (err: any) {
      return json(res, 500, { error: err.message })
    }
  }

  // GET /api/admin/prospects/leads?campaign_id=...
  if (url.startsWith('/api/admin/prospects/leads') && method === 'GET') {
    try {
      const qs = new URL(url, `http://localhost`).searchParams
      const campaignId = qs.get('campaign_id')
      if (!campaignId) return json(res, 400, { error: 'campaign_id é obrigatório' })

      const { data, error } = await supabaseAdmin
        .from('prospect_leads')
        .select('*')
        .eq('campaign_id', campaignId)
        .order('created_at', { ascending: true })
      if (error) throw error
      return json(res, 200, data)
    } catch (err: any) {
      return json(res, 500, { error: err.message })
    }
  }

  // PATCH /api/admin/prospects/leads/:id
  if (url.startsWith('/api/admin/prospects/leads/') && method === 'PATCH') {
    try {
      const id = url.split('/').pop()?.split('?')[0]
      let body = ''
      for await (const chunk of req) body += chunk
      const parsed = JSON.parse(body)

      // Se o status mudou para responded ou converted, cancelar follow-ups futuros automaticamente
      if (parsed.status && ['responded', 'converted'].includes(parsed.status)) {
        await supabaseAdmin
          .from('prospect_followup_queue')
          .update({ status: 'canceled' })
          .eq('lead_id', id)
          .eq('status', 'pending')
      }

      const { data, error } = await supabaseAdmin
        .from('prospect_leads')
        .update(parsed)
        .eq('id', id)
        .select()
        .single()
      if (error) throw error

      return json(res, 200, data)
    } catch (err: any) {
      return json(res, 500, { error: err.message })
    }
  }

  // GET /api/admin/prospects/followups?campaign_id=...
  if (url.startsWith('/api/admin/prospects/followups') && method === 'GET' && !url.includes('/cancel')) {
    try {
      const qs = new URL(url, `http://localhost`).searchParams
      const campaignId = qs.get('campaign_id')
      if (!campaignId) return json(res, 400, { error: 'campaign_id é obrigatório' })

      const { data, error } = await supabaseAdmin
        .from('prospect_followup_queue')
        .select('*, prospect_leads!inner(*)')
        .eq('prospect_leads.campaign_id', campaignId)
        .order('scheduled_at', { ascending: true })
      if (error) throw error
      return json(res, 200, data)
    } catch (err: any) {
      return json(res, 500, { error: err.message })
    }
  }

  // POST /api/admin/prospects/followups/cancel
  if (url === '/api/admin/prospects/followups/cancel' && method === 'POST') {
    try {
      let body = ''
      for await (const chunk of req) body += chunk
      const { id } = JSON.parse(body)
      if (!id) return json(res, 400, { error: 'id do followup é obrigatório' })

      const { data, error } = await supabaseAdmin
        .from('prospect_followup_queue')
        .update({ status: 'canceled' })
        .eq('id', id)
        .select()
        .single()
      if (error) throw error
      return json(res, 200, data)
    } catch (err: any) {
      return json(res, 500, { error: err.message })
    }
  }

  // POST /api/admin/prospects/import
  if (url === '/api/admin/prospects/import' && method === 'POST') {
    try {
      let body = ''
      for await (const chunk of req) body += chunk
      const parsed = JSON.parse(body) as {
        campaign: { slug: string; name: string; description?: string }
        templates: Array<{ segment_id: string; channel: string; subject?: string; body: string }>
        leads: Array<{ segment_id: string; company_name: string; contact_name?: string; phone?: string; email?: string; city?: string; target_role?: string; variables?: Record<string, any> }>
      }

      if (!parsed.campaign?.slug || !parsed.campaign?.name) {
        return json(res, 400, { error: 'Dados da campanha inválidos' })
      }

      // 1. Criar ou atualizar campanha
      const { data: campaign, error: cErr } = await supabaseAdmin
        .from('prospect_campaigns')
        .upsert({
          slug: parsed.campaign.slug,
          name: parsed.campaign.name,
          description: parsed.campaign.description,
          total_leads: parsed.leads.length
        }, { onConflict: 'slug' })
        .select()
        .single()

      if (cErr) throw cErr

      // 2. Criar templates
      if (parsed.templates?.length) {
        const templatesWithCampaign = parsed.templates.map(t => ({
          ...t,
          campaign_id: campaign.id
        }))
        const { error: tErr } = await supabaseAdmin
          .from('prospect_templates')
          .upsert(templatesWithCampaign, { onConflict: 'campaign_id,segment_id,channel' })
        if (tErr) throw tErr
      }

      // 3. Criar leads
      if (parsed.leads?.length) {
        const leadsWithCampaign = parsed.leads.map(l => ({
          ...l,
          campaign_id: campaign.id,
          status: 'new'
        }))
        const { error: lErr } = await supabaseAdmin
          .from('prospect_leads')
          .insert(leadsWithCampaign)
        if (lErr) throw lErr
      }

      return json(res, 200, { success: true, campaignId: campaign.id })
    } catch (err: any) {
      return json(res, 500, { error: err.message })
    }
  }

  // POST /api/admin/prospects/dispatch
  if (url === '/api/admin/prospects/dispatch' && method === 'POST') {
    try {
      let body = ''
      for await (const chunk of req) body += chunk
      const { lead_id, channel, step, text, subject } = JSON.parse(body)

      if (!lead_id || !channel || !step || !text) {
        return json(res, 400, { error: 'Dados insuficientes' })
      }

      // Obter dados do lead
      const { data: lead, error: lErr } = await supabaseAdmin
        .from('prospect_leads')
        .select('*')
        .eq('id', lead_id)
        .single()
      if (lErr || !lead) return json(res, 404, { error: 'Lead não encontrado' })

      let dispatchSuccess = false
      let responseBody = ''

      if (channel === 'whatsapp') {
        const adminPhone = lead.phone
        const uazapiToken = process.env['UAZAPI_TOKEN']
        const baseUrl = process.env['UAZAPI_BASE_URL'] ?? 'https://netservice.uazapi.com'

        if (!adminPhone || !uazapiToken) {
          responseBody = 'Simulação: Envio manual gerado com sucesso (UAZAPI não configurada)'
          dispatchSuccess = true
        } else {
          const result = await sendWhatsAppMessage({
            baseUrl,
            token: uazapiToken,
            number: adminPhone,
            text
          })
          dispatchSuccess = result.success
          responseBody = result.success ? 'WhatsApp enviado via UAZAPI' : (result.error || 'Erro UAZAPI')
        }
      } else {
        // E-mail mock/simulação
        dispatchSuccess = true
        responseBody = `Simulação: E-mail de prospecção enviado para ${lead.email}`
      }

      // Salvar log de disparo
      await supabaseAdmin.from('prospect_dispatch_logs').insert({
        lead_id,
        channel,
        step,
        status: dispatchSuccess ? 'success' : 'failed',
        response_body: responseBody
      })

      if (dispatchSuccess) {
        // Atualizar status do lead
        await supabaseAdmin
          .from('prospect_leads')
          .update({ status: 'contacted' })
          .eq('id', lead_id)

        // Se for o Passo 1 (WhatsApp), agendar Passo 2 (E-mail) para daqui a 48h
        if (step === 1) {
          const scheduledAt = new Date(Date.now() + 48 * 3600 * 1000).toISOString()
          await supabaseAdmin.from('prospect_followup_queue').insert({
            lead_id,
            channel: 'email',
            step: 2,
            scheduled_at: scheduledAt,
            status: 'pending'
          })
        }
        // Se for o Passo 2 (E-mail), agendar Passo 3 (WhatsApp Retomada) para daqui a 120h (5 dias)
        else if (step === 2) {
          const scheduledAt = new Date(Date.now() + 120 * 3600 * 1000).toISOString()
          await supabaseAdmin.from('prospect_followup_queue').insert({
            lead_id,
            channel: 'whatsapp',
            step: 3,
            scheduled_at: scheduledAt,
            status: 'pending'
          })
        }
      }

      return json(res, 200, { success: dispatchSuccess, message: responseBody })
    } catch (err: any) {
      return json(res, 500, { error: err.message })
    }
  }

  json(res, 404, { error: 'Rota admin de prospecção não encontrada' })
}
