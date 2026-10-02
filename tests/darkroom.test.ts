import { expect, mock, test } from 'claude-code/testing'
import type { Engine, Mounted } from 'claude-code/testing'
import type { On, PromptEditResult } from 'claude-code'

import { imagePaths } from '../hooks/develop'
import type { Tool, ToolSpot } from '../hooks/hit'
import { BOMB, TALL, WIDE } from './fixtures'

const NOW = 1_700_000_000_000
const CWD = '/work'
const PASTES = '/tmp/claude-1000/-work/sess/images'
const PIXMAP = 'P3\n2 1\n255\n255 0 0  0 0 255\n' // two pixels: red, blue
const VIEWPORT = { columns: 120, rows: 50, isFullscreen: true }

type World = {
  disk: Record<string, number>
  term?: string
  said?: string
  system?: string
  store?: Record<string, unknown>
  hasMagick?: boolean
}

// What lies beneath the plugin: a disk (path → mtime), ImageMagick, a
// clipboard, a terminal, the plugin's store, the engine's own rows, and tools
// that answer `said`.
const world = (
  on: On,
  { disk, term = 'xterm-ghostty', said = '', system = 'Linux', store = {}, hasMagick = true }: World,
) => {
  const clock = mock.clock(on, { now: NOW })
  mock.env(on, { HOME: '/home/t', TERM: term, WAYLAND_DISPLAY: 'wayland-0' })
  const saved: Record<string, unknown> = { ...store }
  on('store.get', ($, e) => ({ value: saved[e.key] }))
  on('store.set', ($, e) => {
    saved[e.key] = e.value
    return { value: undefined }
  })
  const calls: string[] = []
  const runs: string[][] = []
  const envs: Record<string, string>[] = []
  const toasts: string[] = []
  const copies: string[] = []
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 'sess' }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('tool.register', ($, e) => ({ value: { tool: `mcp__darkroom__${e.name}` } }))
  on('fs.stat', ($, e) => {
    const mtimeMs = disk[e.path]
    return mtimeMs === undefined
      ? { deny: `ENOENT: ${e.path}` }
      : { value: { kind: 'file' as const, size: 4096, mtimeMs, isLink: false, realPath: e.path } }
  })
  on('fs.exists', ($, e) => ({
    value: e.path === PASTES || disk[e.path] !== undefined || (system === 'Darwin' && e.path.startsWith('/System/Library/')),
  }))
  on('fs.list', ($, e) => ({
    value: e.path === '/tmp/claude-1000' ? [{ name: '-work', kind: 'dir' as const, size: 0, mtimeMs: 0, isLink: false }] : [],
  }))
  // A PNG's bytes: the tall one, the bomb, or a plain wide picture.
  on('fs.read', ($, e) => ({
    value: { base64: e.path.includes('tall') ? TALL : e.path.includes('bomb') ? BOMB : WIDE },
  }))
  on('process.run', ($, e) => {
    runs.push([...e.argv])
    envs.push({ ...e.init?.env })
    const line = e.argv.join(' ')
    if (!hasMagick && line.endsWith('-version')) {
      return { value: { exitCode: 127, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    }
    const stdout =
      line === 'id -u' ? '1000\n' : line.includes('identify') ? '640 320 JPEG' : line.endsWith('ppm:-') ? PIXMAP : ''
    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('tool.call', ($, e) => {
    calls.push(e.tool_use_id)
    return { result: { stdout: said, stderr: '', interrupted: false }, text: said }
  })
  on('prompt.edit', ($, e) => ({
    text: `${e.text.slice(0, e.start)}${e.inputText}${e.text.slice(e.end)}`,
    cursor: e.start + e.inputText.length,
  }))
  on('ui.render', { component: ['ToolResult', 'ToolGroup', 'UserMessage', 'AbovePrompt'] }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return Text({ children: 'engine row' })
  })
  on('prompt.submit', ($, e) => ({ text: e.text }))
  on('ui.blit', () => ({ value: {} }))
  on('ui.toast', ($, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.copy', ($, e) => {
    copies.push(e.text)
    return { value: { isCopied: true as const } }
  })
  return { clock, calls, runs, envs, toasts, copies, saved }
}

// Starts the session, has the model run `commands`, and lets every develop finish.
const session = async ($: Engine, clock: ReturnType<typeof mock.clock>, commands: string[]) => {
  await $.session.start({ cwd: CWD, surface: 'terminal', isInteractive: true })
  for (const command of commands) {
    await $.tool.call({ tool: 'Bash', command })
    await clock.advance(0)
    await clock.advance(5000)
  }
}

// The result row of one tool call, as the transcript draws it.
const result = (id: string | undefined) =>
  ({
    plugin: 'darkroom',
    surface: 'terminal',
    component: 'ToolResult',
    requestId: id ?? 'missing',
    viewport: VIEWPORT,
    props: { tool_use_id: id ?? 'missing', tool: 'Bash', output: {}, isErrored: false },
  }) as const

// Unrolls a row's strip and lets its develop play out.
const unroll = async (ui: { press: (target: { key: string }) => Promise<unknown> }, clock: ReturnType<typeof mock.clock>) => {
  await ui.press({ key: 'toggle' })
  await clock.advance(2000)
}

type Drawing = Mounted<'terminal', 'ToolResult'>

// The toolbar entries of the open viewer, as the hit layer over them knows them.
const toolbar = async (ui: Drawing) =>
  ((await ui.find({ type: 'Client', key: 'view-hit' }))?.props.props as { tools: ToolSpot[] }).tools

// Where one toolbar entry sits.
const toolSpot = async (ui: Drawing, tool: Tool) => {
  const spot = (await toolbar(ui)).find(one => one.tool === tool)
  if (spot === undefined) {
    throw new Error(`the toolbar has no ${tool} entry`)
  }
  return spot
}

// Clicks a toolbar entry of the open viewer.
const click = async (ui: Drawing, tool: Tool) => {
  const { left } = await toolSpot(ui, tool)
  await ui.pointer({ type: 'down', x: left + 1, y: 0, button: 'left', in: 'view-hit' })
  await ui.pointer({ type: 'up', x: left + 1, y: 0, button: 'left', in: 'view-hit' })
}

// Pastes image #1 into the prompt box and lets it develop.
const paste = async ($: Engine, clock: ReturnType<typeof mock.clock>) => {
  await $.session.start({ cwd: CWD, surface: 'terminal', isInteractive: true })
  // @ts-expect-error The kit raises prompt.edit as the composer does; its typing does not list the call yet.
  const box: PromptEditResult = await $.prompt.edit({
    origin: { kind: 'composer' },
    text: '',
    cursor: 0,
    start: 0,
    end: 0,
    inputText: '[Image #1]',
  })
  await clock.advance(0)
  await clock.advance(1000)
  return box
}

test('image paths are picked out of commands and outputs', () => {
  expect(imagePaths('magick in.jpg -resize 50% ./out/thumb.webp && cp ~/a.png /tmp/b.PNG')).toEqual([
    'in.jpg',
    './out/thumb.webp',
    '~/a.png',
    '/tmp/b.PNG',
  ])
  expect(imagePaths('see file:///work/logo.png, notes.png.bak or --out=shot.svg')).toEqual(['shot.svg'])
})

test('a tool call that makes an image gets a grey line under its result', async ($, on) => {
  const w = world(on, { disk: { '/work/shot.png': NOW } })
  await session($, w.clock, ['magick in.jpg /work/shot.png'])
  const ui = await $.ui.mount(result(w.calls[0]))
  expect((await ui.find({ key: 'toggle' }))?.text).toBe('● darkroom: shot.png · 64×32 — click to show')
  expect(await ui.find({ text: 'engine row' }), 'the engine row stays').toBeDefined()
  await ui.unmount()
})

test('an image a command only names gets no line', async ($, on) => {
  const w = world(on, { disk: { '/work/old.png': NOW - 60_000 }, said: '/work/old.png\n/work/notes.md' })
  await session($, w.clock, ['ls'])
  const ui = await $.ui.mount(result(w.calls[0]))
  expect(await ui.find({ key: 'toggle' })).toBeUndefined()
  await ui.unmount()
})

test('the line unrolls a strip that develops, then shows the pictures', async ($, on) => {
  const w = world(on, { disk: { '/work/shot.png': NOW } })
  await session($, w.clock, ['magick in.jpg /work/shot.png'])
  const ui = await $.ui.mount(result(w.calls[0]))
  await ui.press({ key: 'toggle' })
  expect(await ui.find({ type: 'Raster' }), 'it develops first').toBeDefined()
  await w.clock.advance(2000)
  expect((await ui.find({ type: 'Image' }))?.props.source).toEqual({ file: '/work/shot.png', format: 'png', generation: NOW })
  expect((await ui.find({ key: 'toggle' }))?.text).toContain('click to hide')
  await ui.unmount()
})

test('a click on a picture opens the viewer, and the arrows browse it', async ($, on) => {
  const w = world(on, { disk: { '/work/a.png': NOW, '/work/b.png': NOW } })
  await session($, w.clock, ['magick x.jpg /work/a.png /work/b.png'])
  const ui = await $.ui.mount(result(w.calls[0]))
  await unroll(ui, w.clock)
  const shown = async () => ((await ui.find({ type: 'Image', key: 'view' }))?.props.source as { file?: string })?.file
  await ui.pointer({ type: 'up', x: 1, y: 1, in: 'strip-hit' })
  expect(await shown()).toBe('/work/a.png')
  await ui.key({ key: 'right', in: 'strip-hit' })
  expect(await shown()).toBe('/work/b.png')
  await ui.key({ key: 'left', in: 'strip-hit' })
  expect(await shown()).toBe('/work/a.png')
  await ui.key({ key: 'x', in: 'strip-hit' })
  expect(await shown(), 'x shuts the viewer').toBeUndefined()
  await ui.unmount()
})

test('i in the viewer puts the PNG itself on the clipboard', async ($, on) => {
  const w = world(on, { disk: { '/work/shot.png': NOW } })
  await session($, w.clock, ['magick in.jpg /work/shot.png'])
  const ui = await $.ui.mount(result(w.calls[0]))
  await unroll(ui, w.clock)
  await ui.pointer({ type: 'up', x: 1, y: 1, in: 'strip-hit' })
  await ui.key({ key: 'i', in: 'view-hit' })
  const copy = w.runs.find(argv => argv[0] === 'sh' && argv[2]?.includes('image/png'))
  expect(copy?.slice(3)).toEqual(['darkroom', '/work/shot.png'])
  expect(w.toasts).toContain('◐ image copied: shot.png')
  await ui.unmount()
})

test('the path button puts the path on the clipboard', async ($, on) => {
  const w = world(on, { disk: { '/work/shot.png': NOW } })
  await session($, w.clock, ['magick in.jpg /work/shot.png'])
  const ui = await $.ui.mount(result(w.calls[0]))
  await unroll(ui, w.clock)
  await ui.pointer({ type: 'up', x: 1, y: 1, in: 'strip-hit' })
  await click(ui, 'path')
  expect(w.copies).toEqual(['/work/shot.png'])
  await ui.unmount()
})

for (const [system, argv] of [
  ['Linux', ['setsid', '-f', 'xdg-open']],
  ['Darwin', ['open']],
] as const) {
  test(`open hands the image to ${argv.join(' ')} on ${system} when no opener is set`, async ($, on) => {
    const w = world(on, { disk: { '/work/shot.png': NOW }, system })
    await session($, w.clock, ['magick in.jpg /work/shot.png'])
    const ui = await $.ui.mount(result(w.calls[0]))
    await unroll(ui, w.clock)
    await ui.pointer({ type: 'up', x: 1, y: 1, in: 'strip-hit' })
    await click(ui, 'open')
    expect(w.runs).toContainEqual([...argv, '/work/shot.png'])
    await ui.unmount()
  })
}

test('open hands the image to the opener the settings name', async ($, on) => {
  const w = world(on, { disk: { '/work/shot.png': NOW }, store: { settings: { opener: 'feh --scale-down' } } })
  await session($, w.clock, ['magick in.jpg /work/shot.png'])
  const ui = await $.ui.mount(result(w.calls[0]))
  await unroll(ui, w.clock)
  await ui.pointer({ type: 'up', x: 1, y: 1, in: 'strip-hit' })
  await click(ui, 'open')
  expect(w.runs).toContainEqual(['setsid', '-f', 'feh', '--scale-down', '/work/shot.png'])
  await ui.unmount()
})

test('/darkroom set keeps the setting it names for the next sessions', async ($, on) => {
  const w = world(on, { disk: {} })
  await $.session.start({ cwd: CWD, surface: 'terminal', isInteractive: true })
  const ran = await $.command.run({
    command: 'darkroom',
    args: 'set develop off',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: true, columns: 200 },
  })
  expect(JSON.stringify(ran)).toContain('develop is now off')
  expect(w.saved.settings).toMatchObject({ develop: false })
})

test('a terminal without kitty graphics gets the pictures in half-block cells', async ($, on) => {
  const w = world(on, { disk: { '/work/shot.png': NOW }, term: 'xterm-256color' })
  await session($, w.clock, ['magick in.jpg /work/shot.png'])
  const ui = await $.ui.mount(result(w.calls[0]))
  await unroll(ui, w.clock)
  expect(await ui.findAll({ type: 'Raster' })).toHaveLength(1)
  expect(await ui.find({ type: 'Image' })).toBeUndefined()
  await ui.unmount()
})

test('a pasted image shows above the prompt box, its marker painted', async ($, on) => {
  const w = world(on, { disk: { [`${PASTES}/1.png`]: NOW } })
  const box = await paste($, w.clock)
  expect(box.decorations).toEqual([{ start: 0, end: 10, color: '#f5a623' }])
  const band = await $.ui.mount({
    plugin: 'darkroom',
    surface: 'terminal',
    component: 'AbovePrompt',
    viewport: VIEWPORT,
    props: { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 120, scroll: { offset: 0, bodyRows: 12 }, view: {} },
  })
  expect((await band.find({ type: 'Image' }))?.props.source).toMatchObject({ file: `${PASTES}/1.png` })
  expect(await band.find({ type: 'Text', text: '[Image #1]' })).toBeDefined()
  await band.unmount()
})

test('a sent message with a pasted image gets a grey line', async ($, on) => {
  const w = world(on, { disk: { [`${PASTES}/1.png`]: NOW } })
  await paste($, w.clock)
  const ui = await $.ui.mount({
    plugin: 'darkroom',
    surface: 'terminal',
    component: 'UserMessage',
    viewport: VIEWPORT,
    props: { text: 'look at this [Image #1]', origin: { kind: 'composer' }, isExpanded: false },
  })
  expect((await ui.find({ key: 'toggle' }))?.text).toBe('● darkroom: [Image #1] · 64×32 — click to show')
  await ui.unmount()
})

test('/darkroom draws the whole roll in the chat', async ($, on) => {
  const w = world(on, { disk: { '/work/shot.png': NOW } })
  await session($, w.clock, ['magick in.jpg /work/shot.png'])
  const ui = await $.ui.mount({
    plugin: 'darkroom',
    surface: 'terminal',
    component: 'CommandOutput',
    viewport: VIEWPORT,
    props: { command: 'darkroom', args: '', text: '1 print on the roll.', isErrored: false },
  })
  expect((await ui.find({ type: 'Image' }))?.props.source).toMatchObject({ file: '/work/shot.png' })
  await ui.unmount()
})

test('with auto-show on, the strip shows without a click', async ($, on) => {
  const w = world(on, { disk: { '/work/shot.png': NOW }, store: { settings: { autoShow: true } } })
  await session($, w.clock, ['magick in.jpg /work/shot.png'])
  const ui = await $.ui.mount(result(w.calls[0]))
  await w.clock.advance(2000)
  expect((await ui.find({ type: 'Image' }))?.props.source).toMatchObject({ file: '/work/shot.png' })
  expect((await ui.find({ key: 'toggle' }))?.text).toContain('click to hide')
  await ui.unmount()
})

test('browsing keeps the frame, and so the buttons, in place', async ($, on) => {
  const w = world(on, { disk: { '/work/wide.png': NOW, '/work/tall.png': NOW } })
  await session($, w.clock, ['magick x.jpg /work/wide.png /work/tall.png'])
  const ui = await $.ui.mount(result(w.calls[0]))
  await unroll(ui, w.clock)
  await ui.pointer({ type: 'up', x: 1, y: 1, in: 'strip-hit' })
  const frame = async () => (await ui.find({ type: 'Box', key: 'frame' }))?.props.height
  const wide = await frame()
  const tools = await toolbar(ui)
  await click(ui, 'forth')
  expect(await frame(), 'the tall picture fits the same frame').toBe(wide)
  expect(await toolbar(ui), 'the toolbar entries stay under the pointer').toEqual(tools)
  expect((await ui.find({ type: 'Image', key: 'view' }))?.props.source).toMatchObject({ file: '/work/tall.png' })
  await ui.unmount()
})

type Spot = { left: number; top: number; columns: number; rows: number }

test("a click on the picture's right half shows the next one, a click beside it puts the viewer away", async ($, on) => {
  const w = world(on, { disk: { '/work/a.png': NOW, '/work/b.png': NOW } })
  await session($, w.clock, ['magick x.jpg /work/a.png /work/b.png'])
  const ui = await $.ui.mount(result(w.calls[0]))
  await unroll(ui, w.clock)
  await ui.pointer({ type: 'up', x: 1, y: 1, in: 'strip-hit' })
  const layer = await ui.find({ type: 'Client', key: 'view-hit' })
  const spot = (layer?.props.props as { picture: Spot }).picture
  await ui.pointer({ type: 'up', x: spot.left + spot.columns - 1, y: spot.top, in: 'view-hit' })
  expect((await ui.find({ type: 'Image', key: 'view' }))?.props.source).toMatchObject({ file: '/work/b.png' })
  await ui.pointer({ type: 'up', x: 0, y: spot.top, in: 'view-hit' })
  expect(await ui.find({ type: 'Image', key: 'view' }), 'beside the picture puts it away').toBeUndefined()
  await ui.unmount()
})

test('every click on an arrow browses, a quick one or one that slips off it', async ($, on) => {
  const w = world(on, { disk: { '/work/a.png': NOW, '/work/b.png': NOW, '/work/c.png': NOW } })
  await session($, w.clock, ['magick x.jpg /work/a.png /work/b.png /work/c.png'])
  const ui = await $.ui.mount(result(w.calls[0]))
  await unroll(ui, w.clock)
  await ui.pointer({ type: 'up', x: 1, y: 1, in: 'strip-hit' })
  const forth = await toolSpot(ui, 'forth')
  // Down on the arrow, up two rows lower and beside the picture.
  await ui.pointer({ type: 'down', x: forth.left, y: 0, button: 'left', in: 'view-hit' })
  await ui.pointer({ type: 'move', x: forth.left + 6, y: 2, button: 'left', in: 'view-hit' })
  await ui.pointer({ type: 'up', x: forth.left + 6, y: 2, button: 'left', in: 'view-hit' })
  await click(ui, 'forth')
  expect((await ui.find({ type: 'Image', key: 'view' }))?.props.source).toMatchObject({ file: '/work/c.png' })
  await ui.unmount()
})

test('the toolbar entry under the pointer lights up', async ($, on) => {
  const w = world(on, { disk: { '/work/shot.png': NOW } })
  await session($, w.clock, ['magick in.jpg /work/shot.png'])
  const ui = await $.ui.mount(result(w.calls[0]))
  await unroll(ui, w.clock)
  await ui.pointer({ type: 'up', x: 1, y: 1, in: 'strip-hit' })
  const lit = async () => (await ui.findAll({ type: 'Text' })).find(one => one.props.backgroundColor === '#f5a623')?.text
  const open = await toolSpot(ui, 'open')
  await ui.pointer({ type: 'move', x: open.left + 2, y: 0, in: 'view-hit' })
  expect(await lit()).toBe(' ↗ open ')
  await ui.pointer({ type: 'leave', x: open.left + 2, y: 0, in: 'view-hit' })
  expect(await lit(), 'leaving puts the light out').toBeUndefined()
  await ui.unmount()
})

test('a click in the strip past the thumbnails folds the darkroom', async ($, on) => {
  const w = world(on, { disk: { '/work/shot.png': NOW } })
  await session($, w.clock, ['magick in.jpg /work/shot.png'])
  const ui = await $.ui.mount(result(w.calls[0]))
  await unroll(ui, w.clock)
  await ui.pointer({ type: 'up', x: 50, y: 1, in: 'strip-hit' })
  expect((await ui.find({ key: 'toggle' }))?.text).toContain('click to show')
  expect(await ui.find({ type: 'Image' })).toBeUndefined()
  await ui.unmount()
})

test('resting on a thumbnail offers copy image and copy path', async ($, on) => {
  const w = world(on, { disk: { '/work/shot.png': NOW } })
  await session($, w.clock, ['magick in.jpg /work/shot.png'])
  const ui = await $.ui.mount(result(w.calls[0]))
  await unroll(ui, w.clock)
  await ui.pointer({ type: 'move', x: 2, y: 1, in: 'strip-hit' })
  expect(await ui.find({ type: 'Text', text: /⧉ image/ }), 'not at once').toBeUndefined()
  await ui.advance(600)
  expect(await ui.find({ type: 'Text', text: /⧉ image/ })).toBeDefined()
  expect(await ui.findAll({ in: 'strip-hit', type: 'Text' }), 'the layer over the pictures draws nothing').toHaveLength(0)
  const lit = async () => (await ui.findAll({ type: 'Text', text: /⧉ image|⎘ path/ })).find(one => one.props.backgroundColor === '#f5a623')?.text
  await ui.pointer({ type: 'move', x: 12, y: 5, in: 'strip-hit' })
  expect(await lit(), 'the entry under the pointer lights up').toBe(' ⎘ path ')
  await ui.pointer({ type: 'move', x: 1, y: 5, in: 'strip-hit' })
  expect(await lit()).toBe(' ⧉ image ')
  await ui.pointer({ type: 'up', x: 1, y: 5, in: 'strip-hit' })
  expect(w.toasts).toContain('◐ image copied: shot.png')
  await ui.pointer({ type: 'up', x: 12, y: 5, in: 'strip-hit' })
  expect(w.copies).toEqual(['/work/shot.png'])
  expect(await ui.find({ type: 'Image', key: 'view' }), 'the menu opens no viewer').toBeUndefined()
  await ui.pointer({ type: 'leave', x: 1, y: 5, in: 'strip-hit' })
  expect(await ui.find({ type: 'Text', text: /⧉ image/ }), 'leaving puts the menu away').toBeUndefined()
  await ui.unmount()
})

test('sending a prompt puts the open viewer away', async ($, on) => {
  const w = world(on, { disk: { '/work/shot.png': NOW } })
  await session($, w.clock, ['magick in.jpg /work/shot.png'])
  const ui = await $.ui.mount(result(w.calls[0]))
  await unroll(ui, w.clock)
  await ui.pointer({ type: 'up', x: 1, y: 1, in: 'strip-hit' })
  expect(await ui.find({ type: 'Image', key: 'view' })).toBeDefined()
  await $.prompt.submit({ text: 'next', origin: { kind: 'composer' }, wait: false })
  expect(await ui.find({ type: 'Image', key: 'view' })).toBeUndefined()
  await ui.unmount()
})

test('the show tool puts the images Claude names on the roll, old ones too, and says what it skipped', async ($, on) => {
  const old = NOW - 60_000
  const w = world(on, { disk: { '/work/icons/a.png': old, '/work/icons/b.png': old, '/work/favicon.ico': old } })
  await $.session.start({ cwd: CWD, surface: 'terminal', isInteractive: true })
  const shown = await $.tool.call({
    tool: 'mcp__darkroom__show',
    paths: ['icons/a.png', '/work/icons/b.png', '/work/favicon.ico', '/work/gone.png'],
  })
  expect(shown.result).toBe(
    'Showing 2 images to the person, in a strip under this call: a.png, b.png. Skipped: ' +
      '/work/favicon.ico: not a format darkroom shows (PNG, JPEG, GIF, WebP, AVIF, SVG, BMP and TIFF); ' +
      '/work/gone.png: no such file.',
  )
  await w.clock.advance(0)
  await w.clock.advance(5000)
  const roll = await $.ui.mount({
    plugin: 'darkroom',
    surface: 'terminal',
    component: 'CommandOutput',
    viewport: VIEWPORT,
    props: { command: 'darkroom', args: '', text: '2 prints on the roll.', isErrored: false },
  })
  const files = (await roll.findAll({ type: 'Image' })).map(one => (one.props.source as { file: string }).file)
  expect(files).toEqual(['/work/icons/a.png', '/work/icons/b.png'])
  await roll.unmount()
})

test('a decompression bomb is never decoded', async ($, on) => {
  const w = world(on, { disk: { '/work/bomb.png': NOW } })
  await session($, w.clock, ['make /work/bomb.png'])
  const ui = await $.ui.mount(result(w.calls[0]))
  expect(await ui.find({ key: 'toggle' })).toBeUndefined()
  await ui.unmount()
})

test('a PNG develops in the sandbox, with no program run on it', async ($, on) => {
  const w = world(on, { disk: { '/work/shot.png': NOW } })
  await session($, w.clock, ['magick in.jpg /work/shot.png'])
  const ui = await $.ui.mount(result(w.calls[0]))
  expect((await ui.find({ key: 'toggle' }))?.text).toBe('● darkroom: shot.png · 64×32 — click to show')
  expect(w.runs.filter(argv => argv.some(arg => arg.includes('/work/shot.png')))).toEqual([])
  await ui.unmount()
})

test("ImageMagick runs only under darkroom's policy, with the decoder the extension names", async ($, on) => {
  const w = world(on, { disk: { '/work/photo.jpg': NOW } })
  await session($, w.clock, ['make /work/photo.jpg'])
  const calls = w.runs.flatMap((argv, i) => (argv.some(arg => arg.includes('/work/photo.jpg')) ? [{ argv, env: w.envs[i] }] : []))
  expect(calls.length).toBeGreaterThan(0)
  for (const { argv, env } of calls) {
    expect(argv).toContain('JPEG:/work/photo.jpg[0]')
    expect(env?.MAGICK_CONFIGURE_PATH?.endsWith('/magick'), 'the policy folder').toBe(true)
  }
})

test('without ImageMagick, a PNG still develops and a JPEG says what it needs', async ($, on) => {
  const w = world(on, { disk: { '/work/shot.png': NOW, '/work/photo.jpg': NOW }, hasMagick: false })
  await session($, w.clock, ['make /work/shot.png /work/photo.jpg'])
  const ui = await $.ui.mount(result(w.calls[0]))
  expect((await ui.find({ key: 'toggle' }))?.text).toBe('● darkroom: shot.png · 64×32 — click to show')
  expect(w.toasts).toContain('◐ darkroom: install ImageMagick to see JPG images')
  await ui.unmount()
})

test('+N turns the strip to its next page', async ($, on) => {
  const w = world(on, { disk: { '/work/a.png': NOW, '/work/b.png': NOW } })
  await session($, w.clock, ['magick x.jpg /work/a.png /work/b.png'])
  const ui = await $.ui.mount({ ...result(w.calls[0]), viewport: { columns: 24, rows: 50, isFullscreen: true } })
  await unroll(ui, w.clock)
  expect(await ui.find({ type: 'Text', text: '+1 ▶' })).toBeDefined()
  await ui.pointer({ type: 'up', x: 20, y: 1, in: 'strip-hit' })
  expect((await ui.find({ type: 'Image', key: 'view' }))?.props.source).toMatchObject({ file: '/work/b.png' })
  await ui.unmount()
})

test('on macOS, copy image hands the PNG to osascript, with no shell', async ($, on) => {
  const w = world(on, { disk: { '/work/shot.png': NOW }, system: 'Darwin' })
  await session($, w.clock, ['magick in.jpg /work/shot.png'])
  const ui = await $.ui.mount(result(w.calls[0]))
  await unroll(ui, w.clock)
  await ui.pointer({ type: 'up', x: 1, y: 1, in: 'strip-hit' })
  await click(ui, 'image')
  const copy = w.runs.find(argv => argv[0] === 'osascript')
  expect(copy?.at(-1)).toBe('/work/shot.png')
  expect(w.runs.some(argv => argv[0] === 'sh')).toBe(false)
  await ui.unmount()
})
