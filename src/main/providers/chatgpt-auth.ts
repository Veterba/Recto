import { createHash, createPublicKey, randomBytes, randomUUID, verify, type JsonWebKey } from 'node:crypto'
import http from 'node:http'
import type { ProviderModel } from '../../shared/providers'
import { ProviderError } from './run'
import type { SecretStore } from './store'

/**
 * Sign in with ChatGPT, the open-source path (OpenAI's "token sharing"
 * preview): OAuth with PKCE in the system browser, back to a listener on
 * 127.0.0.1, then the plan's access token used with the Responses API.
 *
 * - The first sign-in registers Recto (`dynamic_agent_client`) and OpenAI
 *   hands back this install's own client id, kept and used from then on.
 * - A host id (`urn:uuid:…`) is made once per install and sent every time.
 * - Plan usage is its own scope (`chatgpt.tokens.use.direct`): a sign-in
 *   without it is kept but cannot answer.
 * - Tokens live in main only (store.ts), refreshed one at a time - the
 *   refresh token is replaced on every refresh, so two at once would race.
 * - Nothing of Codex's is read or reused: not its client id, not its tokens.
 */

const SCOPES = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct'
const PLAN_SCOPE = 'chatgpt.tokens.use.direct'
const RESOURCE = 'https://api.openai.com/v1'
const REGISTER = 'dynamic_agent_client'
const CALLBACK_PATH = '/auth/callback'
const PREFERRED_PORT = 1455
/** How long the browser has to come back. */
const SIGN_IN_TIMEOUT_MS = 5 * 60_000
/** Refresh this long before the access token runs out. */
const EARLY_MS = 2 * 60_000

export type ChatGptRecord = {
  clientId: string
  hostId: string
  subject: string
  email: string | null
  idToken: string
  accessToken: string | null
  refreshToken: string | null
  expiresAt: number
  scopes: string[]
}

export type AuthDeps = {
  store: SecretStore
  /** Opens the authorize page in the person's browser. */
  open: (url: string) => void
  authBase?: string
  apiBase?: string
  now?: () => number
}

const RECORD = 'chatgpt'
const HOST = 'chatgpt-host'

const b64url = (buf: Buffer): string => buf.toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')

export class ChatGptAuth {
  private refreshing: Promise<void> | null = null
  private cancelSignIn: (() => void) | null = null

  constructor(private readonly deps: AuthDeps) {}

  private get authBase(): string {
    return this.deps.authBase ?? process.env['RECTO_SIWC_AUTH_BASE'] ?? 'https://auth.openai.com'
  }
  private get apiBase(): string {
    return this.deps.apiBase ?? process.env['RECTO_OPENAI_BASE'] ?? 'https://api.openai.com/v1'
  }
  private now(): number {
    return this.deps.now?.() ?? Date.now()
  }

  record(): ChatGptRecord | null {
    const raw = this.deps.store.read(RECORD)
    if (raw === null) return null
    try {
      return JSON.parse(raw) as ChatGptRecord
    } catch {
      return null
    }
  }

  private save(record: ChatGptRecord): void {
    const saved = this.deps.store.write(RECORD, JSON.stringify(record))
    if (!saved.ok) throw new ProviderError({ kind: 'failed', message: saved.error ?? 'The sign-in could not be saved.' })
  }

  /** This install's host id, made once. */
  private hostId(): string {
    const known = this.record()?.hostId ?? this.deps.store.read(HOST)
    if (known !== null) return known
    const made = `urn:uuid:${randomUUID()}`
    this.deps.store.write(HOST, made)
    return made
  }

  /** Signed in, with plan usage granted and a refresh token to keep going. */
  signedIn(): boolean {
    const r = this.record()
    return r !== null && r.refreshToken !== null
  }

  planAllowed(): boolean {
    return this.record()?.scopes.includes(PLAN_SCOPE) ?? false
  }

  /** Stops a sign-in waiting for the browser. */
  cancel(): void {
    this.cancelSignIn?.()
  }

