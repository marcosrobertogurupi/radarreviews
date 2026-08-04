# Radar de Reviews — Configuração de Agentes

## Identidade do projeto

O Radar de Reviews (produto: **Reputei**) é um SaaS multi-tenant de monitoramento de reputação online.
Coleta reviews de múltiplas plataformas, normaliza em um banco unificado, analisa sentimento com IA
e exibe análises consolidadas para empresas clientes.

---

## Stack obrigatória

- **Runtime:** Node.js 20+ com TypeScript estrito (`strict: true`)
- **Banco de dados:** Supabase (PostgreSQL) — schema já definido e migrado
- **Cliente Supabase:** `@supabase/supabase-js` v2
- **HTTP:** `axios` ou `fetch` nativo do Node 20
- **Validação:** `zod` para todos os schemas de entrada e saída
- **Testes:** `vitest`
- **IA:** Google Gemini 2.5 Flash (`@google/generative-ai`) — análise de sentimento + copilot
- **Linting:** ESLint + Prettier (configurações do projeto)
- **Variáveis de ambiente:** sempre via `.env` — nunca hardcoded

---

## Regras absolutas — nunca violar

1. **Nunca inventar campos fora do schema do banco.** O schema está em
   `production_artifacts/schema.sql`. Qualquer campo novo exige uma migration.

2. **Nunca armazenar tokens ou API keys em código.** Usar Supabase Vault para
   OAuth tokens (`vault_secret_id` na tabela `channel_connectors`). Demais
   secrets via `.env`.

3. **Toda inserção de review usa upsert com ON CONFLICT.**
   A constraint única é `(channel, external_id)`. Jamais fazer INSERT simples
   na tabela `reviews` — duplicatas são inaceitáveis.

4. **Sempre salvar o JSON original em `raw_data`.**
   Antes de qualquer normalização, o payload bruto da API vai para `raw_data`.
   Isso permite reprocessamento futuro sem nova chamada à API.

5. **Sempre atualizar `channel_connectors` após cada job.**
   Ao fim de cada coleta: `last_sync_at = now()`, `next_sync_at = now() + intervalo`,
   e `status = 'active'` (ou `'error'` se falhou).

6. **Nunca expor dados de um tenant para outro.**
   Backend usa `SUPABASE_SERVICE_ROLE_KEY` — filtro explícito por `tenant_id` é obrigatório.
   Portal usa anon key — RLS em todas as tabelas garante isolamento automático.

7. **Erros nunca são silenciados.** Todo catch deve logar o erro em `sync_jobs`
   (campo `error_detail`) e atualizar o status do conector para `'error'`.

8. **Escopo de projetos — Supabase e Railway.**
   - **Supabase:** todas as alterações (migrations, funções, config) devem ser feitas
     exclusivamente no projeto **radarviews_producao** (ref: `lkwahbipteiqqzkmfrac`, região `sa-east-1`).
   - **Railway:** todos os deploys e configurações devem ser feitos exclusivamente
     no projeto **reputei-api**. Nunca alterar outros projetos da conta.

---

## Estrutura de pastas do projeto

```
radar-reviews/
├── .agents/              ← arquivos de configuração do Antigravity
│   ├── agents.md         ← este arquivo
│   ├── skills/           ← instruções reutilizáveis por tarefa
│   └── workflows/        ← comandos /slash personalizados
├── production_artifacts/ ← contexto e referências do projeto
│   ├── schema.sql        ← schema completo do banco (fonte da verdade)
│   └── channel-specs.md  ← fichas técnicas de cada canal
├── migrations/           ← migrations SQL incrementais
│   └── 002_sentiment_columns.sql
├── src/
│   ├── connectors/       ← um arquivo por canal (todos implementados)
│   ├── lib/
│   │   ├── supabase.ts   ← cliente Supabase singleton (service role)
│   │   ├── vault.ts      ← helpers para Supabase Vault
│   │   ├── logger.ts     ← logger estruturado JSON
│   │   ├── ingest.ts     ← pipeline de ingestão (dedup + alerts + stats)
│   │   └── sentiment.ts  ← análise de sentimento Gemini + heurística
│   ├── types/
│   │   ├── review.ts     ← NormalizedReview, SentimentResult, etc.
│   │   └── connector.ts  ← ChannelConnector, JobResult
│   ├── scheduler/        ← orquestrador de jobs (loop 60s)
│   │   └── index.ts
│   └── api/              ← servidor HTTP para o portal
│       └── server.ts     ← POST /api/copilot (Gemini copilot endpoint)
├── admin/                ← painel operacional (React + Vite) — uso interno
│   └── src/pages/        ← Dashboard, Reviews, Alerts, Connectors, Tenants, Audit
├── portal/               ← painel do assinante (React + Vite) — produto final
│   └── src/pages/        ← Dashboard, Reviews, Alerts, Copilot (IA)
└── tests/                ← vitest — um arquivo por conector + lib
```

---

## Estado dos conectores (todos concluídos)

