import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

dotenv.config()

const supabaseUrl = process.env.SUPABASE_URL || ''
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || ''
const supabase = createClient(supabaseUrl, supabaseKey)

async function check() {
  const email = 'hotellagopalma@hotmail.com'
  
  // Find auth user ID
  const { data: users, error: authErr } = await supabase.from('usuarios').select('id, email, perfil').eq('email', email)
  console.log('Usuarios:', users, authErr)
  
  if (users && users.length > 0) {
    const userId = users[0].id
    console.log('User ID:', userId)
    
    const { data: tu, error: tuErr } = await supabase.from('tenant_users').select('*').eq('user_id', userId)
    console.log('Tenant Users:', tu, tuErr)
  }
}

check()
