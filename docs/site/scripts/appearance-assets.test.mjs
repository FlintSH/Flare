import { strict as assert } from 'node:assert'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { paletteCSS, readPalette } from './appearance-assets.mjs'

const source = await readFile(
  new URL('../../../lib/customization/schema.ts', import.meta.url),
  'utf8'
)

test('handbook palette follows every application default color in both themes', () => {
  const css = paletteCSS(source)
  for (const name of ['LIGHT_PALETTE', 'DARK_PALETTE']) {
    const palette = readPalette(source, name)
    assert.equal(Object.keys(palette).length, 19)
    for (const [key, value] of Object.entries(palette)) {
      const property = key.replace(
        /[A-Z]/g,
        (letter) => `-${letter.toLowerCase()}`
      )
      assert.ok(css.includes(`--${property}: ${value};`))
    }
  }
  assert.ok(css.includes(':root {'))
  assert.ok(css.includes('.dark {'))
})

test('palette changes that need a new reader fail instead of silently drifting', () => {
  assert.throws(() => readPalette('', 'LIGHT_PALETTE'), /Missing/)
  assert.throws(
    () =>
      readPalette(
        source.replace("background: '#f8fafc'", 'background: dynamicColor'),
        'LIGHT_PALETTE'
      ),
    /Expected 19 literal colors/
  )
})
