/**
 * What a vault file is, by its name: a note, a text file for the code editor,
 * an image or PDF to preview, or something else.
 *
 * Only `.md` is a note - the one kind the index, the bots, backlinks and
 * topics see. Everything else is a file. A name this list does not know
 * is not given up on: the code editor asks main whether its bytes are text,
 * and shows the binary card only if they are not.
 */

export type FileKind = 'note' | 'code' | 'image' | 'pdf' | 'other'

const IMAGE = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif', 'bmp', 'ico'])

const CODE = new Set([
  ...['json', 'jsonl', 'ndjson', 'csv', 'tsv', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf', 'env', 'properties'],
  ...['txt', 'text', 'log', 'markdown', 'mdx', 'rst', 'org', 'adoc', 'tex', 'bib', 'canvas', 'diff', 'patch'],
  ...['js', 'mjs', 'cjs', 'jsx', 'ts', 'mts', 'cts', 'tsx', 'vue', 'svelte', 'css', 'scss', 'sass', 'less', 'html', 'htm', 'xml'],
  ...['py', 'rb', 'go', 'rs', 'java', 'kt', 'swift', 'c', 'h', 'cc', 'cpp', 'hpp', 'cs', 'php', 'lua', 'r', 'pl', 'dart', 'scala'],
  ...['sh', 'bash', 'zsh', 'fish', 'ps1', 'bat', 'sql', 'graphql', 'gql', 'proto', 'dockerfile', 'makefile', 'cmake', 'gradle'],
])

/** The lower-case extension, or '' for a name without one ('Makefile', '.env' counts as 'env'). */
export function extensionOf(path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1)
  const dot = name.lastIndexOf('.')
  return dot === -1 ? '' : name.slice(dot + 1).toLowerCase()
}

export function fileKind(path: string): FileKind {
  const ext = extensionOf(path)
  if (ext === 'md') return 'note'
  if (IMAGE.has(ext)) return 'image'
  if (ext === 'pdf') return 'pdf'
  // No extension: README, Makefile, LICENSE - text, as a rule.
  if (ext === '' || CODE.has(ext)) return 'code'
  return 'other'
}

/** Above this a text file opens read-only: CodeMirror copes, typing into it does not. */
export const READ_ONLY_BYTES = 5 * 1024 * 1024
/** Above this it is not loaded at all - Show in Finder instead. */
export const TOO_LARGE_BYTES = 50 * 1024 * 1024

/** What main says about a file asked for as text. */
export type TextFileResult =
  | { ok: true; content: string; size: number; readOnly: boolean }
  | { ok: false; reason: 'binary' | 'encoding' | 'too-large' | 'error'; error: string; size?: number }
