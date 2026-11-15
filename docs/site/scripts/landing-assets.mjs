import { copyFile, mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'

// The homepage recording and the still it shows first, for each screen size
// and theme. The WebM copy is for browsers built without H.264. They are
// recorded from a real Flare instance; see contributing.md.
export const landingAssets = ['desktop', 'mobile'].flatMap((size) =>
  ['dark', 'light'].flatMap((theme) => [
    `${size}-${theme}.mp4`,
    `${size}-${theme}.webm`,
    `${size}-${theme}-poster.webp`,
  ])
)

export async function prepareLandingAssets(
  site,
  repo = resolve(site, '../..')
) {
  const output = resolve(site, 'public/landing')
  await mkdir(output, { recursive: true })
  for (const name of landingAssets)
    await copyFile(
      resolve(repo, '.github/assets/landing', name),
      resolve(output, name)
    )
}
