import { createSign, generateKeyPairSync } from 'node:crypto'
import http from 'node:http'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

/**
 * Sign in with ChatGPT against a mocked auth server and a mocked Responses
 * API, all on 127.0.0.1: the authorize request as OpenAI's preview asks for
 * it, the callback checked, the ID token verified, refresh and its failure,
 * sign-out; then an answer with a tool call in the middle, and the plan's
 * error codes as problems the person can act on.
 */

const calls: { tool: string; args: unknown }[] = []
vi.mock('../../src/main/vault-tools', () => ({
  callTool: async (tool: string, args: unknown) => {
    calls.push({ tool, args })
    return { ok: true, blocks: [{ kind: 'note', path: 'Garden/Soil.md', text: 'compost, loam, grit' }] }
  },
}))

const { ChatGptAuth } = await import('../../src/main/providers/chatgpt-auth')
const { responsesModel } = await import('../../src/main/providers/openai')
const { ProviderError, toolLoop } = await import('../../src/main/providers/run')
const { VAULT_TOOLS } = await import('../../src/shared/vault-tools')

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' }

let base = ''
let server: http.Server
/** What the mocked servers do next. */
const mock = {
  tokenStatus: 200,
  issued: 'oaiapp_test123',
  nonce: '',
  refreshes: 0,
  revoked: [] as string[],
  responses: [] as (() => { status: number; body: string; sse: boolean })[],
  requests: [] as Record<string, unknown>[],
  /** The scope the token reply says it granted; null leaves it out. */
  scope: 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct' as string | null,
  /** What the browser was shown at the callback. */
  page: Promise.resolve(''),
}

const b64 = (o: unknown): string => Buffer.from(JSON.stringify(o)).toString('base64url')
function idToken(aud: string, nonce: string): string {
  const head = b64({ alg: 'RS256', kid: 'k1' })
  const body = b64({ iss: base, aud, sub: 'user-1', email: 'me@example.com', nonce, exp: Math.floor(Date.now() / 1000) + 3600 })
  const sign = createSign('RSA-SHA256')
  sign.update(`${head}.${body}`)
  return `${head}.${body}.${sign.sign(privateKey).toString('base64url')}`
}

const read = (req: http.IncomingMessage): Promise<string> =>
  new Promise((resolve) => {
    let data = ''
    req.on('data', (c: Buffer) => (data += c.toString()))
    req.on('end', () => resolve(data))
  })

beforeAll(async () => {
  server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', base)
    const body = await read(req)
    const json = (status: number, value: unknown): void => {
      res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(value))
    }
    if (url.pathname === '/.well-known/openid-configuration') return json(200, { issuer: base, jwks_uri: `${base}/jwks`, revocation_endpoint: `${base}/revoke` })
    if (url.pathname === '/jwks') return json(200, { keys: [jwk] })
    if (url.pathname === '/revoke') {
      mock.revoked.push(new URLSearchParams(body).get('token') ?? '')
      return res.writeHead(200).end()
    }
    if (url.pathname === '/api/accounts/oauth/token') {
      const form = new URLSearchParams(body)
      if (mock.tokenStatus !== 200) return json(mock.tokenStatus, { error: 'invalid_grant' })
      if (form.get('grant_type') === 'refresh_token') mock.refreshes++
      expect(form.get('resource')).toBe('https://api.openai.com/v1')
      expect(form.get('client_id')).toBe(mock.issued)
      return json(200, {
        access_token: `access-${mock.refreshes}`,
        refresh_token: `refresh-${mock.refreshes}`,
        id_token: idToken(mock.issued, mock.nonce),
        token_type: 'Bearer',
        expires_in: 3600,
        ...(mock.scope === null ? {} : { scope: mock.scope }),
      })
    }
    if (url.pathname === '/v1/models') return json(200, { models: [{ slug: 'gpt-test', display_name: 'GPT Test', visibility: 'list' }, { slug: 'hidden', visibility: 'hide' }] })
    if (url.pathname === '/v1/responses') {
      mock.requests.push(JSON.parse(body) as Record<string, unknown>)
      const next = mock.responses.shift()!()
      res.writeHead(next.status, { 'content-type': next.sse ? 'text/event-stream' : 'application/json' }).end(next.body)
      return
    }
    res.writeHead(404).end()
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  process.env['RECTO_OPENAI_BASE'] = `${base}/v1`
})
afterAll(() => {
  server.close()
  delete process.env['RECTO_OPENAI_BASE']
})
afterEach(() => {
  mock.tokenStatus = 200
  mock.scope = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct'
  mock.responses = []
  mock.requests = []
  calls.length = 0
})

function memoryStore(): { read: (n: string) => string | null; write: (n: string, v: string | null) => { ok: boolean } } {
  const values = new Map<string, string>()
  return {
    read: (n) => values.get(n) ?? null,
    write: (n, v) => {
      if (v === null) values.delete(n)
      else values.set(n, v)
      return { ok: true }
    },
  }
}

