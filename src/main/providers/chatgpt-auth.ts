import { providerBase } from '../config'
import { createHash, createPublicKey, randomBytes, randomUUID, verify, type JsonWebKey } from 'node:crypto'
import http from 'node:http'
import type { ProviderModel } from '../../shared/providers'
import { logProvider } from './log'
import { problemOf } from './openai'
import { ProviderError } from './run'
import type { SecretStore } from './store'


/** How long a request to OpenAI's sign-in or models may take before it counts as down. */
const NETWORK_TIMEOUT_MS = 15_000
const timed = (): AbortSignal => AbortSignal.timeout(NETWORK_TIMEOUT_MS)

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
/** Refresh errors OpenAI lists as an unusable refresh token: sign in again (developers.openai.com/siwc, Errors and recovery). */
const UNUSABLE_GRANT = new Set(['invalid_grant', 'invalid_refresh_token', 'token_expired', 'refresh_token_expired', 'refresh_token_invalidated', 'refresh_token_reused'])

export type ChatGptRecord = {
  clientId: string
  hostId: string
  subject: string
  email: string | null
  idToken: string
  accessToken: string | null
  refreshToken: string | null
  expiresAt: number
  /** Before this (ms), a refresh is not asked for: OpenAI's `earliest_refresh_at`, or a minute after the token came. */
  refreshFrom?: number
  scopes: string[]
}

/** How long a new access token is taken as fresh when OpenAI does not say: a 401 then is not about its age. */
const FRESH_MS = 60_000

/**
 * `earliest_refresh_at` as epoch ms, in whatever form it comes: epoch seconds or ms, or a date. OpenAI's token
 * reference names the field without its format.
 */
