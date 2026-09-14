import { Component, type ReactNode } from 'react'

/**
 * Keeps one broken tab from taking the whole window with it.
 *
 * React unmounts everything above an uncaught render or effect error. With no
 * boundary, a single note the editor could not build blanked the entire app -
 * and because the workspace restores open tabs, it came back blank on every
 * launch, with nothing on screen to close the tab that caused it.
 */
type Props = { children: ReactNode; label: string; onClose: () => void }
type State = { error: Error | null }

export class ViewBoundary extends Component<Props, State> {
  override state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  override componentDidCatch(error: Error): void {
    console.error(`A tab failed to render (${this.props.label}):`, error)
  }

  override render(): ReactNode {
    const { error } = this.state
    if (error === null) return this.props.children
    return (
      <div className="pane-empty view-error">
        <p>
          <strong>This tab couldn’t be shown.</strong>
          <br />
          <code>{this.props.label}</code>
          <br />
          <span className="view-error__detail">{error.message}</span>
        </p>
        <div className="view-error__actions">
          <button className="btn" onClick={() => this.setState({ error: null })}>
            Try again
          </button>
          <button className="btn" onClick={this.props.onClose}>
            Close tab
          </button>
        </div>
      </div>
    )
  }
}
