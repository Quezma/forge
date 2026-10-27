import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: { outDir: '../internal/web/dist', emptyOutDir: true },
  server: { proxy: { '/api': 'http://127.0.0.1:7777' } },
  test: { environment: 'jsdom', globals: true },
})