/** The browser: checks the authorize URL, then comes back to the callback the way OpenAI would. */
function browser(check: (params: URLSearchParams) => void, back: (params: URLSearchParams) => Record<string, string>) {
  return (url: string): void => {
    const params = new URL(url).searchParams
    check(params)
    mock.nonce = params.get('nonce') ?? ''
    const redirect = new URL(params.get('redirect_uri')!)
    for (const [k, v] of Object.entries(back(params))) redirect.searchParams.set(k, v)
    mock.page = fetch(redirect).then((r) => r.text())
  }
}

describe('Sign in with ChatGPT', () => {
  it('registers on first sign-in, verifies the ID token, keeps the issued client id and the tokens', async () => {
    const store = memoryStore()
    const auth = new ChatGptAuth({
      store,
      authBase: base,
      apiBase: `${base}/v1`,
      open: browser(
        (p) => {
          expect(p.get('client_id')).toBe('dynamic_agent_client')
          expect(p.get('agent_name_hint')).toBe('Recto')
          expect(p.get('ext_agent_host_id')).toMatch(/^urn:uuid:/)
          expect(p.get('scope')).toBe('openid profile email offline_access resource.invoke chatgpt.tokens.use.direct')
          expect(p.get('resource')).toBe('https://api.openai.com/v1')
          expect(p.get('code_challenge_method')).toBe('S256')
          expect(p.get('redirect_uri')).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/auth\/callback$/)
        },
        (p) => ({ code: 'c1', state: p.get('state')!, client_id: mock.issued }),
      ),
    })
    expect(await auth.signIn()).toEqual({ email: 'me@example.com', plan: true })
    const record = auth.record()!
    expect(record).toMatchObject({ clientId: 'oaiapp_test123', subject: 'user-1', accessToken: 'access-0', refreshToken: 'refresh-0' })
    expect(await auth.token()).toBe('access-0')
    expect(await auth.models()).toEqual([{ id: 'gpt-test', label: 'GPT Test' }])

    // Signing in again: the issued id, the ID token as a hint, no registration.
    let second: URLSearchParams | null = null
    const again = new ChatGptAuth({
      store,
      authBase: base,
      open: browser(
        (p) => (second = p),
        (p) => ({ code: 'c2', state: p.get('state')! }),
      ),
    })
    await again.signIn()
    expect(second!.get('client_id')).toBe('oaiapp_test123')
    expect(second!.get('agent_name_hint')).toBeNull()
    expect(second!.get('id_token_hint')).toBe(record.idToken)
    expect(second!.get('ext_agent_host_id')).toBe(record.hostId)
  })

  it('refuses a callback with the wrong state, a cancelled consent, and a registration without a client id', async () => {
    const cases: [Record<string, string> | ((p: URLSearchParams) => Record<string, string>), RegExp][] = [
      [{ code: 'c', state: 'forged', client_id: 'x' }, /different request/],
      [(p) => ({ error: 'access_denied', state: p.get('state')! }), /cancelled/],
      [(p) => ({ code: 'c', state: p.get('state')! }), /did not finish registering/],
    ]
    for (const [back, message] of cases) {
      const auth = new ChatGptAuth({ store: memoryStore(), authBase: base, open: browser(() => {}, typeof back === 'function' ? back : () => back) })
      await expect(auth.signIn()).rejects.toThrow(message)
      expect(auth.record()).toBeNull()
    }
  })

  it('says “signed in” in the browser only once Recto has finished, and why not when it has not', async () => {
    const ok = new ChatGptAuth({ store: memoryStore(), authBase: base, open: browser(() => {}, (p) => ({ code: 'c', state: p.get('state')!, client_id: mock.issued })) })
    await ok.signIn()
    expect(await mock.page).toContain('Signed in. You can close this tab')

    mock.tokenStatus = 400
    const failing = new ChatGptAuth({ store: memoryStore(), authBase: base, open: browser(() => {}, (p) => ({ code: 'c', state: p.get('state')!, client_id: mock.issued })) })
    await expect(failing.signIn()).rejects.toThrow()
    const page = await mock.page
    expect(page).toContain('Recto could not finish signing in')
    expect(page).not.toContain('Signed in.')
  })

  it('a token reply without a scope grants what was asked, plan usage included', async () => {
    mock.scope = null
    const auth = new ChatGptAuth({ store: memoryStore(), authBase: base, open: browser(() => {}, (p) => ({ code: 'c', state: p.get('state')!, client_id: mock.issued })) })
    expect(await auth.signIn()).toMatchObject({ plan: true })
    expect(auth.planAllowed()).toBe(true)
  })

  it('refreshes an access token about to run out, once even when asked twice; a dead refresh token signs out', async () => {
    let now = Date.now()
    const auth = new ChatGptAuth({
      store: memoryStore(),
      authBase: base,
      now: () => now,
      open: browser(() => {}, (p) => ({ code: 'c', state: p.get('state')!, client_id: mock.issued })),
    })
    mock.refreshes = 0
    await auth.signIn()
    now += 59 * 60_000
    const [a, b] = await Promise.all([auth.token(), auth.token()])
    expect(a).toBe('access-1')
    expect(b).toBe('access-1')
    expect(mock.refreshes).toBe(1)

    now += 60 * 60_000
    mock.tokenStatus = 400
    await expect(auth.token()).rejects.toMatchObject({ problem: { kind: 'expired' } })
    expect(auth.signedIn()).toBe(false)
    expect(auth.record()?.clientId).toBe('oaiapp_test123')
  })

  it('signs out by revoking the refresh token, and keeps the registration', async () => {
    const auth = new ChatGptAuth({ store: memoryStore(), authBase: base, open: browser(() => {}, (p) => ({ code: 'c', state: p.get('state')!, client_id: mock.issued })) })
    await auth.signIn()
    const token = auth.record()!.refreshToken!
    expect(await auth.signOut()).toEqual({ revoked: true })
    expect(mock.revoked).toContain(token)
    expect(auth.signedIn()).toBe(false)
    expect(auth.record()?.clientId).toBe('oaiapp_test123')
  })
})

