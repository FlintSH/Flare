import { readFile, readdir, stat } from 'node:fs/promises'
import { dirname, extname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const site = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dist = resolve(site, '.vitepress/dist')
const base = process.env.DOCS_BASE || '/'
async function walk(dir) {
  return (
    await Promise.all(
      (await readdir(dir, { withFileTypes: true })).map((entry) =>
        entry.isDirectory()
          ? walk(resolve(dir, entry.name))
          : resolve(dir, entry.name)
      )
    )
  ).flat()
}
const files = new Set(await walk(dist))
const pages = [...files].filter((file) => file.endsWith('.html'))
const errors = new Set()
for (const file of files) {
  if (/^(test-results|playwright-report)\//.test(relative(dist, file)))
    errors.add(`Test artifacts must not be published: ${relative(dist, file)}`)
}
const decode = (value) =>
  value
    .replaceAll('&amp;', '&')
    .replaceAll('&#39;', "'")
    .replaceAll('&quot;', '"')
for (const file of pages) {
  const html = await readFile(file, 'utf8')
  for (const match of html.matchAll(/\b(?:href|src|poster)="([^"]+)"/g)) {
    const href = decode(match[1])
    if (/^(?:[a-z]+:|\/\/)/i.test(href)) continue
    const [pathname, hash] = href.split('#')
    const clean = decodeURIComponent(pathname.split('?')[0])
    if (clean.startsWith('/') && !clean.startsWith(base)) {
      errors.add(`${relative(dist, file)}: URL escapes DOCS_BASE: ${href}`)
      continue
    }
    let target = clean
      ? clean.startsWith('/')
        ? resolve(dist, clean.slice(base.length))
        : resolve(dirname(file), clean)
      : file
    if (clean.endsWith('/') || (!clean && !hash))
      target = resolve(target, 'index.html')
    if (!files.has(target) && !extname(target) && files.has(target + '.html'))
      target += '.html'
    if (!files.has(target)) {
      errors.add(`${relative(dist, file)}: missing ${href}`)
      continue
    }
    if (hash && target.endsWith('.html')) {
      const content = target === file ? html : await readFile(target, 'utf8')
      const id = decodeURIComponent(hash)
      if (!content.includes(`id="${id}"`))
        errors.add(`${relative(dist, file)}: missing anchor ${href}`)
    }
  }
}
const spec = JSON.parse(await readFile(resolve(dist, 'openapi.json'), 'utf8'))
const refs = JSON.stringify(spec).matchAll(/"\$ref":"(#[^"]+)"/g)
for (const [, ref] of refs) {
  let node = spec
  for (const part of ref.slice(2).split('/'))
    node = node?.[part.replaceAll('~1', '/').replaceAll('~0', '~')]
  if (node === undefined) errors.add(`OpenAPI: unresolved ${ref}`)
}
if (errors.size) {
  console.error([...errors].join('\n'))
  process.exit(1)
}
const bytes = (
  await Promise.all([...files].map(async (file) => (await stat(file)).size))
).reduce((a, b) => a + b, 0)
console.log(
  `Checked ${pages.length} HTML pages, local links, anchors, assets, and OpenAPI references. Static output: ${(bytes / 1e6).toFixed(1)} MB.`
)
