// A PNG decoder for the develop's pixel grid, in plain code: the sandbox a mod
// runs in has no DecompressionStream, and a PNG needs no external program.
// Small and plain over fast; it reads every color type, bit depth and Adam7.

import { gridSize } from './develop'
import type { Grid } from './develop'

// ---- zlib inflate (RFC 1950, 1951) ------------------------------------------

const LENGTH_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258]
const LENGTH_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0]
const DISTANCE_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577]
const DISTANCE_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13]
const CODE_LENGTH_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15]

/** A canonical Huffman code: how many codes of each length, and their symbols in order. */
type Huffman = { counts: Uint16Array; symbols: Uint16Array }

const huffman = (lengths: ArrayLike<number>): Huffman => {
  const counts = new Uint16Array(16)
  for (let i = 0; i < lengths.length; i += 1) {
    counts[lengths[i]!]! += 1
  }
  counts[0] = 0
  const offsets = new Uint16Array(16)
  for (let i = 1; i < 16; i += 1) {
    offsets[i] = offsets[i - 1]! + counts[i - 1]!
  }
  const symbols = new Uint16Array(lengths.length)
  for (let i = 0; i < lengths.length; i += 1) {
    const length = lengths[i]!
    if (length !== 0) {
      symbols[offsets[length]!] = i
      offsets[length]! += 1
    }
  }
  return { counts, symbols }
}

const FIXED_LITERALS = huffman(Array.from({ length: 288 }, (_, i) => (i < 144 ? 8 : i < 256 ? 9 : i < 280 ? 7 : 8)))
const FIXED_DISTANCES = huffman(new Array(30).fill(5))

/** Reads a deflate stream bit by bit, least significant bit first. */
class Bits {
  private at: number
  private byte = 0
  private left = 0

  constructor(
    private readonly data: Uint8Array,
    start: number,
  ) {
    this.at = start
  }

  bit(): number {
    if (this.left === 0) {
      if (this.at >= this.data.length) {
        throw new Error('png: the image data ends too soon')
      }
      this.byte = this.data[this.at]!
      this.at += 1
      this.left = 8
    }
    const bit = this.byte & 1
    this.byte >>= 1
    this.left -= 1
    return bit
  }

  bits(count: number): number {
    let value = 0
    for (let i = 0; i < count; i += 1) {
      value |= this.bit() << i
    }
    return value
  }

  // A stored block starts on a byte boundary.
  bytes(count: number): Uint8Array {
    this.left = 0
    if (this.at + count > this.data.length) {
      throw new Error('png: the image data ends too soon')
    }
    const chunk = this.data.subarray(this.at, this.at + count)
    this.at += count
    return chunk
  }

  symbol(code: Huffman): number {
    let first = 0
    let index = 0
    for (let length = 1; length < 16; length += 1) {
      first = 2 * first + this.bit()
      const count = code.counts[length]!
      if (first < count) {
        return code.symbols[index + first]!
      }
      index += count
      first -= count
    }
    throw new Error('png: a bad Huffman code')
  }
}

const dynamicCodes = (bits: Bits): [Huffman, Huffman] => {
  const literals = bits.bits(5) + 257
  const distances = bits.bits(5) + 1
  const lengthCodes = bits.bits(4) + 4
  const codeLengths = new Uint8Array(19)
  for (let i = 0; i < lengthCodes; i += 1) {
    codeLengths[CODE_LENGTH_ORDER[i]!] = bits.bits(3)
  }
  const lengthCode = huffman(codeLengths)
  const lengths = new Uint8Array(literals + distances)
  for (let n = 0; n < lengths.length; ) {
    const symbol = bits.symbol(lengthCode)
    if (symbol < 16) {
      lengths[n] = symbol
      n += 1
      continue
    }
    const [repeat, value] =
      symbol === 16
        ? [3 + bits.bits(2), n > 0 ? lengths[n - 1]! : -1]
        : symbol === 17
          ? [3 + bits.bits(3), 0]
          : [11 + bits.bits(7), 0]
    if (value < 0 || n + repeat > lengths.length) {
      throw new Error('png: bad code lengths')
    }
    lengths.fill(value, n, n + repeat)
    n += repeat
  }
  return [huffman(lengths.subarray(0, literals)), huffman(lengths.subarray(literals))]
}

