import './index.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { bootTheme } from './lib/theme'
import App from './App'

// antes do render: aplica o tema espelhado em localStorage (evita flash)
bootTheme()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
