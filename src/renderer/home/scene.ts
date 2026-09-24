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

/** Pointer segments folded into the displacement in one frame. */
const MAX_SEGMENTS = 8
/** Content blocks on page two the field keeps dark behind. */
const MAX_BLOCKS = 16
/** Text boxes on page one, each with its own legibility cap. */
const MAX_TEXT_BOXES = 24

/*
 * The river, in the units the brief gives them: the splat radius and the
 * displacement ceiling in heights, the fringe in CSS pixels.
 */
const SPLAT_R = 0.09
const SPLAT_FORCE = 3.0
const DISP_MAX = 0.03
const DISP_DECAY = 0.95
const FRINGE_PX = 4
/** How much of itself the field is carried by each frame; see ADVECT_FRAG. */
const ADVECT = 0.25
/** Depth shapes the shader can hold; the lifecycle keeps four to eight. */
const MAX_SHAPES = 10
/**
 * A shape's drawn gaussian deviation, as a fraction of its nominal sigma.
 *
 * At the nominal size one sigma-0.3 shape alone is past d = 0.3 over about
 * 60% of the window, and four to eight of them bury the paper. The nominal
 * sigma still sets the amplitude and the brief's size classes; this only sets
 * how far each one spreads.
 */
const SPREAD = 0.5
/** How steep the depth reads as a surface: gentle hills, not cliffs. */
const SHADE_S = 0.6
/**
 * Film grain: std in luminance at midtones (unit-deviation noise times this),
 * and how long a grain lives before it re-rolls - each on its own clock, so
 * the pattern holds still and lives rather than refreshing all at once.
 *
 * One to three seconds, not the brief's 0.6 to 2: over that range 78% of
 * grains re-roll within any second, and frames a second apart correlated at
 * 0.20 - measured - against a target of 0.3 to 0.6. At one to three it is
 * 55% re-rolled, which is where the target sits.
 */
const GRAIN = 0.046
const GRAIN_LIFE: readonly [number, number] = [1.0, 3.0]

/*
 * The depth ramps, sRGB hex at d = 0, 0.2, 0.4, 0.6, 0.78, 0.92, 1: paper
 * where nothing is, warm greys, then blue in the deep places, the deepest
 * glowing slightly lighter like the reference's hotspot.
 */
const RAMP = ['#F3F2EF', '#DCD9D5', '#A9A5A3', '#85828A', '#66708F', '#5A6A9C', '#6F82B8'] as const
const RAMP_AT = [0, 0.2, 0.4, 0.6, 0.78, 0.92, 1] as const

/*
 * Page two's ramp, sampled from the blue glass reference: pale, through sky
 * and cobalt, to deep blue and nearly black. High contrast on purpose - the
 * glass blocks need bright and dark to refract. The last stop is repeated so
 * both ramps have seven.
 */
const GLASS_RAMP = ['#BDCDD1', '#9DBBD2', '#73A0CF', '#4173C9', '#0E097B', '#010003', '#010003'] as const
const GLASS_RAMP_AT = [0, 0.25, 0.45, 0.62, 0.8, 1, 1.0001] as const
/**
 * How fast page two's depth saturates: d = 1 - exp(-gain * H). Steeper than
 * page one's 1.6, so the same shapes reach the dark end of a ramp whose
 * median has to sit near #70. Tuned against the measured percentiles.
 */
const GLASS_GAIN = 1.4
/**
 * How far page two's field is pushed deeper behind its statistics:
 * d + (1 - d) x PUSH x G, G one gaussian over the union of the content boxes.
 * Deeper along the ramp, toward navy - multiplying the colour darker turned
 * it to grey mud. The brief's flat d + 0.35 G left pale field behind the type
 * at 3:1; pushing by the remaining distance clears 4.5:1 and never clips
 * the deep end into a plateau. 0.55 keeps the detail moving behind the type;
 * 0.75 measured 15:1 and a dead zone.
 */
const STATS_PUSH = 0.55
const STATS_SIGMA = 120

/** sRGB hex to OKLab, so the shader can interpolate the ramp perceptually. */
function oklab(hex: string): [number, number, number] {
  const lin = [1, 3, 5].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
  }) as [number, number, number]
  const [r, g, b] = lin
  const l = Math.cbrt(0.4122214708 * r + 0.5363286807 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ]
}

const LIGHT_RAMP = new Float32Array(RAMP.flatMap((hex) => oklab(hex)))
const GLASS_RAMP_LAB = new Float32Array(GLASS_RAMP.flatMap((hex) => oklab(hex)))

/*
 * The glass: cells that touch, each a small lens. Pitch in CSS px, the rest
 * in fractions of a cell. LENS is negative - each cell shows about three
 * cells' worth of the field, minified and flipped - and the rim pulls from
 * much further out, which draws the ring inside every cell.
 */
const CELL_PX = 22
const CORNER = 0.28
const RIM = 0.18
const LENS = -3.0
const RIM_PULL = 1.8
/**
 * Dispersion in the rim: seven spectral samples, red pulled least and violet
 * most, spread by this much of the rim's own pull either side of the middle.
 * 0.9, not 0.3: the field is soft at the scale of a cell, and at 0.3 the
 * spectrum's ends saw nearly the same colour - rims only ever went bluish.
 */
const DISPERSION = 0.9
/**
 * How often the field, the frost and the composite above them are redrawn.
 *
 * Fifteen times a second, not sixty: the field's slowest cycles are forty
 * seconds long, so four frames of drift is far under a pixel. The river and
 * the grain still run every frame, which is what the eye is actually
 * watching.
 */
const GROUND_FRAME_MS = 66

