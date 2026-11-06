// Films the demo shots into ~/Recto-demo/recordings.
//
//   npm run demo:record            every shot
//   npm run demo:record 03-board   one shot
//
// Each shot gives <shot>.mp4 and, in stills/, its first and last frame as a PNG
// and as a one-second clip. Frames are kept in a temp folder only while encoding.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { AI_TAPE, RECORDINGS, VAULT } from './paths.mjs'
import { Film, Stage, ffmpeg, openApp } from './rig.mjs'
import { SHOTS } from './shots.mjs'

const wanted = process.argv.slice(2)
for (const id of wanted) if (SHOTS[id] === undefined) throw new Error(`No shot "${id}". Shots: ${Object.keys(SHOTS).join(', ')}`)
if (!fs.existsSync(VAULT)) throw new Error('No demo vault: run `node scripts/demo/make-vault.mjs` first.')
if (!fs.existsSync(AI_TAPE)) throw new Error('No AI tape: run `npm run demo:record-ai` first.')

/** A stable seed per shot, so re-recording one shot does not change another. */
const seedOf = (id) => [...id].reduce((seed, char) => (seed * 31 + char.charCodeAt(0)) | 0, 7)

function stills(id, video) {
  const dir = path.join(RECORDINGS, 'stills')
  fs.mkdirSync(dir, { recursive: true })
  const hold = ['-loop', '1', '-t', '1', '-r', '30']
  const encode = ['-vf', 'format=yuv420p', '-c:v', 'libx264', '-preset', 'slow', '-crf', '13', '-movflags', '+faststart']
  for (const [name, seek] of [
    ['first', ['-ss', '0']],
    ['last', ['-sseof', '-0.05']],
  ]) {
    const png = path.join(dir, `${id}-${name}.png`)
    ffmpeg([...seek, '-i', video, '-frames:v', '1', '-update', '1', png])
    ffmpeg([...hold, '-i', png, ...encode, path.join(dir, `${id}-${name}.mp4`)])
  }
}

async function record(id) {
  const shot = SHOTS[id]
  const options = { ...shot.app }
  if (options.tapeFrom === 'suggestion') options.tapeFrom = JSON.parse(fs.readFileSync(AI_TAPE, 'utf8')).suggestionStart
  const context = await openApp(options)
  const frames = fs.mkdtempSync(path.join(os.tmpdir(), `recto-demo-frames-${id}-`))
  try {
    const stage = new Stage(context.page, seedOf(id))
    await shot.setup?.(stage, context)
    await stage.place(...shot.start)
    const film = new Film(context.page, frames)
    await film.start()
    await shot.act(stage, context)
    await film.stop()
    const video = path.join(RECORDINGS, `${id}.mp4`)
    film.encode(video)
    stills(id, video)
    console.log(`${id}: ${film.frames.length} frames over ${(film.end - film.frames[0].time).toFixed(1)} s`)
  } finally {
    await context.close()
    fs.rmSync(frames, { recursive: true, force: true })
  }
}

fs.mkdirSync(RECORDINGS, { recursive: true })
for (const id of wanted.length > 0 ? wanted : Object.keys(SHOTS)) await record(id)
