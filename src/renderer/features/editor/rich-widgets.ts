import katex from 'katex'
import { EditorView, WidgetType } from '@codemirror/view'
import { resolveVaultFile, vaultFileUrl } from '../../app/vault-url'

/**
 * Widgets for the Obsidian syntax Live Preview renders: maths, tables,
 * footnote markers, embeds and callout headers.
 *
 * Every widget here renders from the note's own text and gives it back on a
 * click: pressing on a formula or a table puts the caret in it, which reveals
 * the source, the same rule as every other Live Preview decoration.
 */

// --- source extraction ------------------------------------------------------

/**
 * Text of a block with its container prefixes removed.
 *
 * A math block or table inside a blockquote carries `> ` on every line, and
 * one inside a list carries the list's indentation. Neither is part of the
 * formula or the table, and KaTeX would choke on a stray `>`.
 */
export function stripContainers(raw: string): string {
  const lines = raw.split('\n').map((line) => line.replace(/^\s*(?:>\s?)+/, (prefix) => (prefix.includes('>') ? '' : prefix)))
  const indents = lines.filter((line) => line.trim() !== '').map((line) => /^\s*/.exec(line)?.[0].length ?? 0)
  const common = indents.length === 0 ? 0 : Math.min(...indents)
  return lines.map((line) => line.slice(Math.min(common, /^\s*/.exec(line)?.[0].length ?? 0))).join('\n')
}

/** The TeX inside a `$$` block, without its fences. */
export function mathSource(raw: string): string {
  const text = stripContainers(raw).trim()
  const open = text.startsWith('$$') ? 2 : 0
  const close = text.length > open + 1 && text.endsWith('$$') ? 2 : 0
  return text.slice(open, text.length - close).trim()
}

// --- maths ------------------------------------------------------------------

/**
 * KaTeX, cached by source.
 *
 * `renderToString` is the one `innerHTML` in the editor, so the options are
 * the safe ones: `trust: false` refuses `\href`, `\url` and `\htmlClass`,
 * KaTeX escapes everything else it emits, and `throwOnError: false` turns bad
 * TeX into a red error span instead of an exception inside a decoration pass -
 * which CodeMirror would swallow, and the whole layer would vanish.
 */
const cache = new Map<string, string>()
const CACHE_LIMIT = 500

function renderTex(tex: string, display: boolean): string {
  const key = `${display ? 'D' : 'I'}${tex}`
  const hit = cache.get(key)
  if (hit !== undefined) return hit
  const html = katex.renderToString(tex, {
    displayMode: display,
    throwOnError: false,
    trust: false,
    strict: 'ignore',
    output: 'htmlAndMathml',
  })
  if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value as string)
  cache.set(key, html)
  return html
}

/** Put the caret at the start of whatever this widget replaced, revealing its source. */
export function revealOnPress(dom: HTMLElement, view: EditorView): void {
  dom.addEventListener('mousedown', (event) => {
    // Links and inputs inside the widget keep their own behaviour.
    if ((event.target as HTMLElement).closest('a, button, input') !== null) return
    event.preventDefault()
    const pos = view.posAtDOM(dom)
    view.dispatch({ selection: { anchor: pos } })
    view.focus()
  })
}

export class MathWidget extends WidgetType {
  constructor(
    private readonly tex: string,
    private readonly display: boolean,
    /** A `$$` block on its own lines, rather than math inside a line. */
    private readonly block: boolean,
  ) {
    super()
  }

  override eq(other: MathWidget): boolean {
    return other.tex === this.tex && other.display === this.display && other.block === this.block
  }

  override toDOM(view: EditorView): HTMLElement {
    const el = document.createElement(this.block ? 'div' : 'span')
    el.className = this.block ? 'cm-math-block' : this.display ? 'cm-math cm-math-display' : 'cm-math'
    el.innerHTML = renderTex(this.tex, this.display)
    revealOnPress(el, view)
    return el
  }

  override ignoreEvent(): boolean {
    return true
  }
}

// --- inline markdown, for the places a widget has to render text itself -----

/**
 * Just enough inline markdown for a table cell: maths, bold, italic, code,
 * highlight, strikethrough and wikilinks.
 *
 * Built from DOM nodes and text nodes, never from HTML strings - apart from
 * KaTeX's own output, nothing a note contains is parsed as markup.
 */
