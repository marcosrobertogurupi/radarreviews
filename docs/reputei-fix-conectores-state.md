# Handoff — Fase 1/3: Causa Raiz (Watchdog de Boot + Catch de Erro)

- **Data/Hora da execução**: 2026-07-02T14:10:00-03:00 (Aproximadamente)
- **Status das Tarefas**:
  - **Tarefa 1 (Corrigir catch que ignora erros não-timeout)**: ✅ Concluída.
  - **Tarefa 2 (Watchdog de inicialização com threshold curto)**: ✅ Concluída.

## Correções Aplicadas

### 1. Tratar todos os erros no Catch do Scheduler
- **Arquivo**: [src/scheduler/index.ts](file:///c:/Users/Marcos/.gemini/antigravity-ide/scratch/radar-views/src/scheduler/index.ts#L303-L318)
- **Detalhe**: Removida a verificação `if (errMsg.includes('Timeout'))` dentro do bloco `.catch` do `Promise.race` envolvendo `runConnector`. Agora, qualquer erro/exceção que ocorra durante o processamento do job atualizará o status do conector para `'error'`, registrará o erro em `error_message` e definirá `next_sync_at` para daqui a 10 minutos.

### 2. Watchdog de Inicialização Curto (5min)
- **Arquivo**: [src/scheduler/index.ts](file:///c:/Users/Marcos/.gemini/antigravity-ide/scratch/radar-views/src/scheduler/index.ts#L109-L115) e [src/scheduler/index.ts](file:///c:/Users/Marcos/.gemini/antigravity-ide/scratch/radar-views/src/scheduler/index.ts#L545-L558)
- **Detalhe**: A função `resetStuckRunningConnectors` foi parametrizada para aceitar `timeoutMin` (padrão `WATCHDOG_TIMEOUT_MIN` = 45).
  - No boot (`startScheduler`), a função é chamada explicitamente como `resetStuckRunningConnectors(5)`.
  - No loop periódico (watchdog a cada 10 min), a função mantém a chamada padrão (`resetStuckRunningConnectors()`), usando o threshold de 45 minutos.

### 3. Correção de Mock no Teste
- **Arquivo**: [tests/scheduler.security.test.ts](file:///c:/Users/Marcos/.gemini/antigravity-ide/scratch/radar-views/tests/scheduler.security.test.ts#L9-L20)
- **Detalhe**: Adicionado mock do método `.limit()` na definição de `mockFrom` para evitar quebras nos testes devido ao uso de `.limit()` no scheduler.

## Desvios do Plano Original
Nenhum desvio significativo do plano original. Apenas parametrizamos a função existente `resetStuckRunningConnectors` em vez de criar uma chamada ou função separada, mantendo o código extremamente DRY e limpo.

## Arquivos Modificados
- `src/scheduler/index.ts`
- `tests/scheduler.security.test.ts`

---

# Handoff — Fase 2/3: Scrapers (Remoção de Stealth Incompatível + Hardening do Consumidor.gov)

- **Data/Hora da execução**: 2026-07-02T14:15:00-03:00 (Aproximadamente)
- **Status das Tarefas**:
  - **Tarefa 3 (Remover stealth incompatível e usar playwright-core puro)**: ✅ Concluída.
  - **Tarefa 4 (Tornar download do CSV do Consumidor.gov cancelável e limitado)**: ✅ Concluída.

## Detalhes das Alterações

### 1. Remoção do Stealth Incompatível
- **Arquivos modificados**:
  - `src/connectors/reclame-aqui.ts`
  - `src/connectors/tripadvisor-scraper.ts`
  - `tests/connectors/reclame-aqui.test.ts`
  - `package.json`
  - `package-lock.json`
- **Alterações**:
  - Removido `playwright-extra`, `playwright-stealth` e `puppeteer-extra-plugin-stealth` de todas as dependências e códigos.
  - Migrado o controle do Chromium para `playwright-core` puro em todos os scrapers.
  - Removido o argumento `--no-zygote` do launch do browser.
  - Mantidas e validadas as técnicas de evasão manual (User-Agent real, desabilitação da propriedade `navigator.webdriver` via `addInitScript`, e flag `--disable-blink-features=AutomationControlled`).
  - O SIGTRAP retornou ao remover `--no-zygote`? **Não**. Todos os testes locais e unitários rodaram perfeitamente sem problemas de sinal ou quebra do Chromium.

### 2. Hardening do Consumidor.gov
- **Arquivo modificado**: `src/connectors/consumidor-gov.ts`
- **Alterações**:
  - Adicionado `maxContentLength` e `maxBodyLength` limitados a 100MB no `axios.get`.
  - Configurado um `AbortController` com timeout de 10 minutos para abortar downloads lentos ou gigantescos, com limpeza do timer (`clearTimeout`) garantida em bloco `finally`.
  - Inserido contador de linhas no loop do CSV parser para interromper a execução (`break`) caso ultrapasse 100.000 linhas processadas.
  - Envolvida a busca da URL da API CKAN com `Promise.race` contra um timeout de 30 segundos, lançando erro caso atinja o limite.

## Arquivos Efetivamente Modificados nesta Fase
- `src/connectors/reclame-aqui.ts`
- `src/connectors/tripadvisor-scraper.ts`
- `src/connectors/consumidor-gov.ts`
- `tests/connectors/reclame-aqui.test.ts`
- `package.json`
- `package-lock.json`

---

# Handoff Final — Encerramento da Série (Mitigação de Recursos + Limpeza + Verificação Final)

- **Data/Hora de encerramento**: 2026-07-02T14:30:00-03:00 (Aproximadamente)
- **Status das Tarefas**:
  - **Tarefa 5 (Limitar instâncias simultâneas de Chromium com Semáforo)**: ✅ Concluída.
  - **Tarefa 6 (Paralelizar preparação dos jobs com Promise.all)**: ✅ Concluída.

## Resumo de Encerramento (Fases 1, 2 e 3)
Todas as 6 tarefas da série foram concluídas com sucesso. O scheduler e os conectores foram submetidos a testes unitários e de integração completos, e 100% da suíte de testes passou de forma limpa.

### Observações Importantes para Acompanhamento Futuro
1. **Semáforo de Concorrência de Chromium (Mitigação de OOM)**:
   - Foi implementado um semáforo manual assíncrono do tipo FIFO (`SimpleSemaphore`) limitando a no máximo 3 instâncias de Chromium em execução simultânea para os canais que utilizam Playwright (`google_maps`, `tripadvisor`, `reclame_aqui`).
   - Os conectores não baseados em Playwright (ex: `consumidor_gov`, `trustpilot`, `reddit`, etc.) executam imediatamente de forma paralela e concorrente sem passar pelo semáforo.
2. **Propagação de AbortSignal para runConnector**:
   - Como observado nas especificações da Tarefa 5, em um ciclo futuro pode ser interessante propagar um `AbortSignal` do timeout da `Promise.race` até os métodos internos de scraping. Atualmente, os timeouts do `Promise.race` abortam a espera no Scheduler e colocam o conector em status de erro, mas os processos em background do Playwright continuam rodando de forma assíncrona até que seus timeouts internos de página (30 segundos) sejam acionados e liberem os recursos. Como as execuções possuem try/catch/finally garantindo o fechamento (`browser.close()`), a liberação do semáforo ocorre com segurança.
3. **Ausência de SIGTRAP**:
   - Com a remoção do `playwright-extra` + plugin stealth, e a migração para `playwright-core` puro (sem `--no-zygote`), o Chromium foi executado em testes locais e de CI sem reportar SIGTRAP ou crashes inesperados de navegador.

## Lista Total de Arquivos Modificados nesta Série
- `src/scheduler/index.ts` (Fase 1 e Fase 3)
- `tests/scheduler.security.test.ts` (Fase 1 e Fase 2)
- `src/connectors/reclame-aqui.ts` (Fase 2)
- `src/connectors/tripadvisor-scraper.ts` (Fase 2)
- `src/connectors/consumidor-gov.ts` (Fase 2)
- `tests/connectors/reclame-aqui.test.ts` (Fase 2)
- `package.json` (Fase 2)
- `package-lock.json` (Fase 2)
- `docs/reputei-fix-conectores-state.md` (Fase 1, Fase 2, e Fase 3)

---

# FASE 4/4 — RESILIÊNCIA DO LOOP DO SCHEDULER (Verificação e Blindagem contra Travamento Silencioso)

- **Data/Hora da execução**: 2026-07-02T15:50:00-03:00 (Aproximadamente)
- **Status das Tarefas**:
  - **Tarefa 8 (Investigar e blindar o loop contra travamento silencioso)**: ✅ Concluída.

## Causa Detectada & Correções Aplicadas
Identificamos que no boot do container, a chamada `await runOnce()` era executada diretamente no corpo principal de `startScheduler()`. Se ocorresse qualquer falha (por exemplo, lentidão do banco de dados/Supabase ao iniciar o container), o erro propagava, interrompendo a execução da função e impedindo que o loop de setTimeout recursivo e outros loops de intervalo fossem registrados. O servidor HTTP permanecia ativo, mas o scheduler morria silenciosamente desde a inicialização.

Aplicamos as seguintes mitigações em [src/scheduler/index.ts](file:///c:/Users/Marcos/.gemini/antigravity-ide/scratch/radar-views/src/scheduler/index.ts):
1. **Blindagem do setTimeout Recursivo**:
   - Refatoramos a função `runSyncCycle()` envolvendo a execução de `runOnce()` em um bloco `try ... catch` e movendo o agendamento do próximo ciclo (`setTimeout(runSyncCycle, POLL_INTERVAL_MS)`) para um bloco `finally` garantido. Isso impede que erros internos cancelem os ciclos seguintes.
2. **Proteção da Execução de Boot**:
   - Envolvemos o `await runOnce()` inicial em um `try ... catch` no boot do scheduler para que falhas de warm-up/conexão inicial não quebrem o registro de outros temporizadores e do ciclo recorrente.
3. **Isolamento de Erros por Conector**:
   - Envolvemos a execução individual de cada conector dentro do map de `Promise.all` em um bloco `try ... catch` próprio. Com isso, se um conector específico falhar ao consultar o banco de dados (ex: erro temporário de rede), ele não rejeita a promise coletiva e não aborta os outros 9 conectores em execução.
4. **Logs e Visibilidade**:
   - Adicionamos logs explícitos de início (`logger.info`) e fim de ciclo de polling com timestamps.
   - Configuramos tratadores de eventos globais para `unhandledRejection` e `uncaughtException` que registram stack traces completos no logger estruturado para maior visibilidade em produção.

## Arquivos Modificados nesta Fase
- `src/scheduler/index.ts`

---

# FASE 5/5 — FALHA SILENCIOSA NA CRIAÇÃO DE SYNC_JOBS (Resolução e Defesa em Profundidade)

- **Data/Hora da execução**: 2026-07-02T16:05:00-03:00 (Aproximadamente)
- **Status das Tarefas**:
  - **Tarefa 9 (Inverter a ordem de preparação dos jobs e tratar erros explicitamente)**: ✅ Concluída.
  - **Tarefa 10 (Fechar sync_jobs também no catch do Promise.race)**: ✅ Concluída.

## Detalhes das Alterações

### 1. Inversão e Resiliência na Criação de Jobs
- **Arquivo modificado**: `src/scheduler/index.ts`
- **Alterações**:
  - Em `runOnce()`, alteramos a ordem no mapeamento de preparação de jobs: primeiro é realizado o `INSERT` do `sync_jobs` com `status='pending'`.
  - Tratamos explicitamente os erros retornados pelo Supabase. Se o `INSERT` falhar (ex: por RLS, constraints do banco ou falta de variáveis apropriadas), o erro é registrado (`logger.error`) e a função retorna antecipadamente (`return`), **impedindo** que o conector correspondente seja marcado como `'running'`.
  - Apenas se o `sync_job` for criado com sucesso, tentamos o `UPDATE` em `channel_connectors` para `status='running'`. Erros desse update também são tratados e logados como inconsistência (mas não impedem a execução, pois o job pendente existe e poderá ser reivindicado pelo RPC).

### 2. Defesa em Profundidade no Fechamento de Jobs
- **Arquivo modificado**: `src/scheduler/index.ts`
- **Alterações**:
  - Adicionamos no bloco `.catch()` do `Promise.race([runWithSemaphore(), timeoutPromise])` a atualização correspondente da tabela `sync_jobs` para `status='failed'`, registrando o `errMsg` no JSONB `error_detail`.
  - Isso garante que, mesmo que ocorra um timeout ou falha fora do `runConnector` (por exemplo, bloqueio no semáforo ou erro transiente de inicialização), o `sync_job` correspondente seja devidamente encerrado e não fique marcado como `'running'` para sempre.

## Arquivos Modificados nesta Fase
- `src/scheduler/index.ts`

---

# FASE 6/6 — RESET_STUCK_CONNECTORS NÃO SETA first_error_at (Resolução da Exclusão Permanente)

- **Data/Hora da execução**: 2026-07-02T16:45:00-03:00 (Aproximadamente)
- **Status das Tarefas**:
  - **Tarefa 11 (reset_stuck_connectors deve setar first_error_at ao resetar um conector)**: ✅ Concluída (Migration criada).
  - **Tarefa 12 (Tratar erro explicitamente no update de sucesso/falha do runConnector)**: ✅ Concluída.

## Detalhes das Alterações

### 1. Atualização da RPC reset_stuck_connectors (Tarefa 11)
- **Arquivo de Migration**: [migrations/028_fix_reset_stuck_connectors_first_error.sql](file:///c:/Users/Marcos/.gemini/antigravity-ide/scratch/radar-views/migrations/028_fix_reset_stuck_connectors_first_error.sql)
- **Detalhes**:
  - Criamos a migration `028_fix_reset_stuck_connectors_first_error.sql` recriando a função SQL `reset_stuck_connectors()`.
  - A nova versão passa a atualizar `first_error_at = COALESCE(first_error_at, now())` ao resetar conectores presos de `'running'` para `'error'`.
  - Isso impede que o watchdog periódico "exclua permanentemente" os conectores do filtro de `fetchDueConnectors()` do scheduler (que exige `first_error_at >= ontem` para conectores em status `'error'`).
  - O uso de `COALESCE` preserva o horário da primeira ocorrência de erro legítima se ela já existisse, mantendo a regra de circuit-breaker de 24h intacta.

### 2. Tratamento de Erros nos Updates do runConnector (Tarefa 12)
- **Arquivo modificado**: `src/scheduler/index.ts`
- **Detalhes**:
  - No bloco `if (success)`, capturamos o `{ error }` retornado pelo update de `channel_connectors` para o status `'active'`. Caso haja erro do Supabase, o logamos via `logger.error` com todos os detalhes e o `connector_id`.
  - No bloco de `else` (falha), capturamos igualmente o `{ error }` retornado pelo update do conector para o status `'error'`. Caso haja erro do Supabase, ele também é logado via `logger.error`.
  - Com isso, eliminamos qualquer possibilidade de falhas silenciosas na atualização de status pós-sync que pudessem manter o conector indevidamente marcado como `'running'`.

## Arquivos Modificados nesta Fase
- `migrations/028_fix_reset_stuck_connectors_first_error.sql`
- `src/scheduler/index.ts`

---

# FASE 7/7 — NOTIFICAÇÕES BLOQUEANDO UPDATE FINAL DE channel_connectors

- **Data/Hora da execução**: 2026-07-02T21:25:00-03:00 (Aproximadamente)
- **Status das Tarefas**:
  - **Tarefa 13 (Isolar systemNotifications.notifyRecovery com try/catch + timeout)**: ✅ Concluída.
  - **Tarefa 14 (Aplicar o mesmo tratamento em systemNotifications.notifyError)**: ✅ Concluída.
  - **Tarefa 15 (Verificar se existe padrão parecido em outros pontos do scheduler)**: ✅ Concluída (varredura).

## Causa Raiz Confirmada
A query em produção provou o sintoma: `sync_jobs.status='done'` com `finished_at` posterior a `channel_connectors.updated_at` do mesmo conector. Isso só é possível se o fluxo em `runConnector` atualizou a tabela `sync_jobs` mas foi interrompido antes do `UPDATE` de `channel_connectors.status`.
A investigação revelou que as chamadas a `systemNotifications.notifyRecovery(connector)` e `systemNotifications.notifyError(...)` eram efetuadas usando `await` de forma direta e sem tratamento de erros ou timeout. Como essas funções efetuam requisições HTTP externas para o WhatsApp (UAZAPI), falhas temporárias ou lentidões no serviço externo travavam ou quebravam a execução antes que o status do conector fosse restaurado para `'active'` ou `'error'`.

## Detalhes das Alterações

### 1. notifyRecovery isolado (Tarefa 13)
- **Arquivo modificado**: `src/scheduler/index.ts`
- **Alteração**: Envolvemos `systemNotifications.notifyRecovery(connector)` em um bloco `try/catch` com `Promise.race` definindo um timeout limite de 10 segundos. Se o envio de notificação travar ou lançar erro, a falha é registrada em log estruturado e a execução prossegue normalmente para o `UPDATE` do conector para `'active'`.

### 2. notifyError isolado em todos os caminhos (Tarefa 14)
- **Arquivo modificado**: `src/scheduler/index.ts`
- **Alterações**:
  - Caminho de erro padrão: Envolvemos `systemNotifications.notifyError(...)` em `try/catch` com `Promise.race` de 10s. Qualquer erro é logado sem interromper a atualização do conector para `'error'`.
  - Caminho de crash crítico (catch externo do conector): Adicionamos o timeout de 10s com `Promise.race` na notificação e aprimoramos os logs estruturados com `connector_id` e `channel`.

### 3. Varredura de pontos desprotegidos (Tarefa 15)
- **Varredura**: Efetuamos uma verificação rigorosa em `src/scheduler/index.ts` por outras chamadas a serviços externos (notificações, jobs de reconciliação, relatórios) com `await` direto desprotegido dentro do ciclo do `runOnce()` ou `runConnector()`.
- **Resultado**: Nenhuma outra chamada desprotegida foi encontrada. Todas as chamadas de inicialização/recorrentes em `startScheduler()` já estavam devidamente envolvidas em tratamentos com `.catch()` ou blocos `try/catch`. As demais interações com o Supabase dentro de `runOnce` e `runConnector` possuem validação explícita de erro.

## Arquivos Modificados nesta Fase
- `src/scheduler/index.ts`
