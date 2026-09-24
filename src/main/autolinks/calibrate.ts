/**
 * Calibration: the vault's own manual links are the ground truth.
 *
 * Each manual link is hidden in turn, its source is scored as though the link
 * were not there, and the trial records the top 3 and whether the hidden
 * target came back among them. `calibrationReport` turns the trials into
 * precision and recall per threshold and picks T_ADD.
 *
 * Kept apart from the service, with the vault behind an interface, so the
 * integration test can run it on a fixture vault without Electron.
 */

import { CANDIDATES, score, type SourceFacts, type TargetFacts, type Trial } from './score'

export type CalibrationVault = {
  eligible: readonly string[]
  /** Links the user wrote (not the auto-links property), to eligible notes. */
  manual: (source: string) => ReadonlySet<string>
  /**
   * The source's facts with `hidden` taken out - its links removed from the
   * own text, so the target's name is not handed to the title bonus, and
   * dropped from the outgoing set. Null when the note is too short to count.
   */
  source: (path: string, hidden: string) => SourceFacts | null
  target: (path: string) => Promise<TargetFacts>
  rejected: (source: string, target: string) => boolean
  /** Links that say nothing about relatedness: to hubs, or between near-duplicates. */
  skip: (source: string, target: string) => boolean
  /** Best targets by sem among `allowed`. */
  similar: (source: string, allowed: string[]) => Promise<{ path: string; sem: number }[]>
  onProgress?: (done: number, total: number) => void
}

export async function collectTrials(vault: CalibrationVault): Promise<Trial[]> {
  const work: { source: string; target: string; manual: ReadonlySet<string> }[] = []
  for (const source of vault.eligible) {
    const manual = vault.manual(source)
    for (const target of manual) if (!vault.skip(source, target)) work.push({ source, target, manual })
  }

  const trials: Trial[] = []
  let done = 0
  for (const { source, target, manual } of work) {
    done++
    const facts = vault.source(source, target)
    if (facts === null) continue
    // The other links stay: in real use they are already there, so they are
    // not candidates. Only the hidden one is back in play.
    const allowed = vault.eligible.filter(
      (t) => t !== source && (t === target || !manual.has(t)) && !vault.rejected(source, t),
    )
    const matches = (await vault.similar(source, allowed)).slice(0, CANDIDATES)
    const scored = []
    for (const m of matches) scored.push({ target: m.path, total: score(m.sem, m.path, facts, await vault.target(m.path)).total })
    const top = scored.sort((a, b) => b.total - a.total).slice(0, 3)
    trials.push({ predictions: top.map((s) => ({ total: s.total, hit: s.target === target })) })
    vault.onProgress?.(done, work.length)
  }
  return trials
}
