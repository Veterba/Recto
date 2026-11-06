import { useEffect, useState } from 'react'
import { dayOf, type OverviewView } from '@shared/overview'
import { registerView } from '../../../app/view-registry'
import { NavArrows } from '../../../app/components/NavArrows'
import { step } from '../../../app/tab-history'
import { cachedData, cachedTopics, fetchData, fetchTopics } from '../overview-store'
import { Overview, OverviewList, type OverviewActions } from './Overview'

/**
 * The vault overview as a tab, beside the ⌃⌘H overlay: the same figures and
 * lists, but in a tab's history. Each list opened from it is a step, and a
 * note opened from it takes the tab's place, so ← comes back to the overview.
 */

const MAIN: OverviewView = { kind: 'main' }

const TITLE: Record<OverviewView['kind'], string> = {
  main: 'Overview',
  orphans: 'Notes with no links',
  broken: 'Broken links',
  dates: 'Links that depend on file dates',
  overdue: 'Overdue',
  day: 'Overview',
  topic: 'Overview',
}

const viewOf = (state: Record<string, unknown>): OverviewView => {
  const view = state['view'] as OverviewView | undefined
  return view !== undefined && typeof view === 'object' && typeof view.kind === 'string' ? view : MAIN
}

type Shell = {
  /** In the tab you are in: a note, or a card beside its board. */
  openFile: (path: string) => void
  openFolder: (name: string) => void
  exists: (path: string) => boolean
}

function OverviewTab({ view, leafId, shell }: { view: OverviewView; leafId: string; shell: Shell }): React.ReactElement {
  const [data, setData] = useState(cachedData)
  const [topics, setTopics] = useState(cachedTopics)
  const [clock, setClock] = useState(() => ({ today: dayOf(new Date()), now: Date.now() }))

  useEffect(() => {
    const today = dayOf(new Date())
    const at = Date.now()
    let live = true
    void fetchData(today, at).then((next) => {
      if (!live || next === null) return
      setClock({ today, now: at })
      setData(next)
    })
    void fetchTopics().then((next) => {
      if (live) setTopics(next)
    })
    return () => {
      live = false
    }
  }, [])

  const actions: OverviewActions = {
    go: (next) => step(leafId, 'overview', { view: next }),
    openNote: shell.openFile,
    openCard: shell.openFile,
    openFolder: shell.openFolder,
  }

  return (
    <div className="overview-tab">
      <div className="md__bar">
        <NavArrows leafId={leafId} />
      </div>
      <div className="overview-tab__body">
        {/* The overlay's card, the same element and look. */}
        <main className="overview">
          {view.kind === 'main' ? (
            <Overview data={data} topics={topics} today={clock.today} now={clock.now} actions={actions} />
          ) : (
            <OverviewList view={view} data={data} topics={topics} today={clock.today} exists={shell.exists} actions={actions} />
          )}
        </main>
      </div>
    </div>
  )
}

export function registerOverviewView(shell: Shell): () => void {
  return registerView({
    type: 'overview',
    title: 'Overview',
    icon: 'house',
    getTitle: (state) => TITLE[viewOf(state).kind],
    render: ({ state, leafId }) => <OverviewTab view={viewOf(state)} leafId={leafId} shell={shell} />,
  })
}
