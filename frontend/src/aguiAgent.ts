import { HttpAgent, randomUUID } from '@ag-ui/client'

const AGENT_ENDPOINT =
  import.meta.env.VITE_AGENT_URL || 'http://localhost:8000/api/agent'

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

export const agent = new HttpAgent({
  url: AGENT_ENDPOINT,
  headers: { 'Content-Type': 'application/json' },
  debug: true,
  initialState: {
    user_name: 'Гость',
    theme: 'light',
  },
})

export const buildUserMessage = (content: string) => ({
  id: randomUUID(),
  role: 'user' as const,
  content,
})

