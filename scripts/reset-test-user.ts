import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function run() {
  console.log('Buscando usuários de teste...');
  const { data: { users }, error } = await supabaseAdmin.auth.admin.listUsers({ perPage: 1000 });
  if (error) {
    console.error('Erro ao listar usuários:', error);
    return;
  }

  const testUsers = users.filter(u => 
    u.email?.includes('test') || 
    u.email?.includes('atualcargas') ||
    u.email?.includes('exemplo') ||
    u.email?.includes('explore')
  );

  console.log(`Encontrados ${testUsers.length} usuários de teste.`);

  for (const u of testUsers) {
    console.log(`Deletando usuário: ${u.email} (${u.id})`);
    const { error: delErr } = await supabaseAdmin.auth.admin.deleteUser(u.id);
    if (delErr) {
      console.error(`Falha ao deletar ${u.email}:`, delErr);
    } else {
      console.log(`✅ Sucesso: ${u.email}`);
    }
  }
  console.log('Limpeza concluída!');
}

run().catch(console.error);
