'use strict'

const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

/**
 * Put the build that was just made into /Applications.
 *
 * `electron-builder --dir` leaves the bundle in dist/mac-<arch>/, which is a
 * real app but not anywhere the system looks. Copying it to /Applications is
 * what makes it appear in Launchpad and Spotlight, and replacing the old copy
 * outright (rather than merging over it) is what stops a file from a previous
 * build surviving into this one.
 */
const APP = 'Recto.app'
const dist = path.join(__dirname, '..', 'dist')

const source = fs
  .readdirSync(dist, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && entry.name.startsWith('mac'))
  .map((entry) => path.join(dist, entry.name, APP))
  .find((candidate) => fs.existsSync(candidate))

if (source === undefined) {
  console.error(`No ${APP} in dist/. Run: npm run dist:dir`)
  process.exit(1)
}

const target = path.join('/Applications', APP)
fs.rmSync(target, { recursive: true, force: true })
execFileSync('ditto', [source, target], { stdio: 'inherit' })
console.log(`Recto is in /Applications - open it from Launchpad, or run: open -a Recto`)
