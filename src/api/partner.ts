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

    // Rota não encontrada
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Rota do parceiro não encontrada' }));

  } catch (err: any) {
    console.error('[partner-api]', err);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message || 'Erro interno' }));
  }
}
