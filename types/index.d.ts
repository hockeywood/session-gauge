export type Window = { kind: 'five_hour' | 'seven_day'; percent: number; resetsAt: number | null; projected: number | null }
export type Gauge = {
  context: number | null
  growth: number | null
  turnsLeft: number | null
  windows: Window[]
  source: 'live' | 'reply' | 'none'
  readAt: number | null
}

declare module 'claude-code' {
  interface PluginState {
    'session-gauge': { gauge: Gauge; warned: number; isOn: boolean; isOpen: boolean }
  }
}
