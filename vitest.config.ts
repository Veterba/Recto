import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

// Only what tests need to resolve imports the way the build does: the same
// aliases as the renderer in electron.vite.config.ts.
export default defineConfig({
  resolve: {
    alias: {
      '@renderer': resolve('src/renderer'),
      '@shared': resolve('src/shared'),
    },
  },
})
