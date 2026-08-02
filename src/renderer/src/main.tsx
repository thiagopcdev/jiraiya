import './index.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { bootTheme } from './lib/theme'
import { bootDensity } from './lib/density'
import App from './App'

// antes do render: aplica tema e densidade espelhados em localStorage (evita flash)
bootTheme()
bootDensity()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
