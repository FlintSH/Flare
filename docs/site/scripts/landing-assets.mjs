import { copyFile, mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

// The homepage recording and the still it shows first, for each screen size
// and theme. The WebM copy is for browsers built without H.264. They are
// recorded from a real Flare instance; see contributing.md.
const recordings = ['desktop', 'mobile'].flatMap((size) =>
  ['dark', 'light'].flatMap((theme) => [
    `${size}-${theme}.mp4`,
    `${size}-${theme}.webm`,
    `${size}-${theme}-poster.webp`,
  ])
)

// Each capture tool's own mark, shown beside its name on the homepage. They
// are published with their credits and license texts, which their terms ask
// to travel with every copy.
const toolMarks = [
  'sharex.png',
  'itake.png',
  'flameshot.svg',
  'spectacle.svg',
  'ember.svg',
  'CREDITS.txt',
  'licenses/GPL-3.0.txt',
  'licenses/LGPL-3.0.txt',
  'licenses/Free-Art-License-1.3.txt',
  'licenses/Breeze-icons-notice.txt',
].map((name) => `tools/${name}`)

export const landingAssets = [...recordings, ...toolMarks]

export async function prepareLandingAssets(
  site,
  repo = resolve(site, '../..')
) {
  const output = resolve(site, 'public/landing')
  for (const name of landingAssets) {
    await mkdir(dirname(resolve(output, name)), { recursive: true })
    await copyFile(
      resolve(repo, '.github/assets/landing', name),
      resolve(output, name)
    )
  }
}
