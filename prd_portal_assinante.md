# Product Requirements Document (PRD) — Portal do Assinante (Reputei)
*Documentação direcionada para testes E2E (Automated Testing via spriteTest)*

## 1. Visão Geral do Produto
O **Portal do Assinante** é a interface "Client-Facing" (voltada para o cliente/locatário final) da plataforma Reputei. É um painel multi-tenant onde os assinantes (empresas) monitoram sua reputação online consolidada de vários canais (Google Maps, TripAdvisor, Facebook, Reclame Aqui, etc.).

**Importante para Testes E2E:** 
- O Portal do Assinante (App `portal/`) é **estritamente separado** do Painel Operacional (App `admin/`).
- O assinante **não** configura conectores complexos (como Google Maps ou TripAdvisor) diretamente por formulários de credenciais no portal.
- O assinante **não** gerencia a "Base de Conhecimento" do sistema.
- A única integração que o assinante faz ativamente no portal é a autorização OAuth da Meta (Facebook/Instagram) na tela de "Meu Perfil" (Settings).

## 2. Autenticação e Controle de Acesso
- **Login:** Acesso via e-mail e senha.
- **Onboarding (Signup):** Fluxo para novos assinantes configurarem os dados básicos da empresa.
- **Trial Expired:** Tela de bloqueio rígida (`TrialExpired.tsx`) exibida caso o período de testes acabe e nenhum plano ativo esteja selecionado.
- **Isolamento de Dados:** Utiliza Row Level Security (RLS) via token JWT (Anon Key). Os usuários só têm acesso aos dados do próprio `tenant_id`.
- **Agências (Parceiros):** Se o usuário tiver o perfil `parceiro`, um `<select>` no topo do menu lateral permite alternar a visão do portal entre os vários clientes (tenants) que ele gerencia.

## 3. Estrutura de Navegação (Sidebar)
O menu principal contém os seguintes fluxos (rotas):

### 3.1. Visão Geral (Dashboard)
- **O que faz:** Exibe KPIs globais de reputação (Nota média, total de reviews, taxa de resposta), gráficos de tendências, distribuição de sentimento (positivo, neutro, negativo, crítico) e nuvem de tópicos.
- **Teste esperado:** Validar se as métricas são carregadas e se pertencem apenas à empresa selecionada.

### 3.2. Reviews
- **O que faz:** Listagem completa das avaliações coletadas.
- **Recursos Chave:** 
  - Filtros por canal, nota, data e sentimento.
  - Reviews `negativos` ou `críticos` devem exibir o resumo da IA (`sentiment_summary`), o motivo do alerta (`alert_reason`) e disponibilizar um botão "Sugerir Resposta".
- **Teste esperado:** Clicar num review crítico para abrir o modal de detalhes e visualizar as sugestões geradas pela IA.

### 3.3. Alertas
- **O que faz:** Fila de trabalho com avaliações críticas que demandam atenção urgente (quebra de SLA).
- **Recursos Chave:** Botões para resolver ou interagir com o alerta.
- **Teste esperado:** Fluxo de marcar um alerta crítico como "Resolvido".

### 3.4. IA Copilot
- **O que faz:** Interface de chat interativo. O Copiloto responde perguntas gerenciais sobre a reputação online da empresa com base nos dados do banco (ex: "Quais são as maiores reclamações deste mês?").
- **Teste esperado:** Enviar uma mensagem para a IA e receber uma resposta textual contextualizada da reputação.

### 3.5. Benchmarking
- **O que faz:** Compara a performance da empresa com concorrentes registrados.

### 3.6. Widget Site
- **O que faz:** Fornece um snippet de código (HTML/JS) para o cliente embutir as melhores avaliações no próprio site.

### 3.7. Gerar Reviews
- **O que faz:** Permite o disparo de campanhas por WhatsApp pedindo avaliações aos clientes.

### 3.8. Relatórios
- **O que faz:** Geração e download de relatórios executivos mensais em PDF.

### 3.9. Planos (Pricing)
- **O que faz:** Interface de upgrade de assinatura via checkout transparente (integração Asaas).

### 3.10. Suporte (Helpdesk)
- **O que faz:** Permite ao assinante abrir tickets para o time operacional do Reputei.
- **Recursos Chave:** 
  - Listagem dos próprios chamados (Aberto, Em andamento, Resolvido).
  - Formulário com campo de Categoria (Dúvida, Problema Técnico, Financeiro, Sugestão).
- **Teste esperado:** Abrir um novo ticket selecionando uma das categorias listadas e preenchendo assunto/descrição.

### 3.11. Meu Perfil (Settings)
- **O que faz:** Edição de dados pessoais, nome da empresa e configuração de integrações passivas.
- **Recursos Chave (Meta):** Botão **"Conectar Agora"** que redireciona o usuário para o OAuth do Facebook/Instagram.
- **Teste esperado:** Verificar se o botão de conectar a Meta gera um redirecionamento válido para o endpoint de autenticação (sem erro 404).

## 4. Comportamentos Adicionais Exigidos nos Testes
- **Notificações:** A interface deve renderizar banners (Toasts) amigáveis e visuais em caso de erro ou sucesso.
- **Barra Lateral Extra para Admins:** Se o login do portal for feito por um usuário da própria plataforma com perfil `admin` ou `operador`, um botão estilizado de **Painel Operacional** aparecerá no fim da sidebar lateral, redirecionando o fluxo externamente para o domínio do administrador. *O spriteTest não deve tentar encontrar as telas operacionais diretamente no portal.*
