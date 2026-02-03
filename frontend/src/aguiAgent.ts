import { HttpAgent, randomUUID } from '@ag-ui/client'

// URL AG-UI сервера (можно переопределить через VITE_AGENT_URL).
const AGENT_ENDPOINT =
  import.meta.env.VITE_AGENT_URL || 'http://localhost:8000/api/agent'

// Заготовка под типы фронтовых tool (оставлено для расширения демо).
type FrontendTool = {
  description: string
  run: (args: { text?: string }) => Promise<Record<string, unknown>>
}

type ToolSchema = {
  name: string
  description: string
  parameters: Record<string, unknown>
}

export const frontendToolSchemas: ToolSchema[] = []

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

