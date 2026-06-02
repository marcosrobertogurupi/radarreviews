# PRD — Radar de Reviews (Reputei)
**Documento de Requisitos do Produto**  
*SaaS Multi-tenant para Monitoramento e Gestão de Reputação Online*  
**Última Atualização:** 2026-05-25  

---

## 1. Visão Geral do Produto

O **Radar de Reviews (Reputei)** é um SaaS multi-tenant de monitoramento de reputação online. O sistema coleta avaliações (reviews), menções e reclamações de múltiplos canais (plataformas digitais e governamentais), normaliza estes dados em um banco de dados unificado, realiza análise de sentimentos inteligente e enriquecimento de dados via Inteligência Artificial (Google Gemini) e fornece painéis analíticos consolidados e ferramentas de resposta para as empresas assinantes.

### 1.1 Proposta de Valor
Ajudar empresas B2C e marcas a monitorarem de forma centralizada o feedback de seus clientes, automatizarem o processo de suporte técnico com IA de ponta (Agentic RAG) e agirem rapidamente diante de crises reputacionais (alertas de sentimentos e surtos de críticas).

---

## 2. Atores do Sistema

- **Assinante (Tenant):** Empresas cadastradas no sistema que monitoram suas marcas. Possuem acesso ao portal do assinante para ver dashboards, cadastrar conectores, responder reviews, receber e configurar alertas, e interagir com o suporte.
- **Usuário do Assinante:** Funcionários autorizados com diferentes permissões (`owner`, `admin`, `viewer`).
- **Administrador / Operador do Reputei:** Equipe interna do SaaS que gerencia os tenants, monitora a integridade operacional dos conectores (jobs), revisa a base de conhecimento auto-aprendiz e resolve tickets de suporte complexos de nível L2/L3.
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
- **IA Primária:** Google Gemini 2.5 Flash (`@google/generative-ai`) para análise de sentimentos e interações do copilot
- **IA de Embedding:** Gemini `text-embedding-004` (vetor de 768 dimensões)
- **Testes:** `vitest`
- **Validação de Schemas:** `zod` para entrada e saída de APIs
- **Frontend Admin:** React + Vite + Recharts (acesso via service_role restrito internamente)
- **Frontend Portal:** React + Vite + Vanilla CSS (acesso via anon key + RLS)

---

## 4. Requisitos Funcionais por Módulo

### 4.1 Ingestão e Conectores
O sistema deve sincronizar periodicamente dados de 8 canais diferentes:

1. **Google Maps (`google_maps`):** Coleta via Google Places API (New), com limite de 5 reviews mais recentes por requisição.
2. **TripAdvisor (`tripadvisor`):** Coleta via Content API v2, com suporte a paginação baseada em `offset` para histórico completo.
3. **Consumidor.gov (`consumidor_gov`):** Ingestão via dados abertos (arquivos CSV mensais do portal dados.gov.br). O sistema faz o download automático, parseia via `csv-parse`, filtra pelo CNPJ das empresas monitoradas e gera ID externo único via hash SHA-256 da composição de CNPJ, Data de Abertura e Descrição.
4. **Trustpilot (`trustpilot`):** Coleta via Consumer API v1 (leitura pública sem auth) utilizando a API Key do portal de desenvolvedores da Trustpilot.
5. **Reddit (`reddit`):** Busca menções públicas com base em palavras-chave. Suporta o modo público (MVP sem credenciais via endpoints JSON públicos) e modo autenticado (OAuth2 Client Credentials pós-aprovação do Reddit).
6. **Facebook (`facebook`):** Busca avaliações públicas na página autorizada via Meta Graph API utilizando tokens de acesso de página armazenados no Vault.
7. **Instagram (`instagram`):** Busca comentários em mídias sociais usando Instagram Graph API, aplicando filtro de palavras-chave configuradas para capturar feedbacks e sugestões.
8. **Reclame Aqui (`reclame_aqui`):** Coleta de reclamações públicas da página da empresa, utilizando API de parceiro ou raspagem via Playwright.

