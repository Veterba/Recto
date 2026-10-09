import fs from 'node:fs'
import path from 'node:path'
import { DATA_DIR, INDEX_NOTE, findEvalsFolder } from './evals/store.ts'

/**
 * npm run vault:tidy -- --vault <path> [--apply] [--report <file.md>]
 *
 * Undoes what the eval runner and the project log used to write into a vault:
 *
 * - every run folder `Evals Qwen/<model>/<run>/` becomes one note
 *   `Evals Qwen/<model>/Eval <run>.md`; its .json/.jsonl go to the hidden
 *   `.recto/evals/<run>/`; the empty folder goes;
 * - `Evals Qwen/Evals.md` becomes `Recto evals.md` (it clashed with another "Evals");
 * - links to log notes and eval notes written as paths
 *   ([[Recto log/2026-10-03 — v0.43.0|…]], [[…/report|report]]) become
 *   [[Note name]] when that name is unique; so does any link to a note this
 *   moves. Other links - the user's own, [[topics/…]] - are left and listed.
 *
 * Without --apply it only prints the plan and the before/after numbers it
 * expects; with --apply it does it, on the vault given, and checks again.
 */

type Link = { full: string; embed: string; target: string; heading: string | null; alias: string | null; escaped: boolean }

const args = process.argv.slice(2)
const flag = (name: string): string | undefined => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}
const APPLY = args.includes('--apply')

const norm = (s: string): string => s.normalize('NFC').toLowerCase().replace(/\.md$/i, '')
const base = (p: string): string => p.slice(p.lastIndexOf('/') + 1).replace(/\.md$/i, '')
const rel = (vault: string, p: string): string => path.relative(vault, p).split(path.sep).join('/')

/** Every file in the visible tree (no dot folders), vault-relative. */
function filesOf(vault: string): string[] {
  const out: string[] = []
  const walk = (dir: string): void => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith('.')) continue
      const full = path.join(dir, e.name)
      if (e.isDirectory()) walk(full)
      else out.push(rel(vault, full))
    }
  }
  walk(vault)
  return out
}

/** Recto's link resolution (shared/parse.ts resolveLink): exact path, else the shortest note of that name. */
function resolver(notes: readonly string[]): (target: string) => string | null {
  const all = new Set(notes)
  const byName = new Map<string, string[]>()
  for (const p of notes) byName.set(norm(base(p)), [...(byName.get(norm(base(p))) ?? []), p])
  return (target) => {
    const clean = target.replace(/\\/g, '/').replace(/^\.\//, '').trim()
    for (const c of [clean, `${clean}.md`]) if (all.has(c)) return c
    const matches = byName.get(norm(base(clean)))
    if (matches === undefined || matches.length === 0) return null
    if (matches.length === 1) return matches[0]!
    if (clean.includes('/')) {
      const exact = matches.find((p) => norm(p).endsWith(norm(clean)))
      if (exact !== undefined) return exact
    }
    return [...matches].sort((a, b) => a.split('/').length - b.split('/').length || a.length - b.length)[0]!
  }
}

const LINK = /(!?)\[\[([^\]]+?)\]\]/g

