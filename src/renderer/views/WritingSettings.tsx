import { useEffect, useState } from 'react'
import { Icon } from '../components/Icon'
import { commands } from '../core/commands'
import { formatChord } from '../core/hotkeys'
import { updateWriting, useWriting, type WritingSettings } from '../core/writing'
import type { FocusUnit } from '../editor/focus-range'

/**
 * Settings → Writing: iA Writer's tools in full, with the parts a menu has no
 * room for - how faint the unfocused text is, and your own style-check words.
 */

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }): React.ReactElement {
  return (
    <div className="setting">
      <div className="setting__text">
        <span className="setting__label">{label}</span>
        {hint !== undefined && <span className="setting__hint">{hint}</span>}
      </div>
      <div className="setting__control">{children}</div>
    </div>
  )
}

function Switch({ on, onChange, label }: { on: boolean; onChange: () => void; label: string }): React.ReactElement {
  return (
    <button className={`toggle${on ? ' is-on' : ''}`} role="switch" aria-checked={on} aria-label={label} onClick={onChange}>
      <span className="toggle__knob" />
    </button>
  )
}

function Chips<K extends string>({
  items,
  isOn,
  onToggle,
}: {
  items: readonly { key: K; label: string; colour?: string }[]
  isOn: (key: K) => boolean
  onToggle: (key: K) => void
}): React.ReactElement {
  return (
    <div className="setting__buttons">
      {items.map((item) => (
        <button
          key={item.key}
          className={`chip${isOn(item.key) ? ' is-active' : ''}`}
          aria-pressed={isOn(item.key)}
          onClick={() => onToggle(item.key)}
          style={item.colour === undefined ? undefined : { ['--chip-ink' as string]: item.colour }}
        >
          {item.colour !== undefined && <span className="chip__dot" style={{ background: item.colour }} />}
          {item.label}
        </button>
      ))}
    </div>
  )
}

const key = (id: string): string => {
  const binding = commands.bindingFor(id)
  return binding === null ? '' : ` · ${formatChord(binding)}`
}

const set = <S extends 'syntax' | 'style' | 'authors'>(section: S, patch: Partial<WritingSettings[S]>): void =>
  updateWriting((s) => ({ ...s, [section]: { ...s[section], ...patch } }))

