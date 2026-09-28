/**
 * The home overlay's picture: two full-window pages, one WebGL2 context.
 *
 * One depth field under both pages, coloured by a ramp. Page one sees it
 * through frosted glass, lit from the top left, with the hero text over it and a displacement field the pointer
 * pushes around - drag across a word and the glyph bends and is swallowed in
 * place, then settles, the way homunculus.jp does it. Page two sees the same
 * depth in a blue ramp, through a grid of glass blocks.
 *
 * The render graph, once per frame:
 *
 *   height  -> field (quarter resolution, RGBA16F: soft gaussians, summed)
 *   frost   -> frost (quarter resolution: the vertical smear, on the depth)
 *   colour  -> light (quarter: smeared depth, ramp, text cap, shading)
 *   colour  -> dark  (quarter, page two only: raw depth, glass ramp)
 *   compose -> scene (full resolution: light and glass crossfaded by
 *                     the slide, the glass blocks computed here so their
 *                     edges stay sharp, and the text composited in)
 *   splat   -> disp  (quarter resolution, RG16F: new pointer segments, and
 *                     the horizontal half of the blur)
 *   advect  -> disp  (the vertical half, self-advection, decay, clamp)
 *   final   -> screen (scene sampled through disp with the channels split,
 *                      then grain - which is why grain is never magnified)
 *
 * There is no feedback of the picture itself anywhere: trails are the
 * displacement flowing and decaying, never the scene stamped again, which is
 * what used to stack five copies of a word on top of each other.
 *
 * Grain is the very last thing, at full device resolution, after the river:
 * never displaced, never blurred, never magnified.
 */

import { SPREAD, MAX_SHAPES, MAX_BLOCKS, MAX_TEXT_BOXES, MAX_SEGMENTS, SPLAT_FORCE, DISP_MAX, GLASS_GAIN, DISP_DECAY } from './scene-tuning'
import { mixPalette, type Palette } from './scene-palette'
import { link } from './scene-gl'
import { HEIGHT_FRAG, FROST_FRAG, colorFrag } from './scene-shaders-depth'
import { SCENE_FRAG, SPLAT_FRAG, ADVECT_FRAG, FINAL_FRAG } from './scene-shaders-compose'
import type { SceneDebug, SceneFlags } from './scene-flags'
import { rng, type Shape, shapeNow, bornShape, coverageOf } from './scene-shapes'
import { paintGlassTestCard, rasteriseText, textCaps, type HeroLine, type Rule } from './scene-text'

/**
 * How often the field, the frost and the composite above them are redrawn.
 *
 * Fifteen times a second, not sixty: the field's slowest cycles are forty
 * seconds long, so four frames of drift is far under a pixel. The river and
 * the grain still run every frame, which is what the eye is actually
 * watching.
 */
const GROUND_FRAME_MS = 66

/** How long a theme change crossfades one palette into the other. */
const PALETTE_MS = 400

// --- GL plumbing ---------------------------------------------------------------

type Target = { fb: WebGLFramebuffer; tex: WebGLTexture; w: number; h: number }

// --- the scene ------------------------------------------------------------------

export type Scene = {
  ok: boolean
  /** CSS size of the canvas; rebuilds every target. */
  resize: (cssWidth: number, cssHeight: number, dpr: number) => void
  /** The hero lines and rules to rasterise, measured from the DOM. */
  setText: (lines: readonly HeroLine[], rules?: readonly Rule[]) => void
  /** Page two's content blocks, CSS px in that page's frame; the field stays dark behind them. */
  setBlocks: (rects: readonly { x: number; y: number; width: number; height: number }[]) => void
  /** Pointer position in uv, and how far it moved since the last one. */
  push: (u: number, v: number, du: number, dv: number) => void
  /** 0 on page one, 1 on page two. */
  setProgress: (p: number) => void
  /** The theme's palette; `fade` crossfades to it rather than switching. */
  setPalette: (next: Palette, fade: boolean) => void
  /** Advance and draw. `dt` in seconds, already clamped by the caller. */
  frame: (dt: number) => void
  /** True while the displacement still has anything in it. */
  disturbed: () => boolean
  debug: SceneDebug
  dispose: () => void
}

