# Product Requirements Document (PRD) — Backend & APIs (Reputei)
*Documentação técnica da API HTTP, arquitetura do servidor e workers em segundo plano*

## 1. Visão Geral da Arquitetura

O Backend do Radar de Reviews (Reputei) opera como a ponte de serviços, orquestrador de inteligência artificial e motor de processamento assíncrono do SaaS. O banco de dados é um **Supabase (PostgreSQL 15+)**, onde as operações do portal do assinante utilizam RLS direto via cliente `@supabase/supabase-js`.

O servidor Node.js (TypeScript) roda na porta `3001` (ambiente dev) e em contêiner Railway (produção), sendo responsável por:
- **Tarefas Assíncronas (Cron Jobs / Polling):** Coleta de avaliações em 8 canais a cada 60 segundos e execução de jobs estratégicos.
- **Processamento Pesado:** Ingestão, deduplicação (`upsert`), e análise de sentimento via Google Gemini 2.5 Flash.
- **Endpoints Exclusivos:** Rotas HTTP dedicadas para Autenticação OAuth (Google e Meta), Billing/Webhooks (Asaas), Comunicação (WhatsApp/Uazapi), Suporte/RAG, Widget e Copilot.

---

## 2. Endpoints da API HTTP

### 2.1. Inteligência Artificial & Copilot
- **`POST /api/copilot`**
  - **Descrição:** Recebe perguntas gerenciais do assinante, recupera contexto do banco de dados (estatísticas de 30 dias, reviews negativos) e consulta a IA Gemini.
  - **Headers:** `Authorization: Bearer <supabase-jwt>`
  - **Payload:** `{ "message": "string", "history": [...] }`
  - **Retorno (200 OK):** `{ "reply": "string_markdown" }`

### 2.2. Autenticação OAuth (Google Business Profile)
- **`GET /api/auth/google/connect`**
  - Retorna a URL de consentimento OAuth 2.0 do Google. O frontend deve abrir essa URL com `window.top.location.href` (fora do iframe).
- **`GET /api/auth/google/callback`**
  - Endpoint público que recebe o `code` do Google, realiza a troca por tokens, armazena criptografado em `tenants.google_oauth_tokens` e redireciona para a tela de configurações do portal.
- **`GET /api/auth/google/status`**
  - Retorna o estado atual da conexão do Google Business Profile para o tenant autenticado.
- **`DELETE /api/auth/google/disconnect`**
  - Revoga os tokens e desconecta o canal.

### 2.3. Autenticação & Webhooks Meta (Facebook / Instagram)
- **`POST /api/meta/auth/connect` & `POST /api/meta/auth/callback`**
  - Gerencia o fluxo de autorização OAuth do Meta Graph API para coleta no Facebook e Instagram.
- **`POST /api/meta/webhook`**
  - Endpoint público para recebimento de webhooks em tempo real de menções e interações da Meta.

### 2.4. Envio de Mensagens e WhatsApp (Uazapi)
- **`POST /api/whatsapp/send`**
  - Dispara convite de avaliação ou notificação crítica via WhatsApp usando a API Uazapi.
  - **Payload:** `{ "number": "5511999999999", "text": "Olá...", "tenantId": "uuid" }`
  - **Retorno (200 OK):** `{ "ok": true, "messageId": "..." }`
- **`POST /api/whatsapp/test`**
  - Endpoint para envio de mensagem de teste de conectividade.

### 2.5. Central de Suporte & Agentic RAG
- **`POST /api/support/ticket`** — Cria novo chamado e dispara triagem automatizada com IA.
- **`GET /api/support/tickets`** — Lista chamados do tenant autenticado.
- **`GET /api/support/ticket/:id/messages`** — Retorna a thread de mensagens de um chamado.
- **`POST /api/support/ticket/:id/message`** — Envia mensagem do usuário/operador no chamado.
- **`PUT /api/support/ticket/:id/resolve`** — Marca o chamado como resolvido e aciona o `KnowledgeLearningService`.
- **`GET /api/support/kb/search`** — Realiza busca semântica em artigos da base de conhecimento (pgvector).
- **`POST /api/admin/support/*`** — Endpoints operacionais para moderar chamados e aprovar rascunhos de IA.

