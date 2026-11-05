import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { Handle, NodeResizer, Position, useStore, type NodeProps } from '@xyflow/react'
import { fileKind, extensionOf } from '@shared/file-kind'
import { IPC } from '@shared/ipc'
import { isPresetColor, type LinkPreview } from '@shared/canvas'
import { youTubeId } from '@shared/youtube'
import { api } from '../../../app/api'
import { vaultFileUrl } from '../../../app/vault-url'
import { useNoteBus } from '../../../app/note-bus'
import { Icon } from '../../../ui/Icon'
import { Markdown } from '../../bots/components/Markdown'
import { NoteBodyEditor } from '../../editor'
import { CodeView } from '../../editor/components/CodeView'
import { PdfView } from '../../pdf/PdfView'
import { useDrawing } from '../drawing-store'
import { strokePath } from '../drawing'
import type { FlowNode } from '../canvas-flow'
import { useCanvasActions } from '../canvas-actions'
import { boardOfCard, isBoardPath, useBoards, useCardPlaces } from '../../boards'
import { BoardPreview, CardNode } from './CanvasBoardNodes'
import { figureOf, shapeOf, type Shape } from '../shapes'
import { styleData } from '../canvas-style'

/**
 * How each kind of node is drawn. Every one is memoised and reads only its own
 * node, so dragging one redraws one. Text is shown as rendered Markdown; the
 * editor is put in only for the node being edited, so a canvas of hundreds of
 * notes is hundreds of static blocks, not hundreds of editors.
 */

/** A node's colour as a CSS colour: a preset maps to the theme's, a hex is itself. */
export const colorOf = (color: string | undefined): string | undefined =>
  color === undefined ? undefined : isPresetColor(color) ? `var(--canvas-${color})` : color


const SIDES = [
  ['top', Position.Top],
  ['right', Position.Right],
  ['bottom', Position.Bottom],
  ['left', Position.Left],
] as const

/** One handle per side: an edge leaves and arrives at any of them (loose connections). */
function Sides(): React.ReactElement {
  return (
    <>
      {SIDES.map(([id, position]) => (
        <Handle key={id} id={id} type="source" position={position} className="canvas-handle" />
      ))}
    </>
  )
}

export function Frame({
  props,
  className,
  children,
  minWidth = 60,
  minHeight = 40,
  keepAspect = false,
}: {
  props: NodeProps<FlowNode>
  className: string
  children: React.ReactNode
  minWidth?: number
  minHeight?: number
  /** Pictures and videos: resized with their proportions kept. */
  keepAspect?: boolean
}): React.ReactElement {
  const actions = useCanvasActions()
  const node = props.data.node
  const color = colorOf(node.color)
  return (
    <div
      className={`canvas-node ${className}${props.selected ? ' is-selected' : ''}`}
      style={color === undefined ? undefined : ({ '--node-color': color } as React.CSSProperties)}
      {...styleData(node)}
    >
      <NodeResizer
        isVisible={props.selected}
        minWidth={minWidth}
        minHeight={minHeight}
        keepAspectRatio={keepAspect}
        lineClassName="canvas-resize__line"
        handleClassName="canvas-resize__handle"
        onResizeEnd={(_, box) => actions.resize(node.id, box)}
      />
      <Sides />
      {children}
    </div>
  )
}

/** The editor put in for typing gets the keyboard at once, with the caret at the end. */
function useFocusOnEdit(editing: boolean): React.RefObject<HTMLDivElement | null> {
  const body = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!editing) return
    const frame = requestAnimationFrame(() => body.current?.querySelector<HTMLElement>('.cm-content')?.focus())
    return () => cancelAnimationFrame(frame)
  }, [editing])
  return body
}

/** As tall as a card grows by itself while typed in; past it, it scrolls. */
const GROW_MAX = 640

/**
 * A card grows to fit what is typed into it, as in Heptabase: while it is
 * edited, whenever its text runs past the bottom, it is made as tall as the
 * text needs (up to GROW_MAX). It never shrinks by itself - a size set by hand
 * stays.
 */
