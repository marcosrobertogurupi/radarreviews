# PRD — Radar de Reviews (Reputei)
**Documento de Requisitos do Produto**  
*SaaS Multi-tenant para Monitoramento e Gestão de Reputação Online*  
**Última Atualização:** 2026-07-28  

---

## 1. Visão Geral do Produto

O **Radar de Reviews (Reputei)** é um SaaS multi-tenant de monitoramento de reputação online. O sistema coleta avaliações (reviews), menções e reclamações de múltiplos canais (plataformas digitais e governamentais), normaliza estes dados em um banco de dados unificado, realiza análise de sentimentos inteligente e enriquecimento de dados via Inteligência Artificial (Google Gemini) e fornece painéis analíticos consolidados e ferramentas de resposta para as empresas assinantes.

### 1.1 Proposta de Valor
Ajudar empresas B2C e marcas a monitorarem de forma centralizada o feedback de seus clientes, automatizarem o processo de suporte técnico com IA de ponta (Agentic RAG) e agirem rapidamente diante de crises reputacionais (alertas de sentimentos, surtos de críticas e notificações via WhatsApp/E-mail).

### 1.2 Identidade Visual

- **Logotipo oficial:** Radar estilizado com olho central (símbolo de vigilância e monitoramento), anéis concêntricos com mira e varredura, tipografia "reputei" em caixa baixa com o "i" final em ciano. Tagline: "— RADAR DE REVIEWS —".
- **Arquivo de referência:** `logo-reputei.png` (disponível em `admin/public/`, `portal/public/`, `partner/public/` e `website/public/`).
- **Paleta de cores:**
  - Roxo primário: `#863bff` / `#6366f1` (accent)
  - Ciano secundário: `#06b6d4` / `#47bfff` (accent-2)
  - Fundo escuro: `#0a0e1a` (bg-base)
  - Lilás claro: `#ede6ff` (highlights)
- **Tipografia da marca:** "reputei" em fonte arredondada, peso 800, minúsculas. "i" final com destaque ciano.
- **Uso no sistema:** O logotipo deve aparecer nas sidebars (portal, admin, parceiro), nas telas de login, na tela de trial expirado e na navbar do site institucional.

---

## 2. Atores do Sistema

- **Assinante (Tenant):** Empresas cadastradas no sistema que monitoram suas marcas. Possuem acesso ao portal do assinante para ver dashboards, cadastrar conectores, responder reviews, receber e configurar alertas, e interagir com o suporte.
- **Usuário do Assinante:** Funcionários autorizados com diferentes permissões (`owner`, `admin`, `viewer`).
- **Administrador / Operador do Reputei:** Equipe interna do SaaS que gerencia os tenants, monitora a integridade operacional dos conectores (jobs), revisa a base de conhecimento auto-aprendiz e resolve tickets de suporte complexos de nível L2/L3.
- **Parceiro (Revendedor):** Agências, consultores ou revendedores que distribuem o SaaS. Possuem portal próprio para gerenciar clientes indicados, acompanhar comissões (setup + recorrência) e cadastrar novos tenants.
- **Autor do Review (Externo):** O cliente final que publica um comentário no Google Maps, Reclame Aqui, TripAdvisor, etc.
- **IA do Sistema (Gemini):** Atua em duas frentes:
  1. Classificação, triagem e análise de sentimentos dos reviews ingeridos.
  2. Agente Autônomo de Suporte (Helpdesk) com base em RAG vetorial e ciclo de aprendizado.

---

## 3. Stack Tecnológica e Arquitetura

