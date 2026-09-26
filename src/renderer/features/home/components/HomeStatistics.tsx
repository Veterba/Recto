import type { HomeStats } from '../home-stats'

/**
 * The figures.
 *
 * Sparse on purpose: a number, a label under it, nothing drawn around it.
 * Monochrome, like the field behind it: no accent colour anywhere.
 */
export function Statistics({ stats, onBack }: { stats: HomeStats | null; onBack: () => void }): React.ReactElement {
  if (stats === null) return <div className="home__stats home__stats--waiting">Reading the vault…</div>

  return (
    <div className="home__stats">
      <div className="home__figures">
        <Figure value={String(stats.notes)} label="notes" />
        <Figure value={String(stats.touchedThisWeek)} label="touched this week" trend={stats.weekTrend} />
        <Figure value={String(stats.links)} label="links" />
        <Figure value={String(stats.tags)} label="tags" />
        <Figure value={stats.streakDays === null ? '—' : String(stats.streakDays)} label="day streak" />
        <Figure value={stats.minutesToday === null ? '—' : `${stats.minutesToday}m`} label="in the app today" />
      </div>

      <div className="home__lists">
        {stats.topFolders.length > 0 && (
          <div className="home__list">
            <p className="home__label">most written in</p>
            {stats.topFolders.map((folder) => (
              <p className="home__row" key={folder.name}>
                <span>{folder.name}</span>
                <span className="home__count">{folder.count}</span>
              </p>
            ))}
          </div>
        )}
        {stats.hubs.length > 0 && (
          <div className="home__list">
            <p className="home__label">most linked</p>
            {stats.hubs.map((hub) => (
              <p className="home__row" key={hub.name}>
                <span>{hub.name}</span>
                <span className="home__count">{hub.links}</span>
              </p>
            ))}
          </div>
        )}
      </div>

      <button className="home__back" type="button" onClick={onBack}>
        <span className="home__arrow" aria-hidden="true">
          ←
        </span>{' '}
        back
      </button>
    </div>
  )
}

function Figure({ value, label, trend }: { value: string; label: string; trend?: number[] }): React.ReactElement {
  return (
    <div className="home__figure">
      <p className="home__number">{value}</p>
      <p className="home__label">{label}</p>
      {trend !== undefined && trend.some((n) => n > 0) && <Sparkline values={trend} />}
    </div>
  )
}

/** A week of writing, as one line. No axes, no grid, no library. */
function Sparkline({ values }: { values: number[] }): React.ReactElement {
  const top = Math.max(1, ...values)
  const points = values.map((value, i) => `${(i / Math.max(1, values.length - 1)) * 100},${18 - (value / top) * 16}`).join(' ')
  return (
    <svg className="home__spark" viewBox="0 0 100 20" preserveAspectRatio="none" aria-hidden="true">
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="1.2" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}
