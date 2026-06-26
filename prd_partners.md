# Product Requirements Document (PRD) - Módulo de Parceiros (Reputei)

## 1. Visão Geral do Produto
O Módulo de Parceiros do Reputei permite que agências, consultores e revendedores atuem como canais de distribuição do SaaS. Cada parceiro recebe acesso a um portal dedicado para gerenciar as contas de seus clientes (Tenants), visualizar suas comissões de setup e recorrência, e acompanhar indicadores de performance.

## 2. Casos de Uso e Funcionalidades Core

### 2.1. Painel Admin (Uso Interno - Reputei)
- **Gestão de Parceiros:** CRUD completo de parceiros (criar, editar, suspender).
- **Atribuição de Comissões:** Definição da taxa de comissão de setup (ex: 20%) e recorrência (ex: 10%) para cada parceiro.
- **Associação de Tenants:** Vincular assinantes (tenants) a parceiros específicos.
- **Gestão Financeira:** Visualizar e alterar o status das comissões mensais geradas (Pendente, Aprovado, Pago, Cancelado).

### 2.2. Portal do Parceiro (Uso Externo - Revendedores)
- **Dashboard:** Visão consolidada de MRR, total de clientes ativos, e comissões do mês atual e anterior.
- **Gestão de Clientes:** Lista de tenants associados ao parceiro, permitindo login rápido (impersonation/SSO) no portal do cliente para gestão da reputação.
- **Extrato de Comissões:** Tabela detalhada com as comissões mensais (setup e recorrência) discriminadas por cliente e status de pagamento.
- **Onboarding e Vendas:** Interface para cadastrar novos leads/clientes e gerar links de onboarding.

## 3. Arquitetura de Dados (Supabase)

### Tabela: `partners`
- `id` (uuid, PK)
- `user_id` (uuid, FK auth.users)
- `name`, `email`, `phone`, `company_name`
- `partner_type` (enum: 'agency', 'consultant', 'sales_rep')
- `commission_setup_rate` (numeric)
- `commission_recurring_rate` (numeric)
- `status` (enum: 'active', 'inactive', 'suspended')

### Tabela: `commissions`
- `id` (uuid, PK)
- `partner_id` (uuid, FK partners)
- `tenant_id` (uuid, FK tenants)
- `reference_month` (date)
- `plan_name` (text), `plan_value` (numeric)
- `is_setup` (boolean)
- `commission_rate` (numeric)
- `commission_value` (numeric, generated always)
- `status` (enum: 'pending', 'approved', 'paid', 'cancelled')

### Alterações em Tabela: `tenants`
- Inclusão de `partner_id` (uuid, nullable)
- Inclusão de `partner_commission_locked` (boolean)

## 4. Endpoints da API REST (Backend Express/Node)

- **`GET /api/partner/dashboard`**: Retorna KPIs agregados (clientes ativos, MRR atual, comissões do mês).
- **`GET /api/partner/clients`**: Lista os tenants vinculados ao parceiro autenticado.
- **`GET /api/partner/commissions`**: Lista o extrato financeiro filtrado por mês.
- **`POST /api/admin/partners`**: Cria um novo parceiro (apenas admin).
- **`PUT /api/admin/commissions/:id/status`**: Atualiza o status do pagamento (apenas admin).

## 5. Regras de Negócio e Segurança (Row Level Security - RLS)

- **Isolamento de Parceiros:** O Portal do Parceiro utiliza a anon key do Supabase. O RLS na tabela `partners` e `commissions` garante que um parceiro só consiga visualizar seus próprios dados validando o `user_id == auth.uid()`.
- **Acesso Administrativo:** O Painel Admin utiliza a `service_role` key ou usuários com role específica de admin para ignorar o RLS e gerenciar todos os parceiros.
- **Cálculo Imutável:** O valor da comissão (`commission_value`) é gerado nativamente pelo banco de dados (Generated Column) multiplicando o `plan_value` pelo `commission_rate`.

## 6. Fluxos de Teste (Sugestão para TestSprite)

1. **Segurança/RLS:** Garantir que um parceiro A não possa ler os tenants ou comissões do parceiro B.
2. **Cálculo de Comissão:** Validar se o banco calcula a comissão corretamente quando a taxa é alterada na criação.
3. **Login do Parceiro:** Autenticação no portal de parceiros retorna o token JWT que destranca apenas os acessos à view `partner_select_own`.
4. **Gestão Admin:** Criação de um parceiro e associação de um tenant, validando se o tenant aparece na listagem `/api/partner/clients`.