/**
 * Debug switches: `?noGrain&freeze&readback&noInput&glassTest&noFringe&flatField`.
 *
 * Also settable as `localStorage.homeFlags` - a JSON object - because the app
 * is not loaded from a URL anyone can edit: a packaged Electron renderer has
 * no address bar to put a query string in. Stored rather than held on `window`
 * so it survives a reload, which is exactly when a debug switch is most
 * annoying to lose.
 *
 * `readback` is the one that costs something: it keeps the drawing buffer
 * alive after compositing so a measurement can copy the canvas out. Nothing
 * can measure what the screen shows without it, and it is never on in normal
 * use.
 */
export type SceneFlags = {
  noGrain: boolean
  freeze: boolean
  readback: boolean
  /** Ignore the pointer, so a measurement cannot be polluted by a real mouse. */
  noInput: boolean
  /** Page two's glass over black/white stripes and a word, to check the lens. */
  glassTest: boolean
  /** Page two's glass without its colour split, to measure the split alone. */
  noFringe: boolean
  /** Page two's glass over flat grey, to check the rims read without an image. */
  flatField: boolean
}

export function readFlags(search = window.location.search): SceneFlags {
  const params = new URLSearchParams(search)
  let forced: Partial<SceneFlags> = {}
  try {
    const stored = window.localStorage.getItem('homeFlags')
    if (stored !== null) forced = JSON.parse(stored) as Partial<SceneFlags>
  } catch {
    // A hand-edited value that is not JSON is not a reason to fail to open.
  }
  const on = (name: keyof SceneFlags): boolean => forced[name] === true || params.has(name)
  return {
    noGrain: on('noGrain'),
    freeze: on('freeze'),
    readback: on('readback'),
    noInput: on('noInput'),
    glassTest: on('glassTest'),
    noFringe: on('noFringe'),
    flatField: on('flatField'),
  }
}

/** What a measurement can ask the scene about itself. */
export type SceneDebug = {
  /** Every live depth shape: nominal sigma, drawn sigma, amplitude, centre. */
  shapes: () => { x: number; y: number; nominal: number; sigma: number; amp: number }[]
  /** The lifecycle's own estimate of how much of the page is deep. */
  coverage: () => number
  /** Where the shader believes the pages are, 0 to 1. */
  progress: () => number
  /** Frames drawn since the scene was created. */
  frames: () => number
  /** Turn a switch on or off without reopening. */
  setFlags: (next: Partial<SceneFlags>) => void
  /**
   * How long the GPU spent on the last completed frame, in milliseconds.
   *
   * Null where the driver will not say - `EXT_disjoint_timer_query_webgl2` is
   * unavailable on plenty of machines, and on some it is present but returns
   * disjoint results, which are discarded rather than reported as fact.
   */
  gpuMs: () => number | null
}

// --- the small deterministic random ------------------------------------------

/**
 * Mulberry32: one multiply-xorshift, seeded per session.
 *
 * Seeded rather than `Math.random` so a session can be replayed - the shapes
 * are the slowest thing on the screen to judge, and judging them twice needs
 * them to be the same twice.
 */
function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// --- the depth shapes -----------------------------------------------------------

/**
 * One soft anisotropic gaussian in the depth field.
 *
 * Sizes in height units. Amplitude and sigma grow from nothing together, live,
 * and recede together: a gaussian stays round and soft at every size, so
 * growing from zero is fine here. Amplitude scales with size, so big shapes
 * run deep and small ones stay shallow - and grey.
 */
type Shape = {
  x: number
  y: number
  sigma: number
  aspect: number
  rot: number
  spin: number
  vx: number
  vy: number
  age: number
  grow: number
  life: number
  recede: number
}

const smooth = (x: number): number => {
  const t = Math.min(1, Math.max(0, x))
  return t * t * (3 - 2 * t)
}

/** 0 at birth, 1 while it lives, 0 again as it goes. */
function growth(shape: Shape): number {
  const { age, grow, life, recede } = shape
  if (age < grow) return smooth(age / grow)
  if (age < grow + life) return 1
  return smooth(1 - (age - grow - life) / recede)
}

function bornShape(random: () => number, aspect: number, size: 'small' | 'any' | 'large' = 'any'): Shape {
  const speed = random() * 0.01
  const heading = random() * Math.PI * 2
  return {
    x: random() * aspect,
    y: random(),
    sigma: size === 'small' ? 0.1 + random() * 0.15 : size === 'large' ? 0.3 + random() * 0.15 : 0.1 + random() * 0.35,
    aspect: 1 + random() * 0.6,
    rot: random() * Math.PI,
    spin: (random() * 2 - 1) * 0.03,
    // At most 1% of the height a second.
    vx: Math.cos(heading) * speed,
    vy: Math.sin(heading) * speed,
    age: 0,
    grow: 6 + random() * 6,
    life: 10 + random() * 15,
    recede: 6 + random() * 6,
  }
}

/** What the shader draws for a shape right now: its size and its depth. */
function shapeNow(shape: Shape): { sigma: number; amp: number } {
  const k = growth(shape)
  return { sigma: Math.max(0.005, shape.sigma * SPREAD * k), amp: k * Math.min(1, Math.max(0.35, shape.sigma / 0.35)) }
}

// --- GL plumbing ---------------------------------------------------------------

type Target = { fb: WebGLFramebuffer; tex: WebGLTexture; w: number; h: number }

const QUAD_VERT = `#version 300 es
in vec2 a_pos;
out vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`

/** Shared by every fragment shader: value noise, fBm, hash. */
const NOISE = `
float hash11(float p) { p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }
float hash21(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i), hash21(i + vec2(1, 0)), u.x),
             mix(hash21(i + vec2(0, 1)), hash21(i + vec2(1, 1)), u.x), u.y);
}
float fbm2(vec2 p) { return vnoise(p) * 0.65 + vnoise(p * 2.03) * 0.35; }
`

