import { FloatingWindow } from './FloatingWindow'
import { History } from '../../features/editor'
import { getView } from '../view-registry'
import type { WorkspaceApi } from '../hooks/use-workspace'

type Props = Pick<WorkspaceApi, 'graphWindow' | 'setGraphWindow' | 'historyWindow' | 'setHistoryWindow'> & {
  activePath: string | null
  /** A restore rewrites the file; the editor picks that up through the watcher. */
  onRestored: () => void
}

/** The floating windows over the workspace: the open note's history, and the graph. */
export function ShellWindows({
  graphWindow,
  setGraphWindow,
  historyWindow,
  setHistoryWindow,
  activePath,
  onRestored,
}: Props): React.ReactElement {
  const graphView = getView('graph')
  return (
    <>
      {historyWindow.open && activePath !== null && (
        <FloatingWindow
          title={`History — ${activePath.slice(activePath.lastIndexOf('/') + 1).replace(/\.md$/, '')}`}
          geometry={historyWindow}
          onChange={setHistoryWindow}
          onClose={() => setHistoryWindow({ open: false })}
          closeHint="Close history"
        >
          <History
            path={activePath}
            // A restore rewrites the file; the editor picks that up through
            // the watcher, so nothing to do here but refresh the list.
            onRestored={onRestored}
          />
        </FloatingWindow>
      )}

      {graphWindow.open && (
        <FloatingWindow
          title="Graph"
          geometry={graphWindow}
          onChange={setGraphWindow}
          onClose={() => setGraphWindow({ open: false })}
          closeHint="Close graph (⌘G)"
        >
          {graphView?.render({
            state: { floating: true, maximized: graphWindow.maximized },
            setState: () => {},
            leafId: 'graph-window',
          })}
        </FloatingWindow>
      )}
    </>
  )
}
