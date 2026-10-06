import type { ClientModule } from 'claude-code'

import type { StripCritter, StripMessage, StripProps } from '../types'

// Drawn in cells. Clawd is the start-up banner's: 9 columns by 3 rows of
// quadrant blocks, the eyes being the two missing quadrants.
const AWAKE_A = [' ▐▛███▜▌ ', '▝▜█████▛▘', '  ▘▘ ▝▝  ']
const AWAKE_B = [' ▐▛███▜▌ ', '▝▜█████▛▘', '   ▘▘▝▝  ']
const ASLEEP = ['         ', ' ▐█████▌ ', '▝▜█████▛▘']
const FLOPPED = ['  ▖▖ ▗▗  ', '▗▟█████▙▖', ' ▐▙███▟▌ ']
const SPRITE_W = 9

const MIRROR: Record<string, string> = { '▘': '▝', '▝': '▘', '▖': '▗', '▗': '▖', '▛': '▜', '▜': '▛', '▙': '▟', '▟': '▙', '▌': '▐', '▐': '▌' }
const mirror = (rows: string[]) => rows.map(row => [...row].reverse().map(ch => MIRROR[ch] ?? ch).join(''))

const CLAY = '#d97757'
const MUTED = '#8f8b80'
const GRASS = '#788c5d'
const GRASS_DARK = '#4f5e3c'
const GREY = '#9c9a92'
const STAR = '#e8c468'

function bodyColour(kind: string): string {
  const k = kind.toLowerCase()
  if (k === 'explore') return '#6a9bcc'
  if (k === 'plan') return '#788c5d'
  if (k === 'claude-code-guide') return '#c46686'
  if (k === 'fork') return '#e8a283'
  if (k === 'general-purpose' || k === 'claude') return CLAY
  let h = 0
  for (let i = 0; i < kind.length; i++) h = (h * 31 + kind.charCodeAt(i)) >>> 0
  return `hsl(${h % 360} 45% 62%)`
}

function phaseOf(id: string): number {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 33 + id.charCodeAt(i)) >>> 0
  return h % 997
}

const SPIN = ['·', '✢', '✳', '✶', '✻', '✽']
const ROWS = 6 // label, three of Clawd, grass, detail
const TICK_MS = 120
const MAX_RESTING = 8
const REST_GAP = 10

type Cell = { ch: string; color?: string; bold?: boolean }
type State = { t: number; hop: { id: string; until: number } | null; picked: string | null }

type Placed = { c: StripCritter; x: number; rows: string[]; colour: string; dir: number }

function layout(critters: StripCritter[], columns: number, t: number): { placed: Placed[]; laneWidth: number } {
  const resting = critters.filter(c => c.mood !== 'awake').slice(-MAX_RESTING)
  const awake = critters.filter(c => c.mood === 'awake')
  const placed: Placed[] = []

  resting.forEach((c, i) => {
    placed.push({
      c,
      x: 1 + i * REST_GAP,
      rows: c.mood === 'asleep' ? ASLEEP : FLOPPED,
      colour: c.mood === 'asleep' ? bodyColour(c.kind) : GREY,
      dir: 1,
    })
  })

  const yardStart = resting.length > 0 ? 1 + resting.length * REST_GAP + 2 : 1
  const yardWidth = Math.max(0, columns - yardStart - 1)
  const laneWidth = awake.length > 0 ? Math.floor(yardWidth / awake.length) : 0
  awake.forEach((c, i) => {
    const lane0 = yardStart + i * laneWidth
    // Walk back and forth across the lane, one column every two ticks.
    const span = Math.max(1, laneWidth - SPRITE_W - 1)
    const p = (Math.floor(t / 2) + phaseOf(c.id)) % (2 * span)
    const dir = p < span ? 1 : -1
    const offset = p < span ? p : 2 * span - p
    const step = (Math.floor(t / 2) + phaseOf(c.id)) % 2 === 0
    const rows = step ? AWAKE_A : AWAKE_B
    placed.push({ c, x: lane0 + offset, rows: dir < 0 ? mirror(rows) : rows, colour: bodyColour(c.kind), dir })
  })

  return { placed, laneWidth }
}

function put(grid: Cell[][], row: number, x: number, text: string, cell: Omit<Cell, 'ch'>) {
  const line = grid[row]
  if (line === undefined) return
  ;[...text].forEach((ch, i) => {
    const col = x + i
    if (col >= 0 && col < line.length) line[col] = { ch, ...cell }
  })
}