/**
 * The depth both pages are made of: H, a sum of soft anisotropic gaussians.
 *
 * Shapes come from JS - where they are, how big, how far through their lives.
 * Overlaps add, so they are the deepest places. Written to every channel so
 * the frost can smear it like any other texture.
 */
const HEIGHT_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
/* Per shape: centre (height units), sigma, amplitude; then rotation, aspect. */
uniform vec4 u_shapeA[${MAX_SHAPES}];
uniform vec2 u_shapeB[${MAX_SHAPES}];
uniform int u_shapes;
uniform float u_aspect;

void main() {
  vec2 p = vec2(v_uv.x * u_aspect, 1.0 - v_uv.y);
  float h = 0.0;
  for (int i = 0; i < ${MAX_SHAPES}; i++) {
    if (i >= u_shapes) break;
    vec4 a = u_shapeA[i];
    vec2 b = u_shapeB[i];
    vec2 q = p - a.xy;
    float c = cos(b.x), s = sin(b.x);
    q = vec2(c * q.x + s * q.y, -s * q.x + c * q.y);
    q.y /= b.y;
    h += a.w * exp(-dot(q, q) / (2.0 * a.z * a.z));
  }
  fragColor = vec4(vec4(h));
}`

/**
 * Frosted glass: the depth smeared vertically, the reference's defining look.
 *
 * A gaussian along y whose length - 0.12 to 0.30 of the height - varies from
 * column to column with low-frequency noise (period ~0.08 of the width), which
 * is what draws the soft vertical streaks. The kernel sits a little above the
 * pixel, so it pours down rather than spreading both ways.
 */
const FROST_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_field;
uniform float u_time;
uniform float u_seed;
${NOISE}

void main() {
  float n = vnoise(vec2(v_uv.x / 0.08 + u_seed * 13.0, u_time * 0.02));
  float len = mix(0.12, 0.30, n);
  float sigma = len * 0.5;
  // uv.y runs upward, so + is above: sampled from above, it pours down.
  float centre = v_uv.y + 0.3 * len;
  vec4 sum = vec4(0.0);
  float wsum = 0.0;
  for (int i = -10; i <= 10; i++) {
    float k = float(i) / 10.0 * 2.0;
    float w = exp(-0.5 * k * k);
    sum += texture(u_field, vec2(v_uv.x, centre + k * sigma)) * w;
    wsum += w;
  }
  fragColor = sum / wsum;
}`

/**
 * Depth to colour: d = 1 - exp(-1.6 H), then a ramp from paper through warm
 * greys to blue, interpolated in OKLab so it has no bands and no steps.
 *
 * Page one also gets the text cap - d held under 0.45 behind the words, so
 * the blue end never reaches them - and light from the top left: a normal from
 * the smeared depth's slope, and at most 8% more or less luminance, so every
 * mass reads as a gentle hill lit from its upper left.
 *
 * Page two gets its own ramp and gain, a flowing layer of fine detail for
 * the lenses to show, and behind its statistics a soft darkening rather than
 * a floor, so the detail and the motion carry on under the type. How much
 * darkening applies is kept in alpha, for the glass to calm its highlights.
 */
const COLOR_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_h;
/* The ramp's stops, already in OKLab. */
uniform vec3 u_ramp[7];
uniform float u_stop[7];
uniform float u_gain;
uniform float u_lit;
/* Page two's content blocks, CSS px, y down: x, y, width, height. */
uniform vec4 u_blocks[${MAX_BLOCKS}];
uniform int u_blockCount;
uniform vec2 u_css;
uniform float u_time;
${NOISE}
uniform float u_aspect;
uniform float u_progress;
uniform vec2 u_texel;
/* Page one's text boxes, each an ellipse (centre, radii) in height units. */
uniform vec4 u_textBoxes[${MAX_TEXT_BOXES}];
uniform int u_textBoxCount;

vec3 ramp(float d) {
  for (int i = 0; i < 6; i++) {
    if (d <= u_stop[i + 1]) return mix(u_ramp[i], u_ramp[i + 1], (d - u_stop[i]) / (u_stop[i + 1] - u_stop[i]));
  }
  return u_ramp[6];
}

vec3 oklabToLinear(vec3 c) {
  float l = c.x + 0.3963377774 * c.y + 0.2158037573 * c.z;
  float m = c.x - 0.1055613458 * c.y - 0.0638541728 * c.z;
  float s = c.x - 0.0894841775 * c.y - 1.2914855480 * c.z;
  l = l * l * l; m = m * m * m; s = s * s * s;
  return vec3(
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s
  );
}

vec3 encode(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}

float depth(float h) { return 1.0 - exp(-u_gain * h); }

/*
 * One smooth mask over the union of page two's content boxes: 1 inside a box,
 * a gaussian of STATS_SIGMA px outside it, joined by max. No rectangle edges,
 * no plateau - it only ever scales the field down.
 */
float overStats(vec2 uv) {
  vec2 p = vec2(uv.x, 1.0 - uv.y) * u_css;
  float m = 0.0;
  for (int i = 0; i < ${MAX_BLOCKS}; i++) {
    if (i >= u_blockCount) break;
    vec4 b = u_blocks[i];
    vec2 beyond = max(abs(p - (b.xy + 0.5 * b.zw)) - 0.5 * b.zw, 0.0);
    m = max(m, exp(-dot(beyond, beyond) / (2.0 * ${STATS_SIGMA.toFixed(1)} * ${STATS_SIGMA.toFixed(1)})));
  }
  return m;
}

/* 3D simplex noise (Gustavson / Ashima): gradient noise, no value lattice to
   show through as axis-aligned blocks. */
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x * 34.0) + 10.0) * x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
float snoise(vec3 v) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289(i);
  vec4 p = permute(permute(permute(i.z + vec4(0.0, i1.z, i2.z, 1.0)) + i.y + vec4(0.0, i1.y, i2.y, 1.0)) + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.5 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  m = m * m;
  return 105.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}

