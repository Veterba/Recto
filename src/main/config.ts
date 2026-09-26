/**
 * Every `RECTO_*` environment variable the app reads, and nothing reads them
 * anywhere else in src. All are for development and tests; a packaged app run
 * normally sets none of them.
 *
 *   RECTO_ALLOW_REAL_VAULT=1      A dev build opens the vault it is pointed at,
 *                                 not a copy, and shares the installed app's
 *                                 state (see dev-guard.ts). The e2e test and the
 *                                 snapshot script set it: they run on a temp copy.
 *   RECTO_MODEL_DIR=<dir>         Where the EmbeddingGemma model lives. Defaults
 *                                 to `<userData>/models`; a dev build sets it to
 *                                 the installed app's folder so the model is
 *                                 downloaded once.
 *   RECTO_TOPICS_ANY_POWER=1      Run the topics backfill on battery and while
 *                                 the user is active. A test seam.
 *   RECTO_WRITE_LOG=1             Log every note write to the console, with the
 *                                 caller's stack.
 *
 * Read by the tests and scripts only, not by the app:
 *
 *   RECTO_E2E=1                   Run test/e2e (`npm run test:e2e` sets it).
 *   RECTO_MODEL_DIR=<dir>         Also runs test/main/topics/topics-vault.test.ts
 *                                 against the live model.
 *   RECTO_RECORD_FIXTURE=1        Re-record that test's embedding fixture.
 */

export const allowRealVault = (): boolean => process.env['RECTO_ALLOW_REAL_VAULT'] === '1'

export const anyPower = process.env['RECTO_TOPICS_ANY_POWER'] === '1'

export const writeLog = process.env['RECTO_WRITE_LOG'] === '1'

export const modelDir = (): string | undefined => process.env['RECTO_MODEL_DIR']

/**
 * Point the model folder at `dir` unless the environment already chose one.
 * Kept in the environment, not a variable, so the worker processes inherit it.
 */
export function defaultModelDir(dir: string): void {
  process.env['RECTO_MODEL_DIR'] ??= dir
}