function sameStyle(a: Cell, b: Cell): boolean {
  return a.color === b.color && a.bold === b.bold
}

const Strip: ClientModule<StripProps, State> = (props, surface) => {
  const { Box, Text } = surface.elements
  const state: State = surface.state ?? { t: 0, hop: null, picked: null }

  if (surface.state === undefined) {
    surface.setState(state)
    surface.every(TICK_MS, () => {
      const s = surface.state ?? state
      surface.setState({ ...s, t: s.t + 1 })
    })
  }

  const columns = surface.columns
  if (columns <= 0) return <Text> </Text>

  const t = state.t
  const { placed, laneWidth } = layout(props.critters, columns, t)
  const selected = state.picked ?? props.selected

  surface.onPointer(event => {
    if (event.type !== 'down') return
    const s = surface.state ?? state
    const hit = layout(props.critters, surface.columns, s.t).placed.find(
      p => event.x >= p.x && event.x < p.x + SPRITE_W && event.y <= 4,
    )
    const id = hit === undefined || hit.c.id === (s.picked ?? props.selected) ? null : hit.c.id
    surface.setState({ ...s, picked: id, hop: id === null ? null : { id, until: s.t + 4 } })
    const message: StripMessage = { select: id }
    surface.post(message)
  })

  const grid: Cell[][] = Array.from({ length: ROWS }, () => Array.from({ length: columns }, () => ({ ch: ' ' })))

  // Grass, with a darker patch under each Clawd.
  put(grid, 4, 0, '▀'.repeat(columns), { color: GRASS })
  for (const p of placed) put(grid, 4, p.x + 1, '▀'.repeat(SPRITE_W - 2), { color: GRASS_DARK })

  for (const p of placed) {
    const ph = phaseOf(p.c.id)
    const hopping = state.hop !== null && state.hop.id === p.c.id && t < state.hop.until
    const top = hopping ? 0 : 1
    p.rows.forEach((row, i) => {
      // Spaces in a sprite are see-through.
      ;[...row].forEach((ch, j) => {
        if (ch !== ' ') put(grid, top + i, p.x + j, ch, { color: p.colour })
      })
    })

    const isSelected = p.c.id === selected
    if (p.c.mood === 'awake') {
      if (!hopping) {
        put(grid, 0, p.x, SPIN[(t + ph) % SPIN.length], { color: CLAY, bold: true })
        const room = Math.max(0, laneWidth - 3)
        const label = p.c.label.length > room ? `${p.c.label.slice(0, Math.max(0, room - 1))}…` : p.c.label
        if (room > 1) put(grid, 0, p.x + 2, label, { color: isSelected ? CLAY : MUTED, bold: isSelected })
      }
    } else if (p.c.mood === 'asleep') {
      const z = Math.floor((t + ph) / 6) % 3
      if (z > 0) put(grid, z === 1 ? 1 : 0, p.x + 7 + (z - 1), z === 1 ? 'z' : 'Z', { color: MUTED })
      if (isSelected) put(grid, 0, p.x + 3, '▾', { color: CLAY, bold: true })
    } else {
      if (Math.floor((t + ph) / 4) % 2 === 0) put(grid, 0, p.x + 2, '✦', { color: STAR })
      else put(grid, 0, p.x + 6, '✦', { color: STAR })
      if (isSelected) put(grid, 0, p.x + 4, '▾', { color: CLAY, bold: true })
    }
  }

  const bottom = selected !== null && props.selected === selected ? props.detail : props.summary
  put(grid, 5, 0, bottom.length > columns ? `${bottom.slice(0, columns - 1)}…` : bottom, {
    color: selected !== null ? undefined : MUTED,
  })

  return (
    <Box flexDirection="column">
      {grid.map(line => {
        const runs: Cell[] = []
        for (const cell of line) {
          const last = runs[runs.length - 1]
          if (last !== undefined && sameStyle(last, cell)) last.ch += cell.ch
          else runs.push({ ...cell })
        }
        return (
          <Box flexDirection="row">
            {runs.map(run => (
              <Text color={run.color} bold={run.bold} wrap="truncate">
                {run.ch}
              </Text>
            ))}
          </Box>
        )
      })}
    </Box>
  )
}

export default Strip
