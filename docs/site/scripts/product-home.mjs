import { mkdir, readFile, writeFile, copyFile, rm } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { landingImages, prepareLandingAssets } from './landing-assets.mjs'

export const productNavigation = [
  { text: 'Explore', link: '/features' },
  { text: 'Docs', link: '/guide/' },
  { text: 'Self-host', link: '/hosting/' },
  { text: 'API', link: '/api/' },
  { text: 'Versions', link: '/versions' },
]

export const productPresentation = [
  'index.md',
  '.vitepress/theme/components/Home.vue',
  '.vitepress/theme/components/DocIcon.vue',
  '.vitepress/theme/landing.css',
  '.vitepress/theme/components/FeatureShowcase.vue',
  '.vitepress/theme/components/showcase-model.mjs',
  '.vitepress/theme/showcase.css',
]

// The public root is the project's home. Archives still render their original
// homepage, including their original component and any generated image bytes.
export async function withProductHome({ site, target, repo }, build) {
  const paths = [
    ...productPresentation,
    ...landingImages.map(([, name]) => `public/landing/${name}`),
  ]
  const originals = await Promise.all(
    paths.map(async (path) => {
      try {
        return await readFile(resolve(target, path))
      } catch (error) {
        if (error.code !== 'ENOENT') throw error
        return null
      }
    })
  )
  try {
    for (const path of productPresentation) {
      await mkdir(dirname(resolve(target, path)), { recursive: true })
      await copyFile(resolve(site, path), resolve(target, path))
    }
    await prepareLandingAssets(target, repo)
    return await build()
  } finally {
    await Promise.all(
      paths.map((path, index) =>
        originals[index] === null
          ? rm(resolve(target, path), { force: true })
          : writeFile(resolve(target, path), originals[index])
      )
    )
  }
}