| Canal           | Fase | Arquivo                      | Status      |
|-----------------|------|------------------------------|-------------|
| google_maps     | 1    | connectors/google-maps.ts    | ✅ concluído |
| tripadvisor     | 1    | connectors/tripadvisor.ts    | ✅ concluído |
| consumidor_gov  | 1    | connectors/consumidor-gov.ts | ✅ concluído |
| trustpilot      | 1    | connectors/trustpilot.ts     | ✅ concluído |
| reddit          | 1    | connectors/reddit.ts         | ✅ concluído |
| facebook        | 2    | connectors/facebook.ts       | ✅ concluído |
| instagram       | 2    | connectors/instagram.ts      | ✅ concluído |
| reclame_aqui    | 3    | connectors/reclame-aqui.ts   | ✅ concluído |
| booking         | 4    | connectors/booking.ts        | ✅ concluído |

---

## Estado do produto (2026-08-04)

### Backend
- ✅ 9 conectores implementados + testados (Google Maps, TripAdvisor, Consumidor.gov, Trustpilot, Reddit, Facebook, Instagram, Reclame Aqui, Booking.com)
- ✅ Pipeline de ingestão com deduplicação, análise de sentimento e alertas
- ✅ Scheduler com loop de polling a cada 60s
- ✅ Motores de IA: Claude 3.5 Haiku (Copilot & respostas) + Gemini 2.5 Flash (fallback & sentimentos)
- ✅ TypeScript limpo (`tsc --noEmit` sem erros)
- ✅ API Backend: `src/api/server.ts` (porta 3001)

### Frontend — Admin (`admin/`)
- ✅ Dashboard com KPIs e gráficos (Recharts)
- ✅ Reviews com filtros e modal de detalhe com análise IA
- ✅ Alertas com resolução
- ✅ Conectores com configuração e force-sync
- ✅ Tenants / Assinantes (CRUD)
- ✅ Auditoria (Audit)
- ✅ Real-time via Supabase Postgres Changes

### Frontend — Portal do Assinante (`portal/`)
- ✅ Dashboard com KPIs e tendências (escopo: só tenant autenticado)
- ✅ Reviews com análise IA + next steps em negativos/críticos
- ✅ Alertas com resolução
- ✅ Copilot IA (chat de suporte — 1ª camada de atendimento)

### Pendente
- ⏳ Planos e billing (XML de preços a receber)
- ⏳ Onboarding self-service do assinante
- ⏳ Notificações por e-mail (webhook já suportado no schema)

---

## Modelo de dados central — Review normalizado

```typescript
interface NormalizedReview {
  tenant_id: string             // UUID do tenant
  business_id: string           // UUID da empresa monitorada
  connector_id: string          // UUID do conector
  channel: SourceChannel        // enum do canal
  external_id: string           // ID original na plataforma (obrigatório)
  rating?: number               // 0–5, undefined se canal não tem nota
  title?: string
  body?: string
  author_name?: string
  author_external_id?: string
  url?: string
  language?: string             // default: 'pt'
  tags?: string[]
  upvotes?: number
  comment_count?: number
  is_resolved?: boolean         // para Reclame Aqui e Consumidor.gov
  response_time_days?: number
  sentiment: SentimentType      // default: 'unanalyzed'
  dissatisfaction_score?: number // 0–100 (preenchido pela IA)
  sentiment_topics?: string[]
  sentiment_summary?: string
  sentiment_result?: SentimentResult
  published_at: string          // ISO 8601 — obrigatório
  raw_data: Record<string, unknown>
}
```

---

## Padrão de conector

```typescript
export async function run(connector: ChannelConnector): Promise<JobResult>
```

O conector deve: buscar dados da API → normalizar → chamar `ingestReviews()` → retornar `JobResult`.
**Nunca** fazer upsert direto — usar sempre `src/lib/ingest.ts`.

---

## Portal do Assinante — regras específicas

- Usa **Supabase anon key** + **RLS** — dados isolados automaticamente por tenant
- Não expor `SUPABASE_SERVICE_ROLE_KEY` no portal
- Copilot chama `POST http://localhost:3001/api/copilot` (dev) ou URL configurada em `VITE_API_URL`
- Authorization: `Bearer <supabase-session-token>`
- Reviews negativos/críticos exibem: `sentiment_summary`, `alert_reason`, botão "Sugerir Resposta"

---

## Variáveis de ambiente

```env
# Backend (src/)
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
GEMINI_API_KEY=
GOOGLE_MAPS_API_KEY=
TRIPADVISOR_API_KEY=
TRUSTPILOT_API_KEY=
REDDIT_CLIENT_ID=
REDDIT_CLIENT_SECRET=

# Admin (admin/.env)
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=

# Portal (portal/.env)
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
VITE_API_URL=http://localhost:3001
```

---

## Convenções de código

- Nomes de funções e variáveis: camelCase
- Nomes de arquivos: kebab-case
- Tipos e interfaces: PascalCase
- Constantes globais: UPPER_SNAKE_CASE
- Comentários: português (o time é brasileiro)
- Commits: português, imperativo ("Adiciona conector Google Maps")
