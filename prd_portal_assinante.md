# Product Requirements Document (PRD) — Portal do Assinante (Reputei)
*Documentação técnica da interface do assinante, navegação e integração com serviços*

## 1. Visão Geral do Produto

O **Portal do Assinante** (localizado no diretório `portal/`) é a interface central "Client-Facing" do Reputei. É um painel web multi-tenant desenvolvido em React, Vite e Vanilla CSS, onde as empresas monitoram sua reputação online em 8 canais (Google Maps, TripAdvisor, Facebook, Instagram, Reclame Aqui, Consumidor.gov, Trustpilot e Reddit).

**Arquitetura e Segurança:**
- O Portal do Assinante é **totalmente separado** do Painel Administrativo Operacional (`admin/`) e do Portal do Parceiro (`partner/`).
- O isolamento de dados é estritamente garantido via Row Level Security (RLS) no Supabase através da chave anônima (`anon_key`) e do token JWT do usuário autenticado.
- O assinante gerencia ativamente suas conexões de canais sociais e de busca na tela de **Meu Perfil / Configurações (Settings)**, que inclui a autorização OAuth do **Google Business Profile (Google Maps)** e da **Meta (Facebook/Instagram)**.

---

## 2. Autenticação e Controle de Acesso

- **Login & Onboarding:** Autenticação por e-mail e senha. Novos usuários passam pelo fluxo de onboarding para registro dos dados da empresa e primeiro conector.
- **Trial Expired:** Tela de bloqueio (`TrialExpired.tsx`) exibida automaticamente caso o período de teste de 7 dias expire sem a contratação de um plano ativo.
- **Isolamento Multi-tenant:** Filtro automático pelo `tenant_id` atrelado ao `auth.uid()` do usuário via RLS (`auth_tenant_id()`).
- **Visão Agência / Parceiro:** Usuários com perfil de agência/parceiro contam com um seletor no topo da barra lateral para alternar rapidamente a visão entre os clientes da sua carteira.

---

## 3. Estrutura de Navegação e Módulos (Sidebar)

### 3.1. Visão Geral (Dashboard)
- **Recursos:** Reputation Score em destaque (0–1000 com classificação qualitativa), nota média por canal, total de avaliações, distribuição de sentimento (positivo, neutro, negativo e crítico) e nuvem de tópicos recorrentes.
- **Gráficos:** Evolução temporal de reviews e tendências de sentimento produzidas com Recharts.

### 3.2. Reviews (Avaliações)
- **Recursos:** Tabela e grid interativo com todas as avaliações normalizadas coletadas.
- **Filtros Avançados:** Filtro por canal de origem, nota (1 a 5 estrelas), período e sentimento.
- **IA "Sugerir Resposta":** Reviews classificados como `negative` ou `critical` exibem o resumo da IA (`sentiment_summary`) e o botão **"Sugerir Resposta"**, que invoca o Gemini 2.5 Flash para gerar uma resposta empática e profissional adaptada ao problema.

### 3.3. Alertas
- **Recursos:** Fila de trabalho com notificações de eventos críticos (ex: quedas bruscas na média de notas, surtos de insatisfação ou termos ofensivos).
- **Ações:** Botões para resolver o alerta, visualizar a avaliação correspondente e gerenciar regras de notificação por E-mail e WhatsApp.

### 3.4. IA Copilot (Reputei IA)
- **Recursos:** Interface de chat interativo. O copiloto responde a perguntas sobre a reputação da empresa extraindo o contexto do banco de dados (estatísticas dos últimos 30 dias, principais temas de insatisfação e reviews críticos).
- **Modelo:** Gemini 2.5 Flash operando com contexto customizado do tenant.

### 3.5. Benchmarking Local
- **Recursos:** Análise comparativa da empresa monitorada contra concorrentes diretos da região.
- **Snapshots:** Leitura da tabela `benchmark_snapshots`, exibindo comparativo de nota média e volume no Google Maps.

### 3.6. Widget Site (Selos & Avaliações)
- **Recursos:** Ferramenta para personalização e incorporação de widgets de reputação no site do assinante.
- **Segurança:** Autenticação via `widget_token` com RLS restrito.
- **Personalização:** Escolha de tema (claro/escuro), filtro de nota mínima e código `<script>` pronto para cópia.
- **Funil de Conversão:** Acompanhamento de acessos e cliques no widget via `review_funnel`.

### 3.7. Gerar Reviews (Campanhas WhatsApp)
- **Recursos:** Ferramenta para solicitação de avaliações a clientes finais via WhatsApp.
- **Filtro de Sentimento:** Clientes satisfeitos são encaminhados para publicar no Google Maps / TripAdvisor; opiniões insatisfeitas são retidas internamente.
- **Integração Uazapi:** Disparo direto de mensagens via `POST /api/whatsapp/send`.

### 3.8. Relatórios Executivos
- **Recursos:** Central de geração e download de relatórios mensais consolidados em PDF com gráficos de sentimento e indicadores estratégicos.

### 3.9. Planos & Checkout (Pricing)
- **Recursos:** Tabela de planos ativas e checkout transparente integrado ao Asaas.
- **Pagamentos:** Suporte a cobrança por Pix (com QR Code estático/dinâmico), Cartão de Crédito e Boleto Bancário.

### 3.10. Central de Suporte (Helpdesk & Agentic RAG)
- **Recursos:** Formato de abertura de chamados de suporte técnico.
- **Deflexão Inteligente com RAG:** Antes do envio do formulário, a busca vetorial (pgvector) pesquisa artigos na base de conhecimento (`support_knowledge_docs`) e sugere soluções imediatas.
- **Atendimento e CSAT:** Acompanhamento da thread de mensagens e campo de avaliação de satisfação (CSAT) após a resolução.

### 3.11. Meu Perfil (Settings & Integrações)
- **Dados da Conta:** Alteração de nome, e-mail da empresa e CNPJ.
- **Segurança:** Alteração de senha de acesso.
- **Integração Google Business Profile (Google Maps):** Card dedicado com botão **"Conectar Google Business Profile"** (executa OAuth via `window.top.location.href`), exibindo o status de conexão e data de sincronização.
- **Integração Meta (Facebook & Instagram):** Card com fluxo OAuth Meta Graph API para autorização de páginas e mídias sociais.

---

## 4. Requisitos de UI/UX e Boas Práticas

- **Notificações em Tela:** Banners estilo Toast para feedback visual em operações.
- **Atalho de Painel Operacional:** Usuários internos com papéis de `admin` ou `operador` visualizam um botão estilizado na barra lateral para navegação direta ao Painel Operacional Administrativo.
