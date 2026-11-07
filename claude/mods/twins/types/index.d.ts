export type Side = 'a' | 'b'
export type Marker = { pair: string; item: string; behind: Side; files: string[]; at: number }
export type Markers = Record<string, Marker>
export type PaneRow = { key: string; title: string; lines: string[] }
export type TwinsPane = { rows: PaneRow[]; at: number }

declare module 'claude-code' {
  interface PluginState {
    twins: {
      markers: Shaped<Markers>
      pane: Shaped<TwinsPane>
    }
  }
}