#### Regras de Ingestão:
- **Deduplicação Obrigatória:** Inserções na tabela `reviews` devem usar cláusula `ON CONFLICT` com a constraint composta `(channel, external_id)`.
- **Preservação de Dados:** O payload bruto (JSON) retornado por qualquer API de canal deve ser integralmente armazenado na coluna `raw_data` da tabela `reviews`.
- **Log de Execução:** Toda execução de job de sincronização deve registrar na tabela `sync_jobs` (data de início, fim, quantidade de reviews lidos, novos e atualizados, e logs de erro).
- **Atualização do Status do Conector:** Ao final de cada execução de job, as colunas `last_sync_at`, `next_sync_at` (com base no intervalo de polling do canal) e `status` (active / error) devem ser atualizadas na tabela `channel_connectors`.

### 4.2 Análise de Sentimento (IA)
Logo após a ingestão de uma avaliação ou comentário, o pipeline aciona o serviço de análise de sentimentos:
- **Modelo:** Google Gemini 2.5 Flash como motor principal.
- **Fallback Heurístico:** Heurística baseada em léxico de termos negativos/positivos para garantir funcionamento se a API Gemini estiver indisponível.
- **Dados Gerados:**
  - `sentiment`: `positive` | `neutral` | `negative` | `unanalyzed`
  - `sentiment_score`: valor contínuo entre -1.0 (extremamente negativo) e 1.0 (extremamente positivo).
  - `dissatisfaction_score` (opcional): pontuação de insatisfação de 0 a 100 para detecção rápida de crises.
  - `sentiment_topics`: temas detectados no review (ex: "atendimento", "preço", "lentidão").
  - `sentiment_summary`: resumo conciso gerado pela IA.

### 4.3 Alertas
Os assinantes podem cadastrar regras customizadas para receber notificações de eventos críticos:
- **Regras baseadas em:** Queda na média de notas (`rating_drop`), surto de volume de reviews (`volume_spike`), surto de reviews negativos (`negative_surge`) ou presença de palavras-chave (`keyword`).
- **Canais de Disparo:** E-mail (webhook de envio) e Webhooks customizados do tenant.

### 4.4 Central de Suporte e Helpdesk (Multi-tenant)
O Reputei possui um sistema de tickets de suporte interno, permitindo que assinantes abram chamados para tirar dúvidas ou relatar problemas com os conectores:
- **Fluxo de Estados (Tickets):** `open` ➔ `ai_triaged` ➔ `in_progress` ➔ `waiting_tenant` ➔ `escalated` ➔ `resolved` ➔ `closed` (além de `reopened`).
- **Prioridades:** `low` | `medium` | `high` | `critical`.
- **SLA Dinâmico:** SLA calculado na criação com base na prioridade e plano do tenant (regras na tabela `ticket_sla_rules`).
- **Trilha de Auditoria:** Cada modificação em tickets (mudança de status, prioridade, atribuição, alertas de SLA) deve gravar um registro imutável na tabela `ticket_audit_log`.

### 4.5 Agentic RAG de Suporte (Atendimento Autônomo)
O helpdesk conta com uma camada de atendimento automático inteligente baseada em Agentic RAG:
1. **Perceber:** Classificação inicial do ticket aberto usando Gemini 2.5 Flash (triagem e sentimento).
2. **Recuperar:** Busca semântica por similaridade de cosseno usando embeddings (pgvector) gerados pelo Gemini `text-embedding-004` contra a tabela `support_knowledge_docs`.
3. **Raciocinar e Agir:** A IA avalia o nível de similaridade encontrado e se classifica em um dos 3 Tiers de confiança:
   - **T1 - Alta Confiança (>= 0.85):** A IA envia a resposta automaticamente para o assinante e define o status do ticket como `ai_responding`.
   - **T2 - Confiança Média (0.65 a 0.84):** A IA gera um rascunho de resposta (`ai_draft_response`), mas não o envia. O rascunho é mostrado em destaque para o operador humano no painel administrativo, que pode revisá-lo e enviá-lo com 1 clique.
   - **T3 - Baixa Confiança (< 0.65):** O ticket é encaminhado diretamente para a fila de atendimento humano sem ação automática da IA.
4. **Ciclo de Aprendizado (Auto-Aprendiz):** Ao fechar um ticket resolvido (seja resolvido por humano ou por IA assistida), o job `KnowledgeLearningService` extrai o par problema-solução da thread, gera um JSON estruturado com o Gemini e:
   - Cria um novo artigo com status `draft` na base de conhecimento (`support_knowledge_docs`), gerando seu embedding vetorial.
   - Ou enriquece um artigo já existente (se a similaridade com o problema for >= 0.80), adicionando variações de termos e atualizando contadores.
   - Documentos com avaliação CSAT >= 4.0 do cliente ou com mais de 3 utilizações bem-sucedidas são publicados automaticamente como `active`.

