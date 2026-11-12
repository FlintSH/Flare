import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import sharp from 'sharp'

export const landingImages = [
  ['docs/images/timeline/library-desktop.webp', 'library-desktop.webp'],
  ['docs/images/image-gallery/after-390.png', 'library-mobile.webp'],
]

export async function prepareLandingAssets(
  site,
  repo = resolve(site, '../..')
) {
  const output = resolve(site, 'public/landing')
  await mkdir(output, { recursive: true })
  for (const [source, name] of landingImages) {
    await sharp(resolve(repo, source))
      .resize({ width: 1600, withoutEnlargement: true })
      .webp({ quality: 85, effort: 5 })
      .toFile(resolve(output, name))
  }
}