/* Three octaves, each domain turned by its own angle so no octave's grain
   lines up with the glass grid - or with another octave. */
float flowFbm(vec3 p) {
  float sum = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 3; i++) {
    float a = 0.9 + float(i) * 1.7;
    mat2 turn = mat2(cos(a), sin(a), -sin(a), cos(a));
    sum += amp * snoise(vec3(turn * p.xy, p.z));
    p = vec3(p.xy * 2.03, p.z * 1.4);
    amp *= 0.5;
  }
  return sum;
}

/*
 * Page two's fine structure: a flow, not a drift. Gradient noise with time as
 * its third axis, warped by a second noise that also evolves, the whole domain
 * carried along at about two cells a second. The big soft shapes keep their
 * slow drift underneath; this is the fast motion over it.
 */
float detail(vec2 uv) {
  vec2 p = vec2(uv.x, 1.0 - uv.y) * u_css / 100.0 + u_time * vec2(0.36, 0.26);
  float t = u_time * 0.35;
  vec2 w = vec2(flowFbm(vec3(p + vec2(3.1, 1.7), t)), flowFbm(vec3(p + vec2(8.3, 2.9), t + 4.0)));
  return 0.5 * flowFbm(vec3(p + 1.2 * w, t * 1.3));
}

void main() {
  float d = depth(texture(u_h, v_uv).r);
  float held = 0.0;
  if (u_lit < 0.5) {
    // The remap that reaches the dark end, then the detail on top of it -
    // added before the remap, the pale end clipped it flat and nothing moved.
    // Lifted off zero first: where no shape is, d sat at 0 and half the
    // detail clipped away, leaving the pale end flat and still.
    d = clamp(0.18 + 0.82 * smoothstep(0.0, 0.7, d) + 0.72 * detail(v_uv), 0.0, 1.0);
    held = overStats(v_uv);
    d += (1.0 - d) * ${STATS_PUSH} * held;
  }
  if (u_lit > 0.5 && u_textBoxCount > 0) {
    // The ellipses are page one's, so they slide out with the words. One
    // per text box - name, statement, every block of meta - joined by max.
    vec2 p = vec2((v_uv.x + u_progress) * u_aspect, 1.0 - v_uv.y);
    float inside = 0.0;
    for (int i = 0; i < ${MAX_TEXT_BOXES}; i++) {
      if (i >= u_textBoxCount) break;
      vec4 b = u_textBoxes[i];
      float e = length((p - b.xy) / b.zw);
      inside = max(inside, 1.0 - smoothstep(0.0, 0.12, (e - 1.0) * min(b.z, b.w)));
    }
    // A soft ceiling: tanh bends toward 0.45 and never reaches a plateau.
    d = mix(d, 0.45 * tanh(d / 0.45), inside);
  }
  vec3 color = encode(oklabToLinear(ramp(d)));
  if (u_lit > 0.5) {
    // Slopes in height units, y down, so the light's top-left is (-x, -y).
    // Read one texel in from the border: past it the texture clamps, the
    // slope halves, and the last column of the window steps.
    vec2 at = clamp(v_uv, 1.5 * u_texel, 1.0 - 1.5 * u_texel);
    float hx = (texture(u_h, at + vec2(u_texel.x, 0.0)).r - texture(u_h, at - vec2(u_texel.x, 0.0)).r) / (2.0 * u_texel.x * u_aspect);
    float hy = (texture(u_h, at - vec2(0.0, u_texel.y)).r - texture(u_h, at + vec2(0.0, u_texel.y)).r) / (2.0 * u_texel.y);
    vec3 n = normalize(vec3(-hx * ${SHADE_S.toFixed(2)}, -hy * ${SHADE_S.toFixed(2)}, 1.0));
    vec3 L = normalize(vec3(-0.4, -0.6, 0.7));
    color *= 1.0 + clamp(0.08 * (dot(n, L) - L.z) / (1.0 - L.z), -0.08, 0.08);
  }
  fragColor = vec4(color, held);
}`

/**
 * Both pages, and the text, at full resolution.
 *
 * One depth under both. Page one sees it through the frost, lit, in the light
 * ramp; page two sees it in the glass ramp through a grid of small lenses.
 * The slide's progress crossfades the two while the text slides out with its
 * page. The lenses are computed here, per device pixel, because their rims
 * and seams are a pixel or two wide.
 */
const SCENE_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_light;
uniform sampler2D u_dark;
uniform sampler2D u_text;
uniform float u_progress;
uniform vec2 u_css;
uniform float u_dpr;
uniform sampler2D u_test;
uniform float u_glassTest;
uniform float u_fringe;
uniform float u_flatField;

float sdRoundBox(vec2 q, vec2 b, float r) {
  vec2 w = abs(q) - b;
  return length(max(w, 0.0)) + min(max(w.x, w.y), 0.0) - r;
}

/*
 * The field at a point in CSS px, y down - or the test card, or flat grey,
 * when a check asks for them. The pointer does not touch it: page two has no
 * river.
 */
vec4 field(vec2 p) {
  vec2 uv = vec2(p.x / u_css.x, 1.0 - p.y / u_css.y);
  if (u_flatField > 0.5) return vec4(vec3(0.5), 0.0);
  return u_glassTest > 0.5 ? vec4(texture(u_test, uv).rgb, 0.0) : texture(u_dark, uv);
}

/*
 * Glass: a grid of small lenses that touch, fixed to the screen, the field
 * moving beneath.
 *
 * Each cell shows about three cells' worth of what is under it, minified and
 * flipped, so the picture breaks at every border - that break is what reads as
 * glass, and it is why neighbouring cells never line up. Near the rim the
 * image is pulled from much further out, which draws a ring wherever the
 * field has an edge to pull across - and nothing where it is uniform, so on
 * flat colour the cells merge and the glass disappears. The rim disperses:
 * a spectrum of samples, so rings crossing a light/dark edge split into a
 * rainbow. No bevel, no seam, no ring drawn on top; one hairline of light
 * along each top edge, and only where there is contrast to catch it.
 */
vec3 glass(vec2 uv) {
  float cell = ${CELL_PX.toFixed(1)};
  vec2 p = vec2(uv.x, 1.0 - uv.y) * u_css;
  vec2 id = floor(p / cell);
  vec2 q = p / cell - id - 0.5;
  vec2 c = (id + 0.5) * cell;
  float r = ${CORNER.toFixed(2)};
  vec2 b = vec2(0.5 - r);
  float d = sdRoundBox(q, b, r);
  // The outward direction, from the distance's own gradient.
  float e = 0.002;
  vec2 g = vec2(sdRoundBox(q + vec2(e, 0.0), b, r) - sdRoundBox(q - vec2(e, 0.0), b, r),
                sdRoundBox(q + vec2(0.0, e), b, r) - sdRoundBox(q - vec2(0.0, e), b, r));
  g = length(g) > 1e-6 ? normalize(g) : vec2(0.0);
  float rim = 1.0 - clamp(-d / ${RIM.toFixed(2)}, 0.0, 1.0);

  vec2 base = q * ${LENS.toFixed(1)};
  vec2 pull = g * rim * rim * ${RIM_PULL.toFixed(2)};
  vec4 mid = field(c + (base + pull) * cell);
  vec3 col = mid.rgb;
  /*
   * Dispersion: in the rim, seven samples along the pull, red least and
   * violet most, each weighted by its spectral colour and normalised by the
   * weights' sum - so a uniform field comes back exactly as it went in, and
   * colour appears only where the rim pulls across an edge in the image.
   */
  if (rim > 0.0) {
    vec3 acc = vec3(0.0);
    vec3 wsum = vec3(0.0);
    float spread = ${DISPERSION.toFixed(2)} * u_fringe * rim * rim;
    for (int i = 0; i < 7; i++) {
      float t = float(i) / 6.0;
      // Three quarters of the hue wheel - red, green, blue, violet. The whole
      // wheel ends where it starts, red at both ends, and the spread never
      // ordered its colours.
      float h = t * 0.75;
      vec3 w = clamp(vec3(abs(h * 6.0 - 3.0) - 1.0, 2.0 - abs(h * 6.0 - 2.0), 2.0 - abs(h * 6.0 - 4.0)), 0.0, 1.0);
      acc += w * field(c + (base + pull * (1.0 + spread * (t - 0.5) * 2.0)) * cell).rgb;
      wsum += w;
    }
    col = acc / wsum;
  }

  /*
   * The only light: a hairline just inside the top edge, fading into the
   * corners - and only where the field under the cell has contrast. Over a
   * uniform colour there is nothing to catch light, and the cells merge.
   */
  float px = 1.0 / (cell * u_dpr);
  float band = smoothstep(-1.7 * px, -1.0 * px, d) * (1.0 - smoothstep(-0.3 * px, 0.2 * px, d));
  float top = smoothstep(0.6, 0.98, -g.y);
  if (band * top > 0.0) {
    // Luminance spread over the span the lens sees, 0-255.
    float l0 = dot(field(c).rgb, vec3(0.2126, 0.7152, 0.0722));
    float l1 = dot(field(c + vec2(1.5, 1.5) * cell).rgb, vec3(0.2126, 0.7152, 0.0722));
    float l2 = dot(field(c + vec2(-1.5, 1.5) * cell).rgb, vec3(0.2126, 0.7152, 0.0722));
    float l3 = dot(field(c + vec2(1.5, -1.5) * cell).rgb, vec3(0.2126, 0.7152, 0.0722));
    float l4 = dot(field(c + vec2(-1.5, -1.5) * cell).rgb, vec3(0.2126, 0.7152, 0.0722));
    float m = (l0 + l1 + l2 + l3 + l4) / 5.0;
    float sd = 255.0 * sqrt(((l0 - m) * (l0 - m) + (l1 - m) * (l1 - m) + (l2 - m) * (l2 - m) + (l3 - m) * (l3 - m) + (l4 - m) * (l4 - m)) / 5.0);
    col += 0.30 * band * top * (1.0 - mid.a) * smoothstep(2.0, 12.0, sd);
  }
  return col;
}

void main() {
  vec2 uv1 = vec2(v_uv.x + u_progress, v_uv.y);
  vec3 light = texture(u_light, v_uv).rgb;
  vec3 color = u_progress > 0.0005 ? mix(light, glass(v_uv), u_progress) : light;
  // The text slides out with page one, and is ink over whatever it is on.
  if (uv1.x >= 0.0 && uv1.x <= 1.0) {
    color = mix(color, vec3(0.082), texture(u_text, uv1).a);
  }
  fragColor = vec4(color, 1.0);
}`

