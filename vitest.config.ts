import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

// The same aliases as the renderer in electron.vite.config.ts, so tests resolve
// imports the way the build does; and the e2e runs leave the clipboard as it was.
export default defineConfig({
  test: {
    globalSetup: ['test/e2e/helpers/keep-clipboard.ts'],
  },
  resolve: {
    alias: {
      '@renderer': resolve('src/renderer'),
      '@shared': resolve('src/shared'),
    },
  },
})
