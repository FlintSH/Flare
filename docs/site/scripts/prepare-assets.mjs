import {
  access,
  copyFile,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

import { getBuildInfo } from './build-info.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
async function walk(path) {
  const entries = await readdir(path, { withFileTypes: true })
  const lists = await Promise.all(
    entries
      .filter(
        (entry) =>
          !['node_modules', 'public', 'dist', 'cache', 'test-results'].includes(
            entry.name
          )
      )
      .map((entry) => {
        const child = resolve(path, entry.name)
        return entry.isDirectory() ? walk(child) : child
      })
  )
  return lists.flat()
}
const files = (await walk(root)).filter((file) =>
  /\.(md|vue|mjs|js)$/.test(file)
)
const images = new Set()
const evidence = new Set()
const pages = []
for (const file of files) {
  const source = await readFile(file, 'utf8')
  for (const match of source.matchAll(
    /\/screenshots\/([a-zA-Z0-9/_-]+\.(?:png|jpg|webp))/g
  ))
    images.add(match[1])
  for (const match of source.matchAll(
    /\/evidence\/([a-zA-Z0-9/_-]+\.(?:png|jpg|webp))/g
  ))
    evidence.add(match[1])
  if (file.endsWith('.md')) pages.push({ path: relative(root, file), source })
}
let sourceBytes = 0
let outputBytes = 0
for (const directory of ['screenshots', 'evidence', 'demos']) {
  await rm(resolve(root, 'public', directory), { recursive: true, force: true })
}
const prepared = new Set()
for (const [name, location, output] of [...images]
  .map((name) => [name, '../images', 'screenshots'])
  .concat(
    [...evidence].map((name) => [name, '../../.github/assets', 'evidence'])
  )) {
  let source = resolve(root, location, name)
  // Vue can use the prepared .webp URL directly while the source stays PNG.
  try {
    await access(source)
  } catch {
    if (!source.endsWith('.webp'))
      throw new Error(`Missing screenshot source: ${source}`)
    source = source.replace(/\.webp$/, '.png')
    await access(source)
  }
  const target = resolve(
    root,
    'public',
    output,
    name.replace(/\.(png|jpg)$/, '.webp')
  )
  if (prepared.has(target)) continue
  prepared.add(target)
  await mkdir(dirname(target), { recursive: true })
  // Preserve readable text and UI edges with a bounded desktop width.
  await sharp(source)
    .resize({ width: 1600, withoutEnlargement: true })
    .webp({ quality: 85, effort: 5 })
    .toFile(target)
  sourceBytes += (await stat(source)).size
  outputBytes += (await stat(target)).size
}
await mkdir(resolve(root, 'public'), { recursive: true })
await writeFile(
  resolve(root, 'public/build-info.json'),
  JSON.stringify(getBuildInfo(), null, 2) + '\n'
)
await copyFile(
  resolve(root, '../../public/icon.svg'),
  resolve(root, 'public/icon.svg')
)
await copyFile(
  resolve(root, '../../examples/integrations.mjs'),
  resolve(root, 'public/integrations.mjs')
)
await mkdir(resolve(root, 'public/demos'), { recursive: true })
for (const name of ['organizing-demo', 'sharing-demo', 'protected-file-demo']) {
  await copyFile(
    resolve(root, '../../.github/assets/vault-folders', `${name}.mp4`),
    resolve(root, 'public/demos', `${name}.mp4`)
  )
}
const index = [
  '# Flare documentation',
  '',
  '> Documentation for the source revision that built this site.',
  '',
  ...pages
    .sort((a, b) => a.path.localeCompare(b.path))
    .map(({ path, source }) => {
      const title = source.match(/^# (.+)$/m)?.[1] || path
      return `- [${title}](./${path.replace(/\.md$/, '.html')}): ${source.match(/^description: (.+)$/m)?.[1] || title}`
    }),
].join('\n')
await writeFile(resolve(root, 'public/llms.txt'), index + '\n')
console.log(
  `Prepared ${prepared.size} referenced screenshots: ${(sourceBytes / 1e6).toFixed(1)} MB source → ${(outputBytes / 1e6).toFixed(1)} MB WebP. Generated assets stay out of Git.`
)