  /** The whole sign-in: browser out, callback back, code exchanged, ID token checked, saved. */
  async signIn(): Promise<{ email: string | null; plan: boolean }> {
    this.cancel()
    const previous = this.record()
    const hostId = this.hostId()
    const verifier = b64url(randomBytes(32))
    const state = b64url(randomBytes(16))
    const nonce = b64url(randomBytes(16))
    const { server, port } = await listen()
    const redirectUri = `http://127.0.0.1:${port}${CALLBACK_PATH}`
    const first = previous === null
    const params = new URLSearchParams({
      client_id: first ? REGISTER : previous.clientId,
      ...(first ? { agent_name_hint: 'Recto' } : {}),
      ext_agent_host_id: hostId,
      ...(!first && previous.idToken !== '' ? { id_token_hint: previous.idToken } : {}),
      response_type: 'code',
      redirect_uri: redirectUri,
      scope: SCOPES,
      resource: RESOURCE,
      state,
      nonce,
      code_challenge_method: 'S256',
      code_challenge: b64url(createHash('sha256').update(verifier).digest()),
    })

    let back: { query: URLSearchParams; reply: (ok: boolean, text: string) => void }
    try {
      const waiting = callback(server, (cancel) => (this.cancelSignIn = cancel))
      this.deps.open(`${this.authBase}/api/accounts/authorize?${params.toString()}`)
      back = await waiting
    } catch (err) {
      server.close()
      throw err
    } finally {
      this.cancelSignIn = null
    }

    const { query } = back
    try {
      const done = await this.finish(query, { first, previous, state, verifier, redirectUri, hostId, nonce })
      back.reply(true, done.plan ? 'Signed in. You can close this tab and go back to Recto.' : 'Signed in, but plan usage was not allowed. Go back to Recto to sign in again and allow it.')
      return done
    } catch (err) {
      back.reply(false, err instanceof Error ? err.message : String(err))
      throw err
    } finally {
      server.close()
    }
  }

  /** The callback checked, the code exchanged, the ID token verified, the sign-in saved. */
  private async finish(
    query: URLSearchParams,
    o: { first: boolean; previous: ChatGptRecord | null; state: string; verifier: string; redirectUri: string; hostId: string; nonce: string },
  ): Promise<{ email: string | null; plan: boolean }> {
    const { first, previous, state, verifier, redirectUri, hostId, nonce } = o
    if (query.get('state') !== state) throw new ProviderError({ kind: 'signed-out', message: 'The sign-in came back for a different request. Try again.' })
    const error = query.get('error')
    if (error !== null)
      throw new ProviderError({
        kind: 'signed-out',
        message: error === 'access_denied' ? 'Sign-in was cancelled.' : `Sign-in failed: ${query.get('error_description') ?? error}.`,
      })
    const code = query.get('code')
    const returned = query.get('client_id')
    if (code === null) throw new ProviderError({ kind: 'signed-out', message: 'Sign-in came back without a code. Try again.' })
    if (first && returned === null)
      throw new ProviderError({ kind: 'signed-out', message: 'OpenAI did not finish registering Recto. Try again.' })
    if (!first && returned !== null && returned !== previous!.clientId)
      throw new ProviderError({ kind: 'signed-out', message: 'The sign-in came back for a different app registration. Try again.' })
    const clientId = first ? returned! : previous!.clientId

    const tokens = await this.tokenRequest({
      grant_type: 'authorization_code',
      client_id: clientId,
      code,
      code_verifier: verifier,
      redirect_uri: redirectUri,
      resource: RESOURCE,
    })
    // Checked before anything is saved: a sign-in that fails here leaves the previous one as it was.
    const claims = await this.checkIdToken(tokens.idToken, clientId, nonce)
    const record: ChatGptRecord = {
      clientId,
      hostId,
      subject: claims.sub,
      email: claims.email,
      idToken: tokens.idToken,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: this.now() + tokens.expiresIn * 1000,
      // No `scope` in the reply means it was granted as asked (RFC 6749, 5.1).
      scopes: tokens.scopes ?? SCOPES.split(' '),
    }
    this.save(record)
    return { email: claims.email, plan: record.scopes.includes(PLAN_SCOPE) }

  }

