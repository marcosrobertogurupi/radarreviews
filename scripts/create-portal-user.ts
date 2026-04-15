/**
 * Cria (ou vincula) um usuário Auth para um tenant existente no portal.
 *
 * Uso — criar novo usuário:
 *   npx tsx scripts/create-portal-user.ts --tenant <slug> --email <email> --password <senha>
 *
 * Uso — listar todos os tenants e ver quais têm usuário vinculado:
 *   npx tsx scripts/create-portal-user.ts --list
 *
 * Exemplos:
 *   npx tsx scripts/create-portal-user.ts --list
 *   npx tsx scripts/create-portal-user.ts --tenant nubank --email marcos@nubank.com --password Senha123!
 */

import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'

const sb = createClient(
  process.env['SUPABASE_URL']!,
  process.env['SUPABASE_SERVICE_ROLE_KEY']!
)

// ── CLI args ─────────────────────────────────────────────────────

function arg(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`)
  return idx !== -1 ? process.argv[idx + 1] : undefined
}

const MODE     = process.argv.includes('--list') ? 'list' : 'create'
const TENANT   = arg('tenant')
const EMAIL    = arg('email')
const PASSWORD = arg('password')
const ROLE     = (arg('role') ?? 'owner') as 'owner' | 'admin' | 'viewer'

// ── Listar tenants ────────────────────────────────────────────────

async function listTenants() {
  const { data: tenants, error } = await sb
    .from('tenants')
    .select('id, name, slug, plan, is_active, created_at')
    .order('created_at', { ascending: false })

  if (error) { console.error('Erro ao buscar tenants:', error.message); process.exit(1) }
  if (!tenants?.length) { console.log('Nenhum tenant encontrado.'); return }

  console.log('\n═══════════════════════════════════════════════════════════')
  console.log('  TENANTS CADASTRADOS')
  console.log('═══════════════════════════════════════════════════════════\n')

  for (const t of tenants) {
    // Verifica se há usuário vinculado
    const { data: users } = await sb
      .from('tenant_users')
      .select('user_id, role')
      .eq('tenant_id', t.id)

    const hasUser = (users?.length ?? 0) > 0
    const status  = t.is_active ? '✅' : '⛔'
    const userStr = hasUser
      ? `👤 ${users!.length} usuário(s) vinculado(s)`
      : '⚠️  SEM usuário — sem acesso ao portal'

    console.log(`${status} ${t.name}`)
    console.log(`   Slug:   ${t.slug}`)
    console.log(`   Plano:  ${t.plan}`)
    console.log(`   ID:     ${t.id}`)
    console.log(`   ${userStr}`)

    if (hasUser) {
      for (const u of users!) {
        // Busca email do usuário Auth
        const { data: authUser } = await sb.auth.admin.getUserById(u.user_id)
        const email = authUser?.user?.email ?? '(email não encontrado)'
        console.log(`   └─ ${email} [${u.role}]`)
      }
    } else {
      console.log(`   └─ Para criar acesso: npx tsx scripts/create-portal-user.ts --tenant ${t.slug} --email SEU@EMAIL.COM --password SENHA`)
    }
    console.log()
  }
}

// ── Criar usuário ─────────────────────────────────────────────────

async function createUser() {
  if (!TENANT || !EMAIL || !PASSWORD) {
    console.error('❌  Informe --tenant, --email e --password')
    console.error('    Exemplo: npx tsx scripts/create-portal-user.ts --tenant nubank --email marcos@nubank.com --password Senha123!')
    process.exit(1)
  }

  if (PASSWORD.length < 8) {
    console.error('❌  Senha deve ter ao menos 8 caracteres.')
    process.exit(1)
  }

  // 1. Buscar tenant
  const { data: tenant, error: tErr } = await sb
    .from('tenants')
    .select('id, name, slug')
    .eq('slug', TENANT)
    .single()

  if (tErr || !tenant) {
    console.error(`❌  Tenant com slug "${TENANT}" não encontrado.`)
    console.error('    Use --list para ver os slugs disponíveis.')
    process.exit(1)
  }

  console.log(`\n📦  Tenant encontrado: ${tenant.name} (${tenant.id})`)

  // 2. Verificar se e-mail já existe no Auth
  const { data: { users: existingUsers } } = await sb.auth.admin.listUsers()
  const existing = existingUsers.find(u => u.email === EMAIL.toLowerCase())

  let userId: string

  if (existing) {
    // Usuário Auth já existe → apenas vincular ao tenant
    userId = existing.id
    console.log(`ℹ️   Usuário Auth já existe para ${EMAIL} — vinculando ao tenant...`)
  } else {
    // 3. Criar usuário Auth novo
    console.log(`🔐  Criando usuário Auth para ${EMAIL}...`)
    const { data: created, error: createErr } = await sb.auth.admin.createUser({
      email:         EMAIL.toLowerCase(),
      password:      PASSWORD,
      email_confirm: true,
    })

    if (createErr || !created.user) {
      console.error('❌  Erro ao criar usuário Auth:', createErr?.message)
      process.exit(1)
    }

    userId = created.user.id
    console.log(`✅  Usuário Auth criado: ${userId}`)
  }

  // 4. Verificar se já está vinculado a este tenant
  const { data: existingLink } = await sb
    .from('tenant_users')
    .select('id, role')
    .eq('tenant_id', tenant.id)
    .eq('user_id', userId)
    .maybeSingle()

  if (existingLink) {
    console.log(`ℹ️   Usuário já está vinculado ao tenant como "${existingLink.role}".`)
  } else {
    const { error: linkErr } = await sb
      .from('tenant_users')
      .insert({ tenant_id: tenant.id, user_id: userId, role: ROLE })

    if (linkErr) {
      console.error('❌  Erro ao vincular tenant_users:', linkErr.message)
      process.exit(1)
    }

    console.log(`✅  Vinculado ao tenant como "${ROLE}"`)
  }

  console.log('\n══════════════════════════════════════════════')
  console.log('  ACESSO CRIADO COM SUCESSO')
  console.log('══════════════════════════════════════════════')
  console.log(`  Tenant:  ${tenant.name}`)
  console.log(`  E-mail:  ${EMAIL}`)
  console.log(`  Senha:   ${PASSWORD}`)
  console.log(`  Papel:   ${ROLE}`)
  console.log(`  Portal:  http://localhost:5174`)
  console.log('══════════════════════════════════════════════\n')
}

// ── Main ──────────────────────────────────────────────────────────

if (MODE === 'list') {
  listTenants().catch(console.error)
} else {
  createUser().catch(console.error)
}
