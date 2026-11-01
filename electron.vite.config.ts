import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import { build, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * `recto-mcp` (src/mcp), the program AI clients start, built beside main as
 * ONE self-contained file: the MCP SDK and zod inlined, nothing from
 * node_modules needed at run time. It runs outside the app - on Recto's
 * Electron as Node, or on Claude Desktop's Node from a .mcpb - so it cannot
 * share main's chunks or its externalised dependencies.
 */
function mcpProgram(): Plugin {
  return {
    name: 'recto-mcp',
    apply: 'build',
    async closeBundle() {
      await build({
        configFile: false,
        logLevel: 'warn',
        ssr: { noExternal: true, target: 'node' },
        build: {
          ssr: resolve('src/mcp/index.ts'),
          outDir: resolve('out/mcp'),
          emptyOutDir: false,
          minify: false,
          rollupOptions: { output: { format: 'es', entryFileNames: 'recto-mcp.mjs', inlineDynamicImports: true } },
        },
      })
    },
  }
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin(), mcpProgram()],
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/main/index.ts'),
          // The indexer runs as a utilityProcess, so it is a second entry point
          // in the same (Node) build - not a renderer and not a worker.
          'indexer/index': resolve('src/workers/indexer/index.ts'),
          // Auto-links' model runs in a third process, so inference never
          // holds up a search.
          'embedder/index': resolve('src/workers/embedder/index.ts'),
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
