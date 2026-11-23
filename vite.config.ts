import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'
import { readFileSync } from 'node:fs'

const pkg = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8')
) as { version: string }

export default defineConfig({
  plugins: [react()],
  define: {
    // Single source of truth for the displayed version:
    // package.json. Bump it there and the UI follows.
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
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
  base: './',
  server: {
    port: 5173,
  },
})