/** Code is text, not links - as in Recto's parser: fenced blocks and `inline code` are blanked first. */
const withoutCode = (text: string): string =>
  text.replace(/^(\s*)(```|~~~)[\s\S]*?^\1\2[^\n]*$/gm, (m) => m.replace(/[^\n]/g, ' ')).replace(/`[^`\n]*`/g, (m) => ' '.repeat(m.length))

function linksIn(text: string): Link[] {
  return [...withoutCode(text).matchAll(LINK)].map((m) => {
    const inner = m[2]!
    const escaped = inner.includes('\\|')
    const [head, ...rest] = inner.replace(/\\\|/g, '|').split('|')
    const hash = head!.indexOf('#')
    return {
      full: m[0],
      embed: m[1]!,
      target: (hash === -1 ? head! : head!.slice(0, hash)).trim(),
      heading: hash === -1 ? null : head!.slice(hash + 1),
      alias: rest.length === 0 ? null : rest.join('|'),
      escaped,
    }
  })
}

type Check = { links: number; resolved: number; broken: number; duplicates: string[]; topics: number; visibleData: number }

function check(notes: readonly string[], text: (p: string) => string, files: readonly string[]): Check {
  const resolve = resolver(notes)
  let links = 0
  let resolved = 0
  let topics = 0
  for (const n of notes)
    for (const l of linksIn(text(n))) {
      if (l.target === '') continue
      if (/^topics\//i.test(l.target)) {
        topics++
        continue
      }
      links++
      if (resolve(l.target) !== null) resolved++
    }
  const count = new Map<string, string[]>()
  for (const n of notes) count.set(norm(base(n)), [...(count.get(norm(base(n))) ?? []), n])
  return {
    links,
    resolved,
    broken: links - resolved,
    duplicates: [...count.values()].filter((v) => v.length > 1).map((v) => `${base(v[0]!)} (${v.length})`),
    topics,
    visibleData: files.filter((f) => /\.(json|jsonl)$/i.test(f)).length,
  }
}

function main(): void {
  const vaultArg = flag('--vault')
  if (vaultArg === undefined) throw new Error('Usage: npm run vault:tidy -- --vault <path> [--apply] [--report <file.md>]')
  const vault = path.resolve(vaultArg)
  const evalsAbs = findEvalsFolder(vault)
  const evals = rel(vault, evalsAbs)
  const files = filesOf(vault)
  const notes = files.filter((f) => f.toLowerCase().endsWith('.md'))
  const original = new Map(notes.map((n) => [n, fs.readFileSync(path.join(vault, n), 'utf8')]))

  // ---- moves ----------------------------------------------------------------------
  const moves: { from: string; to: string }[] = []
  const left: string[] = []
  for (const model of fs.readdirSync(evalsAbs, { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith('.'))) {
    for (const run of fs.readdirSync(path.join(evalsAbs, model.name), { withFileTypes: true }).filter((e) => e.isDirectory())) {
      const dir = `${evals}/${model.name}/${run.name}`
      const inside = files.filter((f) => f.startsWith(`${dir}/`))
      const mds = inside.filter((f) => f.toLowerCase().endsWith('.md'))
      if (mds.length !== 1) {
        left.push(`${dir}/: ${mds.length} notes inside, not one - left as it is`)
        continue
      }
      moves.push({ from: mds[0]!, to: `${evals}/${model.name}/Eval ${run.name}.md` })
      for (const f of inside.filter((x) => x !== mds[0])) {
        if (/\.(json|jsonl)$/i.test(f) && !f.slice(dir.length + 1).includes('/'))
          moves.push({ from: f, to: `${DATA_DIR.split(path.sep).join('/')}/${run.name}/${path.basename(f)}` })
        else left.push(`${f}: not a run's data - left`)
      }
    }
  }
  if (files.includes(`${evals}/Evals.md`)) moves.push({ from: `${evals}/Evals.md`, to: `${evals}/${INDEX_NOTE}` })
  if (files.includes(`${evals}/graded.jsonl`))
    moves.push({ from: `${evals}/graded.jsonl`, to: `${DATA_DIR.split(path.sep).join('/')}/graded.jsonl` })
  for (const f of files.filter((x) => /\.(json|jsonl)$/i.test(x) && !moves.some((m) => m.from === x)))
    left.push(`${f}: data file outside the evals folder - left`)

  const moved = new Map(moves.map((m) => [m.from, m.to]))
  const after = notes.map((n) => moved.get(n) ?? n)
  const newNames = new Map<string, number>()
  for (const n of after) newNames.set(norm(base(n)), (newNames.get(norm(base(n))) ?? 0) + 1)
  const clash = moves.filter((m) => m.to.endsWith('.md') && (newNames.get(norm(base(m.to))) ?? 0) > 1)
  if (clash.length > 0) throw new Error(`These new names are not unique in the vault: ${clash.map((m) => base(m.to)).join(', ')}`)
  for (const m of moves) if (fs.existsSync(path.join(vault, m.to)) && m.from !== m.to) throw new Error(`${m.to} exists already.`)

  // ---- links ----------------------------------------------------------------------
  const resolveOld = resolver(notes)
  const isLogOrEval = (p: string): boolean =>
    p.startsWith(`${evals}/`) || /(^|\/)[^/]* log\/[^/]+$/i.test(p) || /(^|\/)[^/]* log\.md$/i.test(p)
  const rewritten = new Map<string, string>()
  const changes: { note: string; from: string; to: string }[] = []
  const kept: { note: string; link: string; why: string }[] = []
  const topicLinks = new Map<string, number>()
  for (const n of notes) {
    let text = original.get(n)!
    const seen = new Set<string>()
    for (const l of linksIn(text)) {
      if (seen.has(l.full)) continue
      seen.add(l.full)
      if (/^topics\//i.test(l.target)) {
        topicLinks.set(l.target, (topicLinks.get(l.target) ?? 0) + 1)
        continue
      }
      const target = resolveOld(l.target)
      const movesTarget = target !== null && moved.has(target)
      if (!l.target.includes('/') && !movesTarget) continue
      if (target === null) {
        kept.push({ note: n, link: l.full, why: 'resolves to nothing' })
        continue
      }
      if (!movesTarget && !isLogOrEval(target)) {
        kept.push({ note: n, link: l.full, why: 'a path link not to a log or eval note (yours?)' })
        continue
      }
      const name = base(moved.get(target) ?? target)
      if ((newNames.get(norm(name)) ?? 0) !== 1) {
        kept.push({ note: n, link: l.full, why: `"${name}" is not unique` })
        continue
      }
      // An alias that only repeated the path, the name or "report" goes; one that says something else stays.
      const alias = l.alias === null || [norm(name), norm(base(target)), 'report', norm(l.target)].includes(norm(l.alias)) ? null : l.alias
      const next = `${l.embed}[[${name}${l.heading === null ? '' : `#${l.heading}`}${alias === null ? '' : `${l.escaped ? '\\|' : '|'}${alias}`}]]`
      if (next === l.full) continue
      text = text.split(l.full).join(next)
      changes.push({ note: n, from: l.full, to: next })
    }
    if (text !== original.get(n)) rewritten.set(n, text)
  }

  const before = check(notes, (p) => original.get(p)!, files)
  const afterFiles = files.map((f) => moved.get(f) ?? f).filter((f) => !f.startsWith('.'))
  const textAfter = new Map(notes.map((n) => [moved.get(n) ?? n, rewritten.get(n) ?? original.get(n)!]))
  const expected = check(after, (p) => textAfter.get(p)!, afterFiles)

  // ---- apply ----------------------------------------------------------------------
  let result: Check | null = null
  if (APPLY && expected.broken > before.broken)
    throw new Error(
      `Not applying: the plan would leave ${expected.broken - before.broken} new broken links. Run without --apply to see it.`,
    )
  if (APPLY) {
    // The index keeps its old title line; it is "Recto evals" now.
    const index = `${evals}/Evals.md`
    if (moved.has(index)) rewritten.set(index, (rewritten.get(index) ?? original.get(index)!).replace(/^# Evals\s*$/m, '# Recto evals'))
    for (const [n, text] of rewritten) fs.writeFileSync(path.join(vault, n), text)
    for (const m of moves) {
      fs.mkdirSync(path.dirname(path.join(vault, m.to)), { recursive: true })
      fs.renameSync(path.join(vault, m.from), path.join(vault, m.to))
    }
    // A run's raw data knows its note now.
    for (const m of moves.filter((x) => x.to.endsWith('/config.json'))) {
      const runDir = path.dirname(m.from)
      const note = moved.get([...moved.keys()].find((k) => k.startsWith(`${runDir}/`) && k.endsWith('.md')) ?? '')
      const file = path.join(vault, m.to)
      try {
        const config = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>
        if (note !== undefined) fs.writeFileSync(file, `${JSON.stringify({ ...config, note }, null, 2)}\n`)
      } catch {
        // Not JSON we can read: moved as it is.
      }
    }
    for (const m of moves) {
      const dir = path.dirname(path.join(vault, m.from))
      if (dir !== evalsAbs && fs.existsSync(dir) && fs.readdirSync(dir).filter((f) => f !== '.DS_Store').length === 0)
        fs.rmSync(dir, { recursive: true })
    }
    const nowFiles = filesOf(vault)
    const nowNotes = nowFiles.filter((f) => f.toLowerCase().endsWith('.md'))
    result = check(nowNotes, (p) => fs.readFileSync(path.join(vault, p), 'utf8'), nowFiles)
  }

  // ---- report -----------------------------------------------------------------------
  const line = (c: Check): string =>
    `${c.links} links (topics not counted): ${c.resolved} resolve, ${c.broken} broken · duplicate names: ${c.duplicates.length === 0 ? 'none' : c.duplicates.join(', ')} · data files in the visible tree: ${c.visibleData}`
  const out = [
    `# vault:tidy ${APPLY ? '(applied)' : '(plan)'}: ${vault}`,
    '',
    `## Moves (${moves.length})`,
    ...moves.map((m) => `- \`${m.from}\` → \`${m.to}\``),
    '',
    `## Links rewritten (${changes.length} in ${rewritten.size} notes)`,
    ...changes.map((c) => `- ${c.note}: \`${c.from}\` → \`${c.to}\``),
    '',
    `## Left as they are (${kept.length + left.length})`,
    ...left.map((x) => `- ${x}`),
    ...kept.map((k) => `- ${k.note}: \`${k.link}\` - ${k.why}`),
    '',
    `## Topic links, untouched (${[...topicLinks.values()].reduce((a, b) => a + b, 0)} links, ${topicLinks.size} topics)`,
    ...[...topicLinks].sort((a, b) => b[1] - a[1]).map(([t, n]) => `- ${t}: ${n}`),
    '',
    '## Check',
    `- before: ${line(before)}`,
    `- expected after: ${line(expected)}`,
    ...(result === null ? [] : [`- after (measured): ${line(result)}`]),
    `- new broken links: ${(result ?? expected).broken - before.broken}`,
    '',
  ].join('\n')
  const reportFile = flag('--report')
  if (reportFile !== undefined) fs.writeFileSync(reportFile, out)
  console.log(out)
  const final = result ?? expected
  if (final.broken > before.broken) {
    console.error(`Stopped: ${final.broken - before.broken} new broken links.`)
    process.exit(1)
  }
}

try {
  main()
} catch (err) {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
}
