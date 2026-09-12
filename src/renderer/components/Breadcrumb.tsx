/**
 * The path of the open note, in the title strip.
 *
 * The strip has to exist anyway — it is the window drag region and it clears the
 * macOS traffic lights — so it may as well say where you are.
 */
type Props = {
  path: string | null
  fallback: string
}

export function Breadcrumb({ path, fallback }: Props): React.ReactElement {
  if (path === null) {
    return (
      <nav className="crumbs" aria-label="Location">
        <span className="crumbs__item crumbs__item--muted">{fallback}</span>
      </nav>
    )
  }

  const segments = path.split('/')
  const last = segments.length - 1

  return (
    <nav className="crumbs" aria-label="Location">
      {segments.map((segment, i) => (
        <span key={i} className="crumbs__group">
          {i > 0 && <span className="crumbs__sep">›</span>}
          <span className={`crumbs__item${i === last ? ' is-current' : ''}`}>
            {i === last ? segment.replace(/\.md$/, '') : segment}
          </span>
        </span>
      ))}
    </nav>
  )
}
