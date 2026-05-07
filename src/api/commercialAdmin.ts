import http from 'node:http'
import { supabaseAdmin } from '../lib/supabase.js'
import axios from 'axios'
import { logger } from '../lib/logger.js'

function json(res: http.ServerResponse, status: number, data: any) {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(data))
}

async function readBody(req: http.IncomingMessage): Promise<string> {
  let body = ''
  for await (const chunk of req) body += chunk
  return body
}

export async function handleCommercialAdmin(
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

  // 1. GET /api/admin/commercial/companies
  if (url === '/api/admin/commercial/companies' && method === 'GET') {
    try {
      const { data: companies, error: cErr } = await supabaseAdmin
        .from('commercial_companies')
        .select('*')
        .order('name', { ascending: true })

      if (cErr) throw cErr

      const result = []

      for (const comp of companies) {
        // Obter contagem de filiais
        const { count, error: bErr } = await supabaseAdmin
          .from('commercial_branches')
          .select('*', { count: 'exact', head: true })
          .eq('company_id', comp.id)

        if (bErr) throw bErr

        // Obter scores da marca (company level)
        const { data: brandScores, error: sErr } = await supabaseAdmin
          .from('commercial_channel_scores')
          .select('*')
          .eq('target_type', 'company')
          .eq('target_id', comp.id)

        if (sErr) throw sErr

        // Calcular percentual de score para cada canal e média geral normalizada
        const brandScoresFormatted = (brandScores || []).map(s => {
          const scoreNum = Number(s.score) || 0
          const scoreMaxNum = Number(s.score_max) || 5.0
          const scorePct = scoreMaxNum > 0 ? (scoreNum / scoreMaxNum) * 100 : 0
          return {
            id: s.id,
            channel: s.channel,
            score: s.score,
            score_max: s.score_max,
            score_pct: Math.round(scorePct * 100) / 100,
            reputation_label: s.reputation_label,
            collected_at: s.collected_at
          }
        })

        let sumPct = 0
        brandScoresFormatted.forEach(s => { sumPct += s.score_pct })
        const avg_score_pct = brandScoresFormatted.length > 0 ? Math.round((sumPct / brandScoresFormatted.length) * 100) / 100 : null

        result.push({
          ...comp,
          total_branches: count || 0,
          brand_scores: brandScoresFormatted,
          avg_score_pct
        })
      }

      return json(res, 200, result)
    } catch (err: any) {
      logger.error('[commercialAdmin] Erro GET /companies:', err)
      return json(res, 500, { error: err.message })
    }
  }

  // 2. GET /api/admin/commercial/companies/:id
  if (url.startsWith('/api/admin/commercial/companies/') && method === 'GET') {
    try {
      const id = url.split('/').pop()?.split('?')[0]
      if (!id) return json(res, 400, { error: 'ID da empresa é obrigatório' })

      // Buscar empresa
      const { data: company, error: cErr } = await supabaseAdmin
        .from('commercial_companies')
        .select('*')
        .eq('id', id)
        .single()

      if (cErr || !company) return json(res, 404, { error: 'Empresa não encontrada' })

      // Buscar scores da marca
      const { data: brandScores, error: bsErr } = await supabaseAdmin
        .from('commercial_channel_scores')
        .select('*')
        .eq('target_type', 'company')
        .eq('target_id', id)

      if (bsErr) throw bsErr

      const brandScoresFormatted = (brandScores || []).map(s => {
        const scoreNum = Number(s.score) || 0
        const scoreMaxNum = Number(s.score_max) || 5.0
        const scorePct = scoreMaxNum > 0 ? (scoreNum / scoreMaxNum) * 100 : 0
        return {
          ...s,
          score_pct: Math.round(scorePct * 100) / 100,
          is_brand_level: true
        }
      })

      // Buscar filiais
      const { data: branches, error: bErr } = await supabaseAdmin
        .from('commercial_branches')
        .select('*')
        .eq('company_id', id)
        .order('name', { ascending: true })

      if (bErr) throw bErr

      const branchesFormatted = []

      for (const branch of branches || []) {
        // Buscar scores da filial
        const { data: branchScores, error: bscErr } = await supabaseAdmin
          .from('commercial_channel_scores')
          .select('*')
          .eq('target_type', 'branch')
          .eq('target_id', branch.id)

        if (bscErr) throw bscErr

        const branchScoresFormatted = (branchScores || []).map(s => {
          const scoreNum = Number(s.score) || 0
          const scoreMaxNum = Number(s.score_max) || 5.0
          const scorePct = scoreMaxNum > 0 ? (scoreNum / scoreMaxNum) * 100 : 0
          return {
            ...s,
            score_pct: Math.round(scorePct * 100) / 100,
            is_brand_level: false
          }
        })

        branchesFormatted.push({
          ...branch,
          scores: [...branchScoresFormatted, ...brandScoresFormatted]
        })
      }

      return json(res, 200, {
        ...company,
        branches: branchesFormatted,
        brand_scores: brandScoresFormatted
      })
    } catch (err: any) {
      logger.error('[commercialAdmin] Erro GET /companies/:id:', err)
      return json(res, 500, { error: err.message })
    }
  }

  // 3. POST /api/admin/commercial/companies
  if (url === '/api/admin/commercial/companies' && method === 'POST') {
    try {
      const body = await readBody(req)
      const parsed = JSON.parse(body) as {
        company: { name: string; cnpj?: string; segment_id: string; notes?: string }
        branches: Array<{
          name: string; city?: string; state?: string; region?: string; address?: string;
          place_id_google?: string; contact_name?: string; phone?: string; email?: string;
          target_role?: string; commercial_context?: string
        }>
        scores?: Array<{
          target_type: 'company' | 'branch'
          target_ref: string | number
          channel: string
          score: number
          score_max: number
          reputation_label?: string
          review_highlight?: string
          review_sentiment?: 'positive' | 'negative' | 'neutral'
          source_url?: string
        }>
      }

      if (!parsed.company?.name || !parsed.company?.segment_id) {
        return json(res, 400, { error: 'Campos obrigatórios de empresa ausentes' })
      }

      // 1. Criar empresa
      const { data: createdCompany, error: cErr } = await supabaseAdmin
        .from('commercial_companies')
        .insert({
          name: parsed.company.name,
          cnpj: parsed.company.cnpj || null,
          segment_id: parsed.company.segment_id,
          notes: parsed.company.notes || null
        })
        .select()
        .single()

      if (cErr) throw cErr

      // Mapeamento temporário de refs de filiais inseridas para salvar os scores delas
      const insertedBranchIds: string[] = []

      // 2. Criar filiais
      if (parsed.branches?.length) {
        for (const b of parsed.branches) {
          const { data: createdBranch, error: bErr } = await supabaseAdmin
            .from('commercial_branches')
            .insert({
              company_id: createdCompany.id,
              ...b
            })
            .select()
            .single()

          if (bErr) throw bErr
          insertedBranchIds.push(createdBranch.id)
        }
      }

      // 3. Criar scores
      if (parsed.scores?.length) {
        const scoresToInsert = []

        for (const s of parsed.scores) {
          let target_id = ''

          if (s.target_type === 'company') {
            target_id = createdCompany.id
          } else {
            // Referência por índice numérico de filial
            const branchIdx = Number(s.target_ref)
            if (!isNaN(branchIdx) && insertedBranchIds[branchIdx]) {
              target_id = insertedBranchIds[branchIdx]
            } else {
              continue
            }
          }

          scoresToInsert.push({
            target_type: s.target_type,
            target_id,
            channel: s.channel,
            score: s.score,
            score_max: s.score_max,
            reputation_label: s.reputation_label || null,
            review_highlight: s.review_highlight || null,
            review_sentiment: s.review_sentiment || null,
            source_url: s.source_url || null
          })
        }

        if (scoresToInsert.length > 0) {
          const { error: sErr } = await supabaseAdmin
            .from('commercial_channel_scores')
            .insert(scoresToInsert)

          if (sErr) throw sErr
        }
      }

      return json(res, 201, createdCompany)
    } catch (err: any) {
      logger.error('[commercialAdmin] Erro POST /companies:', err)
      return json(res, 500, { error: err.message })
    }
  }

  // 4. PATCH /api/admin/commercial/companies/:id
  if (url.startsWith('/api/admin/commercial/companies/') && method === 'PATCH') {
    try {
      const id = url.split('/').pop()?.split('?')[0]
      if (!id) return json(res, 400, { error: 'ID é obrigatório' })

      const body = await readBody(req)
      const parsed = JSON.parse(body)

      const { data, error } = await supabaseAdmin
        .from('commercial_companies')
        .update(parsed)
        .eq('id', id)
        .select()
        .single()

      if (error) throw error
      return json(res, 200, data)
    } catch (err: any) {
      logger.error('[commercialAdmin] Erro PATCH /companies/:id:', err)
      return json(res, 500, { error: err.message })
    }
  }

  // DELETE /api/admin/commercial/companies/:id
  if (url.startsWith('/api/admin/commercial/companies/') && method === 'DELETE') {
    try {
      const id = url.split('/').pop()?.split('?')[0]
      if (!id) return json(res, 400, { error: 'ID é obrigatório' })

      const { error } = await supabaseAdmin
        .from('commercial_companies')
        .delete()
        .eq('id', id)

      if (error) throw error
      return json(res, 200, { success: true })
    } catch (err: any) {
      logger.error('[commercialAdmin] Erro DELETE /companies/:id:', err)
      return json(res, 500, { error: err.message })
    }
  }

  // 5. POST /api/admin/commercial/branches
  if (url === '/api/admin/commercial/branches' && method === 'POST') {
    try {
      const body = await readBody(req)
      const parsed = JSON.parse(body)

      if (!parsed.company_id || !parsed.name) {
        return json(res, 400, { error: 'company_id e name são obrigatórios' })
      }

      const { data, error } = await supabaseAdmin
        .from('commercial_branches')
        .insert(parsed)
        .select()
        .single()

      if (error) throw error
      return json(res, 201, data)
    } catch (err: any) {
      logger.error('[commercialAdmin] Erro POST /branches:', err)
      return json(res, 500, { error: err.message })
    }
  }

  // 6. PATCH /api/admin/commercial/branches/:id
  if (url.startsWith('/api/admin/commercial/branches/') && method === 'PATCH') {
    try {
      const id = url.split('/').pop()?.split('?')[0]
      if (!id) return json(res, 400, { error: 'ID é obrigatório' })

      const body = await readBody(req)
      const parsed = JSON.parse(body)

      const { data, error } = await supabaseAdmin
        .from('commercial_branches')
        .update(parsed)
        .eq('id', id)
        .select()
        .single()

      if (error) throw error
      return json(res, 200, data)
    } catch (err: any) {
      logger.error('[commercialAdmin] Erro PATCH /branches/:id:', err)
      return json(res, 500, { error: err.message })
    }
  }

  // 7. PUT /api/admin/commercial/scores
  if (url === '/api/admin/commercial/scores' && method === 'PUT') {
    try {
      const body = await readBody(req)
      const parsed = JSON.parse(body)

      if (!parsed.target_type || !parsed.target_id || !parsed.channel) {
        return json(res, 400, { error: 'target_type, target_id e channel são obrigatórios' })
      }

      const payload = {
        target_type: parsed.target_type,
        target_id: parsed.target_id,
        channel: parsed.channel,
        score: parsed.score,
        score_max: parsed.score_max,
        reputation_label: parsed.reputation_label || null,
        review_highlight: parsed.review_highlight || null,
        review_sentiment: parsed.review_sentiment || null,
        source_url: parsed.source_url || null,
        collected_at: parsed.collected_at || new Date().toISOString().split('T')[0],
        updated_at: new Date().toISOString()
      }

      const { data, error } = await supabaseAdmin
        .from('commercial_channel_scores')
        .upsert(payload, { onConflict: 'target_type,target_id,channel' })
        .select()
        .single()

      if (error) throw error
      return json(res, 200, data)
    } catch (err: any) {
      logger.error('[commercialAdmin] Erro PUT /scores:', err)
      return json(res, 500, { error: err.message })
    }
  }

  // GET /api/admin/commercial/google-rating/:placeId
  if (url.startsWith('/api/admin/commercial/google-rating/') && method === 'GET') {
    try {
      const placeId = url.split('/').pop()?.split('?')[0]
      if (!placeId) return json(res, 400, { error: 'placeId é obrigatório' })

      const apiKey = process.env['GOOGLE_MAPS_API_KEY']
      if (!apiKey) {
        return json(res, 500, { error: 'Chave do Google Maps não configurada' })
      }

      const resp = await axios.get(`https://places.googleapis.com/v1/places/${placeId}`, {
        headers: {
          'X-Goog-Api-Key': apiKey,
          'X-Goog-FieldMask': 'id,displayName,rating,userRatingCount'
        }
      })

      const data = resp.data
      const rating = data.rating || null
      const displayName = data.displayName?.text || null
      const reviewsCount = data.userRatingCount || null

      return json(res, 200, { rating, displayName, reviewsCount })
    } catch (err: any) {
      logger.error('[commercialAdmin] Erro GET /google-rating/:placeId:', err.message)
      return json(res, 500, { error: `Erro ao buscar dados do Google: ${err.message}` })
    }
  }

  // 8. POST /api/admin/commercial/generate-argument
  if (url === '/api/admin/commercial/generate-argument' && method === 'POST') {
    try {
      const body = await readBody(req)
      const { branch_id } = JSON.parse(body)

      if (!branch_id) return json(res, 400, { error: 'branch_id é obrigatório' })

      // 1. Buscar branch
      const { data: branch, error: bErr } = await supabaseAdmin
        .from('commercial_branches')
        .select('*')
        .eq('id', branch_id)
        .single()

      if (bErr || !branch) return json(res, 404, { error: 'Filial não encontrada' })

      // 2. Buscar company
      const { data: company, error: cErr } = await supabaseAdmin
        .from('commercial_companies')
        .select('*')
        .eq('id', branch.company_id)
        .single()

      if (cErr || !company) return json(res, 404, { error: 'Empresa-mãe não encontrada' })

      // 3. Buscar scores
      const { data: branchScores, error: bsErr } = await supabaseAdmin
        .from('commercial_channel_scores')
        .select('*')
        .eq('target_type', 'branch')
        .eq('target_id', branch_id)

      const { data: brandScores, error: bdsErr } = await supabaseAdmin
        .from('commercial_channel_scores')
        .select('*')
        .eq('target_type', 'company')
        .eq('target_id', company.id)

      const allScores = [...(branchScores || []), ...(brandScores || [])]

      // Mapeamento de label do segmento
      const segmentLabels: Record<string, string> = {
        seg_saude: 'Clínicas / Hospitais / Odontologia',
        seg_plano_saude: 'Planos de Saúde / Convênios',
        seg_imobi: 'Imobiliárias / Construtoras',
        seg_auto: 'Automotivo / Concessionárias',
        seg_edu: 'Educação / Faculdades / Escolas',
        seg_hotel: 'Hotelaria / Turismo / Booking',
        seg_telecom: 'Telecom / Provedores de Internet',
        seg_varejo: 'Varejo / Supermercados / iFood',
        seg_logistica: 'Transporte / Logística / Transportadoras',
        seg_seguros: 'Seguradoras / Corretoras / Planos de Seguro'
      }

      // Montar texto dos scores
      let scoresText = ''
      if (allScores.length > 0) {
        allScores.forEach(s => {
          const sNum = Number(s.score) || 0
          const sMax = Number(s.score_max) || 5.0
          const pct = Math.round((sNum / sMax) * 100)
          const lvl = s.target_type === 'company' ? 'Marca' : 'Filial'
          scoresText += `- [${lvl}] ${s.channel.toUpperCase()}: ${sNum}/${sMax} (${pct}%) — ${s.reputation_label || 'Sem label'}\n`
          if (s.review_highlight) {
            scoresText += `  Review em Destaque (${s.review_sentiment || 'neutro'}): "${s.review_highlight}"\n`
          }
        })
      } else {
        scoresText = 'Nenhum score ou avaliação mapeada no momento.'
      }

      // Montar Prompt
      const systemPrompt = `Você é um especialista em vendas consultivas B2B para o mercado de gestão de reputação online.`
      const userPrompt = `EMPRESA-ALVO:
Nome: ${company.name}
Segmento: ${segmentLabels[company.segment_id] || company.segment_id}
CNPJ: ${company.cnpj || 'Não informado'}

FILIAL:
Nome: ${branch.name}
Cidade: ${branch.city || 'N/A'} / ${branch.state || 'N/A'}
Endereço: ${branch.address || 'N/A'}
Decisor: ${branch.contact_name || 'Gestor'} (${branch.target_role || 'Contato Principal'})

SCORES DE REPUTAÇÃO:
${scoresText}

CONTEXTO ADICIONAL DO COMERCIAL:
${branch.commercial_context || 'Nenhum contexto adicional informado.'}

TAREFA:
Gere um argumento de abordagem comercial CURTO e DIRETO (máximo 5 linhas) para uso na abertura de contato via WhatsApp ou e-mail cold. O argumento deve:
1. Mencionar de forma empática a dor específica identificada nos scores (ex: reputação do Google Maps ou volume de reclamações).
2. Apresentar o Reputei como uma ferramenta estratégica e proativa de blindagem e aumento de notas locais.
3. Criar uma sutil urgência de perda de clientes, de forma consultiva e construtiva, sem agressividade.
4. Ser altamente personalizado com o nome da filial (${branch.name}) e sua localização (${branch.city}).
5. Terminar com uma pergunta aberta e engajadora que convide o decisor para uma demonstração ou trial gratuito de 30 dias.

Retorne APENAS o argumento comercial gerado, sem saudações introdutórias, sem aspas, sem formatações de markdown ou explicações complementares.`

      // Chamar Claude API
      const apiKey = process.env['ANTHROPIC_API_KEY']
      if (!apiKey) throw new Error('ANTHROPIC_API_KEY não configurada no servidor.')

      const response = await axios.post('https://api.anthropic.com/v1/messages', {
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 1000,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }]
      }, {
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json'
        }
      })

      const argumentText = response.data?.content?.[0]?.text || ''

      // Salvar na filial
      const { data: updatedBranch, error: upErr } = await supabaseAdmin
        .from('commercial_branches')
        .update({ approach_argument: argumentText })
        .eq('id', branch_id)
        .select()
        .single()

      if (upErr) throw upErr

      return json(res, 200, { argument: argumentText, branch_id })
    } catch (err: any) {
      logger.error('[commercialAdmin] Erro no generate-argument:', err?.response?.data || err)
      return json(res, 500, { error: err.message })
    }
  }

  // 9. POST /api/admin/commercial/push-to-prospect
  if (url === '/api/admin/commercial/push-to-prospect' && method === 'POST') {
    try {
      const body = await readBody(req)
      const { campaign_slug, campaign_name, campaign_date, branch_ids } = JSON.parse(body) as {
        campaign_slug: string
        campaign_name?: string
        campaign_date?: string
        branch_ids: string[]
      }

      if (!campaign_slug || !branch_ids?.length) {
        return json(res, 400, { error: 'campaign_slug e branch_ids são obrigatórios' })
      }

      // 1. Criar ou obter campanha
      const { data: campaign, error: cErr } = await supabaseAdmin
        .from('prospect_campaigns')
        .upsert({
          slug: campaign_slug,
          name: campaign_name || campaign_slug,
          campaign_date: campaign_date || new Date().toISOString().split('T')[0]
        }, { onConflict: 'slug' })
        .select()
        .single()

      if (cErr) throw cErr

      let leadsAdded = 0

      // 2. Processar cada filial e criar lead na prospecção
      for (const branchId of branch_ids) {
        // Obter branch
        const { data: branch, error: bErr } = await supabaseAdmin
          .from('commercial_branches')
          .select('*')
          .eq('id', branchId)
          .single()

        if (bErr || !branch) continue

        // Obter company
        const { data: company, error: cpErr } = await supabaseAdmin
          .from('commercial_companies')
          .select('*')
          .eq('id', branch.company_id)
          .single()

        if (cpErr || !company) continue

        // Obter scores para mapear variáveis dinâmicas
        const { data: branchScores } = await supabaseAdmin
          .from('commercial_channel_scores')
          .select('*')
          .eq('target_type', 'branch')
          .eq('target_id', branchId)

        const { data: brandScores } = await supabaseAdmin
          .from('commercial_channel_scores')
          .select('*')
          .eq('target_type', 'company')
          .eq('target_id', company.id)

        const googleMapsScore = (branchScores || []).find(s => s.channel === 'google_maps')?.score
        const reclameAquiScore = (brandScores || []).find(s => s.channel === 'reclame_aqui')?.score

        const mostCriticalReview = [...(branchScores || []), ...(brandScores || [])]
          .filter(s => s.review_highlight)
          .sort((x, y) => (Number(x.score) / Number(x.score_max)) - (Number(y.score) / Number(y.score_max)))[0]?.review_highlight || null

        // Montar variáveis do lead
        const variables = {
          nota_google: googleMapsScore ? Number(googleMapsScore) : null,
          nota_reclame: reclameAquiScore ? Number(reclameAquiScore) : null,
          review_destaque: mostCriticalReview,
          argumento_base: branch.approach_argument || null
        }

        // Criar o lead de prospecção
        const { error: leadErr } = await supabaseAdmin
          .from('prospect_leads')
          .insert({
            campaign_id: campaign.id,
            segment_id: company.segment_id,
            company_name: branch.name,
            contact_name: branch.contact_name || null,
            phone: branch.phone || null,
            email: branch.email || null,
            city: branch.city || null,
            target_role: branch.target_role || null,
            variables,
            status: 'new'
          })

        if (!leadErr) leadsAdded++
      }

      // Atualizar contador total de leads na campanha
      const { data: currentLeads } = await supabaseAdmin
        .from('prospect_leads')
        .select('id', { count: 'exact', head: true })
        .eq('campaign_id', campaign.id)

      await supabaseAdmin
        .from('prospect_campaigns')
        .update({ total_leads: currentLeads?.length || leadsAdded })
        .eq('id', campaign.id)

      return json(res, 200, { success: true, leads_added: leadsAdded, campaign_slug })
    } catch (err: any) {
      logger.error('[commercialAdmin] Erro push-to-prospect:', err)
      return json(res, 500, { error: err.message })
    }
  }

  // 10. GET /api/admin/commercial/campaigns-for-select
  if (url === '/api/admin/commercial/campaigns-for-select' && method === 'GET') {
    try {
      const { data, error } = await supabaseAdmin
        .from('prospect_campaigns')
        .select('id, slug, name, campaign_date, total_leads, is_active')
        .order('campaign_date', { ascending: false })

      if (error) throw error
      return json(res, 200, data)
    } catch (err: any) {
      logger.error('[commercialAdmin] Erro campaigns-for-select:', err)
      return json(res, 500, { error: err.message })
    }
  }

  json(res, 404, { error: 'Rota comercial administrativa não encontrada' })
}
