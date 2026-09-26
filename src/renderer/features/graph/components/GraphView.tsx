import { useCallback, useEffect, useMemo, useState } from 'react'
import { Icon } from '../../../ui/Icon'
import { Tip } from '../../../ui/Tip'
import { registerView } from '../../../app/view-registry'
import { useNoteBus } from '../../../app/note-bus'
import { fit, worldToScreen } from '../geometry'
import { GraphPanel } from './GraphPanel'
import { GraphBar } from './GraphBar'
import { grainLevels, tintCss } from '../../../ui/tint'
import { visibleGraph } from '../view-model'
import { useGraphRefs } from '../hooks/use-graph-refs'
import { useGraphSettings } from '../hooks/use-graph-settings'
import { useGraphData } from '../hooks/use-graph-data'
import { useSimulation } from '../hooks/use-simulation'
import { useDrawLoop } from '../hooks/use-draw-loop'
import { useGraphPointer } from '../hooks/use-graph-pointer'

/**
 * The link graph.
 *
 * Physics in a Worker, drawing on the main thread, positions handed between
 * them as a transferred buffer. React owns none of that: it creates the worker,
 * gives it the graph once, and then only paints whatever positions arrive. No
 * node is a React element - a thousand of them would be a thousand components
 * re-rendering at 60fps, which is exactly the mistake this architecture avoids.
 *
 * The headline feature is the active-note highlight, and it is deliberately a
 * *render-layer* concern: the simulation never learns which note is open, so
 * switching notes repaints one frame rather than re-running a layout.
 */

type Props = {
  activePath: string | null
  onOpenNote: (path: string) => void
  /** Whether the settings can be opened - only when the graph fills the window. */
  editable?: boolean
}