---

## 5. Requisitos Não Funcionais

### 5.1 Segurança e Isolamento (Multi-tenancy)
- **Row Level Security (RLS):** Todas as tabelas principais devem ter RLS habilitado.
- **Função Auxiliar RLS:** Filtro de registros feito via helper no banco `auth_tenant_id()`, garantindo que um tenant nunca tenha acesso aos dados de outro.
- **Tokens e Secrets:** Tokens sensíveis de APIs externas (Facebook, Instagram, etc.) **nunca** devem ser guardados no código ou em texto claro no banco. Devem usar o **Supabase Vault** (`vault_secret_id` na tabela `channel_connectors`). Secrets do sistema ficam no arquivo `.env`.
- **Permissões do Client do Supabase:** O portal do assinante deve utilizar estritamente a chave anônima (`anon_key`). A chave `service_role_key` deve ser usada de forma restrita e segura apenas no backend/scheduler.

### 5.2 Performance e Escalabilidade
- **Índices de Banco:** Criar índices para chaves estrangeiras comumente filtradas (`tenant_id`, `business_id`) e na coluna de agendamento do scheduler (`next_sync_at` parcial para conectores ativos).
- **Índice HNSW:** Para busca semântica veloz, os embeddings vetoriais devem utilizar índice HNSW (`idx_kb_embeddings_hnsw`) otimizado para operações de distância de cosseno.
- **Stats Diárias Pré-computadas:** O dashboard de KPIs e gráficos de tendências do portal e admin deve ler dados pré-agregados da tabela `review_stats_daily` (atualizada por jobs diários e trigger de ingestão), evitando buscas custosas de agregação em tempo de renderização na tabela `reviews`.

---

## 6. Layouts e Interfaces (Requisitos de UI/UX)

O sistema possui duas interfaces web independentes construídas com React, Vite e Vanilla CSS, com design premium, transições suaves, gráficos interativos e suporte a temas.

### 6.1 Painel do Administrador (Admin)
- **Dashboard Operacional:** KPIs de saúde dos conectores, quantidade de erros recentes, volume global de reviews ingeridos por canal e estatísticas gerais de suporte (tempo de resposta, tickets abertos, CSAT médio).
- **Gerenciador de Conectores:** Listagem global de conectores instalados por tenant, status atual (active, error, pending_auth), histórico de execuções (sync_jobs) e opção de forçar sincronização manual.
- **Fila de Suporte:** Listagem avançada de tickets com flags de SLA próximo do estouro, tickets escalados e rascunhos de IA pendentes de aprovação.
- **Gerenciador de Base de Conhecimento (KB):** Painel para revisão manual de artigos em `draft` gerados pela IA, edição e simulação de perguntas/respostas para testar a acurácia do RAG.
- **Visualizador de Auditoria (Audit):** Linha do tempo técnica para visualizar o histórico de eventos de suporte e auditoria do SaaS.

### 6.2 Portal do Assinante
- **Dashboard de Reputação:** Gráficos de evolução de avaliações, média de notas (rating) por canal e distribuição do sentimento (positivo, neutro, negativo).
- **Lista de Reviews:** Visualização em grid das avaliações normalizadas. Para reviews classificados como negativos ou críticos (alto dissatisfaction score), exibir o resumo de sentimento gerado pela IA e o botão "Sugerir Resposta" (chama o Gemini para redigir uma sugestão de resposta contextualizada de forma empática).
- **Painel de Chamados (Suporte):** Abertura fácil de chamados com widget de deflexão (busca na KB e exibe artigos antes de permitir o envio do formulário). Histórico de chamados com chat interativo e campo para notas de satisfação (CSAT).
- **Copilot IA (Suporte):** Chatbot flutuante inteligente disponível no portal para sanar dúvidas imediatas dos clientes usando a KB e informações da conta.

---

## 7. Roadmap e Funcionalidades Pendentes

1. **Planos e Faturamento (Billing):** Integração com gateway de pagamentos baseado nas definições de planos (Starter, Pro, Enterprise).
2. **Onboarding Self-service:** Fluxo assistido e intuitivo para o novo assinante cadastrar a empresa e autenticar seus primeiros conectores sem suporte humano.
3. **Notificações por E-mail:** Envio de alertas de reviews e notificações de tickets por e-mail (usando template de e-mail e SMTP).
