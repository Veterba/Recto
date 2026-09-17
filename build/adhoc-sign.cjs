'use strict'

const { execFileSync } = require('node:child_process')
const path = require('node:path')

/**
 * Ad-hoc sign the packaged app on macOS.
 *
 * Without an Apple Developer ID there is no real signature to apply, and on
 * Apple Silicon an entirely unsigned bundle does not launch - the kernel
 * refuses it before any of our code runs. `codesign --sign -` writes a
 * signature with no identity behind it, which is enough for that check and
 * claims nothing about who built it.
 *
 * Runs before the .dmg is assembled, so the disk image carries the signed app.
 * Failure here is loud on purpose: a silently unsigned build looks fine on the
 * machine that made it and is broken everywhere else.
 */
exports.default = async function adhocSign(context) {
  if (context.electronPlatformName !== 'darwin') return

  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', '--timestamp=none', app], {
    stdio: 'inherit',
  })
  execFileSync('codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' })
  console.log(`  • ad-hoc signed  ${path.basename(app)}`)
}