/** Inflates a zlib stream into exactly `size` bytes; more is refused, as a bomb. */
export const inflate = (data: Uint8Array, size: number): Uint8Array => {
  const cmf = data[0] ?? 0
  const flags = data[1] ?? 0
  if ((cmf & 15) !== 8 || (cmf * 256 + flags) % 31 !== 0 || (flags & 32) !== 0) {
    throw new Error('png: not a zlib stream')
  }
  const out = new Uint8Array(size)
  const bits = new Bits(data, 2)
  let at = 0
  for (let isLast = 0; isLast === 0; ) {
    isLast = bits.bit()
    const type = bits.bits(2)
    if (type === 0) {
      const head = bits.bytes(4)
      const length = head[0]! | (head[1]! << 8)
      if (at + length > size) {
        throw new Error('png: more image data than its size')
      }
      out.set(bits.bytes(length), at)
      at += length
      continue
    }
    if (type === 3) {
      throw new Error('png: a bad deflate block')
    }
    const [literals, distances] = type === 1 ? [FIXED_LITERALS, FIXED_DISTANCES] : dynamicCodes(bits)
    for (let symbol = bits.symbol(literals); symbol !== 256; symbol = bits.symbol(literals)) {
      if (symbol < 256) {
        if (at >= size) {
          throw new Error('png: more image data than its size')
        }
        out[at] = symbol
        at += 1
        continue
      }
      const index = symbol - 257
      const length = LENGTH_BASE[index]! + bits.bits(LENGTH_EXTRA[index]!)
      const code = bits.symbol(distances)
      const distance = DISTANCE_BASE[code]! + bits.bits(DISTANCE_EXTRA[code]!)
      if (distance > at || at + length > size) {
        throw new Error('png: a bad back reference')
      }
      for (let i = 0; i < length; i += 1) {
        out[at] = out[at - distance]!
        at += 1
      }
    }
  }
  return out.subarray(0, at)
}

// ---- PNG ----------------------------------------------------------------------

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10]
const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }
// Adam7: where each pass starts and how far it steps, across then down.
const PASSES = [
  [0, 0, 8, 8],
  [4, 0, 8, 8],
  [0, 4, 4, 8],
  [2, 0, 4, 4],
  [0, 2, 2, 4],
  [1, 0, 2, 2],
  [0, 1, 1, 2],
] as const

export type PngHeader = { width: number; height: number; depth: number; color: number; isInterlaced: boolean }

const u32 = (bytes: Uint8Array, at: number) =>
  ((bytes[at]! << 24) | (bytes[at + 1]! << 16) | (bytes[at + 2]! << 8) | bytes[at + 3]!) >>> 0

/** The size and pixel format of a PNG, from its first chunk. */
export const pngHeader = (bytes: Uint8Array): PngHeader => {
  if (bytes.length < 33 || SIGNATURE.some((byte, i) => bytes[i] !== byte) || u32(bytes, 12) !== 0x49484452) {
    throw new Error('png: not a PNG')
  }
  const header = {
    width: u32(bytes, 16),
    height: u32(bytes, 20),
    depth: bytes[24]!,
    color: bytes[25]!,
    isInterlaced: bytes[28] === 1,
  }
  const channels = CHANNELS[header.color]
  const isDepthOk =
    channels !== undefined &&
    (header.color === 0 ? [1, 2, 4, 8, 16] : header.color === 3 ? [1, 2, 4, 8] : [8, 16]).includes(header.depth)
  if (!isDepthOk || header.width === 0 || header.height === 0) {
    throw new Error('png: an unknown pixel format')
  }
  return header
}

const paeth = (left: number, up: number, upLeft: number) => {
  const p = left + up - upLeft
  const toLeft = Math.abs(p - left)
  const toUp = Math.abs(p - up)
  const toUpLeft = Math.abs(p - upLeft)
  return toLeft <= toUp && toLeft <= toUpLeft ? left : toUp <= toUpLeft ? up : upLeft
}

/**
 * Decodes a PNG to the develop's pixel grid: square pixels, long side at most
 * `side`, each the average of the pixels it covers, alpha laid over `paper`
 * (0xRRGGBB). Refuses a picture of more than `maxPixels` before inflating it.
 */
