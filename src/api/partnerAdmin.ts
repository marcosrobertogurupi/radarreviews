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

export async function handlePartnerAdminRoutes(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  setCors(req, res);
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const auth = await getAuthUser(req.headers.authorization);
  if (!auth || auth.perfil !== 'admin') {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Apenas administradores' }));
    return;
  }

  const url = req.url?.split('?')[0] || '';

  try {
    // ----------------------------------------------------
    // PARCEIROS
    // ----------------------------------------------------
    
    // GET /api/admin/partners
    if (url === '/api/admin/partners' && req.method === 'GET') {
      const { data, error } = await supabaseAdmin
        .from('partners')
        .select('*')
        .order('created_at', { ascending: false });
        
      if (error) throw error;
      
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, partners: data }));
      return;
    }

    // POST /api/admin/partners
    if (url === '/api/admin/partners' && req.method === 'POST') {
      const body = await readBody(req);
      const { name, email, phone, company_name, partner_type, commission_setup_rate, commission_recurring_rate, status, password } = body;
      
      if (!name || !email || !password || !partner_type) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Campos obrigatórios faltando' }));
        return;
      }

      // 1. Criar Auth User
      const { data: authData, error: authErr } = await supabaseAdmin.auth.admin.createUser({
        email: email.trim(),
        password,
        email_confirm: true,
      });

      if (authErr || !authData.user) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: authErr?.message || 'Erro ao criar usuário auth' }));
        return;
      }

      // 2. Criar na tabela partners
      const { data: partner, error: partnerErr } = await supabaseAdmin
        .from('partners')
        .insert({
          user_id: authData.user.id,
          name,
          email,
          phone,
          company_name,
          partner_type,
          commission_setup_rate,
          commission_recurring_rate,
          status: status || 'active'
        })
        .select()
        .single();

      if (partnerErr) throw partnerErr;

      // 3. Atualizar na tabela usuarios para que o parceiro consiga logar no portal (já criado por trigger)
      const { error: userErr } = await supabaseAdmin
        .from('usuarios')
        .update({
          nome: name,
          perfil: 'parceiro',
          ativo: true
        })
        .eq('id', authData.user.id);

      if (userErr) {
        console.error('Erro ao atualizar usuario no schema public:', userErr);
      }

      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, partner }));
      return;
    }

    // PUT /api/admin/partners/:id
    if (url.startsWith('/api/admin/partners/') && req.method === 'PUT') {
      const id = url.split('/api/admin/partners/')[1];
      const body = await readBody(req);
      
      const { error } = await supabaseAdmin
        .from('partners')
        .update(body)
        .eq('id', id);

      if (error) throw error;

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    // ----------------------------------------------------
    // COMISSÕES
    // ----------------------------------------------------

    // GET /api/admin/commissions
    if (url === '/api/admin/commissions' && req.method === 'GET') {
      const { data, error } = await supabaseAdmin
        .from('commissions')
        .select('*, partners(name, email), tenants(name)')
        .order('reference_month', { ascending: false });
        
      if (error) throw error;
      
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, commissions: data }));
      return;
    }

    // PUT /api/admin/commissions/:id/status
    if (url.startsWith('/api/admin/commissions/') && url.endsWith('/status') && req.method === 'PUT') {
      const id = url.split('/api/admin/commissions/')[1]?.split('/status')[0];
      const body = await readBody(req);
      const { status } = body;
      
      if (!status) {
         res.writeHead(400, { 'Content-Type': 'application/json' });
         res.end(JSON.stringify({ error: 'Status obrigatório' }));
         return;
      }

      const updates: any = { status };
      if (status === 'approved') updates.approved_at = new Date().toISOString();
      if (status === 'paid') updates.paid_at = new Date().toISOString();

      const { error } = await supabaseAdmin
        .from('commissions')
        .update(updates)
        .eq('id', id);

      if (error) throw error;

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    // Rota não encontrada
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Rota de admin/parceiros não encontrada' }));

  } catch (err: any) {
    console.error('[partner-admin-api]', err);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message || 'Erro interno' }));
  }
}