/**
 * The river, first half: this frame's pointer segments, and the horizontal
 * half of a separable 5-tap blur.
 *
 * Each segment runs from the previous pointer position to the current one and
 * splats along its whole length (capsule distance), so a fast move leaves a
 * continuous band rather than a row of dots:
 *   D += exp(-dist^2 / R^2) * delta * FORCE
 * Everything is in uv except the distance, which is in heights so the splat
 * is round whatever the window's shape.
 */
const SPLAT_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec2 fragColor;
uniform sampler2D u_prev;
uniform vec4 u_seg[${MAX_SEGMENTS}];
uniform int u_segs;
uniform float u_aspect;
uniform vec2 u_texel;

vec2 splat(vec2 uv) {
  vec2 acc = vec2(0.0);
  for (int i = 0; i < ${MAX_SEGMENTS}; i++) {
    if (i >= u_segs) break;
    vec4 s = u_seg[i];
    vec2 asp = vec2(u_aspect, 1.0);
    vec2 pa = (uv - s.xy) * asp;
    vec2 ba = (s.zw - s.xy) * asp;
    float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-12), 0.0, 1.0);
    vec2 q = pa - ba * h;
    acc += exp(-dot(q, q) / ${(SPLAT_R * SPLAT_R).toFixed(6)}) * (s.zw - s.xy) * ${SPLAT_FORCE.toFixed(2)};
  }
  return acc;
}