- **Runtime:** Node.js 20+ com TypeScript estrito (`strict: true`)
- **Banco de Dados:** Supabase (PostgreSQL 15+)
- **Extensões de Banco:** `uuid-ossp`, `pg_cron`, `pgsodium` (Supabase Vault), `vector` (pgvector para embeddings)
- **Cliente Supabase:** `@supabase/supabase-js` v2
- **IA Primária:** Google Gemini 2.5 Flash (`@google/generative-ai`) para análise de sentimentos, copilot e triagem
- **IA de Embedding:** Gemini `text-embedding-004` (vetor de 768 dimensões)
- **Testes:** `vitest`
- **Validação de Schemas:** `zod` para entrada e saída de APIs
- **Frontend Admin:** React + Vite + Recharts (acesso via service_role restrito internamente)
- **Frontend Portal:** React + Vite + Vanilla CSS (acesso via anon key + RLS)
- **Frontend Parceiro:** React + Vite + Vanilla CSS (portal dedicado a revendedores)
- **Infraestrutura:** Vercel (frontends), Railway (backend API + scheduler)
- **Email Transacional:** Brevo (via n8n webhook — `emailService.ts` + `n8n-email-workflow.json`)
- **Disparos WhatsApp:** API Uazapi (`src/services/whatsapp/uazapi.ts`) para convites de review e alertas críticos em tempo real
- **Gateway de Pagamento:** Asaas (`src/api/asaas-webhook.ts` + `src/lib/asaas.ts`) para checkout e cobrança recorrente

---

## 4. Requisitos Funcionais por Módulo

### 4.1 Ingestão e Conectores
O sistema sincroniza periodicamente dados de 8 canais diferentes:

1. **Google Maps (`google_maps`):** Coleta via Google Places API (New) / Google Business Profile API.
2. **TripAdvisor (`tripadvisor`):** Coleta via Content API v2, com suporte a paginação baseada em `offset` para histórico completo.
3. **Consumidor.gov (`consumidor_gov`):** Ingestão via dados abertos (CSV mensais dados.gov.br) com hash SHA-256 para ID externo único.
4. **Trustpilot (`trustpilot`):** Coleta via Consumer API v1 (leitura pública sem auth).
5. **Reddit (`reddit`):** Busca menções públicas por palavras-chave (JSON público e OAuth2 Client Credentials).
6. **Facebook (`facebook`):** Busca avaliações públicas via Meta Graph API com tokens armazenados no Vault.
7. **Instagram (`instagram`):** Busca comentários via Instagram Graph API com filtro de palavras-chave.
8. **Reclame Aqui (`reclame_aqui`):** Coleta de reclamações públicas via API de parceiro ou raspagem com Playwright.

#### Regras de Ingestão:
- **Deduplicação Obrigatória:** Inserções na tabela `reviews` utilizam `ON CONFLICT` com a constraint composta `(external_id, channel, tenant_id)` (Migration `appsec_hardening_2026_06_01`).
- **Lock Distribuído na Fila:** Procedimento armazenado `claim_review_jobs` com `FOR UPDATE SKIP LOCKED` evita condições de corrida entre workers.
- **Preservação de Dados:** Payload bruto (JSON) mantido integralmente em `raw_data`.
- **Log de Execução:** Histórico completo registrado em `sync_jobs`.
- **Atualização de Status:** `last_sync_at`, `next_sync_at` e `status` atualizados em `channel_connectors`.

### 4.2 Integração Google Business Profile (OAuth 2.0)
O portal do assinante permite conectar a conta Google Business Profile via OAuth 2.0 Authorization Code flow:

- **Fluxo de Endpoints:**
  1. `GET /api/auth/google/connect` — gera URL de autorização Google. O frontend executa a saída do iframe via `window.top.location.href`.
  2. `GET /api/auth/google/callback` — recebe o `code` de autorização, troca por `access_token` e `refresh_token`, salva de forma segura na coluna `tenants.google_oauth_tokens` e redireciona com `?google_connected=1`.
  3. `GET /api/auth/google/status` — retorna o status da conexão e a data de autorização.
  4. `DELETE /api/auth/google/disconnect` — revoga o token e remove a conexão.
- **Tokens:** Armazenados em `tenants.google_oauth_tokens` (texto JSON criptografado) e `tenants.google_oauth_connected_at`. Renovação automática de `access_token` via `refresh_token` na iminência de expiração.
- **Scopes:** `business.manage` + `userinfo.email`.

