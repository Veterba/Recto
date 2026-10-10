/**
 * Test-only, loaded into Electron's main process with `-r`: every request main
 * makes to Ollama (127.0.0.1:11434) is appended to $RECTO_OLLAMA_LOG, one URL
 * a line, before it is sent - so a test can prove there were none.
 */
const fs = require('node:fs')

const log = process.env.RECTO_OLLAMA_LOG
if (log !== undefined && typeof globalThis.fetch === 'function') {
  const real = globalThis.fetch
  globalThis.fetch = (input, init) => {
    const url = typeof input === 'string' ? input : String(input?.url ?? input)
    if (url.includes(':11434')) fs.appendFileSync(log, `${url}\n`)
    return real(input, init)
  }
}
