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
