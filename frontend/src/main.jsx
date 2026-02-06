import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { CopilotKit } from '@copilotkit/react-core'
import './index.css'
import App from './App'

const COPILOTKIT_RUNTIME_URL =
  import.meta.env.VITE_COPILOTKIT_URL || 'http://localhost:8000/copilotkit'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <CopilotKit runtimeUrl={COPILOTKIT_RUNTIME_URL}>
      <App />
    </CopilotKit>
  </StrictMode>,
)