export const decodePng = (bytes: Uint8Array, side: number, maxPixels: number, paper: number): Grid => {
  const header = pngHeader(bytes)
  const { width, height, depth, color } = header
  if (width * height > maxPixels) {
    throw new Error('png: too many pixels')
  }
  const channels = CHANNELS[color]!
  const bitsPerPixel = channels * depth
  const step = Math.max(1, bitsPerPixel >> 3) // bytes to the same channel of the pixel on the left
  const rowBytes = (columns: number) => Math.ceil((columns * bitsPerPixel) / 8)

  let palette: Uint8Array = new Uint8Array(0)
  let alphas: Uint8Array = new Uint8Array(0)
  const idat: Uint8Array[] = []
  for (let at = 8; at + 8 <= bytes.length; ) {
    const length = u32(bytes, at)
    const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8))
    const data = bytes.subarray(at + 8, at + 8 + length)
    if (type === 'PLTE') {
      palette = data
    } else if (type === 'tRNS') {
      alphas = data
    } else if (type === 'IDAT') {
      idat.push(data)
    } else if (type === 'IEND') {
      break
    }
    at += 12 + length
  }

  const passes = header.isInterlaced ? PASSES : ([[0, 0, 1, 1]] as const)
  const shapes = passes.map(([x0, y0, dx, dy]) => ({
    x0,
    y0,
    dx,
    dy,
    columns: Math.ceil((width - x0) / dx),
    rows: Math.ceil((height - y0) / dy),
  }))
  const size = shapes.reduce((sum, pass) => sum + (pass.columns > 0 ? pass.rows * (rowBytes(pass.columns) + 1) : 0), 0)
  const joined = new Uint8Array(idat.reduce((sum, part) => sum + part.length, 0))
  let offset = 0
  for (const part of idat) {
    joined.set(part, offset)
    offset += part.length
  }
  const raw = inflate(joined, size)
  if (raw.length !== size) {
    throw new Error('png: the image data ends too soon')
  }

  const grid = gridSize(width, height, side)
  const sums = new Float64Array(grid.width * grid.height * 3)
  const counts = new Uint32Array(grid.width * grid.height)
  const paperRgb = [(paper >> 16) & 255, (paper >> 8) & 255, paper & 255]
  const max = (1 << Math.min(depth, 8)) - 1
  const sample = (row: Uint8Array, x: number, channel: number) => {
    if (depth === 16) {
      return row[(x * channels + channel) * 2]!
    }
    if (depth === 8) {
      return row[x * channels + channel]!
    }
    const bit = x * depth
    return (row[bit >> 3]! >> (8 - depth - (bit & 7))) & max
  }
  const add = (row: Uint8Array, x: number, fullX: number, fullY: number) => {
    let r: number
    let g: number
    let b: number
    let a = 255
    if (color === 3) {
      const entry = sample(row, x, 0)
      r = palette[entry * 3] ?? 0
      g = palette[entry * 3 + 1] ?? 0
      b = palette[entry * 3 + 2] ?? 0
      a = alphas[entry] ?? 255
    } else if (color === 0 || color === 4) {
      r = g = b = depth < 8 ? Math.round((sample(row, x, 0) * 255) / max) : sample(row, x, 0)
      a = color === 4 ? sample(row, x, 1) : 255
    } else {
      r = sample(row, x, 0)
      g = sample(row, x, 1)
      b = sample(row, x, 2)
      a = color === 6 ? sample(row, x, 3) : 255
    }
    const cell =
      Math.min(grid.height - 1, Math.floor((fullY * grid.height) / height)) * grid.width +
      Math.min(grid.width - 1, Math.floor((fullX * grid.width) / width))
    sums[cell * 3]! += paperRgb[0]! + ((r - paperRgb[0]!) * a) / 255
    sums[cell * 3 + 1]! += paperRgb[1]! + ((g - paperRgb[1]!) * a) / 255
    sums[cell * 3 + 2]! += paperRgb[2]! + ((b - paperRgb[2]!) * a) / 255
    counts[cell]! += 1
  }

  let at = 0
  for (const pass of shapes) {
    if (pass.columns <= 0 || pass.rows <= 0) {
      continue
    }
    const length = rowBytes(pass.columns)
    let previous = new Uint8Array(length)
    for (let y = 0; y < pass.rows; y += 1) {
      const filter = raw[at]!
      const row = raw.slice(at + 1, at + 1 + length)
      at += 1 + length
      for (let i = 0; i < length; i += 1) {
        const left = i >= step ? row[i - step]! : 0
        const up = previous[i]!
        const upLeft = i >= step ? previous[i - step]! : 0
        const predicted =
          filter === 0
            ? 0
            : filter === 1
              ? left
              : filter === 2
                ? up
                : filter === 3
                  ? (left + up) >> 1
                  : filter === 4
                    ? paeth(left, up, upLeft)
                    : -1
        if (predicted < 0) {
          throw new Error('png: an unknown row filter')
        }
        row[i] = (row[i]! + predicted) & 255
      }
      for (let x = 0; x < pass.columns; x += 1) {
        add(row, x, pass.x0 + x * pass.dx, pass.y0 + y * pass.dy)
      }
      previous = row
    }
  }

  const rgb = new Uint8Array(grid.width * grid.height * 3)
  for (let cell = 0; cell < counts.length; cell += 1) {
    const count = Math.max(1, counts[cell]!)
    rgb[cell * 3] = Math.round(sums[cell * 3]! / count)
    rgb[cell * 3 + 1] = Math.round(sums[cell * 3 + 1]! / count)
    rgb[cell * 3 + 2] = Math.round(sums[cell * 3 + 2]! / count)
  }
  return { width: grid.width, height: grid.height, rgb }
}
