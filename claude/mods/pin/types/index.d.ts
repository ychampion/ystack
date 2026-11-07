export type PinList = string[]

declare module 'claude-code' {
  interface PluginState {
    pin: {
      pins: Shaped<PinList>
    }
  }
}
