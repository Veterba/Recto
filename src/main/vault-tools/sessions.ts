import { randomBytes } from 'node:crypto'

/**
 * A session: one run of one of Recto's own providers, with what it may do.
 * Clients connected from outside (Claude Code, Cursor…) have none and get
 * the vault's AI settings as they are. A provider run gets a session, and
 * its calls - in this process, or from a CLI through the MCP socket with
 * `--session <id>` - carry it:
 *
 * - `tools`: the only tools it may call (Quick ask has a handful);
 * - `notes`: the only notes it may see (Quick ask: the open note and its links);
 * - `writable`: the only notes it may change (Quick ask: the open note);
 * - writes always wait for Apply, whatever the write mode says - a chat
 *   inside Recto suggests, it never writes on its own.
 */

export type ToolSession = {
  id: string
  /** Who is asking, for the activity log: "recto-chat · codex". */
  client: string
  tools: ReadonlySet<string> | null
  notes: ReadonlySet<string> | null
  writable: ReadonlySet<string> | null
  /** Notes its tools returned text from: the answer's sources. */
  seen: Set<string>
  /** Every call, as it starts and as it ends: the steps card. */
  onCall?: (call: SessionCall) => void
}

export type SessionCall = { n: number; tool: string; args: Record<string, unknown>; phase: 'start' | 'end'; ok?: boolean; error?: string }

const sessions = new Map<string, ToolSession>()

export function openSession(s: Omit<ToolSession, 'id' | 'seen'>): ToolSession {
  const session: ToolSession = { ...s, id: randomBytes(12).toString('hex'), seen: new Set() }
  sessions.set(session.id, session)
  return session
}

export const closeSession = (id: string): boolean => sessions.delete(id)

export const sessionNamed = (id: string | undefined): ToolSession | null => (id === undefined ? null : (sessions.get(id) ?? null))
