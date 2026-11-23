import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@backend': fileURLToPath(new URL('./backend', import.meta.url)),
    },
  },
  build: {
    outDir: 'dist/app',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
  },
})
