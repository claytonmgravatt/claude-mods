export type Mood = 'awake' | 'asleep' | 'flopped'

export type Critter = {
  /**
   * The subagent's agentId. Not the Agent tool call's id, which every agent
   * of a workflow run shares.
   */
  id: string
  /** The subagent's loop id, once it started. */
  agentId?: string
  /** The agent type: Explore, Plan, general-purpose, ... */
  kind: string
  description: string
  mood: Mood
  hatchedAt: number
  /** The model it runs on, as the engine resolved it. */
  model?: string
  doneAt?: number
  /** The start of its final answer, once it finished. */
  answer?: string
  /** Why it stopped, when it failed. */
  stopReason?: string
}

/** One Clawd as the strip module draws it. */
export type StripCritter = { id: string; kind: string; label: string; mood: Mood }

/** What the hooks module hands the strip module. */
export type StripProps = {
  critters: StripCritter[]
  selected: string | null
  detail: string
  summary: string
}

/** What the strip module posts back when a Clawd is clicked. */
export type StripMessage = { select: string | null }

declare module 'claude-code' {
  interface PluginState {
    vivarium: { critters: Critter[]; isHidden: boolean; selected: string | null }
  }
}