const INLINE =
  /(\$\$[^$]+\$\$|\$[^$\s][^$]*?\$|`[^`]+`|\*\*[^*]+\*\*|__[^_]+__|\*[^*\s][^*]*\*|_[^_\s][^_]*_|==[^=]+==|~~[^~]+~~|\[\[[^\]]+\]\])/g

export function renderInline(text: string, into: HTMLElement): void {
  let last = 0
  for (const match of text.matchAll(INLINE)) {
    const token = match[0]
    const at = match.index ?? 0
    if (at > last) into.append(document.createTextNode(text.slice(last, at)))
    last = at + token.length

    if (token.startsWith('$$')) {
      const span = document.createElement('span')
      span.className = 'cm-math cm-math-display'
      span.innerHTML = renderTex(token.slice(2, -2), true)
      into.append(span)
    } else if (token.startsWith('$')) {
      const span = document.createElement('span')
      span.className = 'cm-math'
      span.innerHTML = renderTex(token.slice(1, -1), false)
      into.append(span)
    } else if (token.startsWith('`')) {
      const code = document.createElement('code')
      code.textContent = token.slice(1, -1)
      into.append(code)
    } else if (token.startsWith('**') || token.startsWith('__')) {
      const strong = document.createElement('strong')
      renderInline(token.slice(2, -2), strong)
      into.append(strong)
    } else if (token.startsWith('==')) {
      const mark = document.createElement('mark')
      mark.className = 'cm-highlight'
      renderInline(token.slice(2, -2), mark)
      into.append(mark)
    } else if (token.startsWith('~~')) {
      const s = document.createElement('s')
      renderInline(token.slice(2, -2), s)
      into.append(s)
    } else if (token.startsWith('[[')) {
      const inner = token.slice(2, -2)
      const span = document.createElement('span')
      span.className = 'cm-wikilink'
      span.textContent = inner.includes('|') ? inner.slice(inner.indexOf('|') + 1) : inner.replace(/#.*$/, '')
      into.append(span)
    } else {
      const em = document.createElement('em')
      renderInline(token.slice(1, -1), em)
      into.append(em)
    }
  }
  if (last < text.length) into.append(document.createTextNode(text.slice(last)))
}

// --- footnotes ----------------------------------------------------------------

export class FootnoteWidget extends WidgetType {
  constructor(private readonly label: string) {
    super()
  }

  override eq(other: FootnoteWidget): boolean {
    return other.label === this.label
  }

  override toDOM(): HTMLElement {
    const sup = document.createElement('sup')
    sup.className = 'cm-footnote-ref'
    sup.textContent = this.label
    return sup
  }

  override ignoreEvent(): boolean {
    return false
  }
}

// --- embeds -------------------------------------------------------------------

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|avif|bmp)$/i

/**
 * `![[file]]` - Obsidian's embed.
 *
 * An image embed renders as the image, found by name anywhere in the vault
 * (Obsidian resolves embeds by file name, not path, and that is what a copied
 * note relies on). `![[file|300]]` sets the width. A note embed renders as a
 * link card rather than the note's full content: transcluding one note inside
 * another is a feature of its own, and a card that opens the note loses
 * nothing the copied text had.
 */
export class EmbedWidget extends WidgetType {
  constructor(
    private readonly target: string,
    private readonly size: string | null,
  ) {
    super()
  }

  override eq(other: EmbedWidget): boolean {
    return other.target === this.target && other.size === this.size
  }

  override toDOM(view: EditorView): HTMLElement {
    const name = this.target.replace(/#.*$/, '').trim()
    if (IMAGE_EXT.test(name)) {
      const wrap = document.createElement('span')
      wrap.className = 'cm-image'
      const path = resolveVaultFile(name)
      if (path === null) {
        wrap.classList.add('is-missing')
        wrap.textContent = `Image not found: ${name}`
        return wrap
      }
      const img = document.createElement('img')
      img.src = vaultFileUrl(path)
      img.alt = name
      img.loading = 'lazy'
      const width = this.size !== null ? Number.parseInt(this.size, 10) : Number.NaN
      if (Number.isFinite(width) && width > 0) img.style.width = `${width}px`
      img.addEventListener('error', () => {
        wrap.classList.add('is-missing')
        wrap.textContent = `Image not found: ${name}`
      })
      wrap.append(img)
      revealOnPress(wrap, view)
      return wrap
    }

    // The link carries `cm-wikilink`, so the editor's own link handler opens it -
    // one code path for following a link, wherever the link is drawn.
    const card = document.createElement('span')
    card.className = 'cm-embed'
    const label = document.createElement('span')
    label.className = 'cm-embed__label'
    label.textContent = '↪'
    const link = document.createElement('span')
    link.className = 'cm-wikilink cm-embed__link'
    link.textContent = name
    card.append(label, link)
    return card
  }

  override ignoreEvent(): boolean {
    // The note card lets the editor see its clicks, so the link handler runs;
    // the image handles its own press.
    return IMAGE_EXT.test(this.target.replace(/#.*$/, '').trim())
  }
}