  /** A good access token: refreshed first when it is about to run out. */
  async token(): Promise<string> {
    const r = this.record()
    if (r === null || r.refreshToken === null) throw new ProviderError({ kind: 'signed-out', message: 'Sign in with ChatGPT in Settings → AI.' })
    if (!r.scopes.includes(PLAN_SCOPE))
      throw new ProviderError({ kind: 'signed-out', message: 'Plan usage was not allowed at sign-in. Sign in again and allow it.' })
    if (r.accessToken !== null && r.expiresAt - EARLY_MS > this.now()) return r.accessToken
    await this.refresh()
    const fresh = this.record()
    if (fresh?.accessToken == null) throw new ProviderError({ kind: 'expired', message: 'The ChatGPT sign-in expired. Sign in again.' })
    return fresh.accessToken
  }

  /** One refresh at a time; a 401 mid-answer asks for one too. True when there is a new token. */
  async refresh(): Promise<boolean> {
    this.refreshing ??= this.doRefresh().finally(() => (this.refreshing = null))
    await this.refreshing
    return this.record()?.accessToken != null
  }

  private async doRefresh(): Promise<void> {
    const r = this.record()
    if (r === null || r.refreshToken === null) return
    try {
      const t = await this.tokenRequest({ grant_type: 'refresh_token', client_id: r.clientId, refresh_token: r.refreshToken, resource: RESOURCE })
      this.save({
        ...r,
        accessToken: t.accessToken,
        refreshToken: t.refreshToken,
        idToken: t.idToken === '' ? r.idToken : t.idToken,
        expiresAt: this.now() + t.expiresIn * 1000,
        scopes: t.scopes ?? r.scopes,
      })
    } catch (err) {
      // The refresh token is spent or revoked: the tokens go, the registration and the hint stay for the next sign-in.
      if (err instanceof ProviderError && err.problem.kind === 'expired') this.save({ ...r, accessToken: null, refreshToken: null })
      throw err
    }
  }

