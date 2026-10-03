import { useState } from 'react'
import { Icon } from '../../../ui/Icon'
import { parseBlocks, type Block, type Inline } from '../markdown'

/**
 * An answer's markdown as React elements. Note titles - [[links]], and the
 * titles of the notes it was read from - are chips that open the note.
 */

type Props = {
  text: string
  /** Note titles to turn into chips where the text mentions them. */
  titles?: readonly string[]
  onOpenNote: (title: string) => void
}

function CodeBlock({ lang, code }: { lang: string; code: string }): React.ReactElement {
  const [copied, setCopied] = useState(false)
  return (
    <div className="md-code">
      <div className="md-code__head">
        <span className="md-code__lang">{lang}</span>
        <button
          className={`md-code__copy${copied ? ' is-done' : ''}`}
          onClick={() => {
            void navigator.clipboard.writeText(code).then(() => {
              setCopied(true)
              window.setTimeout(() => setCopied(false), 1200)
            })
          }}
        >
          <Icon name={copied ? 'check' : 'copy'} size={12} />
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre>
        <code>{code}</code>
      </pre>
    </div>
  )
}

function Inlines({ inline, onOpenNote }: { inline: readonly Inline[]; onOpenNote: Props['onOpenNote'] }): React.ReactElement {
  return (
    <>
      {inline.map((piece, i) => {
        switch (piece.kind) {
          case 'text':
            return <span key={i}>{piece.text}</span>
          case 'bold':
            return (
              <strong key={i}>
                <Inlines inline={piece.children} onOpenNote={onOpenNote} />
              </strong>
            )
          case 'italic':
            return (
              <em key={i}>
                <Inlines inline={piece.children} onOpenNote={onOpenNote} />
              </em>
            )
          case 'code':
            return <code key={i}>{piece.text}</code>
          case 'link':
            return (
              <a key={i} href={piece.href} target="_blank" rel="noreferrer">
                {piece.text}
              </a>
            )
          case 'note':
            return (
              <button key={i} className="note-chip" title={piece.title} onClick={() => onOpenNote(piece.title)}>
                {piece.label}
              </button>
            )
        }
      })}
    </>
  )
}

function Blocks({ blocks, onOpenNote }: { blocks: readonly Block[]; onOpenNote: Props['onOpenNote'] }): React.ReactElement {
  return (
    <>
      {blocks.map((block, i) => {
        switch (block.kind) {
          case 'paragraph':
            return (
              <p key={i}>
                <Inlines inline={block.inline} onOpenNote={onOpenNote} />
              </p>
            )
          case 'heading':
            return (
              <p key={i} className={`md-heading md-heading--${Math.min(block.level, 3)}`}>
                <Inlines inline={block.inline} onOpenNote={onOpenNote} />
              </p>
            )
          case 'list': {
            const items = block.items.map((item, j) => (
              <li key={j}>
                <Inlines inline={item} onOpenNote={onOpenNote} />
              </li>
            ))
            return block.ordered ? (
              <ol key={i} start={block.start}>
                {items}
              </ol>
            ) : (
              <ul key={i}>{items}</ul>
            )
          }
          case 'quote':
            return (
              <blockquote key={i}>
                <Blocks blocks={block.blocks} onOpenNote={onOpenNote} />
              </blockquote>
            )
          case 'code':
            return <CodeBlock key={i} lang={block.lang} code={block.code} />
          case 'table':
            // Wide tables scroll inside the bubble rather than widening it.
            return (
              <div key={i} className="md-table">
                <table>
                  <thead>
                    <tr>
                      {block.head.map((cell, j) => (
                        <th key={j}>
                          <Inlines inline={cell} onOpenNote={onOpenNote} />
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {block.rows.map((row, r) => (
                      <tr key={r}>
                        {row.map((cell, j) => (
                          <td key={j}>
                            <Inlines inline={cell} onOpenNote={onOpenNote} />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          case 'rule':
            return <hr key={i} />
        }
      })}
    </>
  )
}

export function Markdown({ text, titles = [], onOpenNote }: Props): React.ReactElement {
  return (
    <div className="bot-md">
      <Blocks blocks={parseBlocks(text, titles)} onOpenNote={onOpenNote} />
    </div>
  )
}
