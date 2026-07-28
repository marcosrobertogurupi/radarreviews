# Product Requirements Document (PRD) — Módulo de Parceiros (Reputei)
*Documentação do portal de revendedores, regras de comissionamento e arquitetura de integração*

## 1. Visão Geral do Produto

O **Módulo de Parceiros do Reputei** permite que agências de marketing, consultores de negócios e revendedores atuem como canais oficiais de distribuição do SaaS. Cada parceiro cadastrado tem acesso a um portal dedicado (`partner/`), onde pode gerenciar os assinantes de sua carteira (tenants), cadastrar novos clientes via wizard, acompanhar suas comissões de taxa de setup e recorrência mensal, utilizar recursos de reputação para seus clientes e visualizar o extrato financeiro.

---

## 2. Estrutura das Páginas do Portal do Parceiro (`partner/src/pages/`)

O Portal do Parceiro é uma aplicação completa composta por 19 telas organizadas para atender à gestão comercial e técnica dos clientes indicados:

1. **`Login.tsx`:** Tela de autenticação exclusiva para revendedores e parceiros.
2. **`Dashboard.tsx`:** Visão geral de KPIs: MRR gerado, total de clientes ativos, comissões do mês corrente e acumulado histórico.
3. **`Clients.tsx`:** Lista dos clientes (tenants) vinculados com botão de acesso rápido via SSO/Impersonation.
4. **`ClientNew.tsx`:** Wizard de cadastro de um novo assinante pelo parceiro (dados da empresa, plano escolhido e permissões).
5. **`Commissions.tsx`:** Extrato financeiro detalhado com status de cada comissão (Pendente, Aprovado, Pago, Cancelado).
6. **`Profile.tsx`:** Cadastro do parceiro (dados da empresa, tipo de parceiro, tier e chave Pix para recebimento).
7. **`Settings.tsx`:** Configurações de acesso, segurança e preferências da conta do parceiro.
8. **`Reviews.tsx`:** Visualização centralizada das avaliações dos clientes da carteira.
9. **`Alerts.tsx`:** Painel de acompanhamento de alertas disparados nos clientes indicados.
10. **`Benchmarking.tsx`:** Análise comparativa de concorrência dos clientes do parceiro.
11. **`GenerateReviews.tsx`:** Ferramenta para iniciar campanhas de coleta de reviews para os clientes.
12. **`Widget.tsx`:** Gerenciador e customizador do widget de avaliações dos clientes.
13. **`Reports.tsx`:** Emissão e visualização de relatórios de desempenho da carteira.
14. **`Pricing.tsx`:** Tabela comparativa de planos e opções para alteração de plano dos clientes.
15. **`Support.tsx`:** Central de abertura de chamados de suporte técnico direto com o time do Reputei.
16. **`Copilot.tsx`:** Assistente virtual inteligente com foco em tirar dúvidas comerciais e técnicas do parceiro.
17. **`Onboarding.tsx`:** Guia interativo de boas-vindas com o passo a passo para o parceiro começar a vender.
18. **`TrialExpired.tsx`:** Tela de aviso para retenção/regularização do parceiro.
19. **`Prospects.tsx`:** Módulo complementar de visualização de leads de prospecção.

---

## 3. Arquitetura de Dados (Supabase)

### Tabela: `partners` (Migration `003_partner_module.sql`)
- `id` (uuid, PK, default: `uuid_generate_v4()`)
- `user_id` (uuid, FK `auth.users`, NOT NULL)
- `name` (text, NOT NULL), `email` (text, NOT NULL), `phone` (text), `company_name` (text)
- `partner_type` (enum: `'agency'`, `'consultant'`, `'sales_rep'`)
- `tier` (text, default: `'bronze'`) — `bronze` | `silver` | `gold`
- `commission_setup_rate` (numeric, default: `0.20`) — 20% de comissão no setup
- `commission_recurring_rate` (numeric, default: `0.10`) — 10% de comissão na recorrência
- `pix_key_type` (text), `pix_key` (text) — Dados para pagamento de comissões
- `status` (enum: `'active'`, `'inactive'`, `'suspended'`)
- `created_at`, `updated_at` (timestamptz)

### Tabela: `commissions_log` (Migration `003_partner_module.sql`)
- `id` (uuid, PK, default: `uuid_generate_v4()`)
- `partner_id` (uuid, FK `partners`, NOT NULL)
- `tenant_id` (uuid, FK `tenants`, NOT NULL)
- `reference_month` (date, NOT NULL) — Mês de referência da cobrança
- `plan_name` (text, NOT NULL), `plan_value` (numeric, NOT NULL)
- `is_setup` (boolean, default: `false`) — `true` se for comissão de setup, `false` se for recorrência
- `commission_rate` (numeric, NOT NULL) — Percentual aplicado
- `commission_value` (numeric, Generated Column) — Valor calculado automaticamente (`plan_value * commission_rate`)
- `status` (enum: `'pending'`, `'approved'`, `'paid'`, `'cancelled'`)
- `payout_date` (timestamptz), `notes` (text)
- `created_at`, `updated_at` (timestamptz)

### Vinculação na Tabela `tenants`
- `partner_id` (uuid, FK `partners`, nullable)
- `partner_commission_locked` (boolean, default: `false`)

---

## 4. Endpoints da API REST (Backend Node/Express)

### 4.1. Endpoints do Portal do Parceiro (`src/api/partner.ts`)
- **`GET /api/partner/dashboard`**
  - Retorna o resumo consolidado: total de clientes ativos, MRR da carteira, comissões pendentes e comissões pagas no mês.
- **`GET /api/partner/clients`**
  - Lista todos os clientes (tenants) vinculados ao parceiro autenticado.
- **`GET /api/partner/commissions`**
  - Lista o extrato completo de comissões com opção de filtro por mês de referência e status.
- **`POST /api/partner/clients/register`**
  - Permite ao parceiro cadastrar um novo assinante vinculando-o diretamente à sua conta.

### 4.2. Endpoints do Painel Administrativo (`src/api/partnerAdmin.ts`)
- **`GET /api/admin/partners`** — Lista todos os parceiros cadastrados.
- **`POST /api/admin/partners`** — Cria um novo parceiro e define suas taxas de comissão.
- **`PUT /api/admin/partners/:id`** — Atualiza dados, tier ou taxas de comissão do parceiro.
- **`PUT /api/admin/commissions/:id/status`** — Atualiza o status do pagamento da comissão (`pending` ➔ `approved` ➔ `paid`).
- **`POST /api/admin/partners/process-monthly-job`** — Aciona o job de cálculo automático de comissões mensais (`commissions-job.ts`).

---

## 5. Regras de Negócio, Segurança e RLS

- **Isolamento por RLS:** O Portal do Parceiro opera com a chave anônima do Supabase (`anon_key`). A política de RLS na tabela `partners` e `commissions_log` valida `user_id = auth.uid()`, garantindo que um parceiro nunca visualize a carteira ou financeiro de outro.
- **Cálculo Imutável:** O campo `commission_value` é mantido via Generated Column nativa do PostgreSQL, assegurando a exatidão matemática sem risco de manipulação via código.
- **Job de Comissionamento Mensal:** O worker `commissions-job.ts` roda no início de cada mês calculando os valores a pagar para cada parceiro ativo com base nas assinaturas vigentes.
