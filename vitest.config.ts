import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Ambiente Node.js puro (sem browser)
    environment: 'node',
    // Mostrar detalhes de cada teste
    reporter: 'verbose',
    // Arquivos de teste
    include: ['tests/**/*.test.ts'],
    // Timeout padrão: 10 segundos por teste
    testTimeout: 10000,
    // Isolar cada arquivo de teste (evita interferência entre mocks)
    isolate: true,
    // Coverage (opcional: npm run test -- --coverage)
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/scheduler/**'],
    },
  },
  resolve: {
    // Suporte a .ts imports sem extensão nos testes
    extensions: ['.ts', '.js'],
  },
})
