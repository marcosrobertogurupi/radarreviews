import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // Base path para que os assets sejam servidos em /admin/assets/...
  base: '/admin',
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
})
