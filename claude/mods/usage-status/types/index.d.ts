export type Gauge = { label: string; percent?: number; note?: string }
export type Snapshot = { model: string; id: string; cost?: number; gauges: Gauge[] }

declare module 'claude-code' {
  interface PluginState {
    'usage-status': { snapshot: Snapshot | null }
  }
}