export function createScene(canvas: HTMLCanvasElement, flags: SceneFlags, reduced: boolean, initialPalette: Palette): Scene {
  /*
   * `alpha: false` is not a preference.
   *
   * The overlay's window is transparent, and an alpha canvas composites
   * against the desktop - so every dark pixel of the field would show whatever
   * is behind the app. Opaque, and the page behind it never shows through.
   */
  const gl = canvas.getContext('webgl2', {
    alpha: false,
    premultipliedAlpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    /*
     * Kept after compositing, always.
     *
     * Without it the canvas reads back as black, and nothing outside the GPU
     * can check what this screen is actually showing - not a screenshot, not a
     * measurement, not the acceptance tests this was built against. The cost is
     * one buffer that is not recycled; the alternative is an effect nobody can
     * verify.
     */
    preserveDrawingBuffer: true,
  })
  if (gl === null) {
    return {
      ok: false,
      resize: () => {},
      setText: () => {},
      setBlocks: () => {},
      push: () => {},
      setProgress: () => {},
      setPalette: () => {},
      frame: () => {},
      disturbed: () => false,
      debug: { shapes: () => [], coverage: () => 0, progress: () => 0, frames: () => 0, setFlags: () => {}, gpuMs: () => null },
      dispose: () => {},
    }
  }

  /*
   * Float render targets, or a warning and eight bits.
   *
   * The displacement is a signed quantity a hundredth of a uv across; in eight
   * bits that is two or three levels, and the river turns into stairs. Without
   * the extension the effect still runs, visibly coarser.
   */
  /*
   * The GPU's own clock, if it has one to lend.
   *
   * A frame here is six passes over a full-window buffer; what that costs is a
   * question only the GPU can answer, and `performance.now()` around the draw
   * calls answers a different one - how long it took to *submit* the work.
   */
  type TimerExt = {
    TIME_ELAPSED_EXT: number
    GPU_DISJOINT_EXT: number
  }
  const timerExt = gl.getExtension('EXT_disjoint_timer_query_webgl2') as TimerExt | null
  let timerQuery: WebGLQuery | null = null
  let timerPending = false
  let lastGpuMs: number | null = null

  const floatOk = gl.getExtension('EXT_color_buffer_float') !== null
  if (!floatOk) console.warn('Home scene: EXT_color_buffer_float missing; displacement falls back to 8 bit.')
  gl.getExtension('OES_texture_float_linear')

  const quad = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, quad)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
  const vao = gl.createVertexArray()
  gl.bindVertexArray(vao)
  gl.enableVertexAttribArray(0)
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
  gl.bindVertexArray(null)

  const programs = {
    height: link(gl, HEIGHT_FRAG),
    frost: link(gl, FROST_FRAG),
    color: link(gl, colorFrag(false)),
    colorToward: link(gl, colorFrag(true)),
    scene: link(gl, SCENE_FRAG),
    splat: link(gl, SPLAT_FRAG),
    advect: link(gl, ADVECT_FRAG),
    final: link(gl, FINAL_FRAG),
  }
  const broken = Object.values(programs).some((p) => p === null)

  const uniforms = new Map<WebGLProgram, Map<string, WebGLUniformLocation | null>>()
  const at = (program: WebGLProgram, name: string): WebGLUniformLocation | null => {
    let table = uniforms.get(program)
    if (table === undefined) {
      table = new Map()
      uniforms.set(program, table)
    }
    if (!table.has(name)) table.set(name, gl.getUniformLocation(program, name))
    return table.get(name) ?? null
  }

  // --- targets ------------------------------------------------------------

  let targets: Target[] = []
  const makeTarget = (w: number, h: number, internal: number, format: number, type: number): Target => {
    const tex = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, format, type, null)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    const fb = gl.createFramebuffer()!
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    const target = { fb, tex, w, h }
    targets.push(target)
    return target
  }

  let fieldT: Target | null = null
  let frostT: Target | null = null
  let lightT: Target | null = null
  let darkT: Target | null = null
  let sceneT: Target | null = null
  let disp: [Target, Target] | null = null

  /*
   * The glass test card: black and white stripes 6 CSS px wide and a large
   * word, drawn once per resize when ?glassTest is on. A lens is easy to get
   * subtly wrong on a soft field and impossible to misread on stripes.
   */
  const testTex = gl.createTexture()!
  const paintTestCard = (): void => paintGlassTestCard(gl, testTex, cssW, cssH)

  const textTex = gl.createTexture()!
  gl.bindTexture(gl.TEXTURE_2D, textTex)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 0]))
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  /* What kind each line is (scene-text.ts), read only when the theme weighs the kinds differently. */
  const kindTex = gl.createTexture()!
  gl.bindTexture(gl.TEXTURE_2D, kindTex)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 0]))
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)

  const dropTargets = (): void => {
    for (const t of targets) {
      gl.deleteFramebuffer(t.fb)
      gl.deleteTexture(t.tex)
    }
    targets = []
    fieldT = frostT = lightT = darkT = sceneT = null
    disp = null
  }

  let cssW = 1
  let cssH = 1
  let pixelRatio = 1
  let lines: readonly HeroLine[] = []
  let rules: readonly Rule[] = []

  const rasterise = (): void => rasteriseText(gl, textTex, kindTex, lines, rules, cssW, cssH, pixelRatio)

  const resize = (w: number, h: number, dpr: number): void => {
    cssW = Math.max(1, w)
    cssH = Math.max(1, h)
    pixelRatio = dpr
    const fullW = Math.max(1, Math.round(cssW * dpr))
    const fullH = Math.max(1, Math.round(cssH * dpr))
    canvas.width = fullW
    canvas.height = fullH
    dropTargets()
    const qW = Math.max(1, Math.round(fullW * 0.25))
    const qH = Math.max(1, Math.round(fullH * 0.25))
    // Half floats for the field: in eight bits a gradient this soft is a
    // staircase before the frost ever smears it.
    const rgba = floatOk ? gl.RGBA16F : gl.RGBA8
    const rgbaType = floatOk ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE
    fieldT = makeTarget(qW, qH, rgba, gl.RGBA, rgbaType)
    frostT = makeTarget(qW, qH, rgba, gl.RGBA, rgbaType)
    lightT = makeTarget(qW, qH, rgba, gl.RGBA, rgbaType)
    darkT = makeTarget(qW, qH, rgba, gl.RGBA, rgbaType)
    sceneT = makeTarget(fullW, fullH, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE)
    const rg = floatOk ? gl.RG16F : gl.RG8
    const rgType = floatOk ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE
    disp = [makeTarget(qW, qH, rg, gl.RG, rgType), makeTarget(qW, qH, rg, gl.RG, rgType)]
    for (const t of disp) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, t.fb)
      gl.clearColor(0, 0, 0, 0)
      gl.clear(gl.COLOR_BUFFER_BIT)
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    groundAt = -1e9
    lastProgress = -1
    rasterise()
    if (flags.glassTest) paintTestCard()
  }

  // --- state --------------------------------------------------------------

  const random = rng((Date.now() ^ 0x9e3779b9) >>> 0)
  const bornAt = performance.now()
  const shapes: Shape[] = []
  /** Seconds until the next shape is born: every 3 to 7. */
  let nextShapeIn = 0
  const frostSeed = random()
  const shapeA = new Float32Array(MAX_SHAPES * 4)
  const shapeB = new Float32Array(MAX_SHAPES * 2)

  /** How much of the window is deep right now (or `ahead` seconds from now); see coverageOf. */
  const coverage = (ahead = 0): number => coverageOf(shapes, cssW / Math.max(1, cssH), ahead)
  let covered = 0
  /** The same, six seconds ahead: growth and recession are that slow. */
  let forecast = 0
  let steerIn = 0

  /**
   * Four to eight alive, a new one every 3-7 seconds - steered by coverage.
   *
   * Steered by the forecast six seconds out, because a birth takes 6-12
   * seconds to grow and a recession as long to fade: acting on what is on
   * screen now is always late. Under 45% ahead, a large shape is born at
   * once; under 55% any size, on the usual 3-7 second rhythm; above that
   * only a small one, and past 62% none - and the oldest shape still in its
   * prime starts to recede early, over 6-12 seconds like any other. Nothing
   * is ever cut.
   */
  const stepShapes = (dt: number): void => {
    const aspect = cssW / Math.max(1, cssH)
    for (const s of shapes) {
      s.age += dt
      s.x += s.vx * dt
      s.y += s.vy * dt
      s.rot += s.spin * dt
    }
    for (let i = shapes.length - 1; i >= 0; i--) {
      const s = shapes[i]!
      if (s.age > s.grow + s.life + s.recede) shapes.splice(i, 1)
    }
    steerIn -= dt
    if (steerIn <= 0) {
      steerIn = 1
      covered = coverage()
      forecast = coverage(6)
      if (forecast > 0.62) {
        const prime = shapes.filter((s) => s.age > s.grow && s.age < s.grow + s.life)
        const oldest = prime.sort((a, b) => b.age - a.age)[0]
        if (oldest !== undefined) oldest.life = oldest.age - oldest.grow
      }
    }
    nextShapeIn -= dt
    const starving = forecast < 0.45 && shapes.length < 8
    const due = nextShapeIn <= 0 && shapes.length < 8 && forecast < 0.62
    if (starving || due || shapes.length < 4) {
      shapes.push(bornShape(random, aspect, forecast > 0.55 ? 'small' : forecast < 0.45 ? 'large' : 'any'))
      nextShapeIn = 3 + random() * 4
      // A birth changes the forecast; look again before the next one.
      forecast = coverage(6)
    }
  }

  /**
   * The opening picture: shapes already part way through their lives, added
   * until about half the page is deep, so it does not open empty and fill in.
   */
  const seedShapes = (): void => {
    const aspect = cssW / Math.max(1, cssH)
    for (let i = 0; i < 8 && (shapes.length < 4 || coverage() < 0.45); i++) {
      const s = bornShape(random, aspect, coverage() > 0.4 ? 'small' : 'any')
      s.age = s.grow + random() * s.life * 0.6
      shapes.push(s)
    }
    covered = coverage()
    nextShapeIn = 3 + random() * 4
  }
  let textBoxes = new Float32Array(MAX_TEXT_BOXES * 4)
  let textBoxCount = 0
  let time = 0
  let progress = 0
  /** Pointer segments since the last frame: x0, y0, x1, y1 in uv. */
  let segments: number[] = []
  /**
   * The largest displacement anywhere, in heights, tracked in JS.
   *
   * Reading the texture back to find out whether the field has settled is a
   * pipeline stall every frame. The field only ever grows by a splat whose
   * size is known here; blur and advection only ever spread it, and the decay
   * is the same everywhere, so an upper bound can simply be carried along -
   * and when it drops under a fifth of a pixel the passes are skipped, the
   * field is cleared, and the frame is the scene exactly.
   */
  let peak = 0
  let drawn = 0
  /*
   * The ground is redrawn fifteen times a second, not sixty.
   *
   * The field's slowest cycles are forty seconds long: four frames of its
   * drift is well under a pixel. The composite above it is redrawn only when the ground beneath it
   * did, or when the pages moved - during a drag neither is true, and the only
   * passes that have to run every frame are the river and the one that puts it
   * and the grain on the screen.
   */
  let groundAt = -1e9
  let lastProgress = -1

  /*
   * The palette, and a crossfade in progress. A theme change blends every
   * colour uniform from where it is to where it is going - the scene is not
   * rebuilt, and nothing it has drawn is thrown away.
   */
  let palette = initialPalette
  let paletteFade: { from: Palette; at: number } | null = null
  const paletteAt = (now: number): Palette => {
    if (paletteFade === null) return palette
    const k = Math.min(1, (now - paletteFade.at) / PALETTE_MS)
    if (k >= 1) {
      paletteFade = null
      return palette
    }
    return mixPalette(paletteFade.from, palette, k * k * (3 - 2 * k))
  }

  const draw = (program: WebGLProgram | null, target: Target | null): void => {
    if (program === null) return
    gl.bindFramebuffer(gl.FRAMEBUFFER, target?.fb ?? null)
    gl.viewport(0, 0, target?.w ?? canvas.width, target?.h ?? canvas.height)
    gl.useProgram(program)
    gl.bindVertexArray(vao)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }

  const bind = (program: WebGLProgram, name: string, unit: number, tex: WebGLTexture): void => {
    gl.activeTexture(gl.TEXTURE0 + unit)
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.uniform1i(at(program, name), unit)
  }

  const segData = new Float32Array(MAX_SEGMENTS * 4)

  /** Page two's content blocks, CSS px in the page's own frame. */
  let blocks = new Float32Array(MAX_BLOCKS * 4)
  let blockCount = 0

  const frame = (dt: number): void => {
    drawn++
    // Collect the previous frame's timing before starting another.
    if (timerExt !== null && timerQuery !== null && timerPending) {
      const disjoint = gl.getParameter(timerExt.GPU_DISJOINT_EXT) === true
      if (gl.getQueryParameter(timerQuery, gl.QUERY_RESULT_AVAILABLE) === true) {
        const ns = gl.getQueryParameter(timerQuery, gl.QUERY_RESULT) as number
        lastGpuMs = disjoint ? null : Math.round((ns / 1e6) * 100) / 100
        timerPending = false
      }
    }
    if (timerExt !== null && !timerPending) {
      timerQuery ??= gl.createQuery()
      if (timerQuery !== null) {
        gl.beginQuery(timerExt.TIME_ELAPSED_EXT, timerQuery)
        timerPending = true
      }
    }
    if (broken || fieldT === null || frostT === null || lightT === null || darkT === null || sceneT === null || disp === null) return
    const aspect = cssW / Math.max(1, cssH)
    const now = performance.now()
    /*
     * Page two flows at about two cells a second, so it is drawn at the loop's
     * rate rather than fifteen a second.
     */
    const onPage2 = progress > 0.0005
    const fading = paletteFade !== null
    const colours = paletteAt(now)
    const groundDue = now - groundAt > (onPage2 ? 0 : GROUND_FRAME_MS) || progress !== lastProgress || fading
    if (shapes.length === 0) seedShapes()
    if (!flags.freeze && !reduced) {
      time += dt
      stepShapes(dt)
    }

    // --- the field, the frost, and both pages over them
    const page2 = progress > 0.0005
    const { height, frost, color, scene: compose } = programs
    if (height !== null && frost !== null && color !== null && compose !== null && groundDue) {
      const count = Math.min(MAX_SHAPES, shapes.length)
      shapeA.fill(0)
      shapeB.fill(0)
      for (let i = 0; i < count; i++) {
        const s = shapes[i]!
        const now = reduced || flags.freeze ? { sigma: s.sigma * SPREAD, amp: Math.min(1, Math.max(0.35, s.sigma / 0.35)) } : shapeNow(s)
        shapeA.set([s.x, s.y, now.sigma, now.amp], i * 4)
        shapeB.set([s.rot, s.aspect], i * 2)
      }
      gl.useProgram(height)
      gl.uniform4fv(at(height, 'u_shapeA'), shapeA)
      gl.uniform2fv(at(height, 'u_shapeB'), shapeB)
      gl.uniform1i(at(height, 'u_shapes'), count)
      gl.uniform1f(at(height, 'u_aspect'), aspect)
      draw(height, fieldT)

      gl.useProgram(frost)
      bind(frost, 'u_field', 0, fieldT.tex)
      gl.uniform1f(at(frost, 'u_time'), time)
      gl.uniform1f(at(frost, 'u_seed'), frostSeed)
      draw(frost, frostT)

      const paint = (source: Target, target: Target, lit: boolean): void => {
        // The light theme's own variant whenever its push is the one in force.
        const color = colours.statsTo === 1 || programs.colorToward === null ? programs.color! : programs.colorToward
        gl.useProgram(color)
        bind(color, 'u_h', 0, source.tex)
        gl.uniform3fv(at(color, 'u_ramp'), lit ? colours.ramp : colours.glass)
        gl.uniform1fv(at(color, 'u_stop'), lit ? colours.rampAt : colours.glassAt)
        if (color === programs.colorToward) gl.uniform1f(at(color, 'u_statsTo'), colours.statsTo)
        gl.uniform1f(at(color, 'u_gain'), lit ? 1.6 : GLASS_GAIN)
        gl.uniform4fv(at(color, 'u_blocks'), blocks)
        gl.uniform1i(at(color, 'u_blockCount'), blockCount)
        gl.uniform2f(at(color, 'u_css'), cssW, cssH)
        gl.uniform1f(at(color, 'u_time'), time)
        gl.uniform1f(at(color, 'u_lit'), lit ? 1 : 0)
        gl.uniform1f(at(color, 'u_aspect'), aspect)
        gl.uniform1f(at(color, 'u_progress'), progress)
        gl.uniform2f(at(color, 'u_texel'), 1 / source.w, 1 / source.h)
        gl.uniform4fv(at(color, 'u_textBoxes'), textBoxes)
        gl.uniform1i(at(color, 'u_textBoxCount'), textBoxCount)
        draw(color, target)
      }
      paint(frostT, lightT, true)
      // Page two's glass refracts the depth itself, not the frost.
      if (page2) paint(fieldT, darkT, false)

      gl.useProgram(compose)
      bind(compose, 'u_light', 0, lightT.tex)
      bind(compose, 'u_dark', 1, darkT.tex)
      bind(compose, 'u_text', 2, textTex)
      bind(compose, 'u_textKind', 4, kindTex)
      gl.uniform1f(at(compose, 'u_progress'), progress)
      gl.uniform2f(at(compose, 'u_css'), cssW, cssH)
      gl.uniform1f(at(compose, 'u_dpr'), pixelRatio)
      bind(compose, 'u_test', 3, testTex)
      gl.uniform1f(at(compose, 'u_glassTest'), flags.glassTest ? 1 : 0)
      gl.uniform1f(at(compose, 'u_fringe'), flags.noFringe ? 0 : 1)
      gl.uniform1f(at(compose, 'u_flatField'), flags.flatField ? 1 : 0)
      gl.uniform3fv(at(compose, 'u_ink'), colours.ink)
      gl.uniform3fv(at(compose, 'u_textWeights'), colours.textWeights)
      draw(compose, sceneT)
    }
    if (groundDue) {
      groundAt = now
      lastProgress = progress
    }

    // --- the river: splat -> blur -> self-advect -> decay -> clamp
    const decay = Math.pow(DISP_DECAY, dt * 60)
    const pending = Math.min(MAX_SEGMENTS, segments.length / 4)
    segData.fill(0)
    segData.set(segments.slice(0, pending * 4))
    segments = []
    peak *= decay
    for (let i = 0; i < pending; i++) {
      const du = (segData[i * 4 + 2]! - segData[i * 4]!) * aspect
      const dv = segData[i * 4 + 3]! - segData[i * 4 + 1]!
      peak += Math.hypot(du, dv) * SPLAT_FORCE
    }
    peak = Math.min(DISP_MAX, peak)
    const wasMoving = active
    active = !reduced && peak > 0.2 / Math.max(1, cssH)
    if (active && programs.splat !== null && programs.advect !== null) {
      const [a, b] = disp
      const texel = [1 / a.w, 1 / a.h] as const
      gl.useProgram(programs.splat)
      bind(programs.splat, 'u_prev', 0, a.tex)
      gl.uniform4fv(at(programs.splat, 'u_seg'), segData)
      gl.uniform1i(at(programs.splat, 'u_segs'), pending)
      gl.uniform1f(at(programs.splat, 'u_aspect'), aspect)
      gl.uniform2f(at(programs.splat, 'u_texel'), texel[0], texel[1])
      draw(programs.splat, b)
      gl.useProgram(programs.advect)
      bind(programs.advect, 'u_src', 0, b.tex)
      gl.uniform1f(at(programs.advect, 'u_decay'), decay)
      gl.uniform1f(at(programs.advect, 'u_aspect'), aspect)
      gl.uniform2f(at(programs.advect, 'u_texel'), texel[0], texel[1])
      draw(programs.advect, a)
    } else if (wasMoving) {
      // Settled: whatever residue is left is below a pixel, and it is cleared
      // rather than left to be picked up by the next touch.
      for (const t of disp) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, t.fb)
        gl.clearColor(0, 0, 0, 0)
        gl.clear(gl.COLOR_BUFFER_BIT)
      }
      peak = 0
    }

    // --- what reaches the screen
    if (programs.final !== null) {
      gl.useProgram(programs.final)
      bind(programs.final, 'u_scene', 0, sceneT.tex)
      bind(programs.final, 'u_disp', 1, disp[0].tex)
      gl.uniform1f(at(programs.final, 'u_grain'), flags.noGrain ? 0 : colours.grain)
      // Re-seeded on the film's clock, not the frame's.
      // The grain's own clock: wall time, so a grain's life is in seconds
      // whatever the frame rate. A reduced-motion frame holds still.
      gl.uniform1f(at(programs.final, 'u_time'), reduced ? 0 : (now - bornAt) / 1000)
      gl.uniform2f(at(programs.final, 'u_css'), cssW, cssH)
      // At rest the shift is switched off rather than merely small, so the
      // frame that reaches the screen is the scene exactly - which is the
      // whole point of having no ambient drift in the field.
      gl.uniform1f(at(programs.final, 'u_active'), active ? 1 : 0)
      gl.uniform1f(at(programs.final, 'u_page2'), progress)
      draw(programs.final, null)
    }

    if (timerExt !== null && timerPending) gl.endQuery(timerExt.TIME_ELAPSED_EXT)
  }
  let active = false

  return {
    ok: !broken,
    resize,
    setBlocks: (rects) => {
      blocks = new Float32Array(MAX_BLOCKS * 4)
      blockCount = Math.min(MAX_BLOCKS, rects.length)
      rects.slice(0, MAX_BLOCKS).forEach((r, i) => blocks.set([r.x, r.y, r.width, r.height], i * 4))
    },
    setText: (next, nextRules = []) => {
      lines = next
      rules = nextRules
      rasterise()
      textBoxes = textCaps(next, cssH)
      textBoxCount = Math.min(MAX_TEXT_BOXES, next.length)
    },
    push: (u, v, du, dv) => {
      // Page two has no river: the pointer leaves its field alone.
      if (reduced || flags.noInput || progress > 0.0005) return
      if (segments.length >= MAX_SEGMENTS * 4) {
        // Out of room this frame: stretch the last segment to the new point.
        segments[segments.length - 2] = u
        segments[segments.length - 1] = v
        return
      }
      segments.push(u - du, v - dv, u, v)
    },
    setProgress: (p) => {
      progress = Math.max(0, Math.min(1, p))
    },
    setPalette: (next, fade) => {
      const now = performance.now()
      paletteFade = fade ? { from: paletteAt(now), at: now } : null
      palette = next
      groundAt = -1e9
    },
    frame,
    disturbed: () => active,
    debug: {
      shapes: () => shapes.map((s) => ({ x: s.x, y: s.y, nominal: s.sigma, ...shapeNow(s) })),
      coverage: () => covered,
      progress: () => progress,
      frames: () => drawn,
      setFlags: (next) => Object.assign(flags, next),
      gpuMs: () => lastGpuMs,
    },
    dispose: () => {
      dropTargets()
      gl.deleteTexture(textTex)
      gl.deleteTexture(kindTex)
      gl.deleteTexture(testTex)
      gl.deleteBuffer(quad)
      gl.deleteVertexArray(vao)
      for (const p of Object.values(programs)) if (p !== null) gl.deleteProgram(p)
      if (timerQuery !== null) gl.deleteQuery(timerQuery)
    },
  }
}
