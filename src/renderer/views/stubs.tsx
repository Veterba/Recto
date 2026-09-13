import { registerView } from '../core/view-registry'

/**
 * Placeholder views for the sections that land in later milestones.
 *
 * They exist now for one reason: every section is a registered view type from
 * day one, so filling one in later is implementing `render`, not restructuring
 * the app.
 */

type Stub = {
  type: string
  title: string
  milestone: string
  blurb: string
}

const STUBS: Stub[] = [
  {
    type: 'home',
    title: 'Home',
    milestone: 'milestone 7',
    blurb: 'Stat tiles over the append-only events table: notes created, tasks done, streaks, time in app.',
  },
  {
    type: 'chat',
    title: 'AI',
    milestone: 'milestone 4',
    blurb: 'Claude, streaming over IPC from the main process. Conversations saved as markdown in the vault.',
  },
  {
    type: 'profile',
    title: 'Profile',
    milestone: 'milestone 7',
    blurb: 'Who you are in the app: name, avatar, and the totals behind the home dashboard.',
  },
]

export function registerStubViews(): () => void {
  const offs = STUBS.map((stub) =>
    registerView({
      type: stub.type,
      title: stub.title,
      render: ({ state }) => (
        <div className={`stub${state['floating'] === true ? ' stub--compact' : ''}`}>
          <h2 className="stub__title">{stub.title}</h2>
          <p className="stub__blurb">{stub.blurb}</p>
          <span className="stub__badge">{stub.milestone}</span>
        </div>
      ),
    }),
  )
  return () => offs.forEach((off) => off())
}
