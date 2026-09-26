import path from 'node:path'
import v8 from 'node:v8'
import { runInNewContext } from 'node:vm'

/**
 * EmbeddingGemma through transformers.js, local files only. Its own module so
 * the embedder process and the integration test run the same code.
 */

export const MODEL_ID = 'onnx-community/embeddinggemma-300m-ONNX'
/** Matryoshka: the first 256 of 768 dims, re-normalised. */
export const DIMS = 256

/**
 * The model card's own prompt for this use case, copied verbatim:
 * "Semantic Similarity - task: sentence similarity | query: {content}",
 * recommended for "recommendation systems and duplicate detection".
 * https://huggingface.co/onnx-community/embeddinggemma-300m-ONNX#prompt-instructions
 *
 * The same prompt on both sides, because a note is both a source and a
 * target: the retrieval pair (query / document) is for asymmetric search.
 */
export const PROMPT = 'task: sentence similarity | query: '

export type Encoder = (texts: string[]) => Promise<Float32Array[]>

/**
 * A full collection, obtained at runtime. A utilityProcess does not pass
 * `execArgv` on to V8, so `--expose-gc` there does nothing; setting the flag
 * here and fetching `gc` from a fresh context works in any process.
 */
function collector(): () => void {
  // And the heap strategy that trades a little speed for a smaller footprint.
  v8.setFlagsFromString('--optimize-for-size')
  v8.setFlagsFromString('--expose-gc')
  return runInNewContext('gc') as () => void
}

export async function createEncoder(modelDir: string): Promise<Encoder> {
  const gc = collector()
  const { AutoTokenizer, env } = await import('@huggingface/transformers')
  const ort = await import('onnxruntime-node')
  env.localModelPath = modelDir
  env.allowRemoteModels = false
  env.useFSCache = false
  const tokenizer = await AutoTokenizer.from_pretrained(MODEL_ID)
  // Parsing the 20 MB tokenizer leaves a lot of garbage behind.
  gc()
  /**
   * The session straight from the file, not through transformers.js: that
   * reads the 197 MB weights into a JS buffer and hands ORT a copy, so for a
   * moment they exist twice (peak 522 MB). From a path, ORT reads the
   * external data itself. Same graph, same numbers, verified bit for bit.
   *
   * q4: ~0.6 s per 1000 words on two threads. q8 was twice as slow and
   * peaked at 1.6 GB.
   */
  const session = await ort.InferenceSession.create(path.join(modelDir, MODEL_ID, 'onnx', 'model_q4.onnx'), {
    intraOpNumThreads: 2,
    interOpNumThreads: 1,
    // The arena keeps its high-water mark forever; without it memory goes
    // back after each call.
    enableCpuMemArena: false,
  })
  gc()

  return async (texts) => {
    const out: Float32Array[] = []
    // One at a time: a batch costs more memory and saves nothing on CPU.
    for (const text of texts) {
      const enc = (await tokenizer([PROMPT + text], { truncation: true, max_length: 512 })) as {
        input_ids: { data: BigInt64Array; dims: number[] }
        attention_mask: { data: BigInt64Array; dims: number[] }
      }
      const result = await session.run(
        {
          input_ids: new ort.Tensor('int64', enc.input_ids.data, enc.input_ids.dims),
          attention_mask: new ort.Tensor('int64', enc.attention_mask.data, enc.attention_mask.dims),
        },
        ['sentence_embedding'],
      )
      const vec = (result['sentence_embedding']!.data as Float32Array).slice(0, DIMS)
      const norm = Math.hypot(...vec) || 1
      for (let i = 0; i < DIMS; i++) vec[i]! /= norm
      out.push(vec)
    }
    return out
  }
}
