// Stylesheets first: the build orders CSS by when modules are evaluated, and
// these must come before every feature's own (imported from its index.ts).
// Their order is the cascade: tokens, element rules, layout, the shell, then
// the UI primitives the features build on.
// KaTeX's own stylesheet and fonts, bundled - maths renders offline, like the rest.
import 'katex/dist/katex.min.css'
import '../styles/tokens.css'
import '../styles/base.css'
import './styles/first-run.css'
import '../styles/layout.css'
import './styles/sidebar.css'
import './styles/sidebar-parts.css'
import './styles/tabs.css'
import './styles/palette.css'
import '../ui/styles/toggle.css'
import '../ui/styles/tooltip.css'
import '../ui/styles/menu.css'
import '../ui/styles/dialog.css'
import '../ui/styles/color-editor.css'
import '../ui/styles/pill-slider.css'
import '../ui/styles/sliders.css'
import '../ui/styles/chip.css'
import '../ui/styles/setting-row.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
// These two override rules in the features' own stylesheets (transitions, the
// status bar's colour), so they must come after them - after App, which pulls
// every feature in.
import '../styles/motion.css'
import './styles/sidebar-colour.css'

const root = document.getElementById('root')
if (!root) throw new Error('missing #root')

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