const sse = (events: unknown[]): string => events.map((e) => `event: x\ndata: ${JSON.stringify(e)}\n\n`).join('')

describe('the Responses API with Recto’s tools', () => {
  const session = { id: 's', client: 't', tools: null, notes: null, writable: null, seen: new Set<string>(), record: { read: new Set<string>(), skimmed: new Set<string>(), proposals: [] } }
  const run = (plan = true) =>
    toolLoop(responsesModel('gpt-test', { token: async () => 'tok', plan }, VAULT_TOOLS), {
      model: 'chatgpt:gpt-test',
      system: 'You are Recto.',
      messages: [{ role: 'user', content: 'Soil?' }],
      session,
      signal: new AbortController().signal,
    })

  it('runs the call the model asks for, sends its output back with the whole conversation, then streams the answer', async () => {
    mock.responses.push(
      () => ({
        status: 200,
        sse: true,
        body: sse([
          { type: 'response.output_item.done', item: { type: 'reasoning', id: 'rs_1', encrypted_content: 'enc', summary: [] } },
          { type: 'response.output_item.done', item: { type: 'function_call', id: 'fc_1', call_id: 'call_1', name: 'search_notes', arguments: '{"query":"soil"}', status: 'completed' } },
          { type: 'response.completed', response: {} },
        ]),
      }),
      () => ({
        status: 200,
        sse: true,
        body: sse([
          { type: 'response.output_text.delta', delta: 'Compost, ' },
          { type: 'response.output_text.delta', delta: 'loam and grit.' },
          { type: 'response.completed', response: {} },
        ]),
      }),
    )
    let text = ''
    for await (const e of run()) if (e.type === 'text') text += e.text
    expect(text).toBe('Compost, loam and grit.')
    expect(calls).toEqual([{ tool: 'search_notes', args: { query: 'soil' } }])
    const [first, second] = mock.requests
    expect(first).toMatchObject({ model: 'gpt-test', store: false, stream: true, instructions: 'You are Recto.' })
    expect(first).not.toHaveProperty('max_output_tokens')
    expect(first).not.toHaveProperty('previous_response_id')
    const input = second!['input'] as Record<string, unknown>[]
    expect(input[0]).toEqual({ role: 'user', content: 'Soil?' })
    expect(input).toContainEqual({ type: 'reasoning', encrypted_content: 'enc', summary: [] })
    expect(input).toContainEqual({ type: 'function_call', call_id: 'call_1', name: 'search_notes', arguments: '{"query":"soil"}' })
    expect(input.at(-1)).toMatchObject({ type: 'function_call_output', call_id: 'call_1' })
  })

  it('turns the plan’s error codes into problems: limit with Manage usage, not eligible, unavailable, mid-stream failure', async () => {
    const cases: [() => { status: number; body: string; sse: boolean }, string][] = [
      [() => ({ status: 429, sse: false, body: JSON.stringify({ error: { code: 'subscription_sharing_usage_limit_exceeded', message: 'x' } }) }), 'limit'],
      [() => ({ status: 403, sse: false, body: JSON.stringify({ error: { code: 'subscription_sharing_user_not_eligible', message: 'x' } }) }), 'not-eligible'],
      [() => ({ status: 503, sse: false, body: JSON.stringify({ detail: 'direct routing unavailable' }) }), 'down'],
      [() => ({ status: 200, sse: true, body: sse([{ type: 'response.failed', response: { error: { code: 'subscription_sharing_usage_limit_exceeded', message: 'x' } } }]) }), 'limit'],
    ]
    for (const [response, kind] of cases) {
      mock.responses.push(response)
      const error = await (async () => {
        for await (const _ of run()) void _
      })().catch((err: unknown) => err)
      expect(error).toBeInstanceOf(ProviderError)
      expect((error as InstanceType<typeof ProviderError>).problem.kind).toBe(kind)
      if (kind === 'limit') expect((error as InstanceType<typeof ProviderError>).problem.url).toBe('https://chatgpt.com/settings/usage')
    }
  })
})
