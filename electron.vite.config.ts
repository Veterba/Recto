import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/main/index.ts'),
          // The indexer runs as a utilityProcess, so it is a second entry point
          // in the same (Node) build - not a renderer and not a worker.
          'indexer/index': resolve('src/indexer/index.ts'),
        },
        output: { entryFileNames: '[name].js' },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: { rollupOptions: { input: { index: resolve('src/preload/index.ts') } } },
  },
  renderer: {
    root: resolve('src/renderer'),
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer'),
        '@shared': resolve('src/shared'),
      },
    },
    build: { rollupOptions: { input: { index: resolve('src/renderer/index.html') } } },
    // The graph's physics worker is loaded as `new Worker(url, { type: 'module' })`.
    // Vite's default worker format is iife, which cannot code-split - and the
    // worker imports d3-force, so it must. Dev works either way; this is what
    // stops the packaged build being the first place it breaks.
    worker: { format: 'es' },
    plugins: [react()],
  },
})
