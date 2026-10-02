import { atom, memberOf, read, update } from 'claude-code'
import type { ElementTable, Register, RenderSurface } from 'claude-code'

import type { DarkroomSettings, Print, Verb } from '../types'
import { fit, gridSize, imagePaths, paint, parsePpm } from './develop'
import type { Cells, Grid } from './develop'
import { MENU_IMAGE, MENU_PATH } from './hit'
import type { Hit, Item } from './hit'
import { decodePng, pngHeader } from './png'

// The roll. ponytail: each print keeps a small pixel grid in session state;
// 64 prints stay near half a megabyte. Move the grids to the cache if it grows.
const ROLL = 64
const SIDE = 64 // long side of the pixel grid the develop and the cell fallback paint from
const MAX_BYTES = 64 * 1024 * 1024
const MAX_READ = 4 * 1024 * 1024 // what one $.fs.read may hold: a bigger PNG goes to ImageMagick
const PAPER = 0x141414 // what a transparent pixel is laid over
const MAX_PIXELS = 64_000_000 // a bigger picture is not decoded: seconds and gigabytes for a preview
const PASTE_TRIES = 8 // the engine may write a pasted image a moment after its marker lands

// The develop: about one second under the safelight.
const FRAMES = 18
const FRAME_MS = 55

// The layout, in terminal cells.
const THUMB: Cells = { columns: 18, rows: 5 }
const CELL = THUMB.columns + 1 // a thumbnail and the gap after it
const PASTE_ROWS = 6
const PANEL_MIN = 48 // room for the viewer's toolbar
// ponytail: the plugin cannot read the cell's pixel size; it takes a common
// 13 px cell. A picture shows at most 1.4x its size, a small one up to 3x and
// 240 px, so an icon does not float alone in the viewer.
const CELL_PX = 13
const viewColumns = (px: number) => Math.ceil(Math.max(px * 1.4, Math.min(px * 3, 240)) / CELL_PX)
const pasteColumns = (px: number) => Math.min(4 * PASTE_ROWS, Math.ceil(px / 6))

const AMBER = '#f5a623'
const PANEL = '#161616'
const LIT = '#2b2b2b'
const INK = '#141414'
// A button under the pointer: amber, as a lit menu entry.
const LIT_BUTTON = { backgroundColor: AMBER, color: INK }
const HINT = 'click a half to browse · beside to close'

const BACK = ['left', 'h', 'up', 'k']
const FORTH = ['right', 'l', 'down', 'j', 'tab', ' ']
const SHUT = ['x', 'q', 'backspace']

