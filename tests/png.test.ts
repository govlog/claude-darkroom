import { expect, test } from 'claude-code/testing'

import { decodePng } from '../hooks/png'
import { BOMB, FIXTURES, PAPER } from './fixtures'

const MAX_PIXELS = 64_000_000
const hex = (bytes: Uint8Array) => [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('')
const sha256 = async (bytes: Uint8Array) => hex(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)))

for (const fixture of FIXTURES) {
  test(`a PNG decodes to the grid ImageMagick reads from it: ${fixture.name}, side ${fixture.side}`, async () => {
    const grid = decodePng(Uint8Array.fromBase64(fixture.png), fixture.side, MAX_PIXELS, PAPER)
    expect([grid.width, grid.height]).toEqual([fixture.width, fixture.height])
    if (fixture.hex !== undefined) {
      expect(hex(grid.rgb)).toBe(fixture.hex)
    } else {
      expect(await sha256(grid.rgb)).toBe(fixture.sha256)
    }
  })
}

test('a PNG with too many pixels is refused before its data is inflated', () => {
  expect(() => decodePng(Uint8Array.fromBase64(BOMB), 64, MAX_PIXELS, PAPER)).toThrow('too many pixels')
})