### 2.6. Billing & Webhooks (Asaas)
- **`GET /api/plans`** — Retorna a lista de planos e benefícios cadastrados.
- **`POST /api/asaas/webhook`** — Webhook público do Asaas para notificações de pagamento de assinaturas (Pix, Boleto, Cartão), renovando ou suspendendo licenças automaticamente.
- **`POST /api/billing/subscribe`** — Inicia a assinatura de um plano via checkout.

### 2.7. Widget de Reviews & Funil de Conversão
- **`POST /api/widget/token`** — Gera ou recupera o token de segurança (`widget_token`) do tenant.
- **`GET /api/widget/:businessId/reviews`** — Retorna avaliações elegíveis para exibição pública.
- **`GET /api/widget/script/:token`** — Serve o script JS dinâmico para embutir no site do cliente.
- **`POST /api/widget/event`** — Registra métricas no funil de conversão (`review_funnel`).

### 2.8. Módulo de Parceiros & Revendedores
- **`GET /api/partner/dashboard`** — Retorna KPIs agregados do parceiro (MRR, clientes ativos, comissões).
- **`GET /api/partner/clients`** — Lista os tenants vinculados ao parceiro.
- **`GET /api/partner/commissions`** — Lista extrato financeiro de comissões do parceiro.
- **`POST /api/admin/partners`** — Cadastra novo parceiro (apenas admin).
- **`PUT /api/admin/commissions/:id/status`** — Atualiza o status do pagamento da comissão.

### 2.9. Prospecção Outbound & Scoring Comercial
- **`POST /api/admin/prospects/*`** — Gestão de campanhas e leads de prospecção.
- **`GET /api/admin/commercial/*`** — Scoring e classificação comercial de empresas.

### 2.10. Relatórios Executivos em PDF
- **`POST /api/reports/generate`** — Consolida KPIs e gera arquivo PDF do relatório mensal.

---

## 3. Worker Background (Processamentos em Segundo Plano)

O backend executa um Worker unificado (`src/scheduler/index.ts`) que opera continuamente os seguintes serviços:

1. **Polling de Conectores (60s):** Busca registros na tabela `channel_connectors` onde `status = 'active'` e `next_sync_at <= now()`.
2. **Fila Atômica por Lock Distribuído:** Utiliza o procedimento `claim_review_jobs` com `FOR UPDATE SKIP LOCKED` para evitar que múltiplos workers processem o mesmo job.
3. **Execução dos 8 Conectores:** Dispara a classe responsável por cada canal: Google Maps, TripAdvisor, Consumidor.gov, Trustpilot, Reddit, Facebook, Instagram, Reclame Aqui.
4. **Pipeline de Ingestão (`src/lib/ingest.ts`):** 
   - Executa `upsert` na tabela `reviews` com base na constraint `(external_id, channel, tenant_id)`.
   - Armazena o JSON completo na coluna `raw_data`.
5. **Análise de Sentimento em Batch (`src/lib/sentiment.ts`):** 
   - Processa novas avaliações com o Gemini 2.5 Flash respeitando os limites da cota (`gemini-rate-limiter.ts`).
6. **Watchdog de Saúde e Conectores Travados:**
   - Detecta conectores travados no estado `running` e aplica reset automático com geração de alertas (6h, 24h, 48h, 72h).
   - O `system-health-job.ts` avalia a saúde operacional dos jobs e notifica os operadores.
7. **Jobs Estratégicos Regulares:**
   - `reputationScore.ts`: Recalcula diariamente o Reputation Score (0–1000).
   - `prescriptiveAnalysis.ts`: Gera recomendações estratégicas com IA.
   - `benchmark-snapshot-job.ts`: Atualiza os snapshots de concorrentes locais.
   - `commissions-job.ts`: Processa as comissões mensais dos parceiros.
   - `monthly-reports-job.ts`: Gera os relatórios PDF mensais.

---

## 4. Segurança, Validação e Resiliência

- **Validação com Zod:** Todos os payloads recebidos pelos endpoints são validados estruturalmente. Falhas devolvem HTTP `400 Bad Request`.
- **Autenticação Rigorosa:** Requisições sem token Bearer JWT (exceto webhooks públicos e script do widget) retornam imediatamente `401 Unauthorized`.
- **Controle de Cotas de IA:** Acompanhamento de consumo por tenant em `tenant_ai_quotas_and_logs`.
- **Resiliência a Falhas do Supabase/APIs Externas:** Logs estruturados salvos em `sync_jobs.error_detail` e retentativas configuradas.
