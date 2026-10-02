export type Verb = 'read' | 'wrote' | 'made' | 'pasted'

/** One image on the roll: where it is, what it is, and its pixel grid. */
export type Print = {
  id: string
  path: string
  /** The PNG the terminal draws: the image itself, or its converted copy. */
  png: string
  verb: Verb
  tool: string
  width: number
  height: number
  format: string
  bytes: number
  mtimeMs: number
  at: number
  /** RGB bytes, base64, square pixels: what the develop and the cell fallback paint. */
  grid: string
  gridWidth: number
  gridHeight: number
}

declare module 'claude-code' {
  interface PluginState {
    darkroom: {
      prints: Print[]
      /** The prints a tool call worked on, by its tool_use_id. */
      shots: StateFamily<string[]>
      /** Whether a transcript row shows its strip, by the row's requestId; null follows auto-show. */
      isUnrolled: StateFamily<boolean | null>
      /** The strip index a row's viewer shows, by the row's requestId; -1 when shut. */
      viewing: StateFamily<number>
      /** Whether a row's strip has played its develop, by the row's requestId. */
      isDeveloped: StateFamily<boolean>
      /** The strip index whose hover menu shows, by the row's requestId; -1 for none. */
      hovered: StateFamily<number>
      /** The images pasted in the prompt box, by their [Image #N] numbers. */
      pasted: number[]
    }
  }
}
