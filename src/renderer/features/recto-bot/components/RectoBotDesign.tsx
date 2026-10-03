import { useEffect, useRef, useState } from 'react'
import type { BotStep } from '@shared/bots'
// Dev page only: the chat's steps card, to try against the face before the real steps exist.
import { StepsCard } from '../../bots/components/StepsCard'
import '../../bots/styles/chat.css'
import { stillFrame, type BotState } from '../bot'
import { BEHAVIOURS, seededRandom, type ActiveBehaviour, type BehaviourId } from '../behaviours'
import { BOT_PRESETS, BotFigure, RectoBot } from '..'
import '../styles/recto-bot-design.css'

/**
 * The bot's design page, in dev builds only: /dev/recto-bot.
 *
 * One large bot living its own life, every behaviour looping in its own card,
 * the app states, and the sizes it is used at in the app. With `?still` it
 * shows fixed poses instead - the same every time - for the snapshot script.
 */

const STATES: readonly BotState[] = ['idle', 'listening', 'thinking', 'riffle', 'found', 'answering', 'error']

/** The poses the snapshot script photographs: a seed, a moment, nothing left to chance. */
export const STILL_POSES: readonly {
  name: string
  behaviour: BehaviourId | 'rest'
  ms: number
  script?: readonly (readonly [number, BotState])[]
}[] = [
  { name: 'idle', behaviour: 'rest', ms: 0 },
  { name: 'bored', behaviour: 'bored', ms: 2000 },
  { name: 'doze closed', behaviour: 'doze', ms: 3400 },
  { name: 'squint', behaviour: 'squint', ms: 2000 },
  { name: 'curious', behaviour: 'curious', ms: 1000 },
  { name: 'riffle', behaviour: 'rest', ms: 1250, script: [[0, 'riffle']] },
  {
    name: 'found',
    behaviour: 'rest',
    ms: 1650,
    script: [
      [0, 'riffle'],
      [1500, 'found'],
    ],
  },
]
const STILL_SIZES = [40, 120] as const
const STILL_SEED = 7

function useTheme(): [string, () => void] {
  const [theme, setTheme] = useState(() => new URLSearchParams(location.search).get('theme') ?? 'light')
  useEffect(() => {
    document.documentElement.dataset['theme'] = theme
  }, [theme])
  return [theme, () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))]
}

/** A made-up stream of steps, as the bot will report them. */
const FAKE_STEPS: readonly (readonly [running: BotStep, done: BotStep, ms: number])[] = [
  [{ action: 'Tasks', result: 'last week', state: 'running' }, { action: 'Tasks', result: '4 open since last week', state: 'done' }, 700],
  [
    { action: 'Searching notes', result: '“refactor week”', state: 'running' },
    { action: 'Searching notes', result: '“refactor week” · 3 notes', state: 'done' },
    800,
  ],
  [
    { action: 'Recent changes', result: 'since Monday', state: 'running' },
    { action: 'Recent changes', result: '9 notes since Monday', state: 'done' },
    650,
  ],
]
const FAKE_ANSWER =
  'Four tasks are still open from last week: split app.css by feature, a test for split-drag, the dark palette on Home and signing the app. Start with app.css?'

/** The chat's answer, faked: the face riffles while steps come in, finds on the first token, then the answer streams. */
function StepsDemo(): React.ReactElement {
  const [steps, setSteps] = useState<BotStep[]>([])
  const [text, setText] = useState('')
  const [face, setFace] = useState<BotState>('idle')
  const timers = useRef<number[]>([])
  useEffect(() => () => timers.current.forEach((t) => window.clearTimeout(t)), [])

  const run = (): void => {
    timers.current.forEach((t) => window.clearTimeout(t))
    const at = (ms: number, fn: () => void): void => void timers.current.push(window.setTimeout(fn, ms))
    setSteps([])
    setText('')
    setFace('riffle')
    let t = 300
    FAKE_STEPS.forEach(([running, done, ms], i) => {
      at(t, () => setSteps((list) => [...list.slice(0, i), running]))
      t += ms
      at(t, () => setSteps((list) => [...list.slice(0, i), done]))
      t += 150
    })
    t += 400
    at(t, () => setFace('found'))
    at(t + 400, () => setFace('answering'))
    for (let i = 3; i <= FAKE_ANSWER.length + 2; i += 3) at(t + i * 9, () => setText(FAKE_ANSWER.slice(0, i)))
    at(t + FAKE_ANSWER.length * 9 + 400, () => setFace('idle'))
  }

  return (
    <section className="bot-design__card bot-design__steps">
      <div className="chat bot-design__chat">
        <div className="msg-group msg-group--bot">
          <div className="msg-row">
            <StepsCard steps={steps} running={text === '' && face !== 'idle'} />
            {text !== '' && (
              <div className="msg msg--bot">
                <div className="msg__bubble">
                  <div className="bot-md">
                    <p>{text}</p>
                  </div>
                </div>
              </div>
            )}
          </div>
          <span className="bot-face bot-face--group">
            <RectoBot size={36} state={face} />
          </span>
        </div>
      </div>
      <button className="bot-design__button" onClick={run}>
        Simulate answer with steps
      </button>
    </section>
  )
}