  /** Out: the refresh token revoked at OpenAI (best effort), the tokens forgotten, the registration kept. */
  async signOut(): Promise<{ revoked: boolean }> {
    const r = this.record()
    if (r === null) return { revoked: true }
    let revoked = r.refreshToken === null
    if (r.refreshToken !== null) {
      try {
        const config = (await (await fetch(`${this.authBase}/.well-known/openid-configuration`)).json()) as { revocation_endpoint?: string }
        if (typeof config.revocation_endpoint === 'string') {
          const response = await fetch(config.revocation_endpoint, {
            method: 'POST',
            headers: { 'content-type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ token: r.refreshToken, token_type_hint: 'refresh_token', client_id: r.clientId }).toString(),
          })
          revoked = response.ok
        }
      } catch {
        revoked = false
      }
    }
    this.save({ ...r, accessToken: null, refreshToken: null })
    return { revoked }
  }

  /** The models this account may use, in OpenAI's order. */
  async models(): Promise<ProviderModel[]> {
    const response = await fetch(`${this.apiBase}/models`, { headers: { authorization: `Bearer ${await this.token()}` } })
    if (!response.ok) return []
    const body = (await response.json()) as { models?: { slug?: unknown; display_name?: unknown; visibility?: unknown }[] }
    return (body.models ?? [])
      .filter((m) => m.visibility === 'list' && typeof m.slug === 'string')
      .map((m) => ({ id: String(m.slug), label: typeof m.display_name === 'string' ? m.display_name : String(m.slug) }))
  }

  private async tokenRequest(form: Record<string, string>): Promise<{
    accessToken: string
    refreshToken: string
    idToken: string
    expiresIn: number
    /** Null when the reply leaves it out. */
    scopes: string[] | null
  }> {
    let response: Response
    try {
      response = await fetch(`${this.authBase}/api/accounts/oauth/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(form).toString(),
      })
    } catch {
      throw new ProviderError({ kind: 'down', message: 'OpenAI’s sign-in could not be reached. Try again in a moment.' })
    }
    const body = (await response.json().catch(() => ({}))) as Record<string, unknown>
    if (!response.ok) {
      const code = String(body['error'] ?? '')
      if (response.status >= 500) throw new ProviderError({ kind: 'down', message: 'OpenAI’s sign-in is not answering. Try again in a moment.' })
      if (code === 'invalid_client') throw new ProviderError({ kind: 'failed', message: 'OpenAI no longer knows this Recto registration.' })
      throw new ProviderError({ kind: 'expired', message: 'The ChatGPT sign-in expired. Sign in again.' })
    }
    const scope = typeof body['scope'] === 'string' ? body['scope'].split(' ').filter((s) => s !== '') : null
    return {
      accessToken: String(body['access_token'] ?? ''),
      refreshToken: String(body['refresh_token'] ?? ''),
      idToken: typeof body['id_token'] === 'string' ? body['id_token'] : '',
      expiresIn: typeof body['expires_in'] === 'number' ? body['expires_in'] : 3600,
      scopes: scope,
    }
  }

  /** The ID token's signature (OpenAI's published keys), issuer, audience, expiry and nonce. */
  private async checkIdToken(token: string, clientId: string, nonce: string): Promise<{ sub: string; email: string | null }> {
    const fail = (why: string): never => {
      throw new ProviderError({ kind: 'signed-out', message: `The sign-in could not be verified (${why}). Try again.` })
    }
    const [head, payload, signature] = token.split('.')
    if (head === undefined || payload === undefined || signature === undefined) return fail('no ID token')
    const header = JSON.parse(Buffer.from(head, 'base64url').toString()) as { kid?: string; alg?: string }
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString()) as Record<string, unknown>
    if (header.alg !== 'RS256') return fail('unexpected signature type')
    const config = (await (await fetch(`${this.authBase}/.well-known/openid-configuration`)).json()) as { jwks_uri?: string; issuer?: string }
    const keys = ((await (await fetch(String(config.jwks_uri))).json()) as { keys?: (JsonWebKey & { kid?: string })[] }).keys ?? []
    const jwk = keys.find((k) => k.kid === header.kid)
    if (jwk === undefined) return fail('unknown key')
    const good = verify('RSA-SHA256', Buffer.from(`${head}.${payload}`), createPublicKey({ key: jwk, format: 'jwk' }), Buffer.from(signature, 'base64url'))
    if (!good) return fail('bad signature')
    const audience = Array.isArray(claims['aud']) ? claims['aud'] : [claims['aud']]
    if (claims['iss'] !== (config.issuer ?? this.authBase)) return fail('wrong issuer')
    if (!audience.includes(clientId)) return fail('wrong audience')
    if (typeof claims['exp'] !== 'number' || claims['exp'] * 1000 < this.now()) return fail('expired')
    if (claims['nonce'] !== nonce) return fail('wrong nonce')
    if (typeof claims['sub'] !== 'string') return fail('no subject')
    return { sub: claims['sub'], email: typeof claims['email'] === 'string' ? claims['email'] : null }
  }
}

/** The loopback listener: OpenAI's preferred port when it is free, any port otherwise (only the port may change). */
function listen(): Promise<{ server: http.Server; port: number }> {
  const at = (port: number): Promise<{ server: http.Server; port: number }> =>
    new Promise((resolve, reject) => {
      const server = http.createServer()
      server.once('error', reject)
      server.listen(port, '127.0.0.1', () => resolve({ server, port: (server.address() as { port: number }).port }))
    })
  return at(PREFERRED_PORT).catch(() => at(0))
}

const PAGE = (text: string): string =>
  `<!doctype html><meta charset="utf-8"><title>Recto</title><body style="font:16px -apple-system,sans-serif;display:grid;place-items:center;height:90vh;color:#222"><p>${text}</p></body>`

/**
 * Waits for the browser at the callback path; anything else gets a 404. The
 * page is answered only once Recto has finished (`reply`), so it says what
 * really happened - not "signed in" before the code was even exchanged.
 */
function callback(
  server: http.Server,
  onCancel: (cancel: () => void) => void,
): Promise<{ query: URLSearchParams; reply: (ok: boolean, text: string) => void }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new ProviderError({ kind: 'signed-out', message: 'Sign-in timed out. Try again.' })), SIGN_IN_TIMEOUT_MS)
    onCancel(() => {
      clearTimeout(timer)
      reject(new ProviderError({ kind: 'signed-out', message: 'Sign-in was cancelled.' }))
    })
    server.on('request', (req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      if (url.pathname !== CALLBACK_PATH) {
        res.writeHead(404).end()
        return
      }
      clearTimeout(timer)
      resolve({
        query: url.searchParams,
        reply: (ok, text) => {
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
          res.end(PAGE(ok ? text : `Recto could not finish signing in: ${escapeHtml(text)} Go back to Recto to try again.`))
        },
      })
    })
  })
}

const escapeHtml = (text: string): string => text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
