import { useMemo } from 'react'
import {
  type Day,
  type OverviewData,
  type OverviewTopic,
  type OverviewView,
  addDays,
  averagePerDay,
  compact,
  daysBetween,
  duration,
  heatLevel,
  notesBetween,
  overdue,
  rediscover,
  secondsBetween,
  streak,
  todayChange,
  weekStart,
  writtenBetween,
  writtenOn,
} from '@shared/overview'

/**
 * The overview's card: every figure, on paper.
 *
 * All sums are the shared ones (shared/overview.ts), worked out against the
 * renderer's clock. When counting began recently, one quiet line under the
 * first heading says so, and a comparison that would need older days is left
 * out - never a dash. Sections with nothing in them are not shown.
 */

export type OverviewActions = {
  openNote: (path: string) => void
  openCard: (path: string) => void
  openFolder: (name: string) => void
  go: (view: OverviewView) => void
}

type Props = {
  data: OverviewData | null
  topics: OverviewTopic[] | null
  today: Day
  now: number
  /** The Done column of a board, by id; and its name. */
  actions: OverviewActions
}

const DAY_FMT = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
const SHORT_FMT = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' })
const WEEKDAY_FMT = new Intl.DateTimeFormat('en-GB', { weekday: 'short' })
const noon = (day: Day): Date => new Date(`${day}T12:00:00`)
export const longDay = (day: Day): string => DAY_FMT.format(noon(day))
const shortDay = (day: Day): string => SHORT_FMT.format(noon(day))

/** "12–18 Oct", or "29 Sep – 5 Oct" across a month. */
function weekRange(from: Day, to: Day): string {
  const [a, b] = [noon(from), noon(to)]
  return a.getMonth() === b.getMonth() ? `${a.getDate()}–${shortDay(to)}` : `${shortDay(from)} – ${shortDay(to)}`
}

/**
 * The one line that says how far back the figures go: the latest day any of
 * them started counting, while that is inside the heatmap's 26 weeks.
 */
export function countedLine(starts: readonly (Day | null)[], today: Day): string | null {
  const known = starts.map((d) => d ?? today)
  const latest = known.reduce((a, b) => (a > b ? a : b), '0000-00-00')
  if (latest >= today) return 'Stats counted from today'
  if (latest <= addDays(weekStart(today), -(WEEKS - 1) * 7)) return null
  return `Stats counted since ${WEEKDAY_FMT.format(noon(latest))} ${shortDay(latest)}`
}

