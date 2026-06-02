# Módulo de Parceiros (Partner Portal) - Relatório de Implementação

## Visão Geral
O Módulo de Parceiros foi desenvolvido para permitir que Agências, Consultores e Representantes gerenciem suas carteiras de clientes e acompanhem suas comissões referentes ao Reputei. O módulo foi separado em dois frontends:
1. **Partner Portal (`/partner`)**: Portal dedicado para os parceiros (acesso às indicações, novo cadastro, extrato financeiro).
2. **Admin Portal (`/admin`)**: Telas exclusivas para o time interno do Reputei gerenciar os parceiros, aprovar e realizar pagamento de comissões.

## Banco de Dados e Migrações
A migração `003_partner_module.sql` estabeleceu as seguintes estruturas:
- `partners`: Armazena dados cadastrais do parceiro, tipo de parceria (`agency`, `consultant`, `sales_rep`) e as taxas de comissão (`setup_rate` e `recurring_rate`).
- `tenants`: A tabela principal de inquilinos do sistema recebeu o campo `partner_id` para vincular o cliente ao parceiro que o indicou.
- `commissions`: Registra cada evento de cobrança (setup ou recorrência mensal) de clientes vinculados, calculando o valor automaticamente `(plan_value * commission_rate / 100)`. Status disponíveis: `pending`, `approved`, `paid`, `cancelled`.
- `partner_dashboard_summary` (View): Totaliza o número de clientes ativos/trial, e os valores pendentes ou já pagos de forma agregada para rápido carregamento do dashboard.
- `partner_register_tenant` (Função RPC): Garante o registro atômico de novos inquilinos já vinculados ao parceiro solicitante e em conformidade de segurança via banco de dados.

## Backend (API)
- `src/api/partner.ts`: Rotas consumidas pelo Portal do Parceiro. Possui middleware de verificação para garantir que apenas usuários ativos na tabela `partners` acessem as rotas de listagem de clientes e dashboard.
- `src/api/partnerAdmin.ts`: Rotas consumidas pelo painel operacional (`/admin`). Permite a inserção de novos parceiros e o aceite/pagamento das comissões com logs de carimbo de tempo (`approved_at`, `paid_at`).
- Todo o tráfego via API backend possui validações rígidas de tokens Supabase do lado do Servidor.

## Front-End
### Partner Portal (`partner/`)
- Um fork leve baseado no portal do cliente, acessível na porta configurada (Vite default: 5175).
- **Páginas Principais**: Dashboard (KPIs agregados), Meus Clientes (Grid de clientes com status do plano), Novo Cliente (Formulário acionando a RPC), Extrato (lista de comissões e status) e Perfil.

### Admin Portal (`admin/`)
- Incorporação de duas novas views: **Parceiros** (CRUD simplificado) e **Comissões de Parceiros** (Mesa de aprovação e liquidação de PIX).

## Testes e Segurança (AppSec)
- **RLS**: Row-Level Security imposta de forma rígida em `partners` e `commissions`.
- Apenas Administradores do sistema (via Service Role e validação manual do Perfil == admin) podem gerenciar taxas e status.
- Testes localizados em `tests/partner.security.test.ts` atestam as blindagens das views.

## Próximos Passos
- Ajustar os endpoints do gateway de pagamento (Iugu/Stripe) para gerar inserções automáticas na tabela `commissions` a cada fatura quitada de um cliente parceiro.
