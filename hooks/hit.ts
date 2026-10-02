import type { ClientModule, ClientPointerEvent } from 'claude-code'

/** Where the picture sits in the viewer's frame, in cells. */
export type Spot = { left: number; top: number; columns: number; rows: number }

/** What a hit layer knows of the pictures under it. */
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
  | { role: 'view'; ids: string[]; at: number; picture: Spot }

/** The hover menu a thumbnail's label row shows; the hooks module draws it. */
export const MENU_IMAGE = ' ⧉ image '
export const MENU_PATH = ' ⎘ path '

/**
 * The slot under the pointer, how long it has rested there, whether its menu
 * shows, and the props of the last drawing. Changed in place, never through
 * setState: a redraw of the layer would wipe the pictures under it.
 */
type Look = { slot: number; ticks: number; isMenu: boolean; hit: Hit }

const HOLD = 5 // ticks of 100 ms the pointer rests on a thumbnail before its menu shows

// A clear layer over the pictures. It never draws: it tells the hooks module
// what a click hit and which thumbnail the pointer rests on, and passes the
// keys on while a click has given it the focus.
const HitLayer: ClientModule<Hit, Look> = (hit, surface) => {
  const { Box } = surface.elements
  if (surface.state === undefined) {
    const look: Look = { slot: -1, ticks: 0, isMenu: false, hit }
    surface.setState(look)
    surface.every(100, () => {
      const now = look.hit
      if (now.role !== 'strip' || look.slot < 0 || look.isMenu) {
        return
      }
      look.ticks += 1
      if (look.ticks >= HOLD) {
        look.isMenu = true
        surface.post({ ids: now.ids, hover: now.first + look.slot })
      }
    })
  } else {
    surface.state.hit = hit
  }
  surface.onKey(event => surface.post({ ids: hit.ids, key: event.key }))

  if (hit.role === 'view') {
    // On the picture, its left half goes back and its right half on; beside
    // the picture, a click puts the viewer away.
    surface.onPointer(event => {
      const spot = hit.picture
      if (event.type !== 'up') {
        return
      }
      const isOn =
        event.x >= spot.left && event.x < spot.left + spot.columns && event.y >= spot.top && event.y < spot.top + spot.rows
      surface.post(
        isOn ? { ids: hit.ids, step: event.x < spot.left + spot.columns / 2 ? -1 : 1 } : { ids: hit.ids, shut: true },
      )
    })
    return Box({})
  }

  const slotAt = (event: ClientPointerEvent) => {
    const slot = Math.floor(event.x / hit.cell)
    const isOnSlot =
      event.x >= 0 && event.y >= 0 && event.y < hit.rows && slot < hit.count && event.x % hit.cell < hit.cell - 1
    return isOnSlot ? slot : -1
  }
  surface.onPointer(event => {
    const look = surface.state
    if (look === undefined) {
      return
    }
    const slot = event.type === 'leave' ? -1 : slotAt(event)
    if (event.type !== 'up') {
      if (slot !== look.slot) {
        if (look.isMenu) {
          surface.post({ ids: hit.ids, hover: -1 })
        }
        Object.assign(look, { slot, ticks: 0, isMenu: false })
      }
      return
    }
    if (slot < 0) {
      // `+N ▶` turns the page; anywhere else in the strip folds the darkroom.
      const isMore = hit.more > 0 && event.x >= hit.count * hit.cell && event.x < hit.count * hit.cell + `+${hit.more} ▶`.length
      if (isMore) {
        surface.post({ ids: hit.ids, pick: hit.next })
      } else if (event.y >= 0 && event.y < hit.rows) {
        surface.post({ ids: hit.ids, fold: true })
      }
      return
    }
    const offset = event.x - slot * hit.cell
    const isMenu =
      look.slot === slot && look.isMenu && event.y === hit.rows - 1 && offset < MENU_IMAGE.length + MENU_PATH.length
    surface.post(
      isMenu
        ? { ids: hit.ids, pick: hit.first + slot, copy: offset < MENU_IMAGE.length ? 'image' : 'path' }
        : { ids: hit.ids, pick: hit.first + slot },
    )
  })

  return Box({})
}

export default HitLayer