void main() {
  const float W[5] = float[5](1.0, 4.0, 6.0, 4.0, 1.0);
  vec2 sum = vec2(0.0);
  for (int i = -2; i <= 2; i++) {
    vec2 uv = v_uv + vec2(float(i) * u_texel.x, 0.0);
    sum += W[i + 2] * (texture(u_prev, uv).rg + splat(uv));
  }
  fragColor = sum / 16.0;
}`

/**
 * The river, second half: the vertical blur, then self-advection
 * D(uv) = D(uv - D(uv)), then decay, then the ceiling.
 *
 * Advecting the field along itself is what turns a push into a river. The
 * ceiling is 0.03 of the height - about thirty pixels on a thousand-pixel
 * window - so letters bend and are swallowed where they stand; they never fly
 * off or turn. There is no ambient motion at all, so at rest this settles to
 * exactly zero and the final frame is the scene, untouched.
 */
const ADVECT_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec2 fragColor;
uniform sampler2D u_src;
uniform float u_decay;
uniform float u_aspect;
uniform vec2 u_texel;

vec2 blurY(vec2 uv) {
  const float W[5] = float[5](1.0, 4.0, 6.0, 4.0, 1.0);
  vec2 sum = vec2(0.0);
  for (int i = -2; i <= 2; i++) sum += W[i + 2] * texture(u_src, uv + vec2(0.0, float(i) * u_texel.y)).rg;
  return sum / 16.0;
}

void main() {
  /*
   * Advected by a quarter of itself, not all of it. The literal
   * D(uv - D(uv)) moves the field up to thirty pixels a frame, and a field
   * carried along by itself steepens its own front (it is Burgers' equation)
   * faster than a 5-tap blur at quarter resolution can smooth it: the front
   * becomes a shock, and the shock is a straight seam through a glyph.
   */
  vec2 here = blurY(v_uv);
  vec2 d = blurY(v_uv - ${ADVECT.toFixed(2)} * here) * u_decay;
  /*
   * A soft ceiling. A hard clamp turns a sustained drag into a flat plateau
   * of maximum displacement - a block of text sliding rigidly - and
   * self-advection steepens the plateau's edge into a shock, which is exactly
   * the straight seam through a glyph. tanh never flattens and never exceeds
   * the ceiling.
   */
  float m = length(d * vec2(u_aspect, 1.0));
  if (m > 1e-6) d *= ${DISP_MAX.toFixed(3)} * tanh(m / ${DISP_MAX.toFixed(3)}) / m;
  fragColor = d;
}`

/**
 * The frame that reaches the screen: the scene through the river, then grain.
 *
 * Grain last and at full device resolution, so it is never displaced, blurred
 * or magnified. Monochrome - one offset on all three channels - heavier in the
 * midtones than at the ends. A pixel of noise blended 70/30 with a copy at
 * half resolution gives a grain of about 1.3 device pixels: pure per-pixel
 * noise is TV static, not film. It also dithers the 8-bit banding out of the
 * soft gradients below it.
 *
 * The pattern holds still. Every grain has its own life, and re-rolls on its
 * own clock with a 120ms crossfade - no global tick - so a few percent of
 * grains change in any frame and the rest stay where they were. Replacing the
 * whole pattern every frame is snow.
 */
const FINAL_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_scene;
uniform sampler2D u_disp;
uniform float u_grain;
uniform float u_time;
uniform float u_active;
/* How far page two is on screen: its grain is heavier and coarser. */
uniform float u_page2;
uniform vec2 u_css;
${NOISE}

/* One grain cell's value, zero-mean: re-rolled every life, crossfaded. */
float grain(vec2 cell, float seed) {
  float life = mix(${GRAIN_LIFE[0].toFixed(2)}, ${GRAIN_LIFE[1].toFixed(2)}, hash21(cell + seed * 1.37));
  float phase = hash21(cell * 1.71 + seed + 11.3) * life;
  float x = (u_time + phase) / life;
  float epoch = floor(x);
  float since = fract(x) * life;
  // The epoch enters along a non-integer direction: added straight to the
  // cell, a grain's next value would be its neighbour's last one, and the
  // pattern would slide sideways instead of living.
  vec2 step = vec2(17.13, 7.31);
  float before = hash21(cell + (epoch - 1.0) * step + seed * 3.1);
  float after = hash21(cell + epoch * step + seed * 3.1);
  return mix(before, after, smoothstep(0.0, 0.12, since)) - 0.5;
}

