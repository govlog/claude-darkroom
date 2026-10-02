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

/** The thumbnail slot under the pointer, and how many ticks it has rested there. */
type Look = { slot: number; ticks: number }

const HOLD = 5 // ticks of 100 ms the pointer rests on a thumbnail before its menu shows
const COPY_IMAGE = ' ⧉ image '
const COPY_PATH = ' ⎘ path '
const LIT = '#2b2b2b'
const AMBER = '#f5a623'

// A clear layer over the pictures: it tells the hooks module what a click
// hit, offers the copy actions on a thumbnail the pointer rests on, and
// passes the keys on while a click has given it the focus.
const HitLayer: ClientModule<Hit, Look> = (hit, surface) => {
  const { Box, Text } = surface.elements
  if (surface.state === undefined) {
    surface.setState({ slot: -1, ticks: 0 })
    surface.every(100, () => {
      const look = surface.state
      if (look !== undefined && look.slot >= 0 && look.ticks < HOLD) {
        surface.setState({ ...look, ticks: look.ticks + 1 })
      }
    })
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
    const slot = event.type === 'leave' ? -1 : slotAt(event)
    const look = surface.state ?? { slot: -1, ticks: 0 }
    if (event.type !== 'up') {
      if (slot !== look.slot) {
        surface.setState({ slot, ticks: 0 })
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
      look.slot === slot && look.ticks >= HOLD && event.y === hit.rows - 1 && offset < COPY_IMAGE.length + COPY_PATH.length
    surface.post(
      isMenu
        ? { ids: hit.ids, pick: hit.first + slot, copy: offset < COPY_IMAGE.length ? 'image' : 'path' }
        : { ids: hit.ids, pick: hit.first + slot },
    )
  })

  const look = surface.state ?? { slot: -1, ticks: 0 }
  if (look.slot < 0) {
    return Box({})
  }
  // The label row of the thumbnail under the pointer: lit at once, then the
  // copy actions once the pointer has rested there.
  const width = hit.cell - 1
  const row =
    look.ticks >= HOLD
      ? [
          Text({ backgroundColor: LIT, color: AMBER, children: COPY_IMAGE }),
          Text({ backgroundColor: LIT, children: COPY_PATH.padEnd(width - COPY_IMAGE.length) }),
        ]
      : [Text({ backgroundColor: LIT, children: (hit.labels[look.slot] ?? '').slice(0, width).padEnd(width) })]
  return Box({
    flexDirection: 'column',
    children: [Box({ height: hit.rows - 1 }), Box({ marginLeft: look.slot * hit.cell, children: row })],
  })
}

export default HitLayer