export function WritingSettingsTab(): React.ReactElement {
  const writing = useWriting()
  const [words, setWords] = useState(writing.style.customWords.join('\n'))
  useEffect(() => setWords(writing.style.customWords.join('\n')), [writing.style.customWords])

  return (
    <>
      <h3 className="settings__grouphead">Focus</h3>
      <Row label="Focus mode" hint={`Everything but the text you are writing fades away${key('writing:toggle-focus')} · Esc to leave`}>
        <Switch label="Focus mode" on={writing.focus} onChange={() => updateWriting((s) => ({ ...s, focus: !s.focus }))} />
      </Row>
      <Row label="Keep lit" hint="What stays bright around the cursor.">
        <div className="segmented segmented--inline">
          {(['line', 'sentence', 'paragraph'] as FocusUnit[]).map((unit) => (
            <button
              key={unit}
              className={`segmented__tab${writing.focusUnit === unit ? ' is-active' : ''}`}
              onClick={() => updateWriting((s) => ({ ...s, focusUnit: unit }))}
            >
              <span>{unit}</span>
            </button>
          ))}
        </div>
      </Row>
      <Row label="Typewriter scrolling" hint={`Keep the line you write in the middle of the window, even outside focus mode${key('writing:toggle-typewriter')}`}>
        <Switch label="Typewriter scrolling" on={writing.typewriter} onChange={() => updateWriting((s) => ({ ...s, typewriter: !s.typewriter }))} />
      </Row>
      <Row label="Text size" hint={`${writing.fontSize}px in focus mode — the editor keeps its own size`}>
        <input
          className="slider"
          type="range"
          min={12}
          max={32}
          step={1}
          value={writing.fontSize}
          onChange={(event) => updateWriting((s) => ({ ...s, fontSize: Number(event.target.value) }))}
        />
      </Row>
      <Row label="Faded text" hint={`${Math.round(writing.dim * 100)}% — how visible the rest of the note stays`}>
        <input
          className="slider"
          type="range"
          min={0.1}
          max={0.6}
          step={0.02}
          value={writing.dim}
          onChange={(event) => updateWriting((s) => ({ ...s, dim: Number(event.target.value) }))}
        />
      </Row>

      <h3 className="settings__grouphead">Syntax highlight</h3>
      <Row
        label="Colour parts of speech"
        hint={`See how you write: too many adjectives, weak verbs, a run of “and”s${key('writing:toggle-syntax')}`}
      >
        <Switch label="Syntax highlight" on={writing.syntax.on} onChange={() => set('syntax', { on: !writing.syntax.on })} />
      </Row>
      <Row label="Highlight">
        <Chips
          items={[
            { key: 'adjectives', label: 'Adjectives', colour: 'var(--pos-adjective)' },
            { key: 'nouns', label: 'Nouns', colour: 'var(--pos-noun)' },
            { key: 'adverbs', label: 'Adverbs', colour: 'var(--pos-adverb)' },
            { key: 'verbs', label: 'Verbs', colour: 'var(--pos-verb)' },
            { key: 'conjunctions', label: 'Conjunctions', colour: 'var(--pos-conjunction)' },
          ]}
          isOn={(k) => writing.syntax[k]}
          onToggle={(k) => set('syntax', { [k]: !writing.syntax[k] })}
        />
      </Row>
      <p className="setting__note">
        <Icon name="highlighter" size={13} />
        English is tagged by a real part-of-speech tagger that runs on this computer. Russian is tagged by word
        endings and is approximate — conjunctions are exact, the rest is right most of the time.
      </p>

      <h3 className="settings__grouphead">Style check</h3>
      <Row label="Strike through weak words" hint={`Nothing is changed — the words are only marked${key('writing:toggle-style')}`}>
        <Switch label="Style check" on={writing.style.on} onChange={() => set('style', { on: !writing.style.on })} />
      </Row>
      <Row label="Check for">
        <Chips
          items={[
            { key: 'fillers', label: 'Fillers' },
            { key: 'cliches', label: 'Clichés' },
            { key: 'redundancies', label: 'Redundancies' },
            { key: 'custom', label: 'Your words' },
          ]}
          isOn={(k) => writing.style[k]}
          onToggle={(k) => set('style', { [k]: !writing.style[k] })}
        />
      </Row>
      <div className="setting setting--stack">
        <div className="setting__text">
          <span className="setting__label">Your words</span>
          <span className="setting__hint">One word or phrase per line — the habits you want to catch.</span>
        </div>
        <textarea
          className="writing-words"
          value={words}
          rows={5}
          spellCheck={false}
          placeholder={'synergy\nleverage\nв рамках'}
          onChange={(event) => setWords(event.target.value)}
          onBlur={() =>
            set('style', {
              customWords: [...new Set(words.split('\n').map((w) => w.trim()).filter((w) => w !== ''))],
            })
          }
        />
      </div>

      <h3 className="settings__grouphead">Authors</h3>
      <Row label="Show authors" hint={`Colour text by who wrote it — you, an AI, or a reference${key('writing:toggle-authors')}`}>
        <Switch label="Show authors" on={writing.authors.on} onChange={() => set('authors', { on: !writing.authors.on })} />
      </Row>
      <Row label="Show">
        <Chips
          items={[
            { key: 'human', label: 'Human' },
            { key: 'ai', label: 'AI', colour: 'var(--author-ai)' },
            { key: 'reference', label: 'Reference', colour: 'var(--author-reference)' },
          ]}
          isOn={(k) => writing.authors[k]}
          onToggle={(k) => set('authors', { [k]: !writing.authors[k] })}
        />
      </Row>
      <p className="setting__note">
        <Icon name="bot" size={13} />
        Text is yours unless marked. Paste as AI{key('writing:paste-ai')}, or select text and choose Mark selection
        as… from the writing menu. Anything you type inside an AI passage becomes yours. Marks are kept in{' '}
        <code>.recto/authors.json</code>, not in the note, so the file stays plain markdown.
      </p>

      <h3 className="settings__grouphead">Spelling</h3>
      <Row label="Check spelling" hint="Underline misspelt words; right-click one for suggestions.">
        <Switch label="Check spelling" on={writing.spellcheck} onChange={() => updateWriting((s) => ({ ...s, spellcheck: !s.spellcheck }))} />
      </Row>
    </>
  )
}
