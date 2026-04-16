const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(process.cwd(), '.env') });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

const USER_EMAIL = 'marcosroberto_gurupi@hotmail.com';
const NEW_PASSWORD = 'Mudar@123';

async function resetPassword() {
  console.log(`🔐 Redefinindo senha para o usuário: ${USER_EMAIL}...`);
  
  try {
    // 1. Achar o ID do usuário pelo e-mail
    const { data: { users }, error: listError } = await supabase.auth.admin.listUsers();
    if (listError) throw listError;
    
    const user = users.find(u => u.email === USER_EMAIL);
    
    if (!user) {
      console.error('❌ Usuário não encontrado!');
      return;
    }

    // 2. Atualizar a senha
    const { data, error } = await supabase.auth.admin.updateUserById(
      user.id,
      { password: NEW_PASSWORD }
    );
    
    if (error) {
      console.error('❌ Erro ao atualizar senha:', error.message);
      return;
    }

    console.log(`✅ Senha redefinida com sucesso para o usuário ${USER_EMAIL}!`);
    console.log('👉 Agora você pode fazer login no painel usando a senha: Mudar@123');
    
  } catch (err) {
    console.error('❌ Erro inesperado:', err.message);
  }
}

resetPassword();
