/**
 * The hero text and rules, drawn to a canvas and uploaded as the texture the
 * scene composites over the field - and the glass test card.
 */

import { MAX_TEXT_BOXES } from './scene-tuning'

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

/** Draw the hero lines and rules at device resolution into `tex`, mipmapped. */
export function rasteriseText(
  gl: WebGL2RenderingContext,
  tex: WebGLTexture,
  lines: readonly HeroLine[],
  rules: readonly Rule[],
  cssW: number,
  cssH: number,
  pixelRatio: number,
): void {
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
  gl.bindTexture(gl.TEXTURE_2D, tex)
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, flat)
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0)
  gl.generateMipmap(gl.TEXTURE_2D)
}

/**
 * The glass test card: black and white stripes 6 CSS px wide and a large
 * word, into `tex`. A lens is easy to get subtly wrong on a soft field and
 * impossible to misread on stripes.
 */
export function paintGlassTestCard(gl: WebGL2RenderingContext, tex: WebGLTexture, cssW: number, cssH: number): void {
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
  gl.bindTexture(gl.TEXTURE_2D, tex)
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, card)
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
}

/**
 * Every text box gets its own cap: an ellipse through the corners of the box
 * grown by 0.6em, in heights. Under it the depth is held below 0.45, so no
 * text ever stands on the blue end of the ramp. Packed four floats a box, for
 * the colour pass.
 */
export function textCaps(lines: readonly HeroLine[], cssH: number): Float32Array<ArrayBuffer> {
  const H = Math.max(1, cssH)
  const boxes = new Float32Array(MAX_TEXT_BOXES * 4)
  lines.slice(0, MAX_TEXT_BOXES).forEach((l, i) => {
    const margin = Math.max(8, 0.6 * l.fontSize)
    const width = l.maxWidth === null ? l.width : Math.min(l.width, l.maxWidth)
    boxes.set(
      [
        (l.x + width / 2) / H,
        (l.y + l.height / 2) / H,
        ((width / 2 + margin) / H) * Math.SQRT2,
        ((l.height / 2 + margin) / H) * Math.SQRT2,
      ],
      i * 4,
    )
  })
  return boxes
}
