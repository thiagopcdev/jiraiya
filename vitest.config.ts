import { resolve } from 'path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
      '@renderer': resolve(__dirname, 'src/renderer/src')
    }
  },
  test: {
    // ambiente default node; testes de componente declaram jsdom por arquivo
    // com o docblock `// @vitest-environment jsdom` no topo
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['./src/renderer/src/testing/setup.ts'],
    coverage: {
      provider: 'v8',
      all: true,
      include: ['src/**'],
      exclude: [
        'src/**/*.test.{ts,tsx}',
        // infraestrutura de teste
        'src/main/testing/**',
        'src/renderer/src/testing/**',
        // só roda dentro do Electron real (contextBridge/boot de janelas/tray);
        // validado pelo smoke CDP do app empacotado nas integrações
        'src/preload/**',
        'src/main/index.ts',
        // entry points triviais do renderer
        'src/renderer/src/main.tsx',
        'src/renderer/src/env.d.ts'
      ],
      reporter: ['text-summary', 'json-summary', 'html'],
      // gate do CI: o test:coverage FALHA abaixo disso (estado atual: ~92/83/91/94)
      thresholds: {
        statements: 85,
        branches: 78,
        functions: 85,
        lines: 85
      }
    }
  }
})
