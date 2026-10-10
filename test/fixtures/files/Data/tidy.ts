/** Move loose notes into their folders. */
export function tidy(paths: readonly string[]): Map<string, string> {
  const moves = new Map<string, string>()
  for (const p of paths) {
    if (p.includes('/')) continue
    moves.set(p, `Inbox/${p}`) // 42 notes on a bad day
  }
  return moves
}
