# Skill: Criar conector de canal

## Objetivo

Criar um conector completo para um canal de reviews. Um conector é responsável
por buscar dados de uma API externa, normalizar para o modelo `NormalizedReview`
e fazer upsert no Supabase.

---

## Passo 1 — Ler o contexto antes de escrever qualquer código

Antes de começar, leia obrigatoriamente:
- `production_artifacts/schema.sql` — schema completo do banco
- `production_artifacts/channel-specs.md` — ficha técnica do canal que será implementado
- `.agents/agents.md` — regras globais e modelo `NormalizedReview`
- `src/lib/supabase.ts` — cliente existente (não recriar)
- `src/types/review.ts` — tipos já definidos (não redefinir)

---

## Passo 2 — Estrutura do arquivo do conector

Crie o arquivo em `src/connectors/{nome-do-canal}.ts` seguindo este template:

```typescript
import { supabase } from '../lib/supabase'
import { getVaultSecret } from '../lib/vault'
import { logger } from '../lib/logger'
import type { ChannelConnector, JobResult } from '../types/connector'
import type { NormalizedReview } from '../types/review'

const CHANNEL = '{nome_do_canal}' as const  // ex: 'google_maps'
const BATCH_SIZE = 50

export async function run(connector: ChannelConnector): Promise<JobResult> {
  const result: JobResult = {
    reviews_fetched: 0,
    reviews_new: 0,
    reviews_updated: 0,
  }

  try {
    // Passo 3: buscar dados da API
    const rawItems = await fetchFromApi(connector)
    result.reviews_fetched = rawItems.length

    // Passo 4: normalizar
    const normalized = rawItems.map(item =>
      normalize(item, connector)
    )

    // Passo 5: upsert em lote
    const { new: newCount, updated: updatedCount } =
      await upsertReviews(normalized)

    result.reviews_new = newCount
    result.reviews_updated = updatedCount

  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error)
    logger.error(`[${CHANNEL}] Erro no conector ${connector.id}`, { error })
  }

  return result
}
```

---

## Passo 3 — Implementar `fetchFromApi`

A função deve:
- Receber o `ChannelConnector` (contém `external_id`, `config`, `vault_secret_id`)
- Buscar credenciais OAuth via `getVaultSecret(connector.vault_secret_id)` se necessário
- Lidar com paginação — buscar TODOS os itens disponíveis, não só a primeira página
- Implementar retry com backoff exponencial para erros 429 e 5xx:

```typescript
async function fetchWithRetry<T>(
  fn: () => Promise<T>,
  retries = 3
): Promise<T> {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn()
    } catch (err: any) {
      const isRetryable = err?.status === 429 || err?.status >= 500
      if (!isRetryable || i === retries - 1) throw err
      const delay = Math.pow(2, i) * 1000  // 1s, 2s, 4s
      await new Promise(r => setTimeout(r, delay))
    }
  }
  throw new Error('Max retries exceeded')
}
```

- Respeitar rate limits do canal (ver ficha técnica em `channel-specs.md`)
- Retornar array de objetos brutos da API (tipados como `unknown[]` se necessário)

---

## Passo 4 — Implementar `normalize`

A função converte um item bruto da API para `NormalizedReview`:

```typescript
function normalize(
  raw: ApiResponseItem,
  connector: ChannelConnector
): NormalizedReview {
  return {
    tenant_id: connector.tenant_id,       // buscar via JOIN se necessário
    business_id: connector.business_id,
    connector_id: connector.id,
    channel: CHANNEL,
    external_id: String(raw.id),          // OBRIGATÓRIO — ID da plataforma
    rating: normalizeRating(raw.rating),  // sempre 0–5 ou undefined
    title: raw.title?.trim() || undefined,
    body: raw.text?.trim() || undefined,
    author_name: raw.author?.name,
    author_external_id: String(raw.author?.id ?? ''),
    url: raw.url,
    language: raw.language ?? 'pt',
    published_at: new Date(raw.created_at).toISOString(), // OBRIGATÓRIO
    sentiment: 'unanalyzed',
    raw_data: raw as Record<string, unknown>, // payload BRUTO completo
  }
}

// Normaliza ratings de escalas diferentes para 0–5
function normalizeRating(value: unknown): number | undefined {
  if (value == null) return undefined
  const num = Number(value)
  if (isNaN(num)) return undefined
  // Adaptar conforme a escala do canal:
  // Trustpilot: 1–5 → manter
  // Google Maps: 1–5 → manter
  // Reddit: sem rating → undefined
  return Math.min(5, Math.max(0, num))
}
```