function Stills(): React.ReactElement {
  return (
    <div className="bot-design__stills" data-ready="true">
      {STILL_POSES.map((pose) => (
        <div className="bot-design__still" key={pose.name}>
          {STILL_SIZES.map((size) => (
            <div className="recto-bot" style={{ width: size, height: size }} key={size}>
              <BotFigure size={size} frame={stillFrame({ ...pose, size, random: seededRandom(STILL_SEED) })} />
            </div>
          ))}
          <span>{pose.name}</span>
        </div>
      ))}
    </div>
  )
}

export function RectoBotDesign(): React.ReactElement {
  const [theme, toggleTheme] = useTheme()
  const [state, setState] = useState<BotState>('idle')
  const [now, setNow] = useState<ActiveBehaviour | null>(null)
  const still = new URLSearchParams(location.search).has('still')

  if (still) return <Stills />

  return (
    <div className="bot-design">
      <header className="bot-design__top">
        <div>
          <h1>Recto, every animation</h1>
          <p>
            Each card loops one behaviour. The big one lives its own life with the real odds, notices the cursor only while it moves nearby,
            and turns curious when clicked.
          </p>
        </div>
        <button className="bot-design__button" onClick={toggleTheme}>
          {theme === 'dark' ? 'light' : 'dark'}
        </button>
      </header>

      <h2>Auto, as in the app</h2>
      <section className="bot-design__card bot-design__auto">
        <div className="bot-design__stage bot-design__stage--big">
          <span className="bot-design__now">
            {state !== 'idle' ? state : now === 'watch' ? 'Watching you' : now ? BEHAVIOURS[now].label : ''}
          </span>
          <RectoBot size={240} state={state} onBehaviour={setNow} />
        </div>
        <div className="bot-design__side">
          <p>App states override the personality. Error squints for two seconds, then it goes back to idle on its own.</p>
          <div className="bot-design__states" role="radiogroup" aria-label="App state">
            {STATES.map((s) => (
              <button key={s} role="radio" aria-checked={s === state} className="bot-design__button" onClick={() => setState(s)}>
                {s}
              </button>
            ))}
          </div>
          <button
            className="bot-design__button"
            onClick={() => {
              // An answer as the chat shows it: working, the first token, the answer streaming, then waiting for you.
              setState('riffle')
              window.setTimeout(() => setState('found'), 3000)
              window.setTimeout(() => setState('answering'), 3400)
              window.setTimeout(() => setState('listening'), 6000)
            }}
          >
            Simulate answer
          </button>
          <input className="bot-design__field" placeholder="Listening looks at the field that has focus" />
          <div className="bot-design__sizes">
            {[28, 32, 40].map((size) => (
              <RectoBot key={size} size={size} state={state} />
            ))}
          </div>
        </div>
      </section>

      <h2>Steps, as the chat shows them</h2>
      <StepsDemo />

      <h2>Presets</h2>
      <div className="bot-design__grid">
        {BOT_PRESETS.map((preset) => (
          <section className="bot-design__card" key={preset.name}>
            <div className="bot-design__stage">
              <RectoBot size={150} look={preset.look} personality={preset.personality} state={state} />
            </div>
            <h3>{preset.name}</h3>
            <p>{preset.about}</p>
          </section>
        ))}
      </div>

      <h2>Eyes</h2>
      <div className="bot-design__grid">
        {(Object.keys(BEHAVIOURS) as BehaviourId[]).map((id) => (
          <section className="bot-design__card" key={id}>
            <div className="bot-design__stage">
              <RectoBot size={150} mode="forced" behaviour={id} />
            </div>
            <h3>{BEHAVIOURS[id].label}</h3>
            <p>{BEHAVIOURS[id].about}</p>
          </section>
        ))}
      </div>
    </div>
  )
}
