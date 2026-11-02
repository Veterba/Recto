#!/usr/bin/env node
// A stand-in for `codex` and `claude` in tests: it answers by its own file name,
// in that CLI's JSON stream, and spends nothing. FAKE_SCENARIO picks the script:
// ok, signed-out, limit, down, slow. `codex app-server` answers the limits
// read. FAKE_LOG, when set, gets the arguments and
// the prompt it received, as JSON, so a test can check what reached the "cloud".

import fs from 'node:fs'
import path from 'node:path'

const name = path.basename(process.argv[1])
const args = process.argv.slice(2)
const scenario = process.env.FAKE_SCENARIO ?? 'ok'
const out = (event) => process.stdout.write(`${JSON.stringify(event)}\n`)

// Pre-flight: signed in?
if ((args[0] === 'login' && args[1] === 'status') || (args[0] === 'auth' && args[1] === 'status')) {
  if (scenario === 'signed-out') {
    process.stdout.write('Not logged in\n')
    process.exit(1)
  }
  process.stdout.write('Logged in using ChatGPT\n')
  process.exit(0)
}

// Codex's app server, asked only for the plan's limits (the shape a real one gave, free plan).
if (name === 'codex' && args[0] === 'app-server') {
  let pending = ''
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', (chunk) => {
    pending += chunk
    for (const line of pending.split('\n').slice(0, -1)) {
      const message = JSON.parse(line)
      if (message.id === 1) out({ id: 1, result: { userAgent: 'fake' } })
      if (message.id === 2)
        out({
          id: 2,
          result: {
            rateLimits: {
              limitId: 'codex',
              primary: { usedPercent: 6, windowDurationMins: 43200, resetsAt: 1794917533 },
              secondary: null,
              planType: 'free',
              rateLimitReachedType: null,
              spendControlReached: false,
            },
          },
        })
    }
    pending = pending.slice(pending.lastIndexOf('\n') + 1)
  })
  setTimeout(() => process.exit(0), 5000)
} else {
let prompt = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => (prompt += chunk))
process.stdin.on('end', async () => {
  if (process.env.FAKE_LOG) fs.writeFileSync(process.env.FAKE_LOG, JSON.stringify({ name, args, prompt, cwd: process.cwd() }))
  if (scenario === 'limit') {
    if (name === 'codex') out({ type: 'turn.failed', error: { message: 'You have hit your usage limit. Try again later.' } })
    else out({ type: 'result', subtype: 'error_during_execution', is_error: true, result: 'Claude usage limit reached' })
    process.exit(1)
  }
  if (scenario === 'down') {
    process.stderr.write('error: ECONNREFUSED api\n')
    process.exit(1)
  }
  if (scenario === 'slow') {
    process.on('SIGINT', () => process.exit(130))
    await new Promise((r) => setTimeout(r, 30_000))
  }
  if (name === 'codex') {
    out({ type: 'thread.started', thread_id: 't1' })
    out({ type: 'turn.started' })
    out({ type: 'item.completed', item: { id: 'i1', type: 'agent_message', text: 'Your notes say compost, loam and grit.' } })
    out({ type: 'turn.completed', usage: { input_tokens: 900, cached_input_tokens: 0, output_tokens: 40 } })
  } else {
    out({ type: 'system', subtype: 'init' })
    for (const piece of ['Your notes say ', 'compost, loam and grit.'])
      out({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: piece } } })
    out({
      type: 'rate_limit_event',
      rate_limit_info: {
        status: 'allowed',
        unifiedWindows: { five_hour: { utilization: 0.38, resetsAt: 1794917533 }, seven_day: { utilization: 0.12, resetsAt: 1795417533 } },
      },
    })
    out({ type: 'result', subtype: 'success', is_error: false, result: 'Your notes say compost, loam and grit.', usage: { input_tokens: 1200, output_tokens: 80 } })
  }
  process.exit(0)
})
}
