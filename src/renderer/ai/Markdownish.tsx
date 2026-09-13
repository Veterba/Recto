import { useState } from 'react'
import { Icon } from '../components/Icon'

/**
 * Just enough markdown to read an answer.
 *
 * NOT a markdown renderer, and deliberately not one. A full renderer means
 * producing HTML from model output, which means sanitising it, which means a
 * sanitiser is now the thing standing between a reply and the DOM. Everything
 * here is React text nodes - there is no `innerHTML` anywhere in this file, so
 * there is nothing to sanitise and no injection to get wrong.
 *
 * What it does cover is what actually matters in an answer: fenced code blocks,
 * with a copy button, kept apart from the prose.
 */

type Block = { kind: 'text'; text: string } | { kind: 'code'; lang: string; code: string }

const FENCE = /^\s*```(\S*)\s*$/

export function splitBlocks(text: string): Block[] {
  const blocks: Block[] = []
  let buffer: string[] = []
  let code: string[] | null = null
  let lang = ''

  const flushText = (): void => {
    const joined = buffer.join('\n').trim()
    if (joined !== '') blocks.push({ kind: 'text', text: joined })
    buffer = []
  }

  for (const line of text.split('\n')) {
    const fence = FENCE.exec(line)
    if (fence !== null) {
      if (code === null) {
        flushText()
        code = []
        lang = fence[1] ?? ''
      } else {
        blocks.push({ kind: 'code', lang, code: code.join('\n') })
        code = null
        lang = ''
      }
      continue
    }
    if (code !== null) code.push(line)
    else buffer.push(line)
  }

  // An unterminated fence is what a half-streamed answer looks like, every
  // time, for as long as the block is being written. It renders as code.
  if (code !== null && code.length > 0) blocks.push({ kind: 'code', lang, code: code.join('\n') })
  else flushText()

  return blocks
}

function CodeBlock({ lang, code }: { lang: string; code: string }): React.ReactElement {
  const [copied, setCopied] = useState(false)
  return (
    <div className="chat__code">
      <div className="chat__codehead">
        <span className="chat__lang">{lang === '' ? 'code' : lang}</span>
        <button
          className={`chat__copy${copied ? ' is-done' : ''}`}
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

export function Markdownish({ text }: { text: string }): React.ReactElement {
  return (
    <>
      {splitBlocks(text).map((block, index) =>
        block.kind === 'code' ? (
          <CodeBlock key={index} lang={block.lang} code={block.code} />
        ) : (
          <p className="chat__para" key={index}>
            {block.text}
          </p>
        ),
      )}
    </>
  )
}
