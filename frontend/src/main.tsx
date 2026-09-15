import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './i18n'
import App from './App.tsx'
import { ThemeProvider } from '@mui/material/styles'
import { CssBaseline } from '@mui/material'
import theme from './theme'
import { CommandProvider } from './commands/CommandProvider'
import { AuthProvider } from './auth/AuthContext'
import { FocusManagerProvider } from './focus/FocusManager'
import LanguageSynchronizer from './i18n/LanguageSynchronizer'
import PrerenderLanguageVisibilityGate from './startup/PrerenderLanguageVisibilityGate'
import { registerServiceWorker } from './pwa/registerServiceWorker'

registerServiceWorker()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PrerenderLanguageVisibilityGate>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <AuthProvider>
          <LanguageSynchronizer />
          <FocusManagerProvider>
            <CommandProvider>
              <App />
            </CommandProvider>
          </FocusManagerProvider>
        </AuthProvider>
      </ThemeProvider>
    </PrerenderLanguageVisibilityGate>
  </StrictMode>,
)
