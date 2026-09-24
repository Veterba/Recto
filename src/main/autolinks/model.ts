import { createHash } from 'node:crypto'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'

/**
 * The one network call in the feature: fetching the model, once.
 *
 * Pinned to a commit so the bytes cannot change under us, and every file is
 * checked against the hash the Hub publishes for it - sha256 for the large
 * files, git's blob sha1 for the small ones. A download that stops half way
 * resumes from the `.part` file with a Range request.
 */

export const MODEL_REPO = 'onnx-community/embeddinggemma-300m-ONNX'
export const MODEL_REVISION = '5090578d9565bb06545b4552f76e6bc2c93e4a66'

type ModelFile = { name: string; size: number } & ({ sha256: string } | { gitSha1: string })

export const MODEL_FILES: readonly ModelFile[] = [
  { name: 'config.json', size: 1765, gitSha1: 'edb6342fb0d447a42960920034c773ddd6ed6d55' },
  { name: 'tokenizer_config.json', size: 1156830, gitSha1: '73b499ae604d0bcbeb2889639a42f46462e9d372' },
  { name: 'tokenizer.json', size: 20323312, sha256: '4dda02faaf32bc91031dc8c88457ac272b00c1016cc679757d1c441b248b9c47' },
  { name: 'onnx/model_q4.onnx', size: 519322, sha256: 'ad1dfee81a70f7944b9b9d1cc6e48075b832881cf33fab2f2b248be78f3f0043' },
  {
    name: 'onnx/model_q4.onnx_data',
    size: 196725760,
    sha256: '599962c3143b040de2dd05e5975be3e9091dd067cacc6a8f7186e3203bab9e02',
  },
]

export const MODEL_BYTES = MODEL_FILES.reduce((sum, f) => sum + f.size, 0)

const fileUrl = (name: string): string => `https://huggingface.co/${MODEL_REPO}/resolve/${MODEL_REVISION}/${name}`
const target = (root: string, name: string): string => path.join(root, MODEL_REPO, name)

async function checksum(file: string, spec: ModelFile): Promise<boolean> {
  const hash = createHash('sha256' in spec ? 'sha256' : 'sha1')
  // git's blob hash is sha1 over "blob <size>\0" + content.
  if ('gitSha1' in spec) hash.update(`blob ${spec.size}\0`)
  for await (const piece of fs.createReadStream(file)) hash.update(piece as Buffer)
  return hash.digest('hex') === ('sha256' in spec ? spec.sha256 : spec.gitSha1)
}

/** Every file present at its full size. Hashes were checked when it arrived. */
export function modelPresent(root: string): boolean {
  return MODEL_FILES.every((f) => {
    try {
      return fs.statSync(target(root, f.name)).size === f.size
    } catch {
      return false
    }
  })
}

/** Bytes on disk so far, finished files and `.part`s together. */
export function receivedBytes(root: string): number {
  return MODEL_FILES.reduce((sum, f) => {
    for (const p of [target(root, f.name), `${target(root, f.name)}.part`]) {
      try {
        return sum + Math.min(f.size, fs.statSync(p).size)
      } catch {
        // not there yet
      }
    }
    return sum
  }, 0)
}

export class OfflineError extends Error {}

/**
 * Download what is missing. `onProgress` gets total bytes on disk. A network
 * failure throws `OfflineError` and leaves the `.part` for next time; a bad
 * checksum deletes the file, because resuming a corrupt file keeps it corrupt.
 */
export async function downloadModel(
  root: string,
  onProgress: (received: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  for (const spec of MODEL_FILES) {
    const final = target(root, spec.name)
    if (fs.existsSync(final) && fs.statSync(final).size === spec.size) continue
    const part = `${final}.part`
    await fsp.mkdir(path.dirname(final), { recursive: true })
    let have = fs.existsSync(part) ? fs.statSync(part).size : 0
    if (have > spec.size) {
      await fsp.rm(part)
      have = 0
    }

    if (have < spec.size) {
      // Everything already on disk except this file's own part.
      const base = receivedBytes(root) - have
      let response: Response
      try {
        response = await fetch(fileUrl(spec.name), {
          headers: have > 0 ? { Range: `bytes=${have}-` } : {},
          redirect: 'follow',
          ...(signal === undefined ? {} : { signal }),
        })
      } catch (err) {
        throw new OfflineError(err instanceof Error ? err.message : String(err))
      }
      if (!response.ok || response.body === null) throw new Error(`${spec.name}: HTTP ${response.status}`)
      // A server that ignores Range sends the whole file again.
      if (have > 0 && response.status !== 206) have = 0
      const out = fs.createWriteStream(part, { flags: have > 0 ? 'a' : 'w' })
      try {
        for await (const piece of response.body as unknown as AsyncIterable<Uint8Array>) {
          if (!out.write(piece)) await new Promise<void>((resolve) => out.once('drain', () => resolve()))
          have += piece.byteLength
          onProgress(base + have)
        }
      } catch (err) {
        throw new OfflineError(err instanceof Error ? err.message : String(err))
      } finally {
        await new Promise((resolve) => out.end(resolve))
      }
    }

    if (!(await checksum(part, spec))) {
      await fsp.rm(part, { force: true })
      throw new Error(`${spec.name} failed its checksum and was deleted; it will be fetched again.`)
    }
    await fsp.rename(part, final)
  }
  onProgress(MODEL_BYTES)
}
