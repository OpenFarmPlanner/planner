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
import { redirectToPreferredLanguageVersion } from './i18n/publicPageLanguageRedirect'

// A visitor landing on a public page in the other language is sent to their
// language version before anything renders (see publicPageLanguageRedirect).
if (!redirectToPreferredLanguageVersion()) {
  registerServiceWorker()
  renderApp()
}

function renderApp() {
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
}
