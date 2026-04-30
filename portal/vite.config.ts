import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
  // Base path: assets referenciados como /portalcliente/assets/... no HTML
  base: '/portalcliente',
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
})
