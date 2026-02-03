declare module '@ag-ui/client'

interface ImportMetaEnv {
  readonly VITE_AGENT_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

