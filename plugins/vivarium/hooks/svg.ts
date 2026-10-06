// The desktop drawing: a pixel-art strip as one SVG. Clicking a Clawd makes it
// hop and shows its detail line, all in SMIL, since the SVG runs no script.
import type { Critter, Mood } from '../types'

const MAX_AWAKE_DRAWN = 8
const MAX_RESTING_DRAWN = 10
const DETAIL_CHARS = 100

function esc(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

function rng(seed: string): () => number {
  let h = 2166136261
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  if (h === 0) h = 1
  return () => {
    h ^= h << 13
    h ^= h >>> 17
    h ^= h << 5
    return ((h >>> 0) % 10000) / 10000
  }
}

// ---------------------------------------------------------------- pixels

const INK = '#141413'
const CREAM = '#f0eee6'
const CLAY = '#d97757'
const SKY_BLUE = '#6a9bcc'
const OLIVE = '#788c5d'
// Readable on both the light and the dark theme.
const MUTED = '#8f8b80'
// Outlines for accessories, visible on both themes.
const OUTLINE = '#6b675e'

type Palette = Record<string, string>

// Draws a sprite of one character per pixel ('.' is empty), merging runs of a
// colour into one rect. (ox, oy) is the sprite's top-left, in pixels of size p.
function sprite(rows: string[], palette: Palette, p: number, ox: number, oy: number): string {
  let out = ''
  rows.forEach((row, y) => {
    let x = 0
    while (x < row.length) {
      const ch = row[x]
      let run = 1
      while (x + run < row.length && row[x + run] === ch) run++
      const fill = palette[ch]
      if (fill !== undefined) {
        out += `<rect x="${ox + x * p}" y="${oy + y * p}" width="${run * p}" height="${p}" fill="${fill}"/>`
      }
      x += run
    }
  })
  return out
}

// Clawd, 14 wide. Arms out on row 3, eyes as 1x2 slits, four legs.
const BODY = [
  '..BBBBBBBBBB..',
  '..BBEBBBBEBB..',
  '..BBEBBBBEBB..',
  'BBBBBBBBBBBBBB',
  '..BBBBBBBBBB..',
  '..BBBBBBBBBB..',
]
const BODY_ASLEEP = [
  '..BBBBBBBBBB..',
  '..BBBBBBBBBB..',
  '..BEEBBBBEEB..',
  'BBBBBBBBBBBBBB',
  '..BBBBBBBBBB..',
  '..BBBBBBBBBB..',
]
const LEGS_A = ['...B.B..B.B...', '...B.B..B.B...']
const LEGS_B = ['..B.B....B.B..', '...B.B..B.B...']
const LEGS_TUCKED = ['..B.B....B.B..']
const SHADOW = ['..SSSSSSSSSS..']

const P = 2 // creature pixel size
const W = 14 // sprite width in pixels

type Accessory = { rows: string[]; dx: number; dy: number; palette: Palette }
type Kind = { body: string; accessory?: Accessory }

const MAGNIFIER: Accessory = {
  rows: ['..KKK.', '.KGGGK', '.KGGGK', '..KKK.', '.K....', 'K.....'],
  dx: 13,
  dy: -2,
  palette: { K: OUTLINE, G: '#d6e6f5' },
}
const CLIPBOARD: Accessory = {
  rows: ['.KK.', 'PPPP', 'PKKP', 'PPPP', 'PKKP', 'PPPP'],
  dx: -4,
  dy: 0,
  palette: { K: INK, P: CREAM },
}
const GRAD_CAP: Accessory = {
  rows: ['..KKKKKKKKKK..', '....KKKKKK.Y..', '...........Y..'],
  dx: 0,
  dy: -3,
  palette: { K: OUTLINE, Y: '#e8c468' },
}
const SPROUT: Accessory = {
  rows: ['.LL.LL', '..LL..', '...L..'],
  dx: 4,
  dy: -3,
  palette: { L: OLIVE },
}

function kindOf(kind: string): Kind {
  const k = kind.toLowerCase()
  if (k === 'explore') return { body: SKY_BLUE, accessory: MAGNIFIER }
  if (k === 'plan') return { body: OLIVE, accessory: CLIPBOARD }
  if (k === 'general-purpose' || k === 'claude') return { body: CLAY }
  if (k === 'claude-code-guide') return { body: '#c46686', accessory: GRAD_CAP }
  if (k === 'fork') return { body: CLAY, accessory: SPROUT }
  return { body: `hsl(${Math.floor(rng(kind)() * 360)} 45% 62%)` }
}

// Opus Clawds wear this, over any hat their type gives them.
const CROWN: Accessory = {
  rows: ['.Y.Y.Y.', '.YYYYY.'],
  dx: 3.5,
  dy: -2,
  palette: { Y: '#e8c468' },
}

// Size by model: Opus larger, Haiku smaller, anything else as Sonnet.
function scaleFor(c: Critter): number {
  const m = (c.model ?? '').toLowerCase()
  if (m.includes('opus')) return 1.25
  if (m.includes('haiku')) return 0.75
  return 1
}

const isOpus = (c: Critter) => (c.model ?? '').toLowerCase().includes('opus')

// One Clawd with its feet on y = 0, centred on x = 0.
function clawd(kind: Kind, mood: Mood, legs: string[], crowned = false): string {
  const grey = mood === 'flopped'
  const palette: Palette = { B: grey ? '#9c9a92' : kind.body, E: INK }
  const rows = [...(mood === 'awake' ? BODY : BODY_ASLEEP), ...legs]
  const ox = (-W * P) / 2
  const oy = -rows.length * P
  let out = sprite(rows, palette, P, ox, oy)
  const hat = crowned && !grey ? CROWN : mood === 'awake' ? kind.accessory : undefined
  const extras = [hat]
  if (crowned && mood === 'awake' && kind.accessory !== undefined && kind.accessory.dy >= 0) extras.push(kind.accessory)
  for (const a of extras) {
    if (a !== undefined) out += sprite(a.rows, a.palette, P, ox + a.dx * P, oy + a.dy * P)
  }
  return out
}

// Body-coloured pixels over the eye slits, shown for a moment every four
// seconds: a blink, each Clawd on its own beat.
function blink(body: string, beat: number): string {
  const oy = -(BODY.length + LEGS_A.length) * P
  const ox = (-W * P) / 2
  const lids = [4, 9].map(col => `<rect x="${ox + col * P}" y="${oy + P}" width="${P}" height="${2 * P}" fill="${body}"/>`).join('')
  return `<g opacity="0">${lids}<animate attributeName="opacity" values="0;1;0" keyTimes="0;0.96;0.99" calcMode="discrete" dur="4s" begin="-${(beat * 4).toFixed(2)}s" repeatCount="indefinite"/></g>`
}

function shadow(): string {
  return sprite(SHADOW, { S: 'rgba(128,124,116,.35)' }, P, (-W * P) / 2, 0)
}

// Claude's spinner glyphs, one shown at a time.
const SPIN = ['·', '✢', '✳', '✶', '✻', '✽']

function spinner(x: number, y: number, period: number): string {
  return SPIN.map((glyph, i) => {
    const values = SPIN.map((_, j) => (j === i ? 1 : 0)).join(';')
    return `<text x="${x}" y="${y}" class="spin" opacity="${i === 0 ? 1 : 0}">${glyph}<animate attributeName="opacity" values="${values}" calcMode="discrete" dur="${period}s" repeatCount="indefinite"/></text>`
  }).join('')
}

// ---------------------------------------------------------------- the strip

const STRIP_W = 640
const STRIP_H = 62
const GROUND_Y = 40 // feet line

const snap = (n: number) => Math.round(n / P) * P

function walker(c: Critter, n: number, x0: number, x1: number, maxChars: number, now: number): string {
  const r = rng(c.id)
  const kind = kindOf(c.kind)
  const scale = scaleFor(c)
  // Walk from a start point to one end, back to the other, and home again,
  // one step every `stride` seconds.
  const stepPx = 4
  const span = Math.max(stepPx * 4, x1 - x0)
  const start = snap(x0 + r() * span)
  const xs: number[] = []
  for (let x = start; x <= x0 + span; x += stepPx) xs.push(x)
  const forward = xs.length
  for (let x = x0 + span; x >= x0; x -= stepPx) xs.push(x)
  for (let x = x0; x < start; x += stepPx) xs.push(x)
  const stride = 0.22 + r() * 0.1
  const dur = xs.length * stride
  const age = (now - c.hatchedAt) / 1000
  // A negative begin resumes the walk where it was, so a redraw never makes it jump.
  const begin = (-(age % dur)).toFixed(2)
  const flipAt = (forward / xs.length).toFixed(3)
  const backAt = ((forward + Math.floor(span / stepPx) + 1) / xs.length).toFixed(3)
  const label = esc(clip(c.description, maxChars))
  // Above the head and any crown, at whatever size the model gives it.
  const labelY = -Math.round(20 * scale + 6)
  return `<g id="c${n}" class="clawd">
    <animateTransform attributeName="transform" type="translate" calcMode="discrete" values="${xs.map(x => `${x} ${GROUND_Y}`).join(';')}" dur="${dur.toFixed(2)}s" begin="${begin}s" repeatCount="indefinite"/>
    ${shadow()}
    ${HIT}
    <g>${hop(n)}<g transform="scale(${scale})">
      <g>
        <animateTransform attributeName="transform" type="scale" calcMode="discrete" values="1 1;-1 1;1 1" keyTimes="0;${flipAt};${backAt}" dur="${dur.toFixed(2)}s" begin="${begin}s" repeatCount="indefinite"/>
        <g>
          <animateTransform attributeName="transform" type="translate" calcMode="discrete" values="0 0;0 -${P}" dur="${(stride * 2).toFixed(2)}s" repeatCount="indefinite"/>
          <g>${clawd(kind, 'awake', LEGS_A, isOpus(c))}<animate attributeName="opacity" values="1;0" calcMode="discrete" dur="${(stride * 2).toFixed(2)}s" repeatCount="indefinite"/></g>
          <g opacity="0">${clawd(kind, 'awake', LEGS_B, isOpus(c))}<animate attributeName="opacity" values="0;1" calcMode="discrete" dur="${(stride * 2).toFixed(2)}s" repeatCount="indefinite"/></g>
          ${blink(kind.body, r())}
        </g>
      </g>
    </g></g>
    ${spinner(-14, labelY, 1 + r() * 0.4)}
    <text x="-3" y="${labelY}" class="label">${label}</text>
  </g>`
}

function sleeper(c: Critter, n: number, x: number): string {
  const kind = kindOf(c.kind)
  const scale = scaleFor(c)
  const h = (BODY_ASLEEP.length + LEGS_TUCKED.length) * P
  if (c.mood === 'flopped') {
    return `<g id="c${n}" class="clawd" transform="translate(${x} ${GROUND_Y})">
      ${shadow()}
      ${HIT}
      <g>${hop(n)}<g transform="scale(${scale}) translate(0 ${-h}) rotate(180)">${clawd(kind, 'flopped', LEGS_TUCKED)}</g></g>
      <text x="-8" y="${-h - 3}" class="star">✦<animate attributeName="opacity" values="1;0;1;0" calcMode="discrete" dur="1.2s" repeatCount="indefinite"/></text>
      <text x="3" y="${-h - 7}" class="star" opacity="0">✦<animate attributeName="opacity" values="0;1;0;1" calcMode="discrete" dur="1.2s" repeatCount="indefinite"/></text>
    </g>`
  }
  const offset = (rng(c.id)() * 3).toFixed(2)
  return `<g id="c${n}" class="clawd" transform="translate(${x} ${GROUND_Y})">
    ${shadow()}
    ${HIT}
    <g>${hop(n)}<g transform="scale(${scale})"><g>
      <animateTransform attributeName="transform" type="translate" values="0 0;0 -${P}" calcMode="discrete" dur="2.4s" begin="-${offset}s" repeatCount="indefinite"/>
      ${clawd(kind, 'asleep', LEGS_TUCKED, isOpus(c))}
    </g></g></g>
    <text x="10" y="-12" class="zz">z<animateTransform attributeName="transform" type="translate" values="0 0;2 -3;4 -6;6 -9" calcMode="discrete" dur="2.4s" begin="-${offset}s" repeatCount="indefinite"/><animate attributeName="opacity" values="1;1;1;0" calcMode="discrete" dur="2.4s" begin="-${offset}s" repeatCount="indefinite"/></text>
  </g>`
}

// An invisible box over a Clawd, so a click anywhere on it counts.
const HIT = `<rect x="-18" y="-30" width="36" height="34" fill="#000" fill-opacity="0"/>`

function hop(n: number): string {
  return `<animateTransform attributeName="transform" type="translate" values="0 0;0 -8;0 0;0 -3;0 0" dur=".5s" begin="c${n}.click"/>`
}

// One detail line per Clawd, hidden until it is clicked; it stays for eight
// seconds, or until another Clawd is clicked.
function detailLine(n: number, count: number, text: string): string {
  const others = Array.from({ length: count }, (_, i) => i)
    .filter(i => i !== n)
    .map(i => `c${i}.click`)
  const end = [`c${n}.click+8s`, ...others].join(';')
  return `<text x="4" y="${STRIP_H - 4}" class="detail" visibility="hidden"><set attributeName="visibility" to="visible" begin="c${n}.click" end="${end}"/>${esc(clip(text, DETAIL_CHARS))}</text>`
}

function grass(): string {
  let s = `<rect x="0" y="${GROUND_Y + 2}" width="${STRIP_W}" height="2" fill="${OLIVE}"/>`
  for (let x = 12; x < STRIP_W; x += 37) {
    s += `<rect x="${x}" y="${GROUND_Y}" width="2" height="2" fill="${OLIVE}"/><rect x="${x + 4}" y="${GROUND_Y}" width="2" height="2" fill="${OLIVE}"/>`
  }
  return s
}

export function drawStrip(list: Critter[], now: number, detailOf: (c: Critter) => string, summary: string): string {
  const awake = list.filter(c => c.mood === 'awake').slice(-MAX_AWAKE_DRAWN)
  const resting = list
    .filter(c => c.mood !== 'awake')
    .sort((a, b) => (a.doneAt ?? 0) - (b.doneAt ?? 0))
    .slice(-MAX_RESTING_DRAWN)

  // Sleepers line up on the left; walkers share the rest of the strip.
  const restingSvg = resting.map((c, i) => sleeper(c, i, 18 + i * 32)).join('')
  const yardStart = resting.length > 0 ? 18 + resting.length * 32 + 8 : 16
  const yardEnd = STRIP_W - 140
  const lane = awake.length > 0 ? (yardEnd - yardStart) / awake.length : 0
  // A label is about 5.4px a character and starts 14px left of the Clawd's
  // centre; keep it inside the walker's lane.
  const maxChars = Math.max(4, Math.min(16, Math.floor((lane - 40) / 5.4)))
  const awakeSvg = awake
    .map((c, i) => walker(c, resting.length + i, yardStart + i * lane, yardStart + i * lane + Math.max(16, lane - 30 - maxChars * 5.4), maxChars, now))
    .join('')

  const shown = [...resting, ...awake]
  const details = shown.map((c, i) => detailLine(i, shown.length, detailOf(c))).join('')

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${STRIP_W} ${STRIP_H}" width="${STRIP_W}" height="${STRIP_H}" shape-rendering="crispEdges" font-family="ui-monospace, 'Cascadia Mono', Consolas, monospace">
  <style>
    /* Matching the page's colour scheme keeps the sandboxed frame see-through
       instead of giving it an opaque white backdrop on the dark theme. */
    :root { color-scheme: light dark; background: transparent; }
    .summary { font-size: 10px; fill: ${MUTED}; }
    .label { font-size: 9px; fill: ${MUTED}; }
    .zz { font-size: 8px; fill: ${MUTED}; font-weight: 700; }
    .spin { font-size: 10px; fill: ${CLAY}; font-weight: 700; }
    .star { font-size: 7px; fill: #e8c468; }
    .detail { font-size: 10px; fill: ${MUTED}; }
    .clawd { cursor: pointer; }
    .clawd:hover { opacity: .8; }
  </style>
  <text x="${STRIP_W - 4}" y="12" text-anchor="end" class="summary">${esc(summary)}</text>
  ${grass()}
  ${restingSvg}
  ${awakeSvg}
  ${details}
</svg>`
}

