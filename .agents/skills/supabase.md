# Skill: Operações com Supabase

## Objetivo

Guia de como interagir corretamente com o Supabase neste projeto.
Leia antes de qualquer operação de banco de dados.

---

## Cliente singleton

O cliente já está configurado em `src/lib/supabase.ts`.
**Nunca criar um novo cliente — sempre importar o existente.**

```typescript
// CORRETO
import { supabase } from '../lib/supabase'

// ERRADO — nunca fazer isso
import { createClient } from '@supabase/supabase-js'
const supabase = createClient(...)
```

O cliente usa a `SUPABASE_SERVICE_ROLE_KEY` no backend — ela bypassa o RLS.
Por isso o filtro explícito por `tenant_id` é **obrigatório** em toda query.

---

## Upsert de reviews (operação mais comum)

```typescript
const { data, error } = await supabase
  .from('reviews')
  .upsert(reviews, {
    onConflict: 'channel,external_id',
    ignoreDuplicates: false,
  })
  .select('id, collected_at')

if (error) throw new Error(`Supabase upsert error: ${error.message}`)
```

---

## Buscar conectores ativos para o scheduler

```typescript
const { data: connectors, error } = await supabase
  .from('channel_connectors')
  .select(`
    *,
    monitored_businesses!inner(
      id,
      tenant_id,
      name,
      cnpj,
      is_active
    )
  `)
  .eq('status', 'active')
  .eq('monitored_businesses.is_active', true)
  .lte('next_sync_at', new Date().toISOString())
  .order('next_sync_at', { ascending: true })

if (error) throw error
```

---

## Registrar início e fim de um sync job

```typescript
// Início
const { data: job } = await supabase
  .from('sync_jobs')
  .insert({
    connector_id: connector.id,
    status: 'running',
    started_at: new Date().toISOString(),
  })
  .select('id')
  .single()

// Fim (sucesso)
await supabase
  .from('sync_jobs')
  .update({
    status: 'done',
    finished_at: new Date().toISOString(),
    reviews_fetched: result.reviews_fetched,
    reviews_new: result.reviews_new,
    reviews_updated: result.reviews_updated,
  })
  .eq('id', job.id)

// Fim (erro)
await supabase
  .from('sync_jobs')
  .update({
    status: 'failed',
    finished_at: new Date().toISOString(),
    error_detail: { message: result.error, stack: error.stack },
  })
  .eq('id', job.id)
```

---

## Atualizar status do conector após job

```typescript
// Sucesso — agendar próxima execução
const intervalMinutes = connector.config?.interval_minutes ?? 60
await supabase
  .from('channel_connectors')
  .update({
    status: 'active',
    last_sync_at: new Date().toISOString(),
    next_sync_at: new Date(
      Date.now() + intervalMinutes * 60 * 1000
    ).toISOString(),
    error_message: null,
  })
  .eq('id', connector.id)

// Erro
await supabase
  .from('channel_connectors')
  .update({
    status: 'error',
    last_sync_at: new Date().toISOString(),
    error_message: errorMessage,
  })
  .eq('id', connector.id)

// Erro de autenticação — requer reautorização do cliente
await supabase
  .from('channel_connectors')
  .update({
    status: 'pending_auth',
    error_message: 'Token expirado ou revogado. Reautenticação necessária.',
  })
  .eq('id', connector.id)
```

---

## Supabase Vault — tokens OAuth

Tokens de acesso (Facebook, Instagram, Reddit) são armazenados criptografados
no Vault. O campo `vault_secret_id` em `channel_connectors` guarda a referência.

```typescript
// src/lib/vault.ts

import { supabase } from './supabase'

export async function getVaultSecret(secretId: string): Promise<string> {
  const { data, error } = await supabase
    .rpc('vault.decrypted_secrets', { secret_id: secretId })

  if (error || !data) {
    throw new Error(`Vault: não foi possível recuperar o segredo ${secretId}`)
  }
  return data.decrypted_secret
}

export async function setVaultSecret(
  name: string,
  secret: string
): Promise<string> {
  const { data, error } = await supabase
    .rpc('vault.create_secret', { secret, name })

  if (error || !data) {
    throw new Error(`Vault: não foi possível salvar o segredo ${name}`)
  }
  return data  // retorna o UUID do segredo
}
```

---

## Agregação diária — chamar após upserts

Após inserir reviews, disparar a agregação do dia:

```typescript
await supabase.rpc('aggregate_daily_stats', {
  p_business_id: connector.business_id,
  p_channel: connector.channel,
  p_date: new Date().toISOString().split('T')[0],  // 'YYYY-MM-DD'
})
```

---

## Erros comuns e como resolver

| Erro Supabase | Causa | Solução |
|---|---|---|
| `23505 unique_violation` | Upsert com `ignoreDuplicates: true` | Checar constraint `channel,external_id` |
| `42501 insufficient_privilege` | Usando anon key no backend | Usar `SUPABASE_SERVICE_ROLE_KEY` |
| `PGRST116` | `.single()` sem resultado | Usar `.maybeSingle()` ou verificar dados |
| `23503 foreign_key_violation` | `business_id` ou `tenant_id` inválido | Verificar se o registro pai existe |
| Timeout | Query sem índice em tabela grande | Verificar índices em `schema.sql` |

---

## Tipos TypeScript — geração automática

Para gerar os tipos a partir do schema real do Supabase:

```bash
npx supabase gen types typescript \
  --project-id $SUPABASE_PROJECT_ID \
  --schema public \
  > src/types/database.types.ts
```

Executar sempre que houver nova migration.