### 4.3 Análise de Sentimento (IA)
- **Modelo:** Google Gemini 2.5 Flash como motor principal (com fallback heurístico léxico).
- **Rate Limiting:** Controlado via `gemini-rate-limiter.ts` para conformidade com a cota da API.
- **Dados Gerados:**
  - `sentiment`: `positive` | `neutral` | `negative` | `critical` | `unanalyzed`.
  - `sentiment_score`: valor contínuo entre -1.0 e 1.0.
  - `dissatisfaction_score`: pontuação de insatisfação de 0 a 100.
  - `sentiment_topics`: temas detectados no review (ex: "atendimento", "preço").
  - `sentiment_summary`: resumo conciso gerado pela IA.

### 4.4 Reputation Score (0–1000)
Calculado para cada empresa (`monitored_businesses`) com base nos últimos 90 dias:
- Composto por: Rating médio (30%), Sentimento positivo (20%), Volume de reviews (10%), Taxa de resposta (10%), Resoluções Reclame Aqui (10%), Resoluções Consumidor.gov (10%) e Tendência 90 dias (10%).
- Resultados persistidos na tabela `reputation_scores`.

### 4.5 Análise Prescritiva com IA
- **Engine:** `prescriptiveAI.ts` e `prescriptiveAnalysis.ts`.
- **Entrada:** Agregados de `sentiment_topics` e `review_stats_daily` dos últimos 30 dias.
- **Saída:** Recomendações estratégicas salvas na tabela `prescriptive_insights` com categoria, urgência, contexto métrico e grau de confiança.

### 4.6 Alertas e Disparos Multi-canal
- **Gatilhos:** Queda de rating (`rating_drop`), surto de volume (`volume_spike`), surto de negatividade (`negative_surge`), palavra-chave (`keyword`) e falha de conectores.
- **Canais de Disparo:**
  - **E-mail:** Transacional via Brevo/n8n (`emailService.ts`).
  - **WhatsApp:** Notificações em tempo real via Uazapi (`uazapi.ts`).
  - **Webhooks:** Payloads JSON POST customizados por tenant.

### 4.7 Relatórios Mensais em PDF
- Scheduler gera relatórios executivos de reputação mensalmente via `monthly-reports-job.ts` e endpoint `POST /api/reports/generate`.

### 4.8 Benchmarking Local
- Comparativo com concorrentes locais monitorados. Dados salvos na tabela `benchmark_snapshots` via `benchmark-snapshot-job.ts`.

### 4.9 Widget de Geração de Reviews e Funil de Conversão
- **Token de Segurança:** Autenticação via `widget_token` com RLS restrito (`034_widget_columns_and_rls.sql`).
- **Snippet:** `<script src=".../api/widget/:token/script.js">` para inserção em sites.
- **Filtro de Sentimento:** Clientes satisfeitos são direcionados para Google/TripAdvisor/Trustpilot; insatisfeitos são capturados internamente.
- **Funil de Conversão:** Eventos salvos em `review_funnel` (views, clicks, reviews gerados).

### 4.10 Central de Suporte e Helpdesk Multi-tenant
- Estados: `open` ➔ `ai_triaged` ➔ `in_progress` ➔ `waiting_tenant` ➔ `escalated` ➔ `resolved` ➔ `closed`.
- SLA Dinâmico via tabela `ticket_sla_rules`.
- Trilha de Auditoria imutável em `ticket_audit_log`.

### 4.11 Agentic RAG de Suporte (Atendimento Autônomo)
- Triagem inicial via Gemini Flash 2.5 + busca vetorial pgvector (`support_knowledge_docs`).
- Tiers de Confiança: T1 (>=0.85 Resposta Auto), T2 (0.65-0.84 Rascunho IA para Humano), T3 (<0.65 Encaminhamento Humano).
- Ciclo Auto-aprendiz via `KnowledgeLearningService` ao resolver chamados.

### 4.12 Módulo de Parceiros (Revendedores)
- Cadastro de parceiros (`partners`) com taxas de comissão para setup e recorrência.
- Extrato financeiro imutável registrado na tabela `commissions_log`.
- Impersonation/SSO para acesso rápido aos tenants vinculados.
- Portal exclusivo do parceiro (`partner/src/pages/`) com 19 telas operacionais.

