import { registerView } from '../../app/view-registry'
import { NavArrows } from '../../app/components/NavArrows'
import { CanvasView, type CanvasShell } from './components/CanvasView'

/**
 * The `canvas` view: a canvas file in a tab, as a step in the tab's history.
 * Without a file it is the Canvas section's empty page.
 */
export function registerCanvasView(shell: CanvasShell & { newCanvas: () => void }): () => void {
  return registerView({
    type: 'canvas',
    title: 'Canvas',
    icon: 'scan',
    getTitle: (state) => {
      const path = typeof state['path'] === 'string' ? state['path'] : null
      return path === null ? 'Canvas' : path.slice(path.lastIndexOf('/') + 1).replace(/\.canvas$/i, '')
    },
    render: ({ state, leafId }) => {
      const path = typeof state['path'] === 'string' ? state['path'] : null
      if (path === null)
        return (
          <div className="canvas-empty">
            <div className="md__bar">
              <NavArrows leafId={leafId} />
            </div>
            <div className="canvas-empty__body">
              <h2 className="canvas-empty__title">No canvas open</h2>
              <p className="canvas-empty__text">Pick one from the list, or make one: notes, cards, images and links laid out freely.</p>
              <button className="btn btn--primary btn--sm" onClick={shell.newCanvas}>
                New canvas
              </button>
            </div>
          </div>
        )
      return <CanvasView key={path} path={path} leafId={leafId} shell={shell} />
    },
  })
}
