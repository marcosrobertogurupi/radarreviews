import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
import { join } from 'path'

dotenv.config({ path: join(process.cwd(), '.env') })

const supabaseUrl = process.env.SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
})

async function checkUsers() {
  console.log('🔍 Buscando usuários cadastrados no Supabase Auth...')
  
  const { data: { users }, error } = await supabase.auth.admin.listUsers()
  
  if (error) {
    console.error('❌ Erro ao buscar usuários:', error.message)
    return
  }

  if (users.length === 0) {
    console.log('⚠️ Nenhum usuário encontrado no sistema.')
  } else {
    console.log(`✅ Foram encontrados ${users.length} usuário(s):`)
    users.forEach((u, i) => {
      console.log(`${i + 1}. E-mail: ${u.email} | ID: ${u.id}`)
    })
  }
}

checkUsers()