function useGrow(editing: boolean, body: React.RefObject<HTMLDivElement | null>, id: string, height: number): void {
  const actions = useCanvasActions()
  useEffect(() => {
    const el = body.current
    if (!editing || el === null) return
    const check = (): void => {
      // Layout sizes, not screen ones: canvas units whatever the zoom.
      const now = (el.closest('.canvas-node') as HTMLElement | null)?.offsetHeight ?? height
      const over = el.scrollHeight - el.clientHeight
      if (over > 1 && now < GROW_MAX) actions.grow(id, Math.min(GROW_MAX, Math.ceil(now + over)))
    }
    const observer = new ResizeObserver(check)
    for (const child of el.children) observer.observe(child)
    check()
    return () => observer.disconnect()
  }, [editing, body, id, height, actions])
}

/**
 * Below this zoom, text is drawn as plain lines rather than formatted Markdown:
 * the same card, its text in place, only cheaper - too small to read the
 * formatting anyway, and formatting hundreds of cards on every pan is what
 * slows a big canvas down. A boolean, so cards draw again only when it flips.
 */
const PLAIN_BELOW = 0.45
const usePlain = (): boolean => useStore((s) => s.transform[2] < PLAIN_BELOW)

/** Markdown as plain lines: marks taken off, the words and the line breaks kept. */
function PlainText({ text }: { text: string }): React.ReactElement {
  const plain = text
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s+\[[ xX]\]\s+/gm, '☐ ')
    .replace(/^\s*[-*+]\s+/gm, '• ')
    .replace(/!?\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_m, target: string, alias?: string) => alias ?? target)
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_~`]+/g, '')
  return <p className="canvas-node__plain">{plain.slice(0, 1200)}</p>
}

/** A shape's figure behind its text, in the node's colour. */
function Figure({ shape, width, height }: { shape: Shape; width: number; height: number }): React.ReactElement {
  const figure = figureOf(shape, width, height)
  return (
    <svg
      className="canvas-shape"
      viewBox={figure.unit ? '0 0 100 100' : `0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <path className="canvas-shape__outline" d={figure.outline} vectorEffect="non-scaling-stroke" />
      {figure.mark !== undefined && <path className="canvas-shape__mark" d={figure.mark} vectorEffect="non-scaling-stroke" />}
    </svg>
  )
}

export const TextNode = memo(function TextNode(props: NodeProps<FlowNode>): React.ReactElement {
  const actions = useCanvasActions()
  const node = props.data.node
  const editing = actions.editing === node.id
  const plain = usePlain()
  const body = useFocusOnEdit(editing)
  const shape = shapeOf(node)
  // A card grows with its text; a shape keeps the size it was drawn.
  useGrow(editing && shape === null, body, node.id, node.height)
  return (
    <Frame props={props} className={shape === null ? 'canvas-node--text' : `canvas-node--text canvas-node--shape is-${shape}`}>
      {shape !== null && <Figure shape={shape} width={node.width} height={node.height} />}
      <div
        ref={body}
        className={`canvas-node__body${editing ? ' nodrag nopan' : ''}`}
        onWheelCapture={scrollOrPan}
        onDoubleClick={(ev) => {
          ev.stopPropagation()
          actions.startEditing(node.id)
        }}
      >
        {editing ? (
          <NoteBodyEditor
            docKey={`canvas:${node.id}`}
            value={node.text ?? ''}
            placeholder="Write here…"
            onChange={(text) => actions.setText(node.id, text)}
            onOpenLink={(target) => actions.openLink(target)}
          />
        ) : (node.text ?? '') === '' ? (
          shape === null && <p className="canvas-node__empty">Double-click to write</p>
        ) : (
          plain ? (
            <PlainText text={node.text ?? ''} />
          ) : (
            <Markdown text={node.text ?? ''} onOpenNote={(title) => actions.openLink(title)} />
          )
        )}
      </div>
    </Frame>
  )
})

const nameOf = (path: string): string => path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/i, '')

/** A note's text, read when its node is drawn and again when the vault changes; null path: not read. */
/**
 * Notes' text as last read, for the vault's current revision: a note that pans
 * out of view and back is drawn from here, not read from disk again. Any change
 * in the vault (a new revision) starts it afresh.
 */
const noteTexts = { revision: -1, texts: new Map<string, string | null>() }