function epochMs(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value > 1e12 ? value : value * 1000
  if (typeof value === 'string' && value !== '') {
    const n = Number(value)
    if (Number.isFinite(n)) return n > 1e12 ? n : n * 1000
    const at = Date.parse(value)
    return Number.isNaN(at) ? null : at
  }
  return null
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
    return this.deps.authBase ?? providerBase('RECTO_SIWC_AUTH_BASE') ?? 'https://auth.openai.com'
  }
  private get apiBase(): string {
    return this.deps.apiBase ?? providerBase('RECTO_OPENAI_BASE') ?? 'https://api.openai.com/v1'
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
    logProvider(`chatgpt sign-in start: ${first ? 'first, registering' : `again, as ${previous.clientId}`} port=${port}`)
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

    let back: { query: URLSearchParams; reply: (page: Page) => void }
    try {
      const waiting = callback(server, state, (cancel) => (this.cancelSignIn = cancel))
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
      back.reply(
        done.plan
          ? { ok: true, title: 'Signed in to ChatGPT', text: 'Recto can now answer with your ChatGPT plan.' }
          : { ok: false, title: 'Signed in, without plan usage', text: 'Plan usage was not allowed. In Recto, continue with ChatGPT again and allow it.' },
      )
      return done
    } catch (err) {
      back.reply({ ok: false, title: 'Recto couldn’t sign in', text: err instanceof Error ? err.message : String(err) })
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
    }).catch((err: unknown) => {
      if (!(err instanceof ProviderError && err.problem.kind === 'expired')) throw err
      // The code refused. OpenAI: keep the issued client id and start a fresh authorization with it - registering
      // again each time only makes another. The tokens of a sign-in before this one stay as they were.
      if (first) this.save({ clientId, hostId, subject: '', email: null, idToken: '', accessToken: null, refreshToken: null, expiresAt: 0, scopes: [] })
      logProvider(`chatgpt sign-in: the code was refused for ${clientId}; the registration is kept for the next try`)
      // What OpenAI does not say: other apps that use this preview see it for accounts whose plan it does not
      // cover - plan use in other apps needs Plus or Pro on a personal account.
      throw new ProviderError({
        kind: 'not-eligible',
        message:
          'OpenAI did not accept the sign-in. Using a ChatGPT plan in other apps needs ChatGPT Plus or Pro on a personal account - not Free, Go or a work workspace. With one of those, try again.',
      })
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
      refreshFrom: tokens.refreshFrom ?? this.now() + FRESH_MS,
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

  /**
   * One refresh at a time; a 401 mid-answer asks for one too. True when there is a new token; false when the
   * one there is still fresh - asked again so soon, OpenAI refuses the refresh, and a refused refresh signed
   * the person out, so a refusal of the account read as an expired sign-in.
   */
  async refresh(): Promise<boolean> {
    const r = this.record()
    if (r !== null && r.refreshFrom !== undefined && this.now() < r.refreshFrom) {
      logProvider('chatgpt refresh skipped: the token is fresh')
      return false
    }
    this.refreshing ??= this.doRefresh().finally(() => (this.refreshing = null))
    await this.refreshing
    return this.record()?.accessToken != null
  }

  private async doRefresh(): Promise<void> {
    const r = this.record()
    if (r === null || r.refreshToken === null) return
    try {
      const t = await this.tokenRequest({ grant_type: 'refresh_token', client_id: r.clientId, refresh_token: r.refreshToken, resource: RESOURCE })
      // Signed out while it was asked (the tokens gone, or another sign-in since): the new tokens are not saved
      // over that - a sign-out stays a sign-out.
      const now = this.record()
      if (now === null || now.refreshToken !== r.refreshToken) return
      this.save({
        ...now,
        accessToken: t.accessToken,
        // OpenAI rotates refresh tokens, so a reply carries a new one; one that leaves it out keeps the old,
        // rather than saving nothing and signing the person out at the next refresh.
        refreshToken: t.refreshToken === '' ? r.refreshToken : t.refreshToken,
        idToken: t.idToken === '' ? r.idToken : t.idToken,
        expiresAt: this.now() + t.expiresIn * 1000,
        refreshFrom: t.refreshFrom ?? this.now() + FRESH_MS,
        scopes: t.scopes ?? r.scopes,
      })
    } catch (err) {
      // The refresh token is spent or revoked: the tokens go, the registration and the hint stay for the next sign-in.
      if (err instanceof ProviderError && err.problem.kind === 'expired') {
        const now = this.record()
        if (now !== null && now.refreshToken === r.refreshToken) this.save({ ...now, accessToken: null, refreshToken: null })
      }
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
        const config = (await (await fetch(`${this.authBase}/.well-known/openid-configuration`, { signal: timed() })).json()) as { revocation_endpoint?: string }
        if (typeof config.revocation_endpoint === 'string') {
          const response = await fetch(config.revocation_endpoint, {
            signal: timed(),
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

  /**
   * The models this account may use, in OpenAI's order. OpenAI refusing to
   * list them throws its reason: Settings says it before any question is asked.
   */
  async models(): Promise<ProviderModel[]> {
    const token = await this.token()
    // Asked each time Settings or the model picker opens: a request that hangs must not hold them.
    const response = await fetch(`${this.apiBase}/models`, { headers: { authorization: `Bearer ${token}` }, signal: timed() }).catch(() => null)
    if (response === null) return []
    if (!response.ok) throw new ProviderError(await problemOf(response, true))
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
    /** OpenAI's `earliest_refresh_at`, epoch ms; null when it is not there. */
    refreshFrom: number | null
    /** Null when the reply leaves it out. */
    scopes: string[] | null
  }> {
    let response: Response
    try {
      response = await fetch(`${this.authBase}/api/accounts/oauth/token`, {
        signal: timed(),
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(form).toString(),
      })
    } catch {
      logProvider(`chatgpt token ${form['grant_type']}: could not reach OpenAI`)
      throw new ProviderError({ kind: 'down', message: 'OpenAI’s sign-in could not be reached. Try again in a moment.' })
    }
    const body = (await response.json().catch(() => ({}))) as Record<string, unknown>
    logProvider(
      `chatgpt token ${form['grant_type']}: ${response.status}` +
        (response.ok
          ? ` expires_in=${String(body['expires_in'])} earliest_refresh_at=${String(body['earliest_refresh_at'])} new_refresh_token=${typeof body['refresh_token'] === 'string'} scope="${String(body['scope'] ?? '')}"`
          : ` ${JSON.stringify(body)} sent=${Object.keys(form).join(',')}`),
    )
    if (!response.ok) {
      const code = String(body['error'] ?? '')
      // Busy, slow or down: the sign-in stands, and the next try may work.
      if (response.status >= 500 || response.status === 429 || response.status === 408)
        throw new ProviderError({ kind: 'down', message: 'OpenAI’s sign-in is not answering. Try again in a moment.' })
      if (code === 'invalid_client') throw new ProviderError({ kind: 'failed', message: 'OpenAI no longer knows this Recto registration.' })
      // Only a refresh token OpenAI calls unusable means the sign-in itself is over (OAuth 2.0, RFC 6749 §5.2, and
      // OpenAI's "Errors and recovery"): the tokens go then, and only then.
      if (UNUSABLE_GRANT.has(code)) throw new ProviderError({ kind: 'expired', message: 'The ChatGPT sign-in expired. Sign in again.' })
      throw new ProviderError({ kind: 'failed', message: `OpenAI’s sign-in refused the request (${code === '' ? response.status : code}). Try again.` })
    }
    if (typeof body['access_token'] !== 'string' || body['access_token'] === '')
      throw new ProviderError({ kind: 'failed', message: 'OpenAI’s sign-in answered without a token. Try again.' })
    const scope = typeof body['scope'] === 'string' ? body['scope'].split(' ').filter((s) => s !== '') : null
    return {
      accessToken: String(body['access_token'] ?? ''),
      refreshToken: String(body['refresh_token'] ?? ''),
      idToken: typeof body['id_token'] === 'string' ? body['id_token'] : '',
      expiresIn: typeof body['expires_in'] === 'number' ? body['expires_in'] : 3600,
      refreshFrom: epochMs(body['earliest_refresh_at']),
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
    const config = (await (await fetch(`${this.authBase}/.well-known/openid-configuration`, { signal: timed() })).json()) as { jwks_uri?: string; issuer?: string }
    const keys = ((await (await fetch(String(config.jwks_uri), { signal: timed() })).json()) as { keys?: (JsonWebKey & { kid?: string })[] }).keys ?? []
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

/** What the browser tab says at the end of a sign-in: a heading, what happened, and that the tab may close. */
type Page = { ok: boolean; title: string; text: string }

/**
 * The page in the browser tab: a small card in the middle, in the system's
 * font, light or dark as the system is - plain enough to read at a glance in
 * any window size. Every text is escaped: an error message can carry anything.
 */
const PAGE = ({ ok, title, text }: Page): string => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Recto · ${escapeHtml(title)}</title>
<style>
:root{color-scheme:light dark;--bg:#f5f5f4;--card:#fff;--ink:#1c1c1e;--muted:#6e6e73;--rim:rgba(0,0,0,.08);--mark:${ok ? '#2f9e5b' : '#d9534f'}}
@media (prefers-color-scheme:dark){:root{--bg:#1c1c1e;--card:#2c2c2e;--ink:#f2f2f7;--muted:#a1a1a6;--rim:rgba(255,255,255,.08)}}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:var(--bg);color:var(--ink);font:15px/1.5 -apple-system,BlinkMacSystemFont,"SF Pro Text",system-ui,sans-serif}
main{width:100%;max-width:440px;padding:28px 28px 24px;background:var(--card);border-radius:16px;box-shadow:0 0 0 1px var(--rim),0 12px 32px rgba(0,0,0,.08)}
.mark{width:36px;height:36px;border-radius:50%;display:grid;place-items:center;background:var(--mark);color:#fff;font-size:20px;font-weight:600;margin-bottom:14px}
h1{margin:0 0 8px;font-size:19px;font-weight:600;letter-spacing:-.01em}
p{margin:0}
.close{margin-top:18px;color:var(--muted);font-size:13px}
</style></head>
<body><main>
<div class="mark" aria-hidden="true">${ok ? '✓' : '!'}</div>
<h1>${escapeHtml(title)}</h1>
<p>${escapeHtml(text)}</p>
<p class="close">You can close this tab and go back to Recto.</p>
</main></body></html>`

/**
 * Waits for the browser at the callback path; anything else gets a 404. The
 * page is answered only once Recto has finished (`reply`), so it says what
 * really happened - not "signed in" before the code was even exchanged.
 */
function callback(
  server: http.Server,
  state: string,
  onCancel: (cancel: () => void) => void,
): Promise<{ query: URLSearchParams; reply: (page: Page) => void }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new ProviderError({ kind: 'signed-out', message: 'Sign-in timed out. Try again.' })), SIGN_IN_TIMEOUT_MS)
    onCancel(() => {
      clearTimeout(timer)
      reject(new ProviderError({ kind: 'signed-out', message: 'Sign-in was cancelled.' }))
    })
    let answered = false
    server.on('request', (req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      if (url.pathname !== CALLBACK_PATH) {
        res.writeHead(404).end()
        return
      }
      const query = url.searchParams
      logProvider(
        `chatgpt callback: ${[...query.keys()].join(',')} state=${query.get('state') === state ? 'this sign-in' : 'another'} client_id=${query.get('client_id') ?? '-'} error=${query.get('error') ?? '-'}${answered ? ' (after the first)' : ''}`,
      )
      // An older sign-in's page finishing in another tab, or the same page asked twice: it never ends this one.
      if (query.get('state') !== state || answered) {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
        res.end(
          PAGE(
            answered
              ? { ok: true, title: 'Already done', text: 'Recto already has this sign-in.' }
              : { ok: false, title: 'An older sign-in page', text: 'This page is from an earlier sign-in. Recto is waiting for the newest one.' },
          ),
        )
        return
      }
      answered = true
      clearTimeout(timer)
      resolve({
        query: url.searchParams,
        reply: (page) => {
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
          res.end(PAGE(page))
        },
      })
    })
  })
}

const escapeHtml = (text: string): string => text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
