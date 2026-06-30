import http from 'node:http';
import { getAuthUser, setCors } from './server.js';
import { supabaseAdmin } from '../lib/supabase.js';

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
      const { name, email, phone, company_name, partner_type, commission_setup_rate, commission_recurring_rate, status, password, tier, pix_key } = body;
      
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

      const selectedTier = tier || 'bronze';
      let setupRate = commission_setup_rate;
      let recurringRate = commission_recurring_rate;

      if (setupRate === undefined || setupRate === null) {
        if (selectedTier === 'gold') setupRate = 20.00;
        else if (selectedTier === 'silver') setupRate = 15.00;
        else setupRate = 10.00;
      }
      if (recurringRate === undefined || recurringRate === null) {
        if (selectedTier === 'gold') recurringRate = 20.00;
        else if (selectedTier === 'silver') recurringRate = 15.00;
        else recurringRate = 10.00;
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
          commission_setup_rate: setupRate,
          commission_recurring_rate: recurringRate,
          status: status || 'active',
          tier: selectedTier,
          pix_key
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

      if (body.tier && (body.commission_setup_rate === undefined || body.commission_setup_rate === null)) {
        if (body.tier === 'gold') body.commission_setup_rate = 20.00;
        else if (body.tier === 'silver') body.commission_setup_rate = 15.00;
        else body.commission_setup_rate = 10.00;
      }
      if (body.tier && (body.commission_recurring_rate === undefined || body.commission_recurring_rate === null)) {
        if (body.tier === 'gold') body.commission_recurring_rate = 20.00;
        else if (body.tier === 'silver') body.commission_recurring_rate = 15.00;
        else body.commission_recurring_rate = 10.00;
      }

      // Buscar o user_id correspondente ao parceiro
      const { data: partner, error: getErr } = await supabaseAdmin
        .from('partners')
        .select('user_id')
        .eq('id', id)
        .single();
      
      if (getErr || !partner) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Parceiro não encontrado' }));
        return;
      }

      const { user_id } = partner;

      // Se informou nova senha ou e-mail, atualiza no Auth do Supabase
      const authUpdates: any = {};
      if (body.email) authUpdates.email = body.email.trim();
      if (body.password) authUpdates.password = body.password;

      if (Object.keys(authUpdates).length > 0 && user_id) {
        const { error: authErr } = await supabaseAdmin.auth.admin.updateUserById(user_id, authUpdates);
        if (authErr) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: authErr.message || 'Erro ao atualizar dados de autenticação' }));
          return;
        }
      }

      // Se informou nome ou e-mail ou status, atualiza na tabela usuarios
      if (user_id) {
        const userUpdates: any = {};
        if (body.name) userUpdates.nome = body.name;
        if (body.email) userUpdates.email = body.email.trim();
        if (body.status) {
          // Bloqueia se o status for inativo ou suspenso
          userUpdates.ativo = body.status === 'active';
        }

        if (Object.keys(userUpdates).length > 0) {
          await supabaseAdmin
            .from('usuarios')
            .update(userUpdates)
            .eq('id', user_id);
        }
      }

      // Remover password do body antes de atualizar a tabela partners
      const { password, ...partnerBody } = body;

      const { error } = await supabaseAdmin
        .from('partners')
        .update(partnerBody)
        .eq('id', id);

      if (error) throw error;

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    // DELETE /api/admin/partners/:id
    if (url.startsWith('/api/admin/partners/') && req.method === 'DELETE') {
      const id = url.split('/api/admin/partners/')[1];
      
      const { data: partner, error: getErr } = await supabaseAdmin
        .from('partners')
        .select('user_id')
        .eq('id', id)
        .single();
        
      if (getErr || !partner) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Parceiro não encontrado' }));
        return;
      }
      
      if (partner.user_id) {
        // Deletar da tabela usuarios
        await supabaseAdmin.from('usuarios').delete().eq('id', partner.user_id);
        // Deletar do auth.users
        await supabaseAdmin.auth.admin.deleteUser(partner.user_id);
      }
      
      // Deletar da tabela partners
      const { error: delErr } = await supabaseAdmin
        .from('partners')
        .delete()
        .eq('id', id);
        
      if (delErr) throw delErr;
      
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
