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
 * Film grain: how long a grain lives before it re-rolls - each on its own
 * clock, so the pattern holds still and lives rather than refreshing all at
 * once. Its strength (std in luminance at midtones) is the theme's
 * `--home-grain`: grain shows more on black, so the dark theme's is lower.
 *
 * One to three seconds, not the brief's 0.6 to 2: over that range 78% of
 * grains re-roll within any second, and frames a second apart correlated at
 * 0.20 - measured - against a target of 0.3 to 0.6. At one to three it is
 * 55% re-rolled, which is where the target sits.
 */
export const GRAIN_LIFE: readonly [number, number] = [1.0, 3.0]

/*
 * The colours - both ramps, the ink, and the grain's strength - are the
 * theme's, not tuning: `--home-*` in tokens.css, read by scene-palette.ts.
 */

/**
 * How fast page two's depth saturates: d = 1 - exp(-gain * H). Steeper than
 * page one's 1.6, so the same shapes reach the dark end of a ramp whose
 * median has to sit near #70. Tuned against the measured percentiles.
 */
export const GLASS_GAIN = 1.4

/**
 * How far page two's field is pushed behind its statistics, toward the end of
 * the ramp the light type reads against - deep in the light theme, shallow in
 * the dark: d + (to - d) x PUSH x G, G one gaussian over the union of the
 * content boxes.
 * Deeper along the ramp, toward navy - multiplying the colour darker turned
 * it to grey mud. The brief's flat d + 0.35 G left pale field behind the type
 * at 3:1; pushing by the remaining distance clears 4.5:1 and never clips
 * the deep end into a plateau. 0.55 keeps the detail moving behind the type;
 * 0.75 measured 15:1 and a dead zone.
 */
export const STATS_PUSH = 0.55

export const STATS_SIGMA = 120

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