void main() {
  /*
   * Three samples while the field is moving, one while it is not.
   *
   * At rest the displacement is switched off rather than merely small, so the
   * frame is the scene exactly - and this pass is the only one that has to run
   * every frame, because the grain has to re-seed, so what it does when nothing
   * is happening is most of the idle cost of the screen.
   */
  vec3 c;
  if (u_active < 0.5) {
    c = texture(u_scene, v_uv).rgb;
  } else {
    // On page two the pointer stirs the field under the glass instead; the
    // glass itself - the grid - never moves.
    vec2 d = texture(u_disp, v_uv).rg * (1.0 - u_page2);
    /*
     * The fringe is its own width, not a fraction of the displacement: with
     * the displacement capped at 3% of the height a proportional split would
     * all but vanish. It saturates early, so a moderate touch already shows
     * the full band, and it is zero at rest, so the page stays monochrome.
     */
    vec2 dpx = d * u_css;
    float len = length(dpx);
    vec2 dir = len > 1e-4 ? dpx / len : vec2(0.0);
    float mag = length(d * vec2(u_css.x / u_css.y, 1.0));
    vec2 fringe = dir * ${FRINGE_PX.toFixed(1)} / u_css * smoothstep(0.002, 0.015, mag);
    c = vec3(
      texture(u_scene, v_uv + d + fringe).r,
      texture(u_scene, v_uv + d).g,
      texture(u_scene, v_uv + d - fringe).b
    );
  }
  // Two uniform noises, 70/30, normalised to unit deviation: ~1.3 px grain,
  // the same on both pages.
  float fine = grain(floor(gl_FragCoord.xy), 17.0);
  float coarse = grain(floor(gl_FragCoord.xy * 0.5), 31.0);
  float g = (0.7 * fine + 0.3 * coarse) / 0.2199;
  float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
  float amp = u_grain * (0.55 + 0.45 * (1.0 - abs(2.0 * lum - 1.0)));
  fragColor = vec4(clamp(c + g * amp, 0.0, 1.0), 1.0);
}`

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader | null {
  const shader = gl.createShader(type)
  if (shader === null) return null
  gl.shaderSource(shader, src)
  gl.compileShader(shader)
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS) === true) return shader
  console.error(`Home scene shader failed: ${gl.getShaderInfoLog(shader) ?? '?'}`)
  gl.deleteShader(shader)
  return null
}

function link(gl: WebGL2RenderingContext, frag: string): WebGLProgram | null {
  const vs = compile(gl, gl.VERTEX_SHADER, QUAD_VERT)
  const fs = compile(gl, gl.FRAGMENT_SHADER, frag)
  const program = gl.createProgram()
  if (vs === null || fs === null || program === null) return null
  gl.attachShader(program, vs)
  gl.attachShader(program, fs)
  gl.bindAttribLocation(program, 0, 'a_pos')
  gl.linkProgram(program)
  gl.deleteShader(vs)
  gl.deleteShader(fs)
  if (gl.getProgramParameter(program, gl.LINK_STATUS) === true) return program
  console.error(`Home scene link failed: ${gl.getProgramInfoLog(program) ?? '?'}`)
  return null
}

// --- the scene ------------------------------------------------------------------

export type HeroLine = {
  text: string
  /** CSS pixels, relative to the canvas: the box as laid out, before rotation. */
  x: number
  y: number
  width: number
  height: number
  font: string
  /** For the legibility cap's margin around the box. */
  fontSize: number
  letterSpacing: string
  /** Ink strength, 0-1: meta text is 78%. */
  alpha: number
  /** Degrees clockwise about the box's top-left, then shifted back into it. */
  rotate: number
  /** Truncate with an ellipsis to fit, CSS px; the DOM does the same. */
  maxWidth: number | null
  /** A 1 px underline under the text (the call to action's hover). */
  underline: boolean
}

/** A hairline or tick: CSS px, drawn on exact device pixels. */
export type Rule = { x: number; y: number; width: number; height: number; alpha: number }

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
  /** Advance and draw. `dt` in seconds, already clamped by the caller. */
  frame: (dt: number) => void
  /** True while the displacement still has anything in it. */
  disturbed: () => boolean
  debug: SceneDebug
  dispose: () => void
}

export function createScene(canvas: HTMLCanvasElement, flags: SceneFlags, reduced: boolean): Scene {
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
    color: link(gl, COLOR_FRAG),
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
  const paintTestCard = (): void => {
    const card = document.createElement('canvas')
    card.width = Math.max(1, Math.round(cssW))
    card.height = Math.max(1, Math.round(cssH))
    const ctx = card.getContext('2d')
    if (ctx === null) return
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, card.width, card.height)
    ctx.fillStyle = '#000'
    for (let x = 0; x < card.width; x += 12) ctx.fillRect(x, 0, 6, card.height)
    ctx.font = `900 ${Math.round(cssH * 0.3)}px sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.lineWidth = 10
    ctx.strokeStyle = '#fff'
    ctx.strokeText('RECTO', card.width / 2, card.height / 2)
    ctx.fillText('RECTO', card.width / 2, card.height / 2)
    gl.bindTexture(gl.TEXTURE_2D, testTex)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, card)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  }

  const textTex = gl.createTexture()!
  gl.bindTexture(gl.TEXTURE_2D, textTex)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 0]))
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR)
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

  const rasterise = (): void => {
    const pad = 1
    const w = Math.max(1, Math.round(cssW * pixelRatio))
    const h = Math.max(1, Math.round(cssH * pixelRatio))
    const flat = document.createElement('canvas')
    flat.width = w
    flat.height = h
    const ctx = flat.getContext('2d')
    if (ctx === null) return
    ctx.clearRect(0, 0, w, h)
    // Rules on whole device pixels: a 1 CSS px line is exactly dpr pixels,
    // never a half-covered pair.
    for (const r of rules) {
      ctx.fillStyle = `rgba(255,255,255,${r.alpha})`
      const x0 = Math.round(r.x * pixelRatio)
      const y0 = Math.round(r.y * pixelRatio)
      const x1 = Math.max(x0 + 1, Math.round((r.x + r.width) * pixelRatio))
      const y1 = Math.max(y0 + 1, Math.round((r.y + r.height) * pixelRatio))
      ctx.fillRect(x0, y0, x1 - x0, y1 - y0)
    }
    ctx.scale(pixelRatio, pixelRatio)
    ctx.textBaseline = 'middle'
    for (const line of lines) {
      ctx.save()
      ctx.font = line.font
      // Canvas has no text-transform, so the caller has already applied it;
      // letterSpacing it does have, and without it the texture is narrower
      // than the DOM it has to sit exactly on top of.
      if ('letterSpacing' in ctx) (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = line.letterSpacing
      let text = line.text
      if (line.maxWidth !== null && ctx.measureText(text).width > line.maxWidth) {
        while (text.length > 1 && ctx.measureText(`${text}…`).width > line.maxWidth) text = text.slice(0, -1)
        text = `${text.trimEnd()}…`
      }
      ctx.fillStyle = `rgba(255,255,255,${line.alpha})`
      // A rotated box is laid out upright and turned about its corner; the
      // box measured from the DOM is the turned one, so draw from its corner.
      if (line.rotate === 90) {
        ctx.translate(line.x + line.width, line.y)
        ctx.rotate(Math.PI / 2)
        ctx.fillText(text, -pad, line.width / 2)
      } else {
        ctx.fillText(text, line.x - pad, line.y + line.height / 2)
        if (line.underline) {
          const width = ctx.measureText(text).width
          const y = Math.round((line.y + line.height) * pixelRatio) / pixelRatio
          ctx.fillRect(line.x - pad, y, width, 1 / pixelRatio)
        }
      }
      ctx.restore()
    }
    gl.bindTexture(gl.TEXTURE_2D, textTex)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, flat)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0)
    gl.generateMipmap(gl.TEXTURE_2D)
  }

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

  /**
   * How much of the window is past d = 0.3 right now, from the shapes alone.
   *
   * A 24 x 16 grid in JS, once a second, blurred down each column the way
   * the frost smears the real thing - without that the estimate reads the
   * sharp shapes and runs well above what is on screen.
   * Random births alone swing the page between a quarter covered and all of
   * it; the composition wants 40-65% at any moment, so this is what the
   * lifecycle listens to.
   */
  const coverage = (ahead = 0): number => {
    const aspect = cssW / Math.max(1, cssH)
    const live = shapes.map((s) => ({ s, now: shapeNow({ ...s, age: s.age + ahead }) }))
    const grid = new Float32Array(24 * 16)
    for (let j = 0; j < 16; j++) {
      for (let i = 0; i < 24; i++) {
        const px = ((i + 0.5) / 24) * aspect
        const py = (j + 0.5) / 16
        let h = 0
        for (const { s, now } of live) {
          let qx = px - s.x
          let qy = py - s.y
          const c = Math.cos(s.rot)
          const sn = Math.sin(s.rot)
          ;[qx, qy] = [c * qx + sn * qy, (-sn * qx + c * qy) / s.aspect]
          h += now.amp * Math.exp(-(qx * qx + qy * qy) / (2 * now.sigma * now.sigma))
        }
        grid[j * 24 + i] = h
      }
    }
    // The frost: a gaussian of about 0.1 of the height, reaching up.
    let deep = 0
    for (let i = 0; i < 24; i++) {
      for (let j = 0; j < 16; j++) {
        let sum = 0
        let wsum = 0
        for (let k = -4; k <= 4; k++) {
          const row = Math.min(15, Math.max(0, j - 1 + k))
          const w = Math.exp(-(k * k) / (2 * 1.6 * 1.6))
          sum += grid[row * 24 + i]! * w
          wsum += w
        }
        if (sum / wsum > 0.2229) deep++
      }
    }
    return deep / (24 * 16)
  }
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
    const groundDue =
      now - groundAt > (onPage2 ? 0 : GROUND_FRAME_MS) || progress !== lastProgress
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
        gl.useProgram(color)
        bind(color, 'u_h', 0, source.tex)
        gl.uniform3fv(at(color, 'u_ramp'), lit ? LIGHT_RAMP : GLASS_RAMP_LAB)
        gl.uniform1fv(at(color, 'u_stop'), lit ? RAMP_AT : GLASS_RAMP_AT)
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
      gl.uniform1f(at(compose, 'u_progress'), progress)
      gl.uniform2f(at(compose, 'u_css'), cssW, cssH)
      gl.uniform1f(at(compose, 'u_dpr'), pixelRatio)
      bind(compose, 'u_test', 3, testTex)
      gl.uniform1f(at(compose, 'u_glassTest'), flags.glassTest ? 1 : 0)
      gl.uniform1f(at(compose, 'u_fringe'), flags.noFringe ? 0 : 1)
      gl.uniform1f(at(compose, 'u_flatField'), flags.flatField ? 1 : 0)
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
      gl.uniform1f(at(programs.final, 'u_grain'), flags.noGrain ? 0 : GRAIN)
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
      /*
       * Every text box gets its own cap: an ellipse through the corners of
       * the box grown by 0.6em, in heights. Under it the depth is held below
       * 0.45, so no text ever stands on the blue end of the ramp.
       */
      const H = Math.max(1, cssH)
      textBoxes = new Float32Array(MAX_TEXT_BOXES * 4)
      textBoxCount = Math.min(MAX_TEXT_BOXES, next.length)
      next.slice(0, MAX_TEXT_BOXES).forEach((l, i) => {
        const margin = Math.max(8, 0.6 * l.fontSize)
        const width = l.maxWidth === null ? l.width : Math.min(l.width, l.maxWidth)
        textBoxes.set([
          (l.x + width / 2) / H,
          (l.y + l.height / 2) / H,
          ((width / 2 + margin) / H) * Math.SQRT2,
          ((l.height / 2 + margin) / H) * Math.SQRT2,
        ], i * 4)
      })
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
      gl.deleteTexture(testTex)
      gl.deleteBuffer(quad)
      gl.deleteVertexArray(vao)
      for (const p of Object.values(programs)) if (p !== null) gl.deleteProgram(p)
      if (timerQuery !== null) gl.deleteQuery(timerQuery)
    },
  }
}