function GraphView({ activePath, onOpenNote, editable = false }: Props): React.ReactElement {
  const refs = useGraphRefs()
  const { hostRef, canvasRef, state, dirty, motion, framePositions, glideCamera } = refs

  const [panelOpen, setPanelOpen] = useState(false)
  // Leaving full size closes the settings, so they do not spring back open the
  // next time the graph is expanded.
  useEffect(() => {
    if (!editable) setPanelOpen(false)
  }, [editable])
  const [frameMs, setFrameMs] = useState(0)
  const [settling, setSettling] = useState(true)
  /**
   * The hovered node's name, as a tooltip on the canvas.
   *
   * Labels are culled when the graph is crowded or zoomed out, which otherwise
   * leaves a dense cluster as anonymous dots. One re-render per hover change is
   * cheap - it is not per frame and not per pointer move.
   */
  const [hovered, setHovered] = useState<string | null>(null)

  /**
   * Whether there is room for the sliders, measured rather than inferred.
   *
   * The first version keyed this off "is this the floating window", which meant
   * the force controls stayed hidden even with the panel maximised to fill the
   * screen - the one place there was obviously room for them. Space is the
   * actual question, so ask the element.
   */
  const [roomy, setRoomy] = useState(false)

  // --- persisted settings -------------------------------------------------
  const {
    tunables,
    setTunables,
    showLabels,
    setShowLabels,
    showOrphans,
    setShowOrphans,
    showTasks,
    setShowTasks,
    showChats,
    setShowChats,
    look,
    setLook,
    layout,
    setLayout,
    linkRange,
    setLinkRange,
    localOnly,
    setLocalOnly,
  } = useGraphSettings()

  // --- data ---------------------------------------------------------------
  const graph = useGraphData()

  const view = useMemo(
    () => visibleGraph(graph, { showOrphans, showTasks, showChats, linkRange, localOnly, activePath }),
    [graph, showOrphans, showTasks, showChats, linkRange, localOnly, activePath],
  )

  // --- worker lifecycle ---------------------------------------------------
  useSimulation(refs, view, { tunables, layout, look }, setSettling)

  // --- the highlight ------------------------------------------------------
  useEffect(() => {
    const index = activePath === null ? -1 : view.paths.indexOf(activePath)
    const neighbours = new Set<number>()
    if (index >= 0) {
      for (const [a, b] of view.edges) {
        if (a === index) neighbours.add(b)
        else if (b === index) neighbours.add(a)
      }
    }
    state.current.active = index
    state.current.neighbours = neighbours
    dirty.current = true

    // Bring the open note into view if it is off screen. The highlight is
    // useless when you cannot see what it is highlighting, and after a pan or
    // a zoom the note you switch to is often outside the frame.
    const host = hostRef.current
    if (index >= 0 && host !== null) {
      const x = state.current.positions[index * 2]
      const y = state.current.positions[index * 2 + 1]
      if (x !== undefined && y !== undefined && Number.isFinite(x) && Number.isFinite(y)) {
        const [sx, sy] = worldToScreen(state.current.camera, x, y, host.clientWidth, host.clientHeight)
        const margin = 40
        const outside = sx < margin || sy < margin || sx > host.clientWidth - margin || sy > host.clientHeight - margin
        if (outside) glideCamera({ ...motion.current.target, x, y })
      }
    }
  }, [activePath, view])

  useEffect(() => {
    state.current.showLabels = showLabels
    dirty.current = true
  }, [showLabels])

  // --- draw loop ----------------------------------------------------------
  useDrawLoop(refs, setRoomy, setFrameMs)

  // --- interaction --------------------------------------------------------
  const { size, onWheel, onPointerDown, onPointerMove, onPointerLeave } = useGraphPointer(refs, onOpenNote, setHovered)

  /** Put the open note in the middle, at a readable zoom. */
  const centreOnActive = useCallback(() => {
    const index = state.current.active
    if (index < 0) return
    const x = state.current.positions[index * 2]
    const y = state.current.positions[index * 2 + 1]
    if (x === undefined || y === undefined || !Number.isFinite(x) || !Number.isFinite(y)) return
    glideCamera({ x, y, zoom: Math.max(motion.current.target.zoom, 1) })
  }, [glideCamera])

  const nodeCount = view.nodes.length
  const hasActive = activePath !== null && view.paths.includes(activePath)

  const tint = tintCss({ colors: look.background.colors, strength: look.background.strength })
  const grain = grainLevels(look.background.grain)
  const settingsOpen = editable && panelOpen

  return (
    <div className={`graph${roomy ? '' : ' graph--compact'}${settingsOpen ? ' is-editing' : ''}`}>
      <div
        className="graph__canvas"
        ref={hostRef}
        title={hovered ?? undefined}
        data-hovered={hovered ?? ''}
        style={{
          backgroundImage: tint === 'none' ? undefined : tint,
          ['--graph-grain' as string]: Math.min(1, grain.amount * 0.35 + grain.boost * 0.4),
        }}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerLeave={onPointerLeave}
      >
        <canvas ref={canvasRef} />
        {graph !== null && nodeCount === 0 && (
          <p className="graph__empty">
            {showOrphans
              ? 'No notes yet — the graph fills in as you write.'
              : 'Nothing is linked yet. Turn unlinked notes back on to see them.'}
          </p>
        )}
      </div>

      {/* Editing lives in the full-size graph only: the controls need the room,
          and a graph you are styling needs to be big enough to judge. */}
      {editable && !panelOpen && (
        <Tip label="Graph settings" hint="Layout, colour, dots, links" placement="left">
          <button className="graph__gear" onClick={() => setPanelOpen(true)} aria-label="Graph settings">
            <Icon name="settings" size={19} />
          </button>
        </Tip>
      )}
      {settingsOpen && (
        <GraphPanel
          look={look}
          onLook={setLook}
          layout={layout}
          onLayout={setLayout}
          tunables={tunables}
          onTunables={setTunables}
          linkBins={view.bins}
          linkRange={linkRange}
          onLinkRange={setLinkRange}
          shown={view.nodes.length}
          onClose={() => setPanelOpen(false)}
        />
      )}

      <GraphBar
        labels={{ on: showLabels, set: setShowLabels }}
        orphans={{ on: showOrphans, set: setShowOrphans }}
        localOnly={{ on: localOnly, set: setLocalOnly }}
        tasks={{ on: showTasks, set: setShowTasks }}
        chats={{ on: showChats, set: setShowChats }}
        hasActive={hasActive}
        onCentre={centreOnActive}
        onFit={() => {
          const [width, height] = size()
          glideCamera(fit(framePositions(), nodeCount, width, height))
        }}
        nodeCount={nodeCount}
        edgeCount={view.edges.length}
        frameMs={frameMs}
        settling={settling}
      />
    </div>
  )
}

/** Subscribes the graph to the active note without threading props through. */
function GraphHost({ onOpenNote, editable }: { onOpenNote: (path: string) => void; editable: boolean }): React.ReactElement {
  const { activePath } = useNoteBus()
  return <GraphView activePath={activePath} onOpenNote={onOpenNote} editable={editable} />
}

/**
 * Registered as a view type like everything else, so the graph can be a tab, a
 * split, or the floating window without a second implementation.
 */
export function registerGraphView(onOpenNote: (path: string) => void): () => void {
  return registerView({
    type: 'graph',
    title: 'Graph',
    icon: 'git-fork',
    // Editable only when the floating graph is expanded to full size.
    render: ({ state }) => <GraphHost onOpenNote={onOpenNote} editable={state['maximized'] === true} />,
  })
}