**Regras da normalização:**
- `external_id` nunca pode ser vazio ou undefined — se a API não retorna um ID,
  usar hash do conteúdo como fallback: `createHash('sha256').update(raw.text + raw.created_at).digest('hex')`
- `published_at` deve ser sempre uma data válida em ISO 8601
- Campos ausentes na API devem ser `undefined`, nunca string vazia `""`
- `raw_data` deve conter o objeto original **sem modificações**

---

## Passo 5 — Implementar `upsertReviews`

```typescript
async function upsertReviews(
  reviews: NormalizedReview[]
): Promise<{ new: number; updated: number }> {
  let newCount = 0
  let updatedCount = 0

  // Processar em lotes para evitar payloads gigantes
  for (let i = 0; i < reviews.length; i += BATCH_SIZE) {
    const batch = reviews.slice(i, i + BATCH_SIZE)

    const { data, error } = await supabase
      .from('reviews')
      .upsert(batch, {
        onConflict: 'channel,external_id',
        ignoreDuplicates: false,  // false = atualiza se já existir
      })
      .select('id, collected_at')

    if (error) throw error

    // Contar novos vs atualizados pelo tempo de coleta
    const now = new Date()
    data?.forEach(row => {
      const age = now.getTime() - new Date(row.collected_at).getTime()
      if (age < 5000) newCount++  // coletado agora = novo
      else updatedCount++
    })
  }

  return { new: newCount, updated: updatedCount }
}
```

---

## Passo 6 — Atualizar o conector no banco

Após o `run()` retornar, o scheduler (não o conector) é responsável por atualizar
`channel_connectors`. O conector só retorna `JobResult`. Porém, se o erro for
de autenticação (401/403), o conector deve atualizar o status para `pending_auth`:

```typescript
if (error?.status === 401 || error?.status === 403) {
  await supabase
    .from('channel_connectors')
    .update({ status: 'pending_auth', error_message: error.message })
    .eq('id', connector.id)
}
```

---

## Passo 7 — Criar testes

Crie o arquivo de testes em `tests/connectors/{nome-do-canal}.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { run } from '../../src/connectors/{nome-do-canal}'
import { mockConnector } from '../fixtures/connector'

// Mock do cliente Supabase
vi.mock('../../src/lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => ({
      upsert: vi.fn(() => ({ select: vi.fn(() => ({ data: [], error: null })) })),
    })),
  },
}))

describe('{NomeDoCanal} connector', () => {
  it('retorna JobResult com reviews_fetched > 0 para empresa válida', async () => {
    // mock da chamada HTTP aqui
    const result = await run(mockConnector('{nome_do_canal}'))
    expect(result.reviews_fetched).toBeGreaterThanOrEqual(0)
    expect(result.error).toBeUndefined()
  })

  it('retorna error no JobResult quando API falha', async () => {
    // forçar erro na chamada HTTP
    const result = await run(mockConnector('{nome_do_canal}'))
    expect(result.error).toBeDefined()
  })
})
```

---

## Passo 8 — Checklist final antes de concluir

- [ ] Arquivo criado em `src/connectors/{canal}.ts`
- [ ] Exporta função `run(connector): Promise<JobResult>`
- [ ] Normalização gera `external_id` sempre preenchido
- [ ] `raw_data` contém o JSON bruto sem modificações
- [ ] `published_at` é sempre ISO 8601 válido
- [ ] Upsert usa `onConflict: 'channel,external_id'`
- [ ] Retry implementado para 429 e 5xx
- [ ] Erros de auth atualizam status para `pending_auth`
- [ ] Testes criados e passando (`vitest run`)
- [ ] Nenhuma API key hardcoded no código
- [ ] Código revisado pelo linter (`npm run lint`)

---

## Fichas técnicas por canal

Detalhes de cada API estão em `production_artifacts/channel-specs.md`.
Leia a seção do canal que está implementando antes de escrever `fetchFromApi`.
