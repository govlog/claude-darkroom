// The pure core of darkroom: which image paths a text names, the pixmap
// ImageMagick prints, and the frames of the develop. No `$` here.

export type Grid = { width: number; height: number; rgb: Uint8Array }
export type Cells = { columns: number; rows: number }

const IMAGE = /[^\s'"`()<>|;&*?=,[\]{}]+\.(?:png|jpe?g|gif|webp|svg|bmp|avif|tiff?)(?![\w.-])/gi

// ponytail: a path is cut at its first space; parse shell quoting if images
// with spaces in their names must show up.
export const imagePaths = (text: string): string[] => [
  ...new Set((text.slice(0, 200_000).match(IMAGE) ?? []).filter(path => !path.includes('://'))),
]

/** Reads a plain (P3) pixmap, as `magick ... -compress none ppm:-` prints it. */
export const parsePpm = (text: string): Grid => {
  const words = text.replace(/#[^\n]*/g, ' ').trim().split(/\s+/)
  const width = Number(words[1])
  const height = Number(words[2])
  const scale = 255 / Number(words[3])
  const isWhole =
    words[0] === 'P3' && width > 0 && height > 0 && scale > 0 && words.length >= 4 + width * height * 3
  if (!isWhole) {
    throw new Error('darkroom: not a whole P3 pixmap')
  }
  const rgb = new Uint8Array(width * height * 3)
  for (let i = 0; i < rgb.length; i += 1) {
    rgb[i] = Math.round(Number(words[4 + i]) * scale)
  }
  return { width, height, rgb }
}

/** The pixel grid a print keeps: square pixels, its long side at most `side`. */
export const gridSize = (width: number, height: number, side: number) => {
  const long = Math.min(side, Math.max(width, height))
  return width >= height
    ? { width: long, height: Math.max(1, Math.round((long * height) / width)) }
    : { width: Math.max(1, Math.round((long * width) / height)), height: long }
}

/** The largest box of cells that keeps the picture's shape; a cell is about twice as tall as wide. */
export const fit = (width: number, height: number, columns: number, rows: number): Cells => {
  const across = Math.max(1, Math.min(255, Math.floor(columns)))
  const down = Math.max(1, Math.min(255, Math.floor(rows)))
  const tall = Math.round((across * height) / width / 2)
  return tall <= down
    ? { columns: across, rows: Math.max(1, tall) }
    : { columns: Math.max(1, Math.min(across, Math.round((down * 2 * width) / height))), rows: down }
}

const HALF = 0x2580 // upper half block: foreground is the top pixel, background the bottom one
const LAMP = [255, 40, 24] as const // the safelight
const PAPER = 0.9 // how light a blank sheet is under it

const smooth = (t: number) => {
  const x = Math.min(1, Math.max(0, t))
  return x * x * (3 - 2 * x)
}

const noise = (x: number, y: number, seed: number) => {
  let n = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(seed, 1274126177)
  n = Math.imul(n ^ (n >>> 13), 1103515245)
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296
}

/**
 * One frame of the develop as Raster cells. At t=0 a blank sheet under the red
 * lamp; at 0.6 the whole picture, still red and coarse grain gone; at 1 the
 * lights are on and the colors are true.
 */
export const paint = (grid: Grid, box: Cells, t: number, seed = 0): string => {
  const up = smooth(t / 0.6)
  const lit = smooth((t - 0.6) / 0.4)
  const block = Math.max(1, Math.round(6 * (1 - up)))
  const pixel = (x: number, y: number) => {
    const gx = Math.min(grid.width - 1, Math.floor(((x - (x % block)) * grid.width) / box.columns))
    const gy = Math.min(grid.height - 1, Math.floor(((y - (y % block)) * grid.height) / (box.rows * 2)))
    const i = (gy * grid.width + gx) * 3
    const r = grid.rgb[i] ?? 0
    const g = grid.rgb[i + 1] ?? 0
    const b = grid.rgb[i + 2] ?? 0
    const luma = (0.299 * r + 0.587 * g + 0.114 * b) / 255
    const grain = (noise(x, y, seed) - 0.5) * 0.2 * (1 - lit)
    const tone = Math.min(1, Math.max(0, PAPER + (luma - PAPER) * up + grain))
    const mix = (lamp: number, real: number) => Math.round(lamp * tone + (real - lamp * tone) * lit)
    return (mix(LAMP[0], r) << 16) | (mix(LAMP[1], g) << 8) | mix(LAMP[2], b)
  }
  const words = new Uint32Array(box.columns * box.rows * 3)
  for (let y = 0; y < box.rows; y += 1) {
    for (let x = 0; x < box.columns; x += 1) {
      const o = (y * box.columns + x) * 3
      words[o] = HALF
      words[o + 1] = pixel(x, y * 2)
      words[o + 2] = pixel(x, y * 2 + 1)
    }
  }
  return new Uint8Array(words.buffer).toBase64()
}
