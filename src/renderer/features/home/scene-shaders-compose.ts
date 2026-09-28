/**
 * The home scene's composing passes: the full-resolution scene with its glass
 * blocks, the pointer's displacement (splat and advect), and the final read
 * through it with grain (see the render graph in scene.ts).
 */

import {
  CELL_PX,
  CORNER,
  RIM,
  LENS,
  RIM_PULL,
  DISPERSION,
  MAX_SEGMENTS,
  SPLAT_R,
  SPLAT_FORCE,
  ADVECT,
  DISP_MAX,
  GRAIN_LIFE,
  FRINGE_PX,
} from './scene-tuning'
import { NOISE } from './scene-shaders-depth'

/**
 * Both pages, and the text, at full resolution.
 *
 * One depth under both. Page one sees it through the frost, lit, in the light
 * ramp; page two sees it in the glass ramp through a grid of small lenses.
 * The slide's progress crossfades the two while the text slides out with its
 * page. The lenses are computed here, per device pixel, because their rims
 * and seams are a pixel or two wide.
 */
export const SCENE_FRAG = `#version 300 es
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
/* The words' and rules' ink, and each kind of line's strength relative to how
   the texture drew it: strong text, meta labels, grid rules - red, green and
   blue in the kind texture. All ones is the texture exactly as drawn. */
uniform vec3 u_ink;
uniform vec3 u_textWeights;
uniform sampler2D u_textKind;

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
    vec4 t = texture(u_text, uv1);
    float ink = t.a;
    if (u_textWeights != vec3(1.0)) {
      // Which kind of line this is. Where the kind texture has nothing - an
      // edge the two rasters antialiased differently - the ink stands as is.
      vec3 k = texture(u_textKind, uv1).rgb;
      float sum = k.r + k.g + k.b;
      ink = sum > 1e-3 ? t.a * dot(k / sum, u_textWeights) : t.a;
    }
    color = mix(color, u_ink, ink);
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
export const SPLAT_FRAG = `#version 300 es
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
export const ADVECT_FRAG = `#version 300 es
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
export const FINAL_FRAG = `#version 300 es
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
