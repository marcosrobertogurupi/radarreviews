import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // Base path: assets são referenciados como /admin/assets/... no HTML
  // O proxy Next.js mapeia /admin/assets/* → admin-vercel.app/assets/*
  base: '/admin',
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
})