const PLACEHOLDER = /\[Image #(\d+)\]/g
const ROLL_LINE = /^(?:darkroom: )*\d+ prints? on the roll\.$/
// The ImageMagick decoder each extension gets, named in front of the path: it
// never guesses a format from a file's bytes. PNG has its own decoder here.
const CODERS: Record<string, string> = {
  png: 'PNG',
  jpg: 'JPEG',
  jpeg: 'JPEG',
  gif: 'GIF',
  webp: 'WEBP',
  avif: 'AVIF',
  svg: 'MSVG',
  bmp: 'BMP',
  tif: 'TIFF',
  tiff: 'TIFF',
}
// Tool arguments that hold file contents, not paths the call worked on.
const SKIP = new Set(['tool', 'tool_use_id', 'agentId', 'content', 'old_string', 'new_string'])

// Puts a PNG on the clipboard. macOS: osascript, run directly. Linux: wl-copy
// reads the picture on its standard input, hence this fixed script, the path
// its argument and never part of it; wl-copy and xclip fork to serve the
// clipboard, so their output goes to /dev/null and no pipe of ours stays open.
const MAC_CLIPBOARD = [
  'osascript',
  ...['-e', 'on run argv'],
  ...['-e', 'set the clipboard to (read (POSIX file (item 1 of argv)) as «class PNGf»)'],
  ...['-e', 'end run'],
]
const LINUX_CLIPBOARD = [
  '{ if [ -n "$WAYLAND_DISPLAY" ] && command -v wl-copy; then wl-copy --type image/png <"$1";',
  'elif command -v xclip; then xclip -selection clipboard -t image/png -i "$1";',
  'else exit 3; fi; } >/dev/null 2>&1',
].join(' ')

// The settings `/darkroom set <name> <value>` changes, kept across sessions.
const DEFAULTS: DarkroomSettings = { opener: 'auto', develop: true, autoShow: false }
const SETTINGS: Record<string, { field: keyof DarkroomSettings; help: string }> = {
  opener: { field: 'opener', help: 'what opens an image, the path added last; auto: open on macOS, xdg-open elsewhere' },
  develop: { field: 'develop', help: 'play the safelight develop the first time a strip unrolls' },
  'auto-show': { field: 'autoShow', help: 'unroll the strip under a row without a click' },
}
const SWITCH: Record<string, boolean> = { on: true, off: false, true: true, false: false, yes: true, no: false }
const USAGE = 'usage: /darkroom, /darkroom settings, /darkroom set <opener|develop|auto-show> <value>'

const prints = atom({ plugin: 'darkroom', key: 'prints' } as const, [])
const settings = atom({ plugin: 'darkroom', key: 'settings' } as const, DEFAULTS)
const shots = atom({ plugin: 'darkroom', key: 'shots' } as const, [])
const isUnrolled = atom({ plugin: 'darkroom', key: 'isUnrolled' } as const, null)
const viewing = atom({ plugin: 'darkroom', key: 'viewing' } as const, -1)
const isDeveloped = atom({ plugin: 'darkroom', key: 'isDeveloped' } as const, false)
const hovered = atom({ plugin: 'darkroom', key: 'hovered' } as const, { at: -1, item: '' })
const pasted = atom({ plugin: 'darkroom', key: 'pasted' } as const, [])
const NO_HOVER = { at: -1, item: '' as Item }

/** An image to develop: a path a tool call named, or a pasted image by its number. */
type Job = { verb: Verb; tool: string; since: number; useId?: string; tries: number } & (
  | { path: string }
  | { paste: number }
)
type ImageMagick = { convert: string[]; identify: string[] }
/** What a hit layer posts: a pick, a copy from the hover menu, a hover, a step, a key. */
type Post = {
  ids: string[]
  pick?: number
  copy?: 'image' | 'path'
  hover?: number
  item?: Item
  step?: number
  shut?: boolean
  fold?: boolean
  key?: string
}
// The drawing helpers' elements; the render hook draws the hit layers itself.
type Elements = ElementTable<'terminal'>
/** One transcript row's darkroom, as its drawing needs it. */
type RowView = {
  requestId: string
  strip: Print[]
  at: number
  hovered: { at: number; item: string }
  width: number
  screenRows: number
  hasDeveloped: boolean
}

const name = (path: string) => path.slice(path.lastIndexOf('/') + 1)
const humanSize = (bytes: number) =>
  bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`
const gridOf = (print: Print): Grid => ({
  width: print.gridWidth,
  height: print.gridHeight,
  rgb: Uint8Array.fromBase64(print.grid),
})
const pastedAs = (print: Print, session: string, n: string) =>
  print.verb === 'pasted' && print.path.endsWith(`/${session}/images/${n}.png`)
// What a print is called: a pasted one by its marker, the rest by file name.
const label = (print: Print) =>
  print.verb === 'pasted' ? `[Image #${name(print.path).replace(/\.png$/, '')}]` : name(print.path)
const shownSetting = (value: string | boolean) => (typeof value === 'boolean' ? (value ? 'on' : 'off') : value)
// ponytail: a set opener is split on spaces; quote-aware parsing if a viewer
// path ever holds one.
const openerArgv = (opener: string, isMac: boolean) =>
  opener === 'auto' ? [isMac ? 'open' : 'xdg-open'] : opener.split(/\s+/)

const digest = async (text: string) => {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))
  return [...hash.slice(0, 8)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

// Where a strip puts its thumbnails: a page at a time, so they stay put while
// browsing, and the hit layer that knows that layout.
const stripLayout = (row: RowView) => {
  const fits = Math.max(1, Math.floor((row.width + 1) / CELL))
  const first = Math.floor(Math.max(0, row.at) / fits) * fits
  const visible = row.strip.slice(first, first + fits)
  const hit: Hit = {
    role: 'strip',
    ids: row.strip.map(one => one.id),
    first,
    cell: CELL,
    rows: THUMB.rows + 1,
    count: visible.length,
    labels: visible.map(label),
    more: row.strip.length - visible.length,
    next: first + fits < row.strip.length ? first + fits : 0,
  }
  return { first, visible, hit }
}

// Where the viewer puts the picture on show: in a dark panel of one size per
// row, sized by the screen and the row's widest picture, never by the one on
// show, so browsing moves nothing under the pointer.
const viewerLayout = (row: RowView, current: Print) => {
  const frameRows = Math.max(8, Math.min(26, Math.round(row.screenRows * 0.45)))
  const viewBox = (print: Print) =>
    fit(print.width, print.height, Math.min(row.width - 4, viewColumns(print.width)), frameRows)
  const panel = Math.min(row.width, Math.max(PANEL_MIN, ...row.strip.map(one => viewBox(one).columns + 4)))
  const box = viewBox(current)
  const hit: Hit = {
    role: 'view',
    ids: row.strip.map(one => one.id),
    at: row.at,
    picture: {
      left: Math.floor((panel - box.columns) / 2),
      top: Math.floor((frameRows - box.rows) / 2),
      columns: box.columns,
      rows: box.rows,
    },
  }
  return { frameRows, panel, box, hit }
}

export const register: Register = on => {
  // What session.start finds out about the machine.
  let isKitty = false
  let isMac = false
  let cwd = ''
  let home = ''

  // Set by session.start on the session's own `$`: the work runs off the event
  // that asks for it, so no tool call, edit or press waits on it.
  const queue: Job[] = []
  let wake = () => {}
  let developRow = (_requestId: string, _ids: string[]) => {}
  let act = {
    copyImage: async (_print: Print) => {},
    copyPath: async (_print: Print, _surface: RenderSurface) => {},
    open: async (_print: Print) => {},
  }

  // Develop Rasters as last drawn, by `<requestId>/<print id>`: the size each blit keeps.
  const mounted = new Map<string, Cells>()
  // The rows whose develop has started, so a redraw does not start it twice.
  const started = new Set<string>()
  // The rows whose viewer is open: one at a time, and none once you move on.
  const openViews = new Set<string>()

  const shown = (path: string) =>
    cwd !== '' && path.startsWith(`${cwd}/`)
      ? path.slice(cwd.length + 1)
      : home !== '' && path.startsWith(`${home}/`)
        ? `~${path.slice(home.length)}`
        : path
  const where = (print: Print) => (print.verb === 'pasted' ? `${label(print)} (pasted)` : shown(print.path))

  // The drawing helpers take the surface's elements, never `$`.

  // A picture as the terminal draws it: real pixels in kitty and Ghostty,
  // half-block cells elsewhere.
  const picture = (els: Elements, print: Print, box: Cells, key: string) =>
    isKitty ? (
      <els.Image
        key={key}
        source={{ file: print.png, format: 'png', generation: Math.round(print.mtimeMs) }}
        columns={box.columns}
        rows={box.rows}
        alt={label(print)}
      />
    ) : (
      <els.Raster key={key} columns={box.columns} rows={box.rows} cells={paint(gridOf(print), box, 1)} />
    )

  // A hover menu's entry: amber while the pointer is on it.
  const menuEntry = (els: Elements, text: string, isLit: boolean) => (
    <els.Text backgroundColor={isLit ? AMBER : LIT} color={isLit ? INK : undefined}>
      {text}
    </els.Text>
  )

  // A toolbar button, in a keyed Box so it lights up alone under the pointer.
  const toolButton = (els: Elements, key: string, label: string, onPress: (press: { surface: RenderSurface }) => unknown) => (
    <els.Box key={`tool-${key}`}>
      <els.Button key={key} label={label} plain hover={LIT_BUTTON} onPress={onPress} />
    </els.Box>
  )

  // The thumbnails side by side; the render hook lays the hit layer over them.
  const drawStrip = (els: Elements, row: RowView, layout: ReturnType<typeof stripLayout>) => {
    const { Box, Raster, Text } = els
    const { first, visible, hit } = layout
    return (
      <Box gap={1}>
        {visible.map((print, i) => {
          const box = fit(print.width, print.height, THUMB.columns, THUMB.rows)
          const isCurrent = first + i === row.at
          if (!row.hasDeveloped) {
            mounted.set(`${row.requestId}/${print.id}`, box)
          }
          return (
            <Box key={`frame-${print.id}`} flexDirection="column" width={THUMB.columns}>
              <Box height={THUMB.rows} width={THUMB.columns} alignItems="center" justifyContent="center">
                {row.hasDeveloped ? (
                  picture(els, print, box, `thumb-${print.id}`)
                ) : (
                  <Raster key={`dev-${print.id}`} columns={box.columns} rows={box.rows} cells={paint(gridOf(print), box, 0)} />
                )}
              </Box>
              {first + i === row.hovered.at ? (
                <Box>
                  {menuEntry(els, MENU_IMAGE, row.hovered.item === 'image')}
                  {menuEntry(els, MENU_PATH, row.hovered.item === 'path')}
                </Box>
              ) : (
                <Text color={isCurrent ? AMBER : undefined} dimColor={!isCurrent} wrap="truncate-middle">
                  {label(print)}
                </Text>
              )}
            </Box>
          )
        })}
        {hit.role === 'strip' && hit.more > 0 && <Text dimColor>+{hit.more} ▶</Text>}
      </Box>
    )
  }

  // The picture on show with its toolbar and its caption: the content of the
  // dark panel the render hook places, its hit layer over the picture.
  const drawViewer = (
    els: Elements,
    row: RowView,
    current: Print,
    layout: ReturnType<typeof viewerLayout>,
    acts: { step: (by: number) => unknown; shut: () => unknown },
  ) => {
    const { Box, Text } = els
    const { frameRows, panel, box } = layout
    const count = row.strip.length
    const title = where(current)
    const meta = `${current.width}×${current.height} · ${current.format} · ${humanSize(current.bytes)}`
    const hasHint = title.length + meta.length + HINT.length + 5 <= panel
    return (
      <Box flexDirection="column" width={panel}>
        <Box width={panel} justifyContent="space-between" paddingX={1}>
          <Box>
            {toolButton(els, 'prev', ' ◀ ', () => acts.step(-1))}
            <Text>{` ${String(row.at + 1).padStart(String(count).length)}/${count} `}</Text>
            {toolButton(els, 'next', ' ▶ ', () => acts.step(1))}
          </Box>
          <Box gap={1}>
            {toolButton(els, 'copy-image', ' ⧉ image ', () => act.copyImage(current))}
            {toolButton(els, 'copy-path', ' ⎘ path ', press => act.copyPath(current, press.surface))}
            {toolButton(els, 'open', ' ↗ open ', () => act.open(current))}
            {toolButton(els, 'shut', ' ✕ ', acts.shut)}
          </Box>
        </Box>
        <Box key="frame" width={panel} height={frameRows} justifyContent="center" alignItems="center">
          {picture(els, current, box, 'view')}
        </Box>
        <Box width={panel} paddingX={1} justifyContent="space-between">
          <Box gap={1} flexShrink={1}>
            <Text bold wrap="truncate-middle">
              {title}
            </Text>
            <Text dimColor wrap="truncate">
              {meta}
            </Text>
          </Box>
          {hasHint && <Text dimColor>{HINT}</Text>}
        </Box>
      </Box>
    )
  }

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'darkroom',
      description: 'Show the roll of images Claude worked on. Also: settings, set <name> <value>',
    })
    const saved = await $.store.get('settings')
    if (saved !== undefined && typeof saved === 'object') {
      await update($, settings, () => ({ ...DEFAULTS, ...(saved as Partial<DarkroomSettings>) }))
    }
    const term = `${(await $.env.get('TERM')) ?? ''} ${(await $.env.get('TERM_PROGRAM')) ?? ''}`
    const isKittyTerm =
      /kitty|ghostty/i.test(term) ||
      (await $.env.get('KITTY_WINDOW_ID')) !== undefined ||
      (await $.env.get('GHOSTTY_RESOURCES_DIR')) !== undefined
    // The terminal reads the picture from this machine's disk: not through
    // tmux, not from the far end of ssh. There the rows paint half-block cells.
    isKitty =
      isKittyTerm && (await $.env.get('TMUX')) === undefined && (await $.env.get('SSH_CONNECTION')) === undefined
    // macOS, told by a file only macOS has: no program to run for it.
    isMac = await $.fs.exists('/System/Library/CoreServices/SystemVersion.plist').catch(() => false)
    home = (await $.env.get('HOME')) ?? ''
    cwd = e.cwd
    const tmp = ((await $.env.get('TMPDIR')) ?? '/tmp').replace(/\/+$/, '') || '/tmp'
    const uid = (await $.process.run(['id', '-u']).catch(() => undefined))?.stdout.trim() ?? ''
    // Claude Code's own temporary folder, readable by this user alone: where
    // ImageMagick leaves the PNG copy of another format.
    const scratch = `${tmp}/claude-${uid}`
    // The ImageMagick policy this plugin ships, in magick/policy.xml.
    const policy = `${$.plugin.root}/magick`
    const hasMagick7 = (await $.process.run(['magick', '-version']).catch(() => undefined))?.exitCode === 0
    const hasMagick6 =
      !hasMagick7 && (await $.process.run(['convert', '-version']).catch(() => undefined))?.exitCode === 0
    const magick: ImageMagick | undefined = hasMagick7
      ? { convert: ['magick'], identify: ['magick', 'identify'] }
      : hasMagick6
        ? { convert: ['convert'], identify: ['identify'] }
        : undefined
    let hasWarned = false
    let isBusy = false
    let pasteFolder = { session: '', path: '' }

    // ponytail: the engine keeps pasted images as <tmp>/claude-<uid>/<project>/
    // <session>/images/<n>.png, which no API names; follow it if it moves.
    const pastedFile = async (n: number) => {
      const session = await $.session.id()
      if (pasteFolder.session !== session) {
        const base = `${tmp}/claude-${uid}`
        for (const entry of await $.fs.list(base).catch(() => [])) {
          const folder = `${base}/${entry.name}/${session}/images`
          if (entry.kind === 'dir' && (await $.fs.exists(folder))) {
            pasteFolder = { session, path: folder }
            break
          }
        }
      }
      const file = `${pasteFolder.path}/${n}.png`
      return pasteFolder.session === session && (await $.fs.exists(file)) ? file : undefined
    }

    const locate = async (job: Job) => {
      if ('path' in job) {
        return job.path.startsWith('~/') && home !== '' ? `${home}${job.path.slice(1)}` : job.path
      }
      const file = await pastedFile(job.paste)
      if (file === undefined && job.tries < PASTE_TRIES) {
        $.clock.after(250, () => {
          queue.push({ ...job, tries: job.tries + 1 })
          wake()
        })
      }
      return file
    }

    // The print for a job: the one on the roll when the file has not changed,
    // else a fresh one, or undefined for anything that is not a usable image.
    const develop = async (job: Job): Promise<Print | undefined> => {
      const path = await locate(job)
      const stat = path === undefined ? undefined : await $.fs.stat(path, { resolve: true }).catch(() => undefined)
      // Always absolute, so ImageMagick never reads it as a coder prefix or a pipe.
      const real = stat?.realPath
      if (stat === undefined || real === undefined || stat.kind !== 'file' || stat.size === 0 || stat.size > MAX_BYTES) {
        return undefined
      }
      // A path a call only named (an `ls`, a grep hit) is not an image it worked on.
      if (job.verb !== 'read' && job.verb !== 'pasted' && stat.mtimeMs < job.since - 2000) {
        return undefined
      }
      const known = (await read($, prints)).find(print => print.path === real && print.mtimeMs === stat.mtimeMs)
      if (known !== undefined) {
        return known
      }
      const extension = real.slice(real.lastIndexOf('.') + 1).toLowerCase()
      const coder = CODERS[extension]
      if (coder === undefined) {
        return undefined
      }
      const id = await digest(`${real}:${stat.mtimeMs}`)
      const print = {
        id,
        path: real,
        verb: job.verb,
        tool: job.tool,
        bytes: stat.size,
        mtimeMs: stat.mtimeMs,
        at: await $.clock.now(),
      }

      // A PNG needs no program: it is decoded here, in the mod's sandbox, and
      // the terminal draws it straight from its file.
      if (extension === 'png' && stat.size <= MAX_READ) {
        const file = await $.fs.read(real, { as: 'bytes' })
        const bytes = Uint8Array.fromBase64(file.base64)
        const { width, height } = pngHeader(bytes)
        const grid = decodePng(bytes, SIDE, MAX_PIXELS, PAPER)
        return { ...print, png: real, width, height, format: 'PNG', grid: grid.rgb.toBase64(), gridWidth: grid.width, gridHeight: grid.height }
      }

      // Any other format goes to ImageMagick, when it is installed, under the
      // plugin's own policy: these formats only, no delegate, no network.
      if (magick === undefined) {
        if (!hasWarned) {
          hasWarned = true
          $.ui.toast(`◐ darkroom: install ImageMagick to see ${extension.toUpperCase()} images`)
        }
        return undefined
      }
      const run = (argv: string[]) => $.process.run(argv, { env: { MAGICK_CONFIGURE_PATH: policy } })
      const source = `${coder}:${real}[0]`
      const shape = await run([...magick.identify, '-format', '%w %h %m', source])
      const [wide, high, format = '?'] = shape.stdout.trim().split(/\s+/)
      const width = Number(wide)
      const height = Number(high)
      if (shape.exitCode !== 0 || !(width > 0 && height > 0) || width * height > MAX_PIXELS) {
        return undefined
      }
      let png = real
      if (format !== 'PNG') {
        png = `${scratch}/darkroom-${id}.png`
        const made = await run([...magick.convert, source, '-resize', '2048x2048>', `PNG:${png}`])
        if (made.exitCode !== 0) {
          return undefined
        }
      }
      const grid = gridSize(width, height, SIDE)
      const pixmap = await run([
        ...magick.convert,
        source,
        ...['-background', '#141414', '-flatten'],
        ...['-resize', `${grid.width}x${grid.height}!`],
        ...['-depth', '8', '-compress', 'none', 'ppm:-'],
      ])
      const pixels = parsePpm(pixmap.stdout)
      return {
        ...print,
        png,
        width,
        height,
        format,
        grid: pixels.rgb.toBase64(),
        gridWidth: pixels.width,
        gridHeight: pixels.height,
      }
    }

    const pump = async () => {
      for (let job = queue.shift(); job !== undefined; job = queue.shift()) {
        const print = await develop(job).catch(() => undefined)
        if (print === undefined) {
          continue
        }
        await update($, prints, roll => (roll.some(one => one.id === print.id) ? roll : [...roll, print].slice(-ROLL)))
        if (job.useId !== undefined) {
          await update($, memberOf(shots, { requestId: job.useId }), ids =>
            ids.includes(print.id) ? ids : [...ids, print.id],
          )
        }
      }
    }

    wake = () => {
      if (isBusy) {
        return
      }
      isBusy = true
      $.clock.after(0, () => {
        void pump().finally(() => {
          isBusy = false
          if (queue.length > 0) {
            wake()
          }
        })
      })
    }

    // Plays a row's develop on its mounted Rasters, then lets it draw pictures.
    developRow = (requestId, ids) => {
      void read($, prints).then(roll => {
        const grids = ids.flatMap(id => roll.filter(one => one.id === id).map(one => ({ id, grid: gridOf(one) })))
        let frame = 0
        const timer = $.clock.every(FRAME_MS, () => {
          frame += 1
          if (frame >= FRAMES) {
            timer.cancel()
            ids.forEach(id => mounted.delete(`${requestId}/${id}`))
            void update($, memberOf(isDeveloped, { requestId }), () => true)
            return
          }
          for (const { id, grid } of grids) {
            const box = mounted.get(`${requestId}/${id}`)
            if (box !== undefined) {
              void $.ui
                .blit({ requestId, key: `dev-${id}`, cells: paint(grid, box, frame / FRAMES, frame) })
                .catch(() => undefined)
            }
          }
        })
      })
    }

    act = {
      copyImage: async print => {
        const argv = isMac ? [...MAC_CLIPBOARD, print.png] : ['sh', '-c', LINUX_CLIPBOARD, 'darkroom', print.png]
        const copied = await $.process.run(argv).catch(() => undefined)
        $.ui.toast(
          copied?.exitCode === 0
            ? `◐ image copied: ${label(print)}`
            : '◐ darkroom: no clipboard tool for images (wl-copy, xclip or osascript)',
        )
      },
      copyPath: async (print, surface) => {
        const copied = await $.ui.copy({ text: print.path, surface })
        $.ui.toast(copied.isCopied ? `◐ path copied: ${shown(print.path)}` : `◐ darkroom: ${copied.reason}`)
      },
      // `open` hands the file on and returns; on Linux the viewer starts in a
      // session of its own, so it outlives the call.
      open: async print => {
        const argv = [...openerArgv((await read($, settings)).opener, isMac), print.path]
        await $.process.run(isMac ? argv : ['setsid', '-f', ...argv]).catch(() => undefined)
      },
    }

    if (queue.length > 0) {
      wake()
    }
    return next(e)
  })

  on('command.run', { command: 'darkroom' }, async ($, e) => {
    const [action = '', key = '', ...rest] = e.args.trim().split(/\s+/).filter(word => word !== '')
    if (action === 'settings') {
      const now = await read($, settings)
      const rows = Object.entries(SETTINGS).map(
        ([one, { field, help }]) => `  ${one.padEnd(10)} ${shownSetting(now[field])}  - ${help}`,
      )
      return { text: ['settings (/darkroom set <name> <value>):', ...rows].join('\n') }
    }
    if (action === 'set') {
      const setting = SETTINGS[key]
      if (setting === undefined) {
        return { text: `no setting "${key}". ${USAGE}` }
      }
      const raw = rest.join(' ')
      const value = setting.field === 'opener' ? (raw === '' ? 'auto' : raw) : SWITCH[raw.toLowerCase()]
      if (value === undefined) {
        return { text: `${key} takes on or off.` }
      }
      await update($, settings, now => ({ ...now, [setting.field]: value }))
      await $.store.set('settings', await read($, settings))
      return { text: `${key} is now ${shownSetting(value)}.` }
    }
    if (action !== '') {
      return { text: USAGE }
    }
    const count = (await read($, prints)).length
    return { text: count === 0 ? 'no prints yet.' : `${count} print${count > 1 ? 's' : ''} on the roll.` }
  })

  // Reads each call's arguments, and a command's or MCP tool's output, for the
  // image paths it worked on. It never changes or answers a call.
  on('tool.call', async ($, e, next) => {
    const since = await $.clock.now()
    const ran = await next(e)
    if (ran.deny !== undefined || ran.isError === true) {
      return ran
    }
    const verb: Verb = e.tool === 'Read' ? 'read' : e.tool === 'Write' || e.tool === 'Edit' ? 'wrote' : 'made'
    const asked = Object.entries(e).flatMap(([key, value]) => (typeof value === 'string' && !SKIP.has(key) ? [value] : []))
    const said = verb === 'made' ? [ran.text ?? ''] : []
    for (const path of imagePaths([...asked, ...said].join('\n'))) {
      queue.push({ path, verb, tool: e.tool, since, useId: e.tool_use_id, tries: 0 })
    }
    queue.splice(0, Math.max(0, queue.length - ROLL))
    if (queue.length > 0) {
      wake()
    }
    return ran
  })

  // A pasted image: its marker painted amber in the box, its picture developed
  // for the band above the box. The draft is read for markers only.
  on('prompt.edit', async ($, e, next) => {
    const box = await next(e)
    const marks = [...box.text.matchAll(PLACEHOLDER)]
    const numbers = [...new Set(marks.map(mark => Number(mark[1])))]
    const before = await read($, pasted)
    if (numbers.join() !== before.join()) {
      await update($, pasted, () => numbers)
      for (const paste of numbers.filter(n => !before.includes(n))) {
        queue.push({ paste, verb: 'pasted', tool: 'paste', since: 0, tries: 0 })
      }
      wake()
    }
    if (marks.length === 0) {
      return box
    }
    const runs = marks.map(mark => ({ start: mark.index, end: mark.index + mark[0].length, color: AMBER }))
    return { ...box, decorations: [...(box.decorations ?? []), ...runs] }
  })

  // Sending a prompt clears the pasted thumbnails and puts the open viewers
  // away. The prompt passes on unchanged.
  on('prompt.submit', async ($, e, next) => {
    await update($, pasted, () => [])
    for (const id of openViews) {
      await update($, memberOf(viewing, { requestId: id }), () => -1)
    }
    openViews.clear()
    return next(e)
  })

  // The pasted images, as thumbnails right above the prompt box.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const numbers = await read($, pasted)
    if (numbers.length === 0 || e.props.hasSurvey || e.surface !== 'terminal') {
      return next(e)
    }
    const session = await $.session.id()
    const roll = await read($, prints)
    const found = numbers.flatMap(n => roll.filter(one => pastedAs(one, session, String(n))))
    if (found.length === 0) {
      return next(e)
    }
    const els = $.ui.resolve(e)
    const { Box, Text } = els
    const rows = Math.max(2, Math.min(PASTE_ROWS, e.props.maxRows - 1))
    return (
      <Box gap={2}>
        {found.map(print => (
          <Box key={`paste-${print.id}`} flexDirection="column">
            {picture(els, print, fit(print.width, print.height, pasteColumns(print.width), rows), `paste-${print.id}`)}
            <Text color={AMBER}>{label(print)}</Text>
          </Box>
        ))}
      </Box>
    )
  })

  // The clicks, hover and keys of the hit layers over a row's strip and viewer.
  on('ui.message', async ($, e) => {
    if (e.element !== 'strip-hit' && e.element !== 'view-hit') {
      return {}
    }
    const post = e.data as Post
    const view = memberOf(viewing, e)
    const key = post.key ?? ''
    const pick = post.pick
    const hover = post.hover
    const printAt = async (at: number) => (await read($, prints)).find(one => one.id === post.ids[at])
    if (hover !== undefined) {
      await update($, memberOf(hovered, e), () => ({ at: hover, item: post.item ?? '' }))
      return {}
    }
    if (post.fold === true) {
      await update($, memberOf(isUnrolled, e), () => false)
      await update($, memberOf(hovered, e), () => NO_HOVER)
      await update($, view, () => -1)
    } else if (post.shut === true || SHUT.includes(key)) {
      await update($, view, () => -1)
    } else if (post.copy !== undefined && pick !== undefined) {
      const print = await printAt(pick)
      if (print !== undefined) {
        await (post.copy === 'image' ? act.copyImage(print) : act.copyPath(print, e.surface))
      }
    } else if (pick !== undefined) {
      await update($, view, at => (at === pick ? -1 : pick))
    } else if (post.step !== undefined || BACK.includes(key) || FORTH.includes(key)) {
      const by = post.step ?? (BACK.includes(key) ? -1 : 1)
      await update($, view, at => Math.max(0, Math.min(post.ids.length - 1, at + by)))
    } else if (key === 'return') {
      await update($, view, at => (at < 0 ? 0 : -1))
    } else if (key === 'i' || key === 'c' || key === 'o') {
      const print = await printAt(Math.max(0, await read($, view)))
      if (print !== undefined) {
        await (key === 'i' ? act.copyImage(print) : key === 'c' ? act.copyPath(print, e.surface) : act.open(print))
      }
    }
    // One viewer at a time: the one just opened puts the others away.
    if ((await read($, view)) >= 0) {
      for (const other of openViews) {
        if (other !== e.requestId) {
          await update($, memberOf(viewing, { requestId: other }), () => -1)
        }
      }
      openViews.clear()
      openViews.add(e.requestId)
    }
    return {}
  })

  // The grey line under a row that holds images, its strip and its viewer.
  on('ui.render', { component: ['ToolResult', 'ToolGroup', 'UserMessage', 'CommandOutput'] }, async ($, e, next) => {
    // Most rows hold no image: they cost one small read, never the roll.
    let ids: string[] = []
    if (e.component === 'ToolResult') {
      ids = await read($, memberOf(shots, e))
    } else if (e.component === 'ToolGroup') {
      if (e.props.isExpanded) {
        return next(e)
      }
      for (const call of e.props.calls) {
        if (call.tool_use_id !== undefined) {
          ids.push(...(await read($, memberOf(shots, { requestId: call.tool_use_id }))))
        }
      }
    } else if (e.component === 'UserMessage') {
      const numbers = [...e.props.text.matchAll(PLACEHOLDER)].map(mark => mark[1] ?? '')
      if (numbers.length > 0) {
        const session = await $.session.id()
        const roll = await read($, prints)
        ids = numbers.flatMap(n => roll.filter(one => pastedAs(one, session, n)).map(one => one.id))
      }
    } else if (e.props.command === 'darkroom' && ROLL_LINE.test(e.props.text)) {
      ids = (await read($, prints)).map(one => one.id)
    }
    if (ids.length === 0) {
      return next(e)
    }
    const roll = await read($, prints)
    const strip = [...new Set(ids)].flatMap(id => roll.filter(one => one.id === id))
    const lead = strip[0]
    if (lead === undefined) {
      return next(e)
    }

    const { develop, autoShow } = await read($, settings)
    const isRoll = e.component === 'CommandOutput'
    const row = isRoll ? null : await next(e)
    const isOpen = isRoll || ((await read($, memberOf(isUnrolled, e))) ?? autoShow)
    const at = await read($, memberOf(viewing, e))
    const hasDeveloped = !develop || isRoll || (await read($, memberOf(isDeveloped, e)))
    const summary = strip.length === 1 ? `${label(lead)} · ${lead.width}×${lead.height}` : `${strip.length} images`

    if (e.surface !== 'terminal') {
      const { Box, Text } = $.ui.resolve(e)
      return (
        <Box flexDirection="column">
          {row}
          <Text dimColor>{`● darkroom: ${strip.map(where).join(', ')}`}</Text>
        </Box>
      )
    }

    if (isOpen && !hasDeveloped && !started.has(e.requestId)) {
      started.add(e.requestId)
      developRow(
        e.requestId,
        strip.map(one => one.id),
      )
    }
    const els = $.ui.resolve(e)
    const { Box, Button } = els
    const view: RowView = {
      requestId: e.requestId,
      strip,
      at,
      hovered: isOpen ? await read($, memberOf(hovered, e)) : NO_HOVER,
      width: Math.max(THUMB.columns, (e.viewport?.columns ?? 80) - 4),
      screenRows: e.viewport?.rows ?? 40,
      hasDeveloped,
    }
    const current = at >= 0 ? strip[at] : undefined
    const setAt = (to: (at: number) => number) => update($, memberOf(viewing, e), to)
    const toggle = async () => {
      const willOpen = !((await read($, memberOf(isUnrolled, e))) ?? autoShow)
      await update($, memberOf(isUnrolled, e), () => willOpen)
      await update($, memberOf(hovered, e), () => NO_HOVER)
      if (!willOpen) {
        await setAt(() => -1)
      }
    }
    const stripAt = stripLayout(view)
    const viewAt = current === undefined ? undefined : viewerLayout(view, current)
    return (
      <Box flexDirection="column">
        {row}
        {isRoll ? (
          <els.Text dimColor>{`● darkroom: ${summary} on the roll`}</els.Text>
        ) : (
          <Box key="toggle-line">
            <Button
              key="toggle"
              label={`● darkroom: ${summary} — click to ${isOpen ? 'hide' : 'show'}`}
              plain
              dimColor
              hover={{ color: AMBER, dimColor: false }}
              onPress={toggle}
            />
          </Box>
        )}
        {isOpen && (
          <Box flexDirection="column" marginLeft={2}>
            <Box>
              {drawStrip(els, view, stripAt)}
              <Box position="absolute" top={0} left={0}>
                <els.Client key="strip-hit" module="./hit.ts" width={view.width} height={THUMB.rows + 1} props={stripAt.hit} />
              </Box>
            </Box>
            {current !== undefined && viewAt !== undefined && (
              <Box width={view.width - 2} justifyContent="center" marginTop={1}>
                <Box flexDirection="column" width={viewAt.panel} backgroundColor={PANEL}>
                  {drawViewer(els, view, current, viewAt, {
                    step: by => setAt(now => Math.max(0, Math.min(strip.length - 1, now + by))),
                    shut: () => setAt(() => -1),
                  })}
                  <Box position="absolute" top={1} left={0}>
                    <els.Client key="view-hit" module="./hit.ts" width={viewAt.panel} height={viewAt.frameRows} props={viewAt.hit} />
                  </Box>
                </Box>
              </Box>
            )}
          </Box>
        )}
      </Box>
    )
  })
}
