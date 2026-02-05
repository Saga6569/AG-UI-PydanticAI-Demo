import { HttpAgent, randomUUID } from '@ag-ui/client'

// URL AG-UI сервера (можно переопределить через VITE_AGENT_URL).
const AGENT_ENDPOINT =
  import.meta.env.VITE_AGENT_URL || 'http://localhost:8000/api/agent'

type ToolSchema = {
  name: string
  description: string
  parameters: Record<string, unknown>
}

// HttpAgent управляет run, событиями и состоянием AG-UI.
export const agent = new HttpAgent({
  url: AGENT_ENDPOINT,
  headers: { 'Content-Type': 'application/json' },
  debug: true,
  initialState: {
    user_name: 'Гость',
    theme: 'light',
  },
})

// Утилита для создания user-сообщения.
export const buildUserMessage = (content: string) => ({
  id: randomUUID(),
  role: 'user' as const,
  content,
})

