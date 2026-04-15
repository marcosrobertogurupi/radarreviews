// Cliente Supabase singleton para o backend
// Usa SUPABASE_SERVICE_ROLE_KEY — bypassa o RLS.
// OBRIGATÓRIO: todo query deve incluir filtro explícito por tenant_id.

import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env['SUPABASE_URL']
const supabaseServiceKey = process.env['SUPABASE_SERVICE_ROLE_KEY']

if (!supabaseUrl) {
  throw new Error('Variável de ambiente SUPABASE_URL não definida.')
}

if (!supabaseServiceKey) {
  throw new Error('Variável de ambiente SUPABASE_SERVICE_ROLE_KEY não definida.')
}

/**
 * Cliente Supabase singleton com service role key.
 * Importar este cliente — nunca criar um novo com createClient().
 *
 * ATENÇÃO: Esta chave bypassa o RLS. Sempre incluir filtro por tenant_id
 * em todas as queries para garantir isolamento multi-tenant.
 */
export const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    // O backend não precisa de sessão de usuário
    persistSession: false,
    autoRefreshToken: false,
  },
})