### 4.13 Sistema de Prospecção Outbound e Commercial Scoring
- Campanhas de prospecção (`prospect_campaigns`), enriquecimento de leads (`prospect_leads`), fila de follow-ups (`prospect_followup_queue`) e scoring comercial de empresas (`commercial_channel_scores`).

### 4.14 Telemetria, Quotas e Saúde do Sistema
- **System Health Watchdog:** `system-health-job.ts` avalia taxa de erro de conectores e envia alertas aos administradores do SaaS.
- **Watchdog de Conectores Travados:** Regras de descontinuação de conectores travados em 'running' com alertas escalonados (6h, 24h, 48h, 72h).
- **Resource Usage Telemetry:** Tabela `resource_usage_telemetry` para monitoramento de custos de infraestrutura.
- **AI Quotas & Logs:** Tabela `tenant_ai_quotas_and_logs` para acompanhamento de uso e limites por tenant.

### 4.15 Billing e Checkout via Asaas
- Gerenciamento de assinaturas via gateway Asaas (`src/api/asaas-webhook.ts` + `src/lib/asaas.ts`).
- Suporte a pagamentos por Pix, Cartão de Crédito e Boleto Bancário.

---

## 5. Requisitos Não Funcionais

### 5.1 Segurança e Isolamento (Multi-tenancy)
- RLS em todas as tabelas principais com a função `auth_tenant_id()`.
- Secrets OAuth e tokens externos armazenados no **Supabase Vault** (`vault_secret_id`). Tokens Google OAuth criptografados em `tenants.google_oauth_tokens`.
- Chave anônima (`anon_key`) no frontend e `service_role` estritamente no backend.

### 5.2 Performance e Escalabilidade
- Índices HNSW para pgvector (`idx_kb_embeddings_hnsw`).
- Tabela pré-agregada `review_stats_daily` mantida via triggers e jobs diários.
- Fila atômica com `claim_review_jobs` (`FOR UPDATE SKIP LOCKED`).

---

## 6. Layouts e Interfaces

### 6.1 Painel do Administrador (Admin)
- Dashboard Operacional, Gerenciador de Conectores, Fila de Suporte, Base de Conhecimento (KB), Auditoria, Planos, Scoring Comercial, Campanhas de Prospecção e Gestão de Comissões.

### 6.2 Portal do Assinante
- Dashboard de Reputação, Lista de Reviews (com IA "Sugerir Resposta"), Benchmarking, Widget Site (Customização e Script Token), Gerar Reviews (WhatsApp), Alertas, Relatórios PDF, Suporte/Helpdesk com RAG, Copilot IA, Checkout Asaas e Configurações (com Google OAuth e Meta OAuth).

### 6.3 Portal do Parceiro
- Portal dedicado para revendedores com 19 telas (Dashboard MRR, Clientes, Extrato de Comissões, Wizard de Registro, Suporte, Benchmarking, Reviews e Configurações).

---

## 7. Planos e Preços Praticados

| Slug | Nome | Preço Mensal | Canais Permitidos | Descrição / Principais Benefícios |
|---|---|---|---|---|
| `trial` | Trial | R$ 0,00 | 3 | Avaliação gratuita de 7 dias. |
| `basico` | Básico | R$ 289,00 | 3 | Negócios locais. 500 reviews/mês, Google Maps & TripAdvisor, alertas e relatórios. |
| `completo` | Completo | R$ 459,00 | 8 | Monitoramento total + IA. Reviews ilimitados, todos os canais, Copilot IA, WhatsApp. |
| `custom` | Custom | R$ 389,00 | 4 | Flexibilidade para marcas. Atender até 4 canais escolhidos sob demanda. |
| `enterprise` | Enterprise | R$ 1.500,00 | 999 | Escala máxima. Canais ilimitados, SLA garantido, Webhooks, suporte dedicado 24/7. |

---

## 8. Roadmap e Funcionalidades Futuras

1. **Onboarding Self-service 100% Autônomo:** Fluxo guiado sem assistência humana para novos assinantes configurarem marca e primeiros conectores.
2. **API Pública REST com API Keys:** Autenticação e webhooks públicos para tenants Enterprise consumirem dados diretamente.
3. **Notificações por SMS:** Canal secundário para alertas críticos de infraestrutura.
