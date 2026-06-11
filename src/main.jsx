import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import ResearchApp from './components/ResearchApp.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import { ConfirmProvider } from './components/ConfirmDialog.jsx'
import { isResearchHost } from './utils/environment.js'

// One deploy, two interfaces. The Research Bench lives on its own subdomain
// (research.foundry.alokkhatri.com) and never mounts the workshop App.
const research = isResearchHost();

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <ConfirmProvider>
        {research ? <ResearchApp /> : <App />}
      </ConfirmProvider>
    </ErrorBoundary>
  </StrictMode>,
)
