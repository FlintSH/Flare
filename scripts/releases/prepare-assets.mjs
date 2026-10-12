import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { basename, resolve, sep } from 'node:path'

const [version, destination] = process.argv.slice(2)
if (!/^\d+\.\d+\.\d+$/.test(version || '') || !destination) {
  throw new Error(
    'Usage: node scripts/releases/prepare-assets.mjs VERSION OUTPUT_DIRECTORY'
  )
}

const manifest = `.github/release-notes/v${version}.assets.json`
if (existsSync(manifest)) {
  const root = resolve('.')
  const assets = JSON.parse(readFileSync(manifest, 'utf8'))
  const names = new Set()
  for (const asset of assets) {
    const source = resolve(asset.source)
    if (
      !source.startsWith(`${root}${sep}`) ||
      basename(asset.name) !== asset.name ||
      names.has(asset.name)
    ) {
      throw new Error(`Invalid or duplicate release asset: ${asset.name}`)
    }
    names.add(asset.name)
    if (!existsSync(source))
      throw new Error(`Missing release asset: ${asset.source}`)
  }
  mkdirSync(destination, { recursive: true })
  for (const asset of assets)
    copyFileSync(asset.source, resolve(destination, asset.name))
  console.log(`Prepared ${assets.length} release assets for v${version}`)
} else {
  console.log(`No release asset manifest for v${version}`)
}