function useNoteText(path: string | null): string | null | undefined {
  const { revision } = useNoteBus()
  // A new revision: what was read before may be stale.
  if (noteTexts.revision !== revision) {
    noteTexts.revision = revision
    noteTexts.texts.clear()
  }
  const cached = path === null ? undefined : noteTexts.texts.get(path)
  const [text, setText] = useState<string | null | undefined>(cached)
  useEffect(() => {
    if (path === null) return
    const known = noteTexts.texts.get(path)
    if (known !== undefined) {
      setText(known)
      return
    }
    let live = true
    void api.invoke(IPC.fsRead, path).then((got) => {
      const read = got.ok ? got.content : null
      noteTexts.texts.set(path, read)
      if (live) setText(read)
    })
    return () => {
      live = false
    }
  }, [path, revision])
  return text
}

const bodyOf = (text: string): string => text.replace(/^---\n[\s\S]*?\n---\n?/, '')
/** What a note shows when read: without Obsidian's %% comments (a board's settings are one), as Obsidian shows it. */
const shownOf = (text: string): string => bodyOf(text).replace(/%%[\s\S]*?%%/g, '')

/**
 * The wheel over something in a node that scrolls (a note's text, a PDF, a
 * board's lane): it scrolls that, and only that - even at its end the canvas
 * does not move. Over anything that does not scroll, the canvas moves. A pinch
 * always zooms the canvas. Decided on each turn of the wheel, before the
 * canvas sees it.
 */
function scrollOrPan(ev: React.WheelEvent<HTMLElement>): void {
  const el = ev.currentTarget
  const scrolls = el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1
  el.classList.toggle('nowheel', !ev.ctrlKey && scrolls)
}

export const FileNode = memo(function FileNode(props: NodeProps<FlowNode>): React.ReactElement {
  const actions = useCanvasActions()
  // Which notes are boards and cards comes from the boards' store: drawn again when it changes.
  useBoards()
  useCardPlaces()
  const node = props.data.node
  const file = node.file ?? ''
  const kind = fileKind(file)
  if (kind === 'note') {
    // A board as a board (or, switched, its Markdown); a card as its board shows it; any other note as itself.
    if (isBoardPath(file)) return actions.rawBoards.has(node.id) ? <NoteNode {...props} board /> : <BoardNode {...props} />
    if (boardOfCard(file) !== null) return <CardNode {...props} />
    return <NoteNode {...props} />
  }
  if (kind === 'code') return <TextFileNode {...props} />
  if (kind === 'pdf') return <PdfNode {...props} />
  if (extensionOf(file) === 'svg') return <SvgNode {...props} />
  return <MediaNode {...props} />
})

/** A picture, a video, audio or any other file: shown as itself, a picture or a video with its caption. */
function MediaNode(props: NodeProps<FlowNode>): React.ReactElement {
  const node = props.data.node
  const file = node.file ?? ''
  const kind = fileKind(file)
  const media = kind === 'image' || VIDEO.has(extensionOf(file))
  return (
    <Frame props={props} className={`canvas-node--file is-${VIDEO.has(extensionOf(file)) ? 'video' : kind}`} keepAspect={media}>
      <AttachmentBody path={file} id={node.id} />
      {media && <Caption id={node.id} text={typeof node['caption'] === 'string' ? node['caption'] : ''} selected={props.selected} />}
    </Frame>
  )
}

/**
 * A picture's or a video's caption, as in Heptabase: a line under it, kept in
 * the canvas file as `caption`. Selected and without one, it offers to add one.
 */
function Caption({ id, text, selected }: { id: string; text: string; selected: boolean }): React.ReactElement | null {
  const actions = useCanvasActions()
  const [typing, setTyping] = useState(false)
  if (typing)
    return (
      <input
        className="canvas-caption canvas-caption__input nodrag"
        aria-label="Caption"
        defaultValue={text}
        autoFocus
        onKeyDown={(ev) => {
          ev.stopPropagation()
          if (ev.key === 'Enter') ev.currentTarget.blur()
          if (ev.key === 'Escape') {
            ev.currentTarget.value = text
            ev.currentTarget.blur()
          }
        }}
        onBlur={(ev) => {
          setTyping(false)
          actions.setCaption(id, ev.target.value.trim())
        }}
      />
    )
  if (text === '' && !selected) return null
  return (
    <p
      className={`canvas-caption${text === '' ? ' is-empty' : ''}`}
      onDoubleClick={(ev) => {
        ev.stopPropagation()
        setTyping(true)
      }}
    >
      {text === '' ? 'Double-click to add a caption' : text}
    </p>
  )
}

