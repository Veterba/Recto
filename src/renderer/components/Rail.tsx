import { SECTIONS, type Section, type SectionId } from '../core/sections'
import { Icon } from './Icon'

/**
 * The left icon strip. Clicking a section opens its view; clicking the active
 * section again collapses its sidebar panel, which is the behaviour people
 * expect from every editor that has one.
 */
type Props = {
  active: SectionId
  sidebarOpen: boolean
  onSelect: (section: Section) => void
}

export function Rail({ active, sidebarOpen, onSelect }: Props): React.ReactElement {
  const main = SECTIONS.filter((s) => s.footer !== true)
  const footer = SECTIONS.filter((s) => s.footer === true)

  const button = (section: Section): React.ReactElement => {
    const isActive = section.id === active
    return (
      <button
        key={section.id}
        className={`rail__btn${isActive ? ' is-active' : ''}`}
        aria-label={section.label}
        aria-current={isActive}
        aria-expanded={isActive && section.noPanel !== true ? sidebarOpen : undefined}
        onClick={() => onSelect(section)}
      >
        <Icon name={section.icon} />
        <span className="rail__tip" role="tooltip">
          {section.label}
        </span>
      </button>
    )
  }

  return (
    <nav className="rail" aria-label="Sections">
      <div className="rail__group">{main.map(button)}</div>
      <div className="rail__group">{footer.map(button)}</div>
    </nav>
  )
}
