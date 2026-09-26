/**
 * The home scene's tuning: limits, the pointer river, the shapes, the ramps and
 * the glass. Shared by the shaders (as GLSL constants) and the frame loop.
 */

/** Pointer segments folded into the displacement in one frame. */
export const MAX_SEGMENTS = 8

/** Content blocks on page two the field keeps dark behind. */
export const MAX_BLOCKS = 16

/** Text boxes on page one, each with its own legibility cap. */
export const MAX_TEXT_BOXES = 24

/*
 * The river, in the units the brief gives them: the splat radius and the
 * displacement ceiling in heights, the fringe in CSS pixels.
 */
export const SPLAT_R = 0.09

export const SPLAT_FORCE = 3.0

export const DISP_MAX = 0.03

export const DISP_DECAY = 0.95

export const FRINGE_PX = 4

/** How much of itself the field is carried by each frame; see ADVECT_FRAG. */
export const ADVECT = 0.25

/** Depth shapes the shader can hold; the lifecycle keeps four to eight. */
export const MAX_SHAPES = 10

/**
 * A shape's drawn gaussian deviation, as a fraction of its nominal sigma.
 *
 * At the nominal size one sigma-0.3 shape alone is past d = 0.3 over about
 * 60% of the window, and four to eight of them bury the paper. The nominal
 * sigma still sets the amplitude and the brief's size classes; this only sets
 * how far each one spreads.
 */
export const SPREAD = 0.5

/** How steep the depth reads as a surface: gentle hills, not cliffs. */
export const SHADE_S = 0.6

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
export const GRAIN = 0.046

export const GRAIN_LIFE: readonly [number, number] = [1.0, 3.0]

/*
 * The depth ramps, sRGB hex at d = 0, 0.2, 0.4, 0.6, 0.78, 0.92, 1: paper
 * where nothing is, warm greys, then blue in the deep places, the deepest
 * glowing slightly lighter like the reference's hotspot.
 */
const RAMP = ['#F3F2EF', '#DCD9D5', '#A9A5A3', '#85828A', '#66708F', '#5A6A9C', '#6F82B8'] as const

export const RAMP_AT = [0, 0.2, 0.4, 0.6, 0.78, 0.92, 1] as const

/*
 * Page two's ramp, sampled from the blue glass reference: pale, through sky
 * and cobalt, to deep blue and nearly black. High contrast on purpose - the
 * glass blocks need bright and dark to refract. The last stop is repeated so
 * both ramps have seven.
 */
const GLASS_RAMP = ['#BDCDD1', '#9DBBD2', '#73A0CF', '#4173C9', '#0E097B', '#010003', '#010003'] as const

export const GLASS_RAMP_AT = [0, 0.25, 0.45, 0.62, 0.8, 1, 1.0001] as const

/**
 * How fast page two's depth saturates: d = 1 - exp(-gain * H). Steeper than
 * page one's 1.6, so the same shapes reach the dark end of a ramp whose
 * median has to sit near #70. Tuned against the measured percentiles.
 */
export const GLASS_GAIN = 1.4

/**
 * How far page two's field is pushed deeper behind its statistics:
 * d + (1 - d) x PUSH x G, G one gaussian over the union of the content boxes.
 * Deeper along the ramp, toward navy - multiplying the colour darker turned
 * it to grey mud. The brief's flat d + 0.35 G left pale field behind the type
 * at 3:1; pushing by the remaining distance clears 4.5:1 and never clips
 * the deep end into a plateau. 0.55 keeps the detail moving behind the type;
 * 0.75 measured 15:1 and a dead zone.
 */
export const STATS_PUSH = 0.55

export const STATS_SIGMA = 120

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

export const LIGHT_RAMP = new Float32Array(RAMP.flatMap((hex) => oklab(hex)))

export const GLASS_RAMP_LAB = new Float32Array(GLASS_RAMP.flatMap((hex) => oklab(hex)))

/*
 * The glass: cells that touch, each a small lens. Pitch in CSS px, the rest
 * in fractions of a cell. LENS is negative - each cell shows about three
 * cells' worth of the field, minified and flipped - and the rim pulls from
 * much further out, which draws the ring inside every cell.
 */
export const CELL_PX = 22

export const CORNER = 0.28

export const RIM = 0.18

export const LENS = -3.0

export const RIM_PULL = 1.8

/**
 * Dispersion in the rim: seven spectral samples, red pulled least and violet
 * most, spread by this much of the rim's own pull either side of the middle.
 * 0.9, not 0.3: the field is soft at the scale of a cell, and at 0.3 the
 * spectrum's ends saw nearly the same colour - rims only ever went bluish.
 */
export const DISPERSION = 0.9
