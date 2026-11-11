import type { EngineInterface, Register } from 'claude-code'

import type { Critter, Mood, StripProps } from '../types'
import { drawStrip } from './svg'

const OLD_PANE = 'vivarium'
const CRITTERS = { plugin: 'vivarium', key: 'critters' } as const
const IS_HIDDEN = { plugin: 'vivarium', key: 'isHidden' } as const
const SELECTED = { plugin: 'vivarium', key: 'selected' } as const

const MAX_KEPT = 40
const ANSWER_CHARS = 300

// ---------------------------------------------------------------- helpers

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

function duration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${s % 60}s`
  return `${Math.floor(m / 60)}h ${m % 60}m`
}

function summary(list: Critter[]): string {
  const awake = list.filter(c => c.mood === 'awake').length
  const failed = list.filter(c => c.mood === 'flopped').length
  const parts = [`${awake} working`, `${list.length - awake - failed} finished`]
  if (failed > 0) parts.push(`${failed} failed`)
  return parts.join(' · ')
}

// claude-opus-5-5 -> Opus 5.5, claude-haiku-4-5-20251001 -> Haiku 4.5.
function modelName(model: string | undefined): string | undefined {
  if (model === undefined) return undefined
  const m = /(opus|sonnet|haiku|fable)-(\d+)(?:-(\d{1,2}))?(?:-|\[|$)/i.exec(model)
  if (m === null) return model
  const family = m[1][0].toUpperCase() + m[1].slice(1).toLowerCase()
  return m[3] !== undefined ? `${family} ${m[2]}.${m[3]}` : `${family} ${m[2]}`
}

function detail(c: Critter, now: number, tool: string | undefined): string {
  const model = modelName(c.model)
  const head = model !== undefined ? `${c.kind} · ${model} · ${c.description}` : `${c.kind} · ${c.description}`
  if (c.mood === 'awake') {
    return `${head} · running ${duration(now - c.hatchedAt)}${tool !== undefined ? ` · last tool: ${tool}` : ''}`
  }
  const took = duration((c.doneAt ?? now) - c.hatchedAt)
  if (c.mood === 'asleep') return `${head} · finished in ${took}: ${c.answer ?? '(no text)'}`
  return `${head} · ${c.stopReason ?? 'stopped'} after ${took}`
}

function stopReason(reason: string, explanation: string | null): string {
  if (reason === 'aborted') return 'interrupted'
  if (reason === 'refusal') return explanation ? `refused (${explanation})` : 'refused'
  return 'stopped by an API error'
}

// ---------------------------------------------------------------- state

async function getCritters($: EngineInterface): Promise<Critter[]> {
  const { value = [] } = await $.state.get(CRITTERS)
  return value
}

// Read, apply, write only if nobody wrote in between; try again otherwise.
// Skips the write when nothing changed, so the strip is not redrawn for nothing.
async function editCritters($: EngineInterface, fn: (list: Critter[]) => Critter[]): Promise<void> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const held = await $.state.get(CRITTERS)
    const before = held.value ?? []
    const after = fn(before)
    if (after === before) return
    const written = await $.state.set(CRITTERS, after, { ifVersion: held.version })
    if (written.isSet) return
  }
}

function wake(c: Critter): Critter {
  const { doneAt: _d, answer: _a, stopReason: _s, ...rest } = c
  return { ...rest, mood: 'awake' }
}

// ---------------------------------------------------------------- hooks

export const register: Register = on => {
  // The last tool each running subagent called. Kept here, not in $.state,
  // so a tool call never redraws the strip; read when a Clawd is clicked.
  const lastTool = new Map<string, string>()

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'vivarium',
      description: 'Show or hide the subagent strip above the prompt',
    })
    // Earlier versions drew into a side pane.
    void $.ui.close({ id: OLD_PANE })

    return next(e)
  })

  on('command.run', { command: 'vivarium' }, async $ => {
    const { value: isHidden = false } = await $.state.get(IS_HIDDEN)
    await $.state.set(IS_HIDDEN, !isHidden)

    return { text: isHidden ? 'Subagent strip shown.' : 'Subagent strip hidden.' }
  })

  on('agent.spawn', async ($, e, next) => {
    const hatchedAt = await $.clock.now()
    const spawned = await next(e)

    if (spawned.deny !== undefined || spawned.agentId === undefined) return spawned

    // Keyed by the subagent's own id: every agent of a workflow run carries
    // the Workflow call's tool_use_id, which would draw the run as one Clawd.
    const critter: Critter = {
      id: spawned.agentId,
      agentId: spawned.agentId,
      kind: e.subagentType,
      description: e.description,
      mood: 'awake',
      hatchedAt,
      model: spawned.model,
    }
    await editCritters($, list => [...list.filter(c => c.id !== critter.id), critter].slice(-MAX_KEPT))
    $.ui.toast(`✻ ${e.subagentType} hatched: ${clip(e.description, 50)}`)

    return spawned
  })

  // A finished subagent that is given more work wakes up again. Writes only
  // on that change, never per tool call.
  on('tool.call', ($, e, next) => {
    const agentId = e.agentId
    if (agentId !== undefined) {
      lastTool.set(agentId, e.tool)
      void editCritters($, list =>
        list.some(c => c.agentId === agentId && c.mood !== 'awake')
          ? list.map(c => (c.agentId === agentId ? wake(c) : c))
          : list,
      )
    }

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const agentId = e.agentId
    if (agentId !== undefined) {
      const now = await $.clock.now()
      const mood: Mood = e.reason === 'answer' ? 'asleep' : 'flopped'
      const answer = clip(oneLine(e.answer), ANSWER_CHARS)
      const reason = stopReason(e.reason, e.reason === 'refusal' ? e.refusal.explanation : null)
      await editCritters($, list =>
        list.some(c => c.agentId === agentId)
          ? list.map(c => {
              if (c.agentId !== agentId) return c
              return mood === 'asleep'
                ? { ...c, mood, doneAt: now, answer }
                : { ...c, mood, doneAt: now, stopReason: reason }
            })
          : list,
      )
    }

    return next(e)
  })

  // A click in the strip: remember which Clawd is selected, so the strip
  // draws its detail line.
  on('ui.message', async ($, e, next) => {
    if (e.element !== 'clawds') return next(e)
    const data = e.data as { select?: unknown } | null
    const id = typeof data?.select === 'string' ? data.select : null
    await $.state.set(SELECTED, id)

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const list = await getCritters($)
    const { value: isHidden = false } = await $.state.get(IS_HIDDEN)
    if (e.props.hasSurvey || isHidden || list.length === 0) return next(e)

    const now = await $.clock.now()
    const hasResting = list.some(c => c.mood !== 'awake')
    const clear = async () => {
      await editCritters($, all => all.filter(c => c.mood === 'awake'))
      await $.state.set(SELECTED, null)
    }

    const toolOf = (c: Critter) => (c.agentId !== undefined ? lastTool.get(c.agentId) : undefined)

    // The terminal draws the block-character strip, whose cells it lays out
    // exactly; every other surface draws the pixel SVG.
    if (e.surface === 'terminal') {
      const { value: selectedId = null } = await $.state.get(SELECTED)
      const chosen = list.find(c => c.id === selectedId)
      const tool = chosen !== undefined ? toolOf(chosen) : undefined
      const props: StripProps = {
        critters: list.map(c => ({ id: c.id, kind: c.kind, label: c.description, mood: c.mood })),
        selected: chosen?.id ?? null,
        detail: chosen !== undefined ? detail(chosen, now, tool) : '',
        summary: summary(list),
      }
      const { Box, Button, Client } = $.ui.resolve(e)
      return (
        <Box flexDirection="row" alignItems="flex-end">
          <Client key="clawds" module="./strip.tsx" props={props} height={6} flexGrow={1} />
          {hasResting && <Button key="clear" label="Clear finished" onPress={clear} />}
        </Box>
      )
    }

    const { Box, Svg, Button } = $.ui.resolve(e)
    return (
      <Box flexDirection="row" alignItems="flex-end">
        <Svg
          source={drawStrip(list, now, c => detail(c, now, toolOf(c)), summary(list))}
          alt={`Subagents: ${summary(list)}`}
          width={640}
          height={62}
          isInteractive
        />
        {hasResting && <Button key="clear" label="Clear finished" onPress={clear} />}
      </Box>
    )
  })
}
