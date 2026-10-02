import type { ClientModule, ClientPointerEvent, JsonValue } from 'claude-code'

/** Where the picture sits in the viewer's hit layer, in cells. */
export type Spot = { left: number; top: number; columns: number; rows: number }

/** An entry of the viewer's toolbar; the keys stand for the same acts. */
export type Tool = 'back' | 'forth' | 'image' | 'path' | 'open' | 'shut'

/** Where a toolbar entry sits in the top row of the viewer's hit layer. */
export type ToolSpot = { tool: Tool; left: number; width: number }

/** What a hit layer knows of what is drawn under it. */
export type Hit =
  | {
      role: 'strip'
      ids: string[]
      first: number
      cell: number
      rows: number
      count: number
      labels: string[]
      // The thumbnails off this page, and the first one of the next page.
      more: number
      next: number
    }
  | { role: 'view'; ids: string[]; at: number; picture: Spot; tools: ToolSpot[] }

type StripHit = Extract<Hit, { role: 'strip' }>
type ViewHit = Extract<Hit, { role: 'view' }>

/** The hover menu a thumbnail's label row shows; the hooks module draws it. */
export const MENU_IMAGE = ' ⧉ image '
export const MENU_PATH = ' ⎘ path '

/** A hover menu's entry, or none. */
export type Item = 'image' | 'path' | ''

/**
 * What the layer keeps between events: the thumbnail slot under the pointer,
 * how long it has rested there, whether its menu shows and the entry the
 * pointer is on; the toolbar entry under the pointer, the one last posted as
 * lit (null: post it again) and the ticks to wait before that post; what the
 * button went down on; where the pointer last was; the props of the last
 * drawing. Changed in place, never through setState: a redraw of the layer
 * would wipe the pictures under it.
 */
type Look = {
  slot: number
  ticks: number
  isMenu: boolean
  item: Item
  tool: Tool | ''
  lit: Tool | '' | null
  quiet: number
  press: { click: JsonValue | undefined } | undefined
  x: number
  y: number
  hit: Hit
}

const HOLD = 5 // ticks of 100 ms the pointer rests on a thumbnail before its menu shows
// Ticks after a click before the toolbar's next hover post: a post replaces
// one not yet delivered in its frame, and the first tick can fall in the
// click's own frame.
const QUIET = 2

// The thumbnail slot under the pointer, or -1 between and past them.
const slotAt = (hit: StripHit, x: number, y: number) => {
  const slot = Math.floor(x / hit.cell)
  const isOnSlot = x >= 0 && y >= 0 && y < hit.rows && slot < hit.count && x % hit.cell < hit.cell - 1
  return isOnSlot ? slot : -1
}

// The menu entry under the pointer in a thumbnail's label row.
const itemAt = (hit: StripHit, x: number, y: number, slot: number): Item => {
  const offset = x - slot * hit.cell
  if (y !== hit.rows - 1 || offset < 0) {
    return ''
  }
  return offset < MENU_IMAGE.length ? 'image' : offset < MENU_IMAGE.length + MENU_PATH.length ? 'path' : ''
}

// The toolbar entry under the pointer: the top row of the viewer's layer.
const toolAt = (hit: ViewHit, x: number, y: number): Tool | '' =>
  y === 0 ? (hit.tools.find(one => x >= one.left && x < one.left + one.width)?.tool ?? '') : ''

// What a click in the strip asks for: a thumbnail opens in the viewer, or
// copies from its menu; `+N ▶` turns the page; anywhere else folds the darkroom.
const stripClick = (look: Look, hit: StripHit, x: number, y: number): JsonValue | undefined => {
  const slot = slotAt(hit, x, y)
  if (slot >= 0) {
    const item = look.slot === slot && look.isMenu ? itemAt(hit, x, y, slot) : ''
    return item === '' ? { ids: hit.ids, pick: hit.first + slot } : { ids: hit.ids, pick: hit.first + slot, copy: item }
  }
  const moreWidth = String(hit.more).length + 3 // "+", the count, " ▶"
  if (hit.more > 0 && x >= hit.count * hit.cell && x < hit.count * hit.cell + moreWidth) {
    return { ids: hit.ids, pick: hit.next }
  }
  return y >= 0 && y < hit.rows ? { ids: hit.ids, fold: true } : undefined
}

