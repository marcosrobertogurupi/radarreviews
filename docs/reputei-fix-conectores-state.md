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
