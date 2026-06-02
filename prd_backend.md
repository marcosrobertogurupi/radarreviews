# Product Requirements Document (PRD) — Backend & APIs (Reputei)
*Documentação direcionada para testes automatizados e integração E2E via spriteTest*

## 1. Visão Geral da Arquitetura
O Backend do Radar de Reviews (Reputei) opera principalmente como uma ponte de serviços, processamento de inteligência artificial e orquestrador de coletas assíncronas. O banco de dados é um **Supabase (PostgreSQL)**, sendo grande parte do CRUD tradicional (como listagens no dashboard) resolvida via cliente Supabase e RLS direto pelo frontend.

Por isso, este backend em Node.js (executado na porta `3001` no ambiente dev) foca em:
- **Tarefas Assíncronas (Cron Jobs / Polling):** Coleta de avaliações em 8 canais diferentes a cada 60 segundos.
- **Processamento Pesado:** Ingestão, deduplicação (`upsert`), e análise de sentimento via Google Gemini 2.5 Flash.
- **Endpoints Exclusivos:** Rotas HTTP dedicadas para Integrações (Webhooks, Asaas), envio de mensagens ativas (WhatsApp) e Inteligência Artificial (Copilot).

**Importante para Testes:** 
- Nenhuma rota da API retorna páginas HTML (exceto scripts de widget e fallbacks de erro/404). Todas retornam payloads JSON estruturados.
- Quase todas as rotas exigem header `Authorization: Bearer <supabase-jwt>` gerado via Supabase Auth.

## 2. Endpoints da API HTTP

### 2.1. Inteligência Artificial (Copilot)
- **Endpoint:** `POST /api/copilot`
- **O que faz:** Recebe uma pergunta gerencial do usuário (ex: "O que estão falando mal do meu negócio?") e o histórico de mensagens, recupera o contexto do banco de dados (estatísticas dos últimos 30 dias, reviews negativos, etc) e invoca a API do Gemini.
- **Retorno Esperado (200 OK):** `{ "reply": "string_com_a_resposta_em_markdown" }`
- **Validação E2E:** Disparar um POST válido com token de assinante e verificar se a API retorna uma string formatada como resposta da IA.

### 2.2. Disparo de Campanhas (WhatsApp)
- **Endpoint:** `POST /api/whatsapp/send`
- **O que faz:** Inicia o processo de envio de uma mensagem de convite de review para um cliente final via WhatsApp, usando a API de parceiro (Uazapi).
- **Body Esperado:** `{ "number": "5511999999999", "text": "Olá...", "tenantId": "uuid" }`
- **Retorno Esperado:** 
  - `200 OK`: `{ "ok": true, "messageId": "..." }`
  - `400 / 401 / 403`: Falhas de validação de limite de envios do plano ou sem autenticação.
- **Validação E2E:** Testar bloqueio de token inválido (`401`) e submissão bem-sucedida (`200`).

### 2.3. Helpdesk (Suporte ao Assinante)
- **Endpoint:** `POST /api/support/ticket`
  - **Cria** um chamado de suporte e o classifica com IA (urgência/tom).
- **Endpoint:** `GET /api/support/tickets?tenantId=uuid`
  - **Lista** chamados do cliente autenticado.
- **Endpoint:** `GET /api/support/ticket/:id/messages`
  - **Lê** o histórico de um chamado.
- **Endpoint:** `POST /api/support/ticket/:id/message`
  - **Envia** resposta/interação em um chamado aberto.
- **Endpoint:** `PUT /api/support/ticket/:id/resolve`
  - **Fecha** o chamado.

### 2.4. Gestão e Billing
- **Endpoint:** `GET /api/plans`
  - Retorna a lista de planos ativos extraídos da configuração estática ou do BD.
- **Endpoint:** `POST /api/asaas/webhook`
  - **Acesso:** Livre (Webhook do Asaas).
  - Recebe atualizações de pagamento via Pix/Cartão, renovando ou suspendendo licenças de `tenants`.

### 2.5. Integrações Sociais (Meta)
- **Endpoints:** `POST /api/meta/auth/connect`, `POST /api/meta/auth/callback`
  - Lida com a ponte OAuth do Facebook Graph API para coleta no Instagram e Facebook.
- **Endpoint:** `POST /api/meta/webhook`
  - Ouve eventos sociais e menções ao vivo da plataforma Meta.

### 2.6. Widget e Relatórios Executivos
- **Endpoint:** `GET /api/widget/:businessId/reviews`
  - Rota não-autenticada para ser injetada no `<script>` do site do cliente. Retorna JS/HTML.
- **Endpoint:** `POST /api/reports/generate`
  - Gera em tempo real um PDF analítico consolidando KPIs de sentimento e notas.

## 3. Worker Background (Processamentos em Segundo Plano)

O backend possui um Worker (`src/scheduler/index.ts`) cujo loop contínuo é imperativo para a plataforma:

1. **Agendamento (Polling):** A cada 60s, busca conectores na tabela `channel_connectors` onde `status = 'active'` e `next_sync_at <= now()`.
2. **Coleta Externa:** Dispara as classes (scrapers ou wrappers de API) dos 8 canais suportados:
   - Google Maps, TripAdvisor, Consumidor.gov, Trustpilot, Reddit, Facebook, Instagram, Reclame Aqui.
3. **Ingestão (`src/lib/ingest.ts`):** 
   - Insere na tabela `reviews` fazendo **Upsert** baseado na chave única (`channel`, `external_id`).
   - Salva o payload completo bruto original no campo `raw_data`.
4. **Análise de Sentimento (`src/lib/sentiment.ts`):** 
   - Manda as novas avaliações textuais em batch para a IA classificar entre `positive`, `neutral`, `negative` ou `critical`, e retorna um resumo qualitativo (`sentiment_summary`).
5. **Monitoramento de Alertas (`alert_rules`):**
   - Caso uma regra dispare (ex: nota 1), insere um registro na tabela `alert_events` e notifica o dono via Webhook ou Email (se configurado).
6. **Estatísticas (`pg_cron` no DB):**
   - As tabelas de dashboard leem da view materializada/tabela diária consolidada gerada para desafogar as queries.

## 4. Regras Absolutas e Testes Esperados
- **Validação de Inputs:** O back-end não deve "estourar" (`500`) com payload mal-formado. Requisições na API HTTP sem os devidos campos devem devolver `400 Bad Request` com o erro estruturado.
- **Segurança:** Sem um Bearer token válido (exceto Webhooks e Widget), todas as rotas devem responder imediatamente `401 Unauthorized`.
- **Deduplicação de Dados:** Inserir duas vezes o mesmo review (via simulação do ingestor) deve ser tratado como Upsert silencioso e não violar restrições do PostgreSQL nem inflar as métricas de contagem de avaliações.
