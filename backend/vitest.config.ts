import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  resolve: {
    alias: { app: fileURLToPath(new URL('../frontend/src/app', import.meta.url)) },
  },
})
