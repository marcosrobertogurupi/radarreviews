import http from 'node:http';
import { createClient } from '@supabase/supabase-js';
import { getAuthUser, setCors } from './server.js';

const supabaseAdmin = createClient(
  process.env['SUPABASE_URL']!,
  process.env['SUPABASE_SERVICE_ROLE_KEY']!
);

async function readBody(req: http.IncomingMessage): Promise<any> {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error('JSON inválido');
  }
}

// Helper para validar status do parceiro
export async function getPartnerAuth(authHeader: string | undefined) {
  const auth = await getAuthUser(authHeader);
  if (!auth) return null;

  // Buscar perfil de parceiro
  const { data: partner, error } = await supabaseAdmin
    .from('partners')
    .select('*')
    .eq('user_id', auth.userId)
    .single();

  if (error || !partner) return null;

  return {
    ...auth,
    partnerId: partner.id,
    partnerStatus: partner.status,
    partnerType: partner.partner_type
  };
}

export async function handlePartnerRoutes(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  setCors(req, res);
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const auth = await getPartnerAuth(req.headers.authorization);
  if (!auth) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Não autenticado como parceiro' }));
    return;
  }

  if (auth.partnerStatus !== 'active') {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Conta de parceiro inativa ou suspensa' }));
    return;
  }

  const url = req.url?.split('?')[0] || '';

  try {
    // GET /api/partner/dashboard
    if (url === '/api/partner/dashboard' && req.method === 'GET') {
      const { data, error } = await supabaseAdmin
        .from('partner_dashboard_summary')
        .select('*')
        .eq('partner_id', auth.partnerId)
        .single();
        
      if (error && error.code !== 'PGRST116') throw error; // Ignora se não achou e retorna default
      
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, dashboard: data || {} }));
      return;
    }

    // GET /api/partner/clients
    if (url === '/api/partner/clients' && req.method === 'GET') {
      const { data, error } = await supabaseAdmin
        .from('tenants')
        .select('id, name, slug, plan, is_active, plan_status, trial_ends_at, created_at, monitored_businesses(cnpj, category)')
        .eq('partner_id', auth.partnerId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, clients: data }));
      return;
    }

    // POST /api/partner/clients
    if (url === '/api/partner/clients' && req.method === 'POST') {
      const body = await readBody(req);
      const { business_name, email, phone, plan_slug } = body;
      
      if (!business_name || !email) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'business_name e email são obrigatórios' }));
        return;
      }

      // Utiliza a RPC para criar com segurança
      const { data, error } = await supabaseAdmin.rpc('partner_register_tenant', {
        p_partner_id: auth.partnerId,
        p_business_name: business_name,
        p_email: email,
        p_phone: phone || null,
        p_plan_slug: plan_slug || 'starter'
      });

      if (error) throw error;

      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, tenantId: data }));
      return;
    }

    // GET /api/partner/commissions
    if (url === '/api/partner/commissions' && req.method === 'GET') {
      const { data, error } = await supabaseAdmin
        .from('commissions')
        .select('*, tenants(name)')
        .eq('partner_id', auth.partnerId)
        .order('reference_month', { ascending: false });

      if (error) throw error;
      
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, commissions: data }));
      return;
    }

    // POST /api/partner/register-client
    if (url === '/api/partner/register-client' && req.method === 'POST') {
      const body = await readBody(req);
      const {
        businessName, clientEmail, clientPassword,
        plan: requestedPlan = 'basico', cnpj, category,
        channels = [], instagramUsername, hashtags, fbUrl
      } = body;

      if (!businessName?.trim() || !clientEmail?.trim() || !clientPassword) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'businessName, clientEmail e clientPassword são obrigatórios' }));
        return;
      }

      // 1. Criar usuário Auth (e-mail já confirmado, parceiro define a senha inicial)
      const { data: authData, error: authErr } = await supabaseAdmin.auth.admin.createUser({
        email: clientEmail.trim(),
        password: clientPassword,
        email_confirm: true,
      });

      if (authErr || !authData.user) {
        const msg = authErr?.message ?? 'Erro ao criar usuário';
        const status = msg.toLowerCase().includes('already') ? 409 : 500;
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: msg }));
        return;
      }
      const userId = authData.user.id;

      // 2. Buscar plano
      const slugify = (name: string) =>
        name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
          .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/, '').slice(0, 50);

      let slug = slugify(businessName.trim());
      const { data: slugExists } = await supabaseAdmin
        .from('tenants').select('slug').eq('slug', slug).maybeSingle();
      if (slugExists) slug = `${slug}-${Math.random().toString(36).slice(2, 6)}`;

      const { data: planData } = await supabaseAdmin
        .from('plans')
        .select('slug, max_channels')
        .eq('slug', requestedPlan)
        .maybeSingle();
      const plan = planData?.slug ?? 'basico';
      const maxChannels = planData?.max_channels ?? 3;

      if ((channels as string[]).length > maxChannels) {
        // Rollback: remover usuário criado
        await supabaseAdmin.auth.admin.deleteUser(userId);
        res.writeHead(422, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `O plano ${plan} permite no máximo ${maxChannels} canais.` }));
        return;
      }

      const trialEndsAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

      // 3. Criar tenant com partner_id vinculado
      const tenantInsert: Record<string, unknown> = {
        name: businessName.trim(), slug, plan,
        plan_status: 'trial', trial_ends_at: trialEndsAt,
        partner_id: auth.partnerId,
      };
      const { data: tenant, error: tenantErr } = await supabaseAdmin
        .from('tenants').insert(tenantInsert).select('id').single();
      if (tenantErr || !tenant) {
        await supabaseAdmin.auth.admin.deleteUser(userId);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: tenantErr?.message ?? 'Erro ao criar tenant' }));
        return;
      }

      // 4. Vincular usuário ao tenant como owner
      await supabaseAdmin.from('tenant_users').insert({
        tenant_id: tenant.id, user_id: userId, role: 'owner',
      });

      // 5. Criar empresa monitorada
      const bizInsert: Record<string, unknown> = { tenant_id: tenant.id, name: businessName.trim() };
      if (category?.trim()) bizInsert['category'] = category.trim();
      if (cnpj?.trim())     bizInsert['cnpj']     = cnpj.replace(/\D/g, '').slice(0, 14);
      const { data: biz, error: bizErr } = await supabaseAdmin
        .from('monitored_businesses').insert(bizInsert).select('id').single();
      if (bizErr || !biz) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: bizErr?.message ?? 'Erro ao criar empresa' }));
        return;
      }

      // 6. Criar regras de alerta padrão
      await supabaseAdmin.from('alert_rules').insert([
        { tenant_id: tenant.id, business_id: biz.id, name: 'Rating Baixo (Automático)', condition_type: 'rating_drop', threshold: 2, notify_email: true },
        { tenant_id: tenant.id, business_id: biz.id, name: 'Sentimento Crítico (IA)', condition_type: 'negative_surge', notify_email: true },
      ]);

      // 7. Criar conectores dos canais selecionados
      if ((channels as string[]).length > 0) {
        const connectors = (channels as string[]).map((ch) => {
          const conn: Record<string, unknown> = { business_id: biz.id, channel: ch, status: 'active' };
          if (ch === 'google_maps') conn['status'] = 'pending_config';
          if (ch === 'instagram') {
            conn['external_id'] = instagramUsername?.replace('@', '') || businessName.trim();
            conn['config'] = { username: instagramUsername?.replace('@', ''), hashtags: hashtags || '', interval_minutes: 120 };
          }
          if (ch === 'facebook') {
            conn['config'] = { page_url: fbUrl || '', interval_minutes: 60 };
          }
          if (ch === 'tripadvisor') {
            conn['status'] = 'pending_config'; // Admin configura o url_path
          }
          return conn;
        });
        await supabaseAdmin.from('channel_connectors').insert(connectors);
      }

      console.log(`[partner-register] Tenant criado: ${slug} (${tenant.id}) por parceiro ${auth.partnerId}`);
      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, tenantId: tenant.id, businessId: biz.id, clientEmail: clientEmail.trim() }));
      return;
    }

    // Rota não encontrada
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Rota do parceiro não encontrada' }));

  } catch (err: any) {
    console.error('[partner-api]', err);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message || 'Erro interno' }));
  }
}

