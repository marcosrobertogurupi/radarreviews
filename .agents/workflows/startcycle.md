# Workflow: /startcycle

---
description: Inicia a implementação completa de um conector de canal
---

Quando o usuário digitar `/startcycle <canal>`, executar a sequência abaixo.
Exemplo: `/startcycle google_maps`

## Sequência de execução

### 1. Leitura de contexto (sempre primeiro)

Ler os seguintes arquivos antes de qualquer ação:

- `.agents/agents.md`
- `.agents/skills/connector.md`
- `.agents/skills/supabase.md`
- `production_artifacts/channel-specs.md` (seção do canal solicitado)
- `production_artifacts/schema.sql`
- `src/types/review.ts` (se existir)
- `src/lib/supabase.ts` (se existir)

### 2. Plano de implementação

Gerar e exibir um plano com:
- Canal: `<canal>`
- Arquivo a criar: `src/connectors/<canal>.ts`
- Arquivo de teste: `tests/connectors/<canal>.test.ts`
- Dependências npm necessárias (se houver novas)
- Mapeamento de campos (API → NormalizedReview)
- Pontos de atenção específicos do canal

**Aguardar aprovação do usuário antes de continuar.**
Se o usuário adicionar comentários ao plano, incorporar e reapresentar.

### 3. Instalação de dependências

Se o canal precisar de novas dependências, instalar via terminal:

```bash
npm install <dependencias>
```

### 4. Criação dos arquivos de tipos (se não existirem)

Se `src/types/review.ts` não existir, criá-lo com os tipos:
- `NormalizedReview`
- `SourceChannel`
- `SentimentType`
- `ChannelConnector`
- `JobResult`

Se `src/lib/supabase.ts` não existir, criá-lo com o cliente singleton.
Se `src/lib/vault.ts` não existir, criá-lo com os helpers do Vault.
Se `src/lib/logger.ts` não existir, criá-lo com logger estruturado.

### 5. Implementação do conector

Criar `src/connectors/<canal>.ts` seguindo rigorosamente `skills/connector.md`.

Após criar o arquivo, executar no terminal:
```bash
npx tsc --noEmit
```
Se houver erros de TypeScript, corrigir antes de continuar.

### 6. Implementação dos testes

Criar `tests/connectors/<canal>.test.ts`.

Executar os testes:
```bash
npm run test tests/connectors/<canal>.test.ts
```

Corrigir falhas até todos os testes passarem.

### 7. Lint

```bash
npm run lint src/connectors/<canal>.ts
```

Corrigir todos os warnings e erros.

### 8. Verificação no browser

Abrir o browser integrado e verificar:
- Se existe um `.env.example` com as variáveis necessárias
- Se existe documentação no README sobre como configurar o canal

### 9. Relatório final

Exibir um resumo com:
- Arquivo criado: `src/connectors/<canal>.ts`
- Testes: N passando, 0 falhando
- Campos mapeados: lista
- Variáveis de ambiente necessárias: lista
- Próximo passo sugerido: qual canal implementar em seguida

---

## Outros workflows disponíveis

- `/startcycle <canal>` — implementar um conector do zero
- `/test-connector <canal>` — rodar testes de um conector existente *(a criar)*
- `/check-schema` — verificar se o schema local está atualizado *(a criar)*