/**
 * A board on the canvas: its preview (CanvasBoardNodes.tsx) under its name
 * bar, which switches it to the board's Markdown and opens the board itself.
 */
function BoardNode(props: NodeProps<FlowNode>): React.ReactElement {
  const actions = useCanvasActions()
  const node = props.data.node
  const path = node.file ?? ''
  return (
    <Frame props={props} className="canvas-node--note canvas-node--board" minWidth={280} minHeight={160}>
      <header className="canvas-note__title">
        <Icon name="square-kanban" size={13} />
        <span>{nameOf(path)}</span>
        <button className="canvas-fold canvas-note__beside nodrag" aria-label="Show Markdown" onClick={() => actions.toggleRaw(node.id)}>
          <Icon name="file-code" size={12} />
        </button>
        <button className="canvas-fold nodrag" aria-label="Open the board" onClick={() => actions.openFile(path)}>
          <Icon name="external-link" size={12} />
        </button>
      </header>
      <div className="canvas-node__body canvas-board-view" onWheelCapture={scrollOrPan}>
        <BoardPreview path={path} onScroll={scrollOrPan} far={usePlain()} />
      </div>
    </Frame>
  )
}

/**
 * A PDF on the canvas: dragged by its name bar, its pages and highlights shown
 * below it (features/pdf/PdfView.tsx, preview). A double-click opens it in the
 * PDF panel docked on the window's right (features/pdf/PdfPanel.tsx), where it is read and highlighted. It opens at the
 * node's `#page=N`, as Obsidian keeps it.
 */
