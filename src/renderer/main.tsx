import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
// KaTeX's own stylesheet and fonts, bundled - maths renders offline, like the rest.
import 'katex/dist/katex.min.css'
import './styles/tokens.css'
import './styles/app.css'

const root = document.getElementById('root')
if (!root) throw new Error('missing #root')

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
