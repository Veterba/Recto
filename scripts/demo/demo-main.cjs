// Loaded into the app's main process for a recording (`electron -r`), before the
// app's own code. On top of the snapshot rules (the window is never shown), it
// sets the demo's date, answers the folder picker, and records or replays
// the local model.
//
//   DEMO_NOW     ISO date the clock starts from.
//   DEMO_PICK    The folder "Choose folder…" returns. A native dialog cannot be filmed.
//   DEMO_AI      record: talk to Ollama and save every exchange to DEMO_TAPE.
//                replay: answer from DEMO_TAPE, same order, same text; nothing reaches Ollama.
//   DEMO_TAPE_FROM  The exchange a replay starts at.
require('../snapshot-isolate.cjs')
const fs = require('node:fs')
const { dialog } = require('electron')

const RealDate = Date
const offset = new RealDate(process.env.DEMO_NOW).getTime() - RealDate.now()
globalThis.Date = class extends RealDate {
  constructor(...args) {
    if (args.length === 0) super(RealDate.now() + offset)
    else super(...args)
  }
  static now() {
    return RealDate.now() + offset
  }
}

if (process.env.DEMO_PICK) dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [process.env.DEMO_PICK] })

const OLLAMA = 'http://127.0.0.1:11434'
const realFetch = globalThis.fetch
const urlOf = (input) => (typeof input === 'string' ? input : (input.url ?? String(input)))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

if (process.env.DEMO_AI === 'record') {
  const tape = { fixed: {}, chats: [] }
  const save = () => fs.writeFileSync(process.env.DEMO_TAPE, JSON.stringify(tape, null, 1))
  globalThis.fetch = async (input, init) => {
    const url = urlOf(input)
    if (!url.startsWith(OLLAMA)) return realFetch(input, init)
    const response = await realFetch(input, init)
    const route = url.slice(OLLAMA.length)
    if (route !== '/api/chat') {
      tape.fixed[route] = await response.clone().text()
      save()
      return response
    }
    // Only Quick ask's turns, which carry tools. Background work (note cards) runs
    // on its own schedule, so its calls have no fixed place in the order.
    const request = JSON.parse(init.body)
    if (request.tools === undefined) return response
    const entry = { request, lines: [] }
    tape.chats.push(entry)
    const [mine, theirs] = response.body.tee()
    void (async () => {
      const decoder = new TextDecoder()
      let pending = ''
      for await (const chunk of mine) {
        pending += decoder.decode(chunk, { stream: true })
        const lines = pending.split('\n')
        pending = lines.pop()
        entry.lines.push(...lines.filter((l) => l.trim() !== ''))
      }
      if (pending.trim() !== '') entry.lines.push(pending)
      save()
    })()
    return new Response(theirs, { status: response.status, headers: response.headers })
  }
}

if (process.env.DEMO_AI === 'replay') {
  const tape = JSON.parse(fs.readFileSync(process.env.DEMO_TAPE, 'utf8'))
  let next = Number(process.env.DEMO_TAPE_FROM ?? 0)
  /** Same words as the model's, at the speed a warm model on a fast Mac streams them. */
  const TOKEN_MS = 16
  const FIRST_TOKEN_MS = 500
  globalThis.fetch = async (input, init) => {
    const url = urlOf(input)
    if (!url.startsWith(OLLAMA)) return realFetch(input, init)
    const route = url.slice(OLLAMA.length)
    if (route !== '/api/chat') return new Response(tape.fixed[route] ?? '{}', { status: 200 })
    if (JSON.parse(init.body).tools === undefined) return new Response('{"error":"not on the tape"}', { status: 500 })
    const entry = tape.chats[next++]
    if (entry === undefined) return new Response('{"error":"tape ran out"}', { status: 500 })
    const encoder = new TextEncoder()
    const body = new ReadableStream({
      async start(controller) {
        await sleep(FIRST_TOKEN_MS)
        for (const line of entry.lines) {
          controller.enqueue(encoder.encode(`${line}\n`))
          await sleep(TOKEN_MS)
        }
        controller.close()
      },
    })
    return new Response(body, { status: 200 })
  }
}