function PdfNode(props: NodeProps<FlowNode>): React.ReactElement {
  const actions = useCanvasActions()
  const node = props.data.node
  const path = node.file ?? ''
  const page = Number(/#page=(\d+)/.exec(typeof node.subpath === 'string' ? node.subpath : '')?.[1] ?? '1')
  return (
    <Frame props={props} className="canvas-node--note canvas-node--pdf" minWidth={200} minHeight={160}>
      <header className="canvas-note__title">
        <Icon name="file" size={13} />
        <span>{path.slice(path.lastIndexOf('/') + 1)}</span>
      </header>
      <PdfView path={path} mode="preview" page={page} onScroll={scrollOrPan} onOpen={() => actions.openReader(path)} far={usePlain()} />
    </Frame>
  )
}

/**
 * An SVG on the canvas: a drawing Recto made (its strokes kept in it) is drawn
 * from its strokes, in the text's colour - and double-clicked, drawn on again;
 * any other SVG is a picture like any other.
 */
function SvgNode(props: NodeProps<FlowNode>): React.ReactElement {
  const path = props.data.node.file ?? ''
  const drawn = useDrawing(path)
  if (drawn === null) return <MediaNode {...props} />
  return <DrawingNode props={props} drawn={drawn} />
}

function DrawingNode({ props, drawn }: { props: NodeProps<FlowNode>; drawn: ReturnType<typeof useDrawing> }): React.ReactElement {
  const actions = useCanvasActions()
  const node = props.data.node
  const paths = useMemo(() => (drawn ?? null)?.strokes.map((s) => ({ d: strokePath(s), color: s.color })) ?? [], [drawn])
  return (
    <Frame props={props} className="canvas-node--drawing">
      <svg
        className="canvas-drawing__ink"
        viewBox={drawn == null ? undefined : `0 0 ${drawn.width} ${drawn.height}`}
        preserveAspectRatio="none"
        onDoubleClick={(ev) => {
          ev.stopPropagation()
          actions.drawOn(node.id)
        }}
      >
        {paths.map((p, i) => (
          <path key={i} d={p.d} fill={p.color ?? 'currentColor'} />
        ))}
      </svg>
    </Frame>
  )
}

/** How much of a text file the canvas shows before it is opened for typing. */
const TEXT_PREVIEW = 4000

/**
 * A text file that is not a note - .txt, .csv, .json, code - on the canvas, as
 * in Heptabase: its first lines in place, and a double-click puts the code
 * editor in the node (the same one a tab has: saved as you type, and taking a
 * change another app makes). Escape or a click elsewhere ends the typing.
 */
function TextFileNode(props: NodeProps<FlowNode>): React.ReactElement {
  const actions = useCanvasActions()
  const node = props.data.node
  const path = node.file ?? ''
  const editing = actions.editing === node.id
  const [preview, setPreview] = useState<string | null | undefined>(undefined)
  const { revision } = useNoteBus()
  // Read again when the typing ends, and when the vault changes.
  useEffect(() => {
    if (editing) return
    let live = true
    void api.invoke(IPC.fsReadText, path).then((got) => {
      if (live) setPreview(got.ok ? got.content.slice(0, TEXT_PREVIEW) : null)
    })
    return () => {
      live = false
    }
  }, [path, editing, revision])
  return (
    <Frame props={props} className={`canvas-node--note canvas-node--textfile${preview === null ? ' is-missing' : ''}`}>
      <header className="canvas-note__title">
        <Icon name="file-code" size={13} />
        <span>{path.slice(path.lastIndexOf('/') + 1)}</span>
      </header>
      {editing ? (
        <div className="canvas-code nodrag nowheel nopan">
          <CodeView path={path} />
        </div>
      ) : (
        <div
          className="canvas-node__body"
          onWheelCapture={scrollOrPan}
          onDoubleClick={(ev) => {
            ev.stopPropagation()
            if (preview !== null) actions.startEditing(node.id)
          }}
        >
          {preview === null ? (
            <p className="canvas-node__empty">This file can’t be read as text.</p>
          ) : (
            <pre className="canvas-code__preview">{preview}</pre>
          )}
        </div>
      )}
    </Frame>
  )
}

function NoteNode(props: NodeProps<FlowNode> & { board?: boolean }): React.ReactElement {
  const actions = useCanvasActions()
  const node = props.data.node
  const path = node.file ?? ''
  const text = useNoteText(path)
  const editing = actions.editing === node.id
  const plain = usePlain()
  const body = useFocusOnEdit(editing)
  useGrow(editing, body, node.id, node.height)
  return (
    <Frame
      props={props}
      className={`canvas-node--note${text === null ? ' is-missing' : ''}${props.data.folded === true ? ' is-folded' : ''}`}
    >
      <header className="canvas-note__title" onDoubleClick={() => actions.openFile(path)}>
        <Icon name={text === null ? 'alert-triangle' : 'file-text'} size={13} />
        <span>{nameOf(path)}</span>
        {props.board === true && (
          <button className="canvas-fold canvas-note__beside nodrag" aria-label="Show as a board" onClick={() => actions.toggleRaw(node.id)}>
            <Icon name="square-kanban" size={12} />
          </button>
        )}
        {text !== null && (
          <button className="canvas-fold canvas-note__beside nodrag" aria-label="Open beside the canvas" onClick={() => actions.openBeside(path)}>
            <Icon name="panel-right-open" size={12} />
          </button>
        )}
        <button
          className="canvas-fold nodrag"
          aria-label={props.data.folded === true ? 'Unfold the note' : 'Fold the note'}
          aria-expanded={props.data.folded !== true}
          onClick={() => actions.toggleFold(node.id)}
        >
          <Icon name={props.data.folded === true ? 'chevrons-up-down' : 'chevrons-down-up'} size={12} />
        </button>
      </header>
      <div
        ref={body}
        className={`canvas-node__body${editing ? ' nodrag nopan' : ''}`}
        onWheelCapture={scrollOrPan}
        onDoubleClick={(ev) => {
          ev.stopPropagation()
          if (text !== null && text !== undefined) actions.startEditing(node.id)
        }}
      >
        {text === null ? (
          <p className="canvas-node__empty">This note is gone. The node stays until you remove it.</p>
        ) : text === undefined ? null : editing ? (
          <NoteBodyEditor
            docKey={`canvas-note:${path}`}
            value={bodyOf(text)}
            placeholder="Empty note"
            onChange={(body) => actions.setNoteBody(path, body)}
            onOpenLink={(target) => actions.openLink(target)}
          />
        ) : (
          plain ? (
            <PlainText text={shownOf(text)} />
          ) : (
            <Markdown text={shownOf(text)} onOpenNote={(title) => actions.openLink(title)} />
          )
        )}
      </div>
    </Frame>
  )
}

const VIDEO = new Set(['mp4', 'mov', 'webm', 'm4v'])

const AUDIO = new Set(['mp3', 'wav', 'm4a', 'flac', 'ogg', 'aac'])

function AttachmentBody({ path, id }: { path: string; id: string }): React.ReactElement {
  const actions = useCanvasActions()
  const kind = fileKind(path)
  const ext = extensionOf(path)
  const [failed, setFailed] = useState<'missing' | 'unplayable' | null>(null)
  /** A video's width over its height, once read: the mini-player's shape. */
  const ratio = useRef<number | undefined>(undefined)
  /** It did not load: gone from the vault, or there and not something this player reads. Asked, not guessed. */
  const fail = (): void =>
    void api.invoke(IPC.fsExisting, [path]).then((found) => setFailed(found.includes(path) ? 'unplayable' : 'missing'))
  // A file that is gone, or cannot be shown: said, in its place - the node stays.
  if (failed !== null)
    return (
      <div className="canvas-file__other is-missing">
        <Icon name="alert-triangle" size={20} />
        <span>
          {path.slice(path.lastIndexOf('/') + 1)} {failed === 'missing' ? 'is not in the vault.' : 'can’t be shown here.'}
        </span>
        {failed === 'unplayable' && (
          <button className="btn btn--sm nodrag" onClick={() => void api.invoke(IPC.fsReveal, path)}>
            Reveal in Finder
          </button>
        )}
      </div>
    )
  if (kind === 'image')
    return (
      <img
        className="canvas-file__image"
        src={vaultFileUrl(path)}
        alt={nameOf(path)}
        draggable={false}
        onError={fail}
        onLoad={(ev) => actions.fitMedia(id, ev.currentTarget.naturalWidth, ev.currentTarget.naturalHeight)}
      />
    )
  if (VIDEO.has(ext))
    return (
      <div className="canvas-video__cover">
        {/* Its first frame, still: the video itself plays in the mini-player. */}
        <video
          className="canvas-file__media"
          src={`${vaultFileUrl(path)}#t=0.1`}
          preload="metadata"
          muted
          onError={fail}
          onLoadedMetadata={(ev) => {
            const v = ev.currentTarget
            ratio.current = v.videoWidth / v.videoHeight
            actions.fitMedia(id, v.videoWidth, v.videoHeight)
          }}
        />
        <button
          className="canvas-video__play nodrag"
          aria-label="Play the video"
          onClick={() => actions.play({ kind: 'file', path, title: nameOf(path), ...(ratio.current === undefined ? {} : { ratio: ratio.current }) })}
        >
          <Icon name="play" size={22} />
        </button>
      </div>
    )
  if (AUDIO.has(ext))
    return <audio className="canvas-file__audio nodrag" src={vaultFileUrl(path)} controls onError={fail} />
  // Any other file: its name, and the app the system has for it.
  return (
    <div className="canvas-file__other">
      <Icon name="file" size={22} />
      <span>{path.slice(path.lastIndexOf('/') + 1)}</span>
      <div className="canvas-file__actions">
        <button className="btn btn--sm nodrag" onClick={() => void api.invoke(IPC.fsOpenWithApp, path)}>
          Open
        </button>
        <button className="btn btn--ghost btn--sm nodrag" onClick={() => void api.invoke(IPC.fsReveal, path)}>
          Reveal in Finder
        </button>
      </div>
    </div>
  )
}

export const LinkNode = memo(function LinkNode(props: NodeProps<FlowNode>): React.ReactElement {
  const actions = useCanvasActions()
  const url = props.data.node.url ?? ''
  const [card, setCard] = useState<LinkPreview | null>(null)
  useEffect(() => {
    let live = true
    void api.invoke(IPC.canvasLinkPreview, url).then((found) => {
      if (live) setCard(found)
    })
    return () => {
      live = false
    }
  }, [url])
  let host = url
  try {
    host = new URL(url).host
  } catch {
    // Not a URL Recto can read: shown as written.
  }
  const video = youTubeId(url)
  if (video !== null) return <YouTubeNode props={props} id={video} url={url} card={card} />
  return (
    <Frame props={props} className={`canvas-node--link${card?.image != null ? ' has-image' : ''}`}>
      <button className="canvas-link nodrag" onClick={() => actions.openUrl(url)} title={url}>
        {card?.image != null && <img className="canvas-link__image" src={card.image} alt="" draggable={false} />}
        <span className="canvas-link__host">
          {card?.icon != null ? <img className="canvas-link__icon" src={card.icon} alt="" /> : <Icon name="external-link" size={13} />}
          {host}
        </span>
        {card?.title != null && <span className="canvas-link__title">{card.title}</span>}
        {card?.description != null && <span className="canvas-link__text">{card.description}</span>}
        <span className="canvas-link__url">{url}</span>
      </button>
    </Frame>
  )
})


/**
 * A YouTube link as a video on the canvas: its picture and title (the preview
 * Recto fetched once, a data URL - nothing is loaded from YouTube to draw it)
 * with a play button that plays it in the mini-player window, beside the
 * canvas rather than in it.
 */
function YouTubeNode({ props, id, url, card }: { props: NodeProps<FlowNode>; id: string; url: string; card: LinkPreview | null }): React.ReactElement {
  const actions = useCanvasActions()
  return (
    <Frame props={props} className="canvas-node--link canvas-node--video" keepAspect>
      <div className="canvas-video__cover" style={card?.image != null ? { backgroundImage: `url(${card.image})` } : undefined}>
        <button
          className="canvas-video__play nodrag"
          aria-label="Play the video"
          onClick={() => actions.play({ kind: 'youtube', id, title: card?.title ?? 'YouTube' })}
        >
          <Icon name="play" size={22} />
        </button>
        <button className="canvas-video__title nodrag" onClick={() => actions.openUrl(url)} title={url}>
          {card?.title ?? url}
        </button>
      </div>
    </Frame>
  )
}

export const GroupNode = memo(function GroupNode(props: NodeProps<FlowNode>): React.ReactElement {
  const actions = useCanvasActions()
  const node = props.data.node
  const naming = actions.editing === node.id
  const folded = props.data.folded === true
  return (
    <Frame props={props} className={`canvas-node--group${folded ? ' is-folded' : ''}`} minWidth={120} minHeight={folded ? 40 : 80}>
      <button
        className="canvas-fold nodrag"
        aria-label={folded ? 'Unfold the group' : 'Fold the group'}
        aria-expanded={!folded}
        onClick={() => actions.toggleFold(node.id)}
      >
        <Icon name={folded ? 'chevron-right' : 'chevron-down'} size={13} />
        {folded && <span>{props.data.holds ?? 0} inside</span>}
      </button>
      {naming ? (
        <input
          className="canvas-group__label canvas-group__input nodrag"
          aria-label="Group name"
          defaultValue={node.label ?? ''}
          autoFocus
          onFocus={(ev) => ev.currentTarget.select()}
          onChange={(ev) => actions.setText(node.id, ev.target.value.trim())}
          onBlur={actions.stopEditing}
          onKeyDown={(ev) => {
            if (ev.key === 'Enter' || ev.key === 'Escape') ev.currentTarget.blur()
          }}
        />
      ) : (
        node.label !== undefined &&
        node.label !== '' && (
          <span className="canvas-group__label" onDoubleClick={() => actions.startEditing(node.id)}>
            {node.label}
          </span>
        )
      )}
    </Frame>
  )
})

/** A node of a type Recto does not draw (a plugin's): kept in the file, shown as a box saying what it is. */
export const UnknownNode = memo(function UnknownNode(props: NodeProps<FlowNode>): React.ReactElement {
  return (
    <Frame props={props} className="canvas-node--unknown">
      <p className="canvas-node__empty">A “{props.data.node.type}” node, from another app. Recto keeps it as it is.</p>
    </Frame>
  )
})

/** An arrow's free end: nothing to see, only somewhere for the arrow to end. */
export const PointNode = memo(function PointNode(): React.ReactElement {
  return (
    <div className="canvas-point">
      <Sides />
    </div>
  )
})

export const NODE_TYPES = { text: TextNode, file: FileNode, link: LinkNode, group: GroupNode, point: PointNode, unknown: UnknownNode }
