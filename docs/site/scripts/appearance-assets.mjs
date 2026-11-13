import { readFile, mkdir, writeFile, copyFile } from 'node:fs/promises'
import { resolve } from 'node:path'

// Read only literal palette data. Importing the application schema would pull
// runtime dependencies into the independently installed handbook.
export function readPalette(source, name) {
  const body = source.match(
    new RegExp(`export const ${name}: Palette = \\{([^}]+)\\}`)
  )?.[1]
  if (!body) throw new Error(`Missing application palette: ${name}`)
  const entry = /\s*(\w+): '(#[\da-fA-F]{6})',/g
  const entries = [...body.matchAll(entry)]
  if (body.replace(entry, '').trim() || entries.length !== 19)
    throw new Error(`Expected 19 literal colors in ${name}`)
  return Object.fromEntries(entries.map(([, key, value]) => [key, value]))
}

export function paletteCSS(source) {
  return [
    ['LIGHT_PALETTE', ':root'],
    ['DARK_PALETTE', '.dark'],
  ]
    .map(([name, selector]) => {
      const declarations = Object.entries(readPalette(source, name)).map(
        ([key, value]) =>
          `  --${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}: ${value};`
      )
      return `${selector} {\n${declarations.join('\n')}\n}`
    })
    .join('\n')
}

export async function prepareAppearance(
  root,
  applicationRoot = resolve(root, '../..')
) {
  const source = await readFile(
    resolve(applicationRoot, 'lib/customization/defaults.ts'),
    'utf8'
  )
  await writeFile(
    resolve(root, 'public/flare-theme.css'),
    `/* Generated from Flare's default palettes. Do not edit. */\n${paletteCSS(source)}\n`
  )
  await mkdir(resolve(root, 'public/fonts'), { recursive: true })
  for (const name of [
    'Inter-VariableFont_opsz_wght.ttf',
    'Inter-Italic-VariableFont_opsz_wght.ttf',
  ]) {
    await copyFile(
      resolve(applicationRoot, 'public/fonts/inter', name),
      resolve(root, 'public/fonts', name)
    )
  }
}
