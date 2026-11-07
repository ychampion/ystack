/** The key name the add box is open for, and its last message to the owner. Never a key's value. */
export type VaultPaneText = string

declare module 'claude-code' {
  interface PluginState {
    vault: {
      adding: Shaped<VaultPaneText>
      note: Shaped<VaultPaneText>
      problem: Shaped<string>
    }
  }
}
