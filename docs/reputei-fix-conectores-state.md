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