/** With a real minus sign. */
const num = (n: number): string => `${n < 0 ? '−' : ''}${Math.abs(n).toLocaleString('en-US')}`
const plural = (n: number, one: string, many = `${one}s`): string => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`

export function Overview({ data, topics, today, now, actions }: Props): React.ReactElement {
  if (data === null) return <Placeholder />
  return <Figures data={data} topics={topics} today={today} now={now} actions={actions} />
}

function Figures({ data, topics, today, now, actions }: Props & { data: OverviewData }): React.ReactElement {
  const { index } = data
  const week = weekStart(today)
  const lastWeek = addDays(week, -7)
  const elapsed = daysBetween(week, today)
  const weekDays = Array.from({ length: elapsed + 1 }, (_, i) => addDays(week, i))

  const touched = notesBetween(data.edits, week, today)
  // Words you added, this week; today's on its own beside it. Never a net change: deleting is not unwriting.
  const written = writtenBetween(data.written, week, today)

  const run = streak(data.edits, today)

  const avg = averagePerDay(data.active, data.activeSince, week, today) ?? 0
  const avgBefore = data.activeSince !== null && data.activeSince <= lastWeek ? averagePerDay(data.active, data.activeSince, lastWeek, addDays(week, -1)) : null
  const monthStart = `${today.slice(0, 8)}01`
  const month = secondsBetween(data.active, monthStart, today)
  const total = Object.values(data.active).reduce((a, b) => a + b, 0)

  // A line needs three days to say anything.
  const editDays = weekDays.filter((d) => data.editsSince !== null && d >= data.editsSince)
  const wordDays = weekDays.filter((d) => data.writtenSince !== null && d >= data.writtenSince)

  const late = useMemo(() => overdue(index.dueCards, today), [index.dueCards, today])
  const lateBoards = [...new Set(late.map((c) => c.board ?? 'a board'))]
  const again = rediscover(index, data.opened, data.openedSince, today, now)
  const since = index.oldest
  const counted = countedLine([data.editsSince, data.writtenSince, data.activeSince], today)
  const attention = index.orphans.length + index.broken.length + late.length > 0
  const lists = [index.folders.length > 0, index.hubs.length > 0].filter(Boolean).length

  return (
    <>
      <header className="overview__head">
        <h2 className="overview__heading">
          {since === null ? 'No notes yet' : `Since ${longDay(since)} · ${plural(Math.max(0, daysBetween(since, today)), 'day')}`}
        </h2>
        {counted !== null && <p className="overview__quiet">{counted}</p>}
      </header>

      <div className="overview__totals">
        <Total value={compact(index.notes)} label="Notes" />
        <Total value={compact(index.words)} label="Words" />
        <Total value={compact(index.links)} label="Links" />
        <Total value={compact(index.tags)} label="Tags" />
      </div>

      <section className="overview__section" aria-label="This week">
        <div className="overview__section-head">
          <span className="overview__label">This week</span>
          <span className="overview__aside">{weekRange(week, addDays(week, 6))}</span>
        </div>
        <div className="overview__week">
          <Stat
            value={touched.toLocaleString('en-US')}
            delta={todayChange(data.edits[today]?.length ?? 0)}
            caption="notes touched"
            spark={editDays.length >= 3 ? weekDays.map((d) => data.edits[d]?.length ?? 0) : undefined}
            floor={5}
          />
          <Stat
            value={num(written)}
            delta={todayChange(writtenOn(data.written, today))}
            caption="words written"
            spark={wordDays.length >= 3 ? weekDays.map((d) => writtenOn(data.written, d)) : undefined}
            floor={250}
          />
          <Stat value={plural(run.current, 'day')} caption={`writing streak · longest ${plural(run.longest, 'day')}`} />
          <Stat
            value={duration(avg)}
            caption={avgBefore === null ? 'a day in Recto' : `a day in Recto · last week ${duration(avgBefore)}`}
            extra={`${duration(month)} this month · ${duration(total)} in all`}
          />
        </div>
      </section>

      <Heatmap edits={data.edits} today={today} onDay={(day) => actions.go({ kind: 'day', day })} />

      {attention && (
        <section className="overview__section" aria-label="Needs attention">
          <span className="overview__label">Needs attention</span>
          <div className="overview__attention">
            {index.orphans.length > 0 && (
              <Attention count={index.orphans.length} title="Notes with no links" detail="Nothing points to them and they point nowhere" onClick={() => actions.go({ kind: 'orphans' })} />
            )}
            {index.broken.length > 0 && (
              <Attention count={index.broken.length} title="Broken links" detail="[[Links]] to notes that don’t exist" onClick={() => actions.go({ kind: 'broken' })} />
            )}
            {late.length > 0 && (
              <Attention
                count={late.length}
                title="Overdue tasks"
                detail={lateBoards.length === 1 ? `On the ${lateBoards[0]} board` : `On ${lateBoards.length} boards`}
                warn
                onClick={() => actions.go({ kind: 'overdue' })}
              />
            )}
          </div>
        </section>
      )}

      {lists > 0 && (
        <div className={lists === 2 ? 'overview__two' : undefined}>
          {index.folders.length > 0 && (
            <section className="overview__section" aria-label="Most written in">
              <span className="overview__label">Most written in</span>
              <div className="overview__list">
                {index.folders.map((f) => (
                  <Row key={f.name} name={f.name} count={f.count} onClick={() => actions.openFolder(f.name)} />
                ))}
              </div>
            </section>
          )}
          {index.hubs.length > 0 && (
            <section className="overview__section" aria-label="Most linked">
              <span className="overview__label">Most linked</span>
              <div className="overview__list">
                {index.hubs.map((h) => (
                  <Row key={h.path} name={h.name} count={h.links} onClick={() => actions.openNote(h.path)} />
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      {data.topicsOn && (topics === null || topics.length > 0) && (
        <section className="overview__section" aria-label="Topics">
          <span className="overview__label">Topics</span>
          <div className="overview__topics">
            {topics === null ? (
              <span className="overview__chip overview__chip--waiting" aria-hidden="true" />
            ) : (
              topics.map((t) => (
                <button key={t.id} type="button" className="overview__chip" onClick={() => actions.go({ kind: 'topic', id: t.id })}>
                  {t.name}
                  <em>{t.paths.length}</em>
                </button>
              ))
            )}
          </div>
        </section>
      )}

      {(again.onThisDay !== null || again.unopened !== null) && (
      <section className="overview__section" aria-label="Rediscover">
        <span className="overview__label">Rediscover</span>
        {again.onThisDay !== null && (
          <button type="button" className="overview__again" onClick={() => actions.openNote(again.onThisDay!.path)}>
            <b>{again.onThisDay.name}</b>
            <span>Written a {again.onThisDay.ago} ago today</span>
          </button>
        )}
        {again.unopened !== null && (
          <button type="button" className="overview__again" onClick={() => actions.openNote(again.unopened!.path)}>
            <b>{again.unopened.name}</b>
            <span>Not opened for {plural(again.unopened.days, 'day')}</span>
          </button>
        )}
      </section>
      )}

      <p className="overview__foot">Counted on this Mac from your notes; nothing is sent anywhere.</p>
    </>
  )
}

function Total({ value, label }: { value: string; label: string }): React.ReactElement {
  return (
    <div className="overview__total">
      <b>{value}</b>
      <span className="overview__label">{label}</span>
    </div>
  )
}

function Stat({
  value,
  delta,
  caption,
  spark,
  floor = 1,
  extra,
}: {
  value: string
  delta?: { text: string; tone: 'up' | 'down' } | null
  caption: string
  spark?: number[] | undefined
  floor?: number
  extra?: string
}): React.ReactElement {
  return (
    <div className="overview__stat">
      <div>
        <b>{value}</b>
        {delta != null && <span className={`overview__delta overview__delta--${delta.tone}`}>{delta.text}</span>}
      </div>
      <small>{caption}</small>
      {extra !== undefined && <small>{extra}</small>}
      {spark !== undefined && <Sparkline values={spark} floor={floor} />}
    </div>
  )
}

/**
 * Monday to today as one line; the rest of the week is room it has yet to fill.
 * Scaled from zero to a quarter above the week's highest, never lower than
 * `floor`: one note and then two is a gentle rise, not a full-height spike.
 */
function Sparkline({ values, floor }: { values: number[]; floor: number }): React.ReactElement {
  const top = Math.max(floor, Math.max(...values) * 1.25)
  const points = values.map((v, i) => `${(i / 6) * 100},${26 - (v / top) * 22}`).join(' ')
  return (
    <svg className="overview__spark" viewBox="0 0 100 28" preserveAspectRatio="none" aria-hidden="true">
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

const WEEKS = 26

function Heatmap({ edits, today, onDay }: { edits: Record<Day, string[]>; today: Day; onDay: (day: Day) => void }): React.ReactElement {
  const first = addDays(weekStart(today), -(WEEKS - 1) * 7)
  const days = Array.from({ length: WEEKS * 7 }, (_, i) => addDays(first, i))
  const max = Math.max(0, ...days.map((d) => edits[d]?.length ?? 0))
  return (
    <section className="overview__section" aria-label="Writing activity">
      <div className="overview__section-head">
        <span className="overview__label">Writing activity</span>
        <span className="overview__aside">last 26 weeks</span>
      </div>
      <div className="overview__heat" role="grid" aria-label="Notes edited per day, last 26 weeks">
        {days.map((day) => {
          const n = edits[day]?.length ?? 0
          if (day > today) return <i key={day} className="overview__cell overview__cell--future" />
          const label = `${longDay(day)} · ${plural(n, 'note')} edited`
          return n === 0 ? (
            <i key={day} className="overview__cell" title={label} />
          ) : (
            <button key={day} type="button" className={`overview__cell overview__cell--${heatLevel(n, max)}`} title={label} aria-label={label} onClick={() => onDay(day)} />
          )
        })}
      </div>
      <div className="overview__legend" aria-hidden="true">
        Less <i className="overview__cell" />
        <i className="overview__cell overview__cell--1" />
        <i className="overview__cell overview__cell--2" />
        <i className="overview__cell overview__cell--3" />
        <i className="overview__cell overview__cell--4" /> More
      </div>
    </section>
  )
}

function Attention({ count, title, detail, warn, onClick }: { count: number; title: string; detail: string; warn?: boolean; onClick: () => void }): React.ReactElement {
  return (
    <button type="button" className="overview__attn" onClick={onClick}>
      <span className={`overview__attn-n${warn === true ? ' overview__attn-n--warn' : ''}`}>{count}</span>
      <span>
        <b>{title}</b>
        <span className="overview__attn-d">{detail}</span>
      </span>
      <span className="overview__go" aria-hidden="true">
        →
      </span>
    </button>
  )
}

function Row({ name, count, onClick }: { name: string; count?: number | string; onClick?: () => void }): React.ReactElement {
  return (
    <button type="button" className="overview__row" onClick={onClick} disabled={onClick === undefined}>
      <span>{name}</span>
      {count !== undefined && <span className="overview__count">{count}</span>}
    </button>
  )
}

/**
 * The page before its figures arrive: the same blocks at the same sizes, so
 * nothing moves when they land.
 */
function Placeholder(): React.ReactElement {
  return (
    <div className="overview__waiting" aria-busy="true">
      <header className="overview__head">
        <h2 className="overview__heading">
          <span className="overview__bar" style={{ width: 220 }} />
        </h2>
      </header>
      <div className="overview__totals">
        {['Notes', 'Words', 'Links', 'Tags'].map((label) => (
          <div className="overview__total" key={label}>
            <b>
              <span className="overview__bar" style={{ width: 56 }} />
            </b>
            <span className="overview__label">{label}</span>
          </div>
        ))}
      </div>
      <div className="overview__bar overview__bar--block" style={{ height: 196 }} />
      <div className="overview__bar overview__bar--block" style={{ height: 130 }} />
    </div>
  )
}

// --- sub-pages ------------------------------------------------------------------

const folderOf = (path: string): string => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '')
const nameOf = (path: string): string => path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/i, '')

/** One of the small lists the overview opens into, with Back at the top of the column. */
export function OverviewList({
  view,
  data,
  topics,
  today,
  exists,
  actions,
}: {
  view: Exclude<OverviewView, { kind: 'main' }>
  data: OverviewData | null
  topics: OverviewTopic[] | null
  today: Day
  exists: (path: string) => boolean
  actions: OverviewActions
}): React.ReactElement {
  const list = ((): { title: string; rows: React.ReactElement[] } => {
    if (data === null) return { title: '', rows: [] }
    switch (view.kind) {
      case 'orphans':
        return {
          title: 'Notes with no links',
          rows: data.index.orphans.map((n) => <Row key={n.path} name={n.name} count={folderOf(n.path)} onClick={() => actions.openNote(n.path)} />),
        }
      case 'broken':
        return {
          title: 'Broken links',
          rows: data.index.broken.map((b) => (
            <Row key={`${b.path}\n${b.target}`} name={b.name} count={`[[${b.target}]]`} onClick={() => actions.openNote(b.path)} />
          )),
        }
      case 'overdue':
        return {
          title: 'Overdue tasks',
          rows: overdue(data.index.dueCards, today).map((c) => (
            <Row key={c.path} name={c.name} count={`due ${shortDay(c.due)}${c.board === null ? '' : ` · ${c.board}`}`} onClick={() => actions.openCard(c.path)} />
          )),
        }
      case 'day':
        return {
          title: `Edited on ${longDay(view.day)}`,
          rows: (data.edits[view.day] ?? []).map((p) =>
            exists(p) ? <Row key={p} name={nameOf(p)} count={folderOf(p)} onClick={() => actions.openNote(p)} /> : <Row key={p} name={nameOf(p)} count="no longer here" />,
          ),
        }
      case 'topic': {
        const topic = topics?.find((t) => t.id === view.id)
        return {
          title: topic === undefined ? 'Topic' : topic.name,
          rows: (topic?.paths ?? []).map((p) => <Row key={p} name={nameOf(p)} count={folderOf(p)} onClick={() => actions.openNote(p)} />),
        }
      }
    }
  })()
  return (
    <section className="overview__section" aria-label={list.title}>
      <div className="overview__section-head">
        <h2 className="overview__heading">{list.title}</h2>
        <span className="overview__aside">{data === null ? '' : list.rows.length}</span>
      </div>
      <div className="overview__list">{data !== null && list.rows.length === 0 ? <p className="overview__quiet">Nothing here any more</p> : list.rows}</div>
    </section>
  )
}