// What a click in the viewer asks for: a toolbar entry, its act; on the
// picture, its left half the one before and its right half the next; beside
// the picture, the viewer put away.
const viewClick = (hit: ViewHit, x: number, y: number): JsonValue | undefined => {
  const spot = hit.picture
  const isOn = x >= spot.left && x < spot.left + spot.columns && y >= spot.top && y < spot.top + spot.rows
  const tool = y === 0 ? toolAt(hit, x, y) : isOn ? (x < spot.left + spot.columns / 2 ? 'back' : 'forth') : 'shut'
  return tool === '' ? undefined : { ids: hit.ids, tool }
}

// A clear layer over the pictures and the viewer's toolbar. It never draws:
// it tells the hooks module what a click asks for and what the pointer rests
// on, and passes the keys on while a click has given it the focus. A press
// over it never reaches the transcript, so no click selects text.
const HitLayer: ClientModule<Hit, Look> = (hit, surface) => {
  const { Box } = surface.elements
  // The toolbar entry under the pointer lights up, once no click is on its way.
  const light = (look: Look) => {
    if (look.quiet === 0 && look.tool !== look.lit) {
      look.lit = look.tool
      surface.post({ ids: look.hit.ids, lit: look.tool })
    }
  }
  if (surface.state === undefined) {
    const look: Look = {
      slot: -1,
      ticks: 0,
      isMenu: false,
      item: '',
      tool: '',
      lit: '',
      quiet: 0,
      press: undefined,
      x: -1,
      y: -1,
      hit,
    }
    surface.setState(look)
    surface.every(100, () => {
      const now = look.hit
      if (now.role === 'view') {
        look.quiet = Math.max(0, look.quiet - 1)
        light(look)
        return
      }
      if (look.slot < 0 || look.isMenu) {
        return
      }
      look.ticks += 1
      if (look.ticks >= HOLD) {
        look.isMenu = true
        look.item = itemAt(now, look.x, look.y, look.slot)
        surface.post({ ids: now.ids, hover: now.first + look.slot, item: look.item })
      }
    })
  } else {
    surface.state.hit = hit
  }
  surface.onKey(event => surface.post({ ids: hit.ids, key: event.key }))

  const clickAt = (look: Look, x: number, y: number) =>
    hit.role === 'view' ? viewClick(hit, x, y) : stripClick(look, hit, x, y)

  // What the pointer rests on: a toolbar entry to light, a thumbnail whose menu may show.
  const hover = (look: Look, event: ClientPointerEvent) => {
    if (hit.role === 'view') {
      look.tool = event.type === 'leave' ? '' : toolAt(hit, event.x, event.y)
      light(look)
      return
    }
    const slot = event.type === 'leave' ? -1 : slotAt(hit, event.x, event.y)
    Object.assign(look, { x: event.x, y: event.y })
    if (slot !== look.slot) {
      if (look.isMenu) {
        surface.post({ ids: hit.ids, hover: -1, item: '' })
      }
      Object.assign(look, { slot, ticks: 0, isMenu: false, item: '' })
    } else if (look.isMenu) {
      // The entry under the pointer lights up.
      const item = itemAt(hit, event.x, event.y, slot)
      if (item !== look.item) {
        look.item = item
        surface.post({ ids: hit.ids, hover: hit.first + slot, item })
      }
    }
  }

  surface.onPointer(event => {
    const look = surface.state
    if (look === undefined) {
      return
    }
    if (event.type !== 'up') {
      hover(look, event)
      if (event.type === 'down') {
        look.press = { click: clickAt(look, event.x, event.y) }
      }
      return
    }
    // A click asks for what the button went down on: one that slips still lands.
    const click = look.press === undefined ? clickAt(look, event.x, event.y) : look.press.click
    look.press = undefined
    if (click !== undefined) {
      surface.post(click)
      look.quiet = QUIET
      look.lit = null
    }
  })

  return Box({})
}

export default HitLayer
