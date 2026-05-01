import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
dotenv.config()

const supabaseUrl = process.env.SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing env vars')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseServiceKey)

async function resetPassword() {
  const email = 'marcosroberto_gurupi@hotmail.com'
  const newPassword = 'Mudar@123'

  console.log(`Resetando senha para ${email}...`)

  const { data: users, error: listError } = await supabase.auth.admin.listUsers()
  if (listError) {
    console.error('Erro ao listar usuários:', listError)
    return
  }

  const user = users.users.find(u => u.email === email)
  if (!user) {
    console.error('Usuário não encontrado')
    return
  }

  const { data, error } = await supabase.auth.admin.updateUserById(
    user.id,
    { password: newPassword }
  )

  if (error) {
    console.error('Erro ao resetar senha:', error)
  } else {
    console.log('Senha resetada com sucesso para: Mudar@123')
  }
}

resetPassword()
