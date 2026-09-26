/**
 * The home scene's depth passes: the height field, the frost smear, and the
 * colour ramps (see the render graph in scene.ts).
 */

import { MAX_SHAPES, MAX_BLOCKS, MAX_TEXT_BOXES, STATS_SIGMA, STATS_PUSH, SHADE_S } from './scene-tuning'

/** Shared by every fragment shader: value noise, fBm, hash. */
export const NOISE = `
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
export const HEIGHT_FRAG = `#version 300 es
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
export const FROST_FRAG = `#version 300 es
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
export const COLOR_FRAG = `#version 300 es
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
