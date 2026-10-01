import { useEffect, useState } from 'react'
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

const STATES: readonly BotState[] = ['idle', 'listening', 'thinking', 'answering', 'error']

/** The poses the snapshot script photographs: a seed, a moment, nothing left to chance. */
export const STILL_POSES: readonly { name: string; behaviour: BehaviourId | 'rest'; ms: number }[] = [
  { name: 'idle', behaviour: 'rest', ms: 0 },
  { name: 'bored', behaviour: 'bored', ms: 2000 },
  { name: 'doze closed', behaviour: 'doze', ms: 3400 },
  { name: 'squint', behaviour: 'squint', ms: 2000 },
  { name: 'curious', behaviour: 'curious', ms: 1000 },
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
          <input className="bot-design__field" placeholder="Listening looks at the field that has focus" />
          <div className="bot-design__sizes">
            {[28, 32, 40].map((size) => (
              <RectoBot key={size} size={size} state={state} />
            ))}
          </div>
        </div>
      </section>

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
