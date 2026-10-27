export type FileStat = { path: string; added: number; removed: number }
export type AgentRow = {
  id: string
  description: string
  type: string
  prompt: string
  status: string
  steps: string[]
}
export type Note = { id: string; text: string; isSent: boolean }
export type Todo = { id: string; content: string; status: 'pending' | 'in_progress' | 'completed' }

declare module 'claude-code' {
  interface PluginState {
    'work-panel': {
      files: string[]
      stats: FileStat[]
      agents: AgentRow[]
      todos: Todo[]
      selected: string | null
      notes: Note[]
      draft: string
      todoMode: boolean
    }
  }
}
