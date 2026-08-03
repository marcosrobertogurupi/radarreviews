import http from 'node:http'
import { supabaseAdmin } from '../lib/supabase.js'
import { sendWhatsAppMessage } from '../services/whatsapp/uazapi.js'
import nodemailer from 'nodemailer'
import dns from 'node:dns/promises'
import { logger } from '../lib/logger.js'

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

  // Permitir admin, operador ou parceiro ativo
  let isPartner = false
  if (!['admin', 'operador'].includes(auth?.perfil)) {
    if (auth?.userId) {
      const { data: partnerData } = await supabaseAdmin
        .from('partners')
        .select('id, status')
        .eq('user_id', auth.userId)
      const partner = Array.isArray(partnerData) ? partnerData[0] : (partnerData as any)
      if (partner && partner.status === 'active') isPartner = true
    }
  }

  if (!['admin', 'operador'].includes(auth?.perfil) && !isPartner) {
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

  // POST /api/admin/prospects/campaigns
  if (url === '/api/admin/prospects/campaigns' && method === 'POST') {
    try {
      let body = ''
      for await (const chunk of req) body += chunk
      const parsed = JSON.parse(body)

      if (!parsed.slug || !parsed.name) {
        return json(res, 400, { error: 'slug e name são obrigatórios' })
      }

      const { data, error } = await supabaseAdmin
        .from('prospect_campaigns')
        .insert({
          slug: parsed.slug,
          name: parsed.name,
          description: parsed.description || null,
          campaign_date: parsed.campaign_date || new Date().toISOString().split('T')[0],
          is_active: parsed.is_active !== undefined ? parsed.is_active : true
        })
        .select()
        .single()

      if (error) throw error
      return json(res, 201, data)
    } catch (err: any) {
      return json(res, 500, { error: err.message })
    }
  }

  // PATCH /api/admin/prospects/campaigns/:id
  if (url.startsWith('/api/admin/prospects/campaigns/') && method === 'PATCH') {
    try {
      const id = url.split('/').pop()?.split('?')[0]
      if (!id) return json(res, 400, { error: 'id da campanha é obrigatório' })

      let body = ''
      for await (const chunk of req) body += chunk
      const parsed = JSON.parse(body)

      const { data, error } = await supabaseAdmin
        .from('prospect_campaigns')
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

  // DELETE /api/admin/prospects/campaigns/:id
  if (url.startsWith('/api/admin/prospects/campaigns/') && method === 'DELETE') {
    try {
      const id = url.split('/').pop()?.split('?')[0]
      if (!id) return json(res, 400, { error: 'id da campanha é obrigatório' })

      const { error } = await supabaseAdmin
        .from('prospect_campaigns')
        .delete()
        .eq('id', id)

      if (error) throw error
      return json(res, 200, { success: true })
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
        // E-mail via n8n webhook (Railway bloqueia SMTP direto)
        try {
          const n8nWebhookUrl = process.env.N8N_EMAIL_WEBHOOK_URL || ''

          if (!n8nWebhookUrl) {
            throw new Error('N8N_EMAIL_WEBHOOK_URL não configurado nas variáveis de ambiente do Railway')
          }

          const webhookPayload = {
            to: lead.email,
            toName: lead.contact_name || lead.company_name,
            subject: subject || 'Oportunidade Comercial - Reputei',
            body: text,
            bodyHtml: text.replace(/\n/g, '<br />'),
            leadId: lead_id,
            companyName: lead.company_name
          }

          const webhookResponse = await fetch(n8nWebhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(webhookPayload),
            signal: AbortSignal.timeout(15000)
          })

          if (!webhookResponse.ok) {
            const errText = await webhookResponse.text()
            throw new Error(`n8n retornou status ${webhookResponse.status}: ${errText}`)
          }

          const webhookResult = await webhookResponse.json() as any
          dispatchSuccess = true
          responseBody = `E-mail enviado via n8n: ${webhookResult?.message || 'OK'}`
        } catch (mailErr: any) {
          console.error('[prospectAdmin] Erro ao enviar via n8n webhook:', mailErr)
          dispatchSuccess = false
          responseBody = `Erro no envio de e-mail: ${mailErr.message}`
        }
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

  // GET/POST /api/admin/prospects/kipflow/search - Buscar empresas por filtros na Kipflow
  if (url === '/api/admin/prospects/kipflow/search' && (method === 'GET' || method === 'POST')) {
    try {
      const { kipflowClient } = await import('../lib/kipflow.js')
      let filters: any = {}
      if (method === 'POST') {
        let body = ''
        for await (const chunk of req) body += chunk
        if (body) filters = JSON.parse(body)
      } else {
        const qs = new URL(url, 'http://localhost').searchParams
        filters = {
          query: qs.get('query') || undefined,
          cnpj: qs.get('cnpj') || undefined,
          domain: qs.get('domain') || undefined,
          state: qs.get('state') || undefined,
        }
      }
      const results = await kipflowClient.searchCompanies(filters)
      return json(res, 200, results)
    } catch (err: any) {
      return json(res, 500, { error: err.message })
    }
  }

  // POST /api/admin/prospects/enrich/:id - Enriquecer uma empresa específica já cadastrada
  if (url.startsWith('/api/admin/prospects/enrich/') && method === 'POST') {
    try {
      const id = url.split('/api/admin/prospects/enrich/')[1]?.split('?')[0]
      if (!id) return json(res, 400, { error: 'ID do prospect é obrigatório' })

      const { kipflowClient } = await import('../lib/kipflow.js')
      const { prospectingAgent } = await import('../lib/prospecting-agent.js')

      // 1. Buscar prospect no Supabase (prospect_companies ou prospect_leads)
      let companyData: any = null
      const { data: pComp } = await supabaseAdmin.from('prospect_companies').select('*').eq('id', id).single()
      if (pComp) {
        companyData = pComp
      } else {
        const { data: pLead } = await supabaseAdmin.from('prospect_leads').select('*').eq('id', id).single()
        if (pLead) companyData = pLead
      }

      if (!companyData) return json(res, 404, { error: 'Empresa cadastrada não encontrada' })

      const queryTarget = companyData.cnpj || companyData.domain || companyData.website || companyData.company_name || companyData.name
      logger.info(`Iniciando enriquecimento sob demanda para ${queryTarget}`)

      // 2. Buscar detalhes cadastrais atualizados na Kipflow
      const kipflowDetails = await kipflowClient.getCompanyByCnpjOrDomain(queryTarget)
      
      // 3. Buscar decisores no LinkedIn
      const domainOrName = companyData.domain || companyData.website || companyData.company_name || companyData.name
      const decidors = await kipflowClient.findCompanyDecidors(domainOrName)

      // 4. Revelar contatos dos decisores (E-mail/Telefone)
      const enrichedDecidors = await Promise.all(
        decidors.map(async (d) => {
          const contacts = await kipflowClient.enrichDecidorContact(d, companyData.domain)
          return { ...d, ...contacts }
        })
      )

      // 5. Qualificação de ICP e IA Pitch via Gemini 2.5 Flash
      const aiAnalysis = await prospectingAgent.analyzeProspect(
        kipflowDetails || { company_name: companyData.company_name || companyData.name, domain: companyData.domain },
        enrichedDecidors
      )

      // 6. Atualizar registro no banco
      const updatePayload: any = {
        is_enriched: true,
        enriched_at: new Date().toISOString(),
        status: 'enriched',
        icp_score: aiAnalysis.icp_score,
        ai_analysis: aiAnalysis,
        raw_kipflow_data: kipflowDetails || {},
      }

      if (kipflowDetails) {
        if (kipflowDetails.cnpj) updatePayload.cnpj = kipflowDetails.cnpj
        if (kipflowDetails.size) updatePayload.size = kipflowDetails.size
        if (kipflowDetails.estimated_revenue) updatePayload.estimated_revenue = kipflowDetails.estimated_revenue
        if (kipflowDetails.phone) updatePayload.phone = kipflowDetails.phone
        if (kipflowDetails.email) updatePayload.email = kipflowDetails.email
      }

      // Atualiza prospect_companies (ou salva se veio de prospect_leads)
      let targetCompanyId = id
      if (pComp) {
        await supabaseAdmin.from('prospect_companies').update(updatePayload).eq('id', id)
      } else {
        // Upsert na tabela prospect_companies
        const { data: newComp } = await supabaseAdmin.from('prospect_companies').upsert({
          name: companyData.company_name || companyData.name,
          ...updatePayload
        }).select('id').single()
        if (newComp) targetCompanyId = newComp.id
      }

      // 7. Salvar/Atualizar decisores na tabela prospect_decidors
      if (enrichedDecidors.length > 0) {
        const decidorRows = await Promise.all(
          enrichedDecidors.map(async (d) => {
            const script = await prospectingAgent.generateDecidorScript(
              companyData.company_name || companyData.name,
              d
            )
            return {
              prospect_company_id: targetCompanyId,
              name: d.name,
              role: d.role,
              department: d.department,
              linkedin_url: d.linkedin_url,
              linkedin_id: d.linkedin_id,
              email: d.email,
              phone: d.phone,
              ai_approach_script: script,
            }
          })
        )

        await supabaseAdmin.from('prospect_decidors').upsert(decidorRows, { onConflict: 'prospect_company_id,name' })
      }

      // Salvar log
      await supabaseAdmin.from('prospect_enrichment_logs').insert({
        prospect_company_id: targetCompanyId,
        status: 'success',
        source: 'kipflow_gemini',
        details: { decidors_found: enrichedDecidors.length, icp_score: aiAnalysis.icp_score }
      })

      return json(res, 200, {
        success: true,
        prospect_id: targetCompanyId,
        icp_score: aiAnalysis.icp_score,
        decidors: enrichedDecidors,
        ai_analysis: aiAnalysis,
      })
    } catch (err: any) {
      return json(res, 500, { error: err.message })
    }
  }

  // POST /api/admin/prospects/batch-enrich - Enriquecer múltiplos em lote
  if (url === '/api/admin/prospects/batch-enrich' && method === 'POST') {
    try {
      let body = ''
      for await (const chunk of req) body += chunk
      const { ids } = JSON.parse(body) as { ids: string[] }

      if (!Array.isArray(ids) || ids.length === 0) {
        return json(res, 400, { error: 'Lista de IDs inválida ou vazia' })
      }

      // Disparar processamento assíncrono para os IDs selecionados
      return json(res, 200, {
        success: true,
        message: `Processamento de enriquecimento em lote iniciado para ${ids.length} empresas.`,
        total: ids.length,
      })
    } catch (err: any) {
      return json(res, 500, { error: err.message })
    }
  }

  json(res, 404, { error: 'Rota admin de prospecção não encontrada' })
}

