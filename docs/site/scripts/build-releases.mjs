import { execFileSync, spawn } from 'node:child_process'
import {
  access,
  copyFile,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getBuildInfo } from './build-info.mjs'
import {
  discoverReleases,
  releaseBuildInfo,
  releaseSource,
  rollingBuildInfo,
  rollingSource,
  selectReleases,
} from './release-data.mjs'
import { prepareLegacy } from './release-render.mjs'
import {
  recoverDirectoryPublication,
  replaceDirectory,
} from './release-publish.mjs'

const site = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repo = resolve(site, '../..')
const output = resolve(site, '.vitepress/releases')
const base = process.env.DOCS_BASE || '/'
if (!base.startsWith('/') || !base.endsWith('/') || /[?#\\]/.test(base))
  throw new Error('DOCS_BASE must be a URL path beginning and ending with /')
const args = process.argv.slice(2)
if (args.length && (args.length !== 2 || args[0] !== '--manifest'))
  throw new Error(
    'Usage: node scripts/build-releases.mjs [--manifest fixture.json]'
  )
await recoverDirectoryPublication(output)

function token() {
  if (process.env.GH_TOKEN || process.env.GITHUB_TOKEN)
    return process.env.GH_TOKEN || process.env.GITHUB_TOKEN
  try {
    return execFileSync('gh', ['auth', 'token'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    return undefined
  }
}

function run(command, arguments_, cwd, env = {}) {
  return new Promise((accept, reject) => {
    const child = spawn(command, arguments_, {
      cwd,
      env: { ...process.env, ...env },
      stdio: 'inherit',
    })
    child.on('error', reject)
    child.on('exit', (code, signal) => {
      if (code === 0) accept()
      else reject(new Error(`${command} failed (${signal || code})`))
    })
  })
}

async function exists(path) {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function copy(source, target) {
  await mkdir(dirname(target), { recursive: true })
  await copyFile(source, target)
}

async function overlayChrome(target, legacy) {
  for (const name of [
    'BuildStamp.vue',
    'VersionHistory.vue',
    'version-diff.mjs',
    'ProjectCredit.vue',
    ...(legacy ? ['Screenshot.vue'] : []),
  ]) {
    await copy(
      resolve(site, '.vitepress/theme/components', name),
      resolve(target, '.vitepress/theme/components', name)
    )
  }
  await copy(resolve(site, 'versions.md'), resolve(target, 'versions.md'))
  for (const screenshot of [
    'handbook/docs-versions.webp',
    'handbook/docs-rolling.webp',
  ]) {
    const image = resolve(repo, 'docs/images', screenshot)
    if (await exists(image)) {
      await copy(image, resolve(target, '../images', screenshot))
      // Legacy archives have no asset preparation pipeline of their own.
      if (legacy)
        await copy(image, resolve(target, 'public/screenshots', screenshot))
    }
  }
  if (legacy) {
    await copy(
      resolve(site, '.vitepress/theme/style.css'),
      resolve(target, '.vitepress/theme/style.css')
    )
    await copy(
      resolve(site, '.vitepress/theme/Layout.vue'),
      resolve(target, '.vitepress/theme/Layout.vue')
    )
    await writeFile(
      resolve(target, '.vitepress/theme/index.js'),
      `import DefaultTheme from 'vitepress/theme'\nimport Layout from './Layout.vue'\nimport VersionHistory from './components/VersionHistory.vue'\nimport Screenshot from './components/Screenshot.vue'\nimport './style.css'\nexport default { extends: DefaultTheme, Layout, enhanceApp({ app }) { app.component('VersionHistory', VersionHistory); app.component('Screenshot', Screenshot) } }\n`
    )
  } else {
    const indexPath = resolve(target, '.vitepress/theme/index.js')
    const original = await readFile(indexPath, 'utf8')
    await writeFile(
      resolve(target, '.vitepress/theme/release-theme.js'),
      original
    )
    await writeFile(
      indexPath,
      `import historical from './release-theme.js'\nimport VersionHistory from './components/VersionHistory.vue'\nexport default { ...historical, enhanceApp(context) { historical.enhanceApp?.(context); context.app.component('VersionHistory', VersionHistory) } }\n`
    )
  }
}

async function configure(target, release, manifest, info, releaseBase, legacy) {
  const rolling = info.channel === 'rolling'
  const replacedMeta = [
    'flare:version',
    'flare:commit',
    ...(rolling ? ['robots'] : []),
  ]
  const historical = legacy ? '{}' : 'historical'
  const sidebar = legacy
    ? `[{ text: 'Original release documentation', items: ${JSON.stringify(release.pages.map((page) => ({ text: page.title, link: `/${page.path}` })))} }]`
    : '(historical.themeConfig?.sidebar || [])'
  await writeFile(
    resolve(target, '.vitepress/config.mjs'),
    `${legacy ? '' : "import historical from './release-config.mjs'\n"}const source = ${historical}\nexport default {
  ...source,
  title: 'Flare Docs',
  titleTemplate: ${JSON.stringify(`:title | ${rolling ? 'Rolling (unreleased)' : release.tag} | Flare Docs`)},
  description: 'Versioned Flare documentation from published releases.',
  lang: 'en-US', base: ${JSON.stringify(releaseBase)},
  appearance: source.appearance || 'dark',
  lastUpdated: false,
  outDir: ${JSON.stringify(resolve(target, '.vitepress/dist'))},
  head: [...(source.head || []).filter(([tag, attrs]) => !(tag === 'meta' && ${JSON.stringify(replacedMeta)}.includes(attrs?.name)) && !(tag === 'link' && attrs?.rel === 'icon')),
    ${rolling ? "['meta', { name: 'robots', content: 'noindex,follow' }]," : ''}
    ['link', { rel: 'icon', type: 'image/svg+xml', href: ${JSON.stringify(`${releaseBase}icon.svg`)} }],
    ['meta', { name: 'flare:version', content: ${JSON.stringify(info.version)} }],
    ['meta', { name: 'flare:commit', content: ${JSON.stringify(info.commit)} }]],
  vite: { ...(source.vite || {}), css: { postcss: { plugins: [] } } },
  ${legacy ? 'vue: { template: { transformAssetUrls: false } },' : ''}
  themeConfig: {
    ...(source.themeConfig || {}),
    siteTitle: 'Flare', logo: '/icon.svg',
    buildInfo: ${JSON.stringify(info)},
    docsVersions: ${JSON.stringify(manifest)},
    docsRoot: ${JSON.stringify(base)},
    nav: [...(source.themeConfig?.nav || []).filter(item => item.link !== '/versions'), { text: 'Versions', link: '/versions' }],
    sidebar: ${sidebar},
    search: { provider: 'local', options: { detailedView: true } },
    editLink: undefined,
  }
}\n`
  )
  await mkdir(resolve(target, 'public'), { recursive: true })
  await writeFile(
    resolve(target, 'public/build-info.json'),
    JSON.stringify(info, null, 2) + '\n'
  )
  await writeFile(
    resolve(target, 'public/docs-versions.json'),
    JSON.stringify(manifest, null, 2) + '\n'
  )
}

const discovered = args.length
  ? JSON.parse(await readFile(resolve(args[1]), 'utf8'))
  : await discoverReleases({ token: token() })
const selected = selectReleases(discovered.latest, discovered.releases)
const sources = selected.map((release) =>
  releaseSource(repo, release, {
    latest: release.tag_name === discovered.latest.tag_name,
  })
)
const rolling = rollingSource(repo, discovered.rolling)
const manifest = {
  schemaVersion: 1,
  latest: discovered.latest.tag_name,
  releases: sources.map(({ metadata }) => metadata),
  rolling,
}
const renderer = getBuildInfo()
const builtAt = new Date().toISOString()
const temporary = await mkdtemp(resolve(tmpdir(), 'flare-docs-releases-'))
const assembled = resolve(temporary, 'output')
await mkdir(assembled)
try {
  // Build the stable root first; version directories are added afterward.
  const ordered = [...sources].sort(
    (a, b) =>
      Number(b.metadata.tag === manifest.latest) -
      Number(a.metadata.tag === manifest.latest)
  )
  ordered.push({ metadata: rolling, channel: 'rolling' })
  for (const { metadata: release, channel = 'stable' } of ordered) {
    const label = channel === 'rolling' ? 'rolling' : release.tag
    console.log(
      `Building ${label} (${release.kind}, ${release.publishedAt || release.updatedAt})`
    )
    const archive = resolve(temporary, label)
    const target = resolve(archive, 'docs/site')
    const legacy = release.kind === 'legacy'
    await mkdir(target, { recursive: true })
    if (!legacy) {
      const tar = resolve(temporary, `${label}.tar`)
      await run('git', ['archive', '-o', tar, release.commit], repo)
      await run('tar', ['-xf', tar, '-C', archive], repo)
      await rm(tar)
      await rename(
        resolve(target, '.vitepress/config.mjs'),
        resolve(target, '.vitepress/release-config.mjs')
      )
    }
    await symlink(
      resolve(site, 'node_modules'),
      resolve(target, 'node_modules')
    )
    await overlayChrome(target, legacy)
    if (legacy) {
      await copy(
        resolve(repo, 'public/icon.svg'),
        resolve(target, 'public/icon.svg')
      )
    } else {
      await run(
        process.execPath,
        [resolve(target, 'scripts/prepare-assets.mjs')],
        target
      )
    }
    const info =
      channel === 'rolling'
        ? rollingBuildInfo(release, renderer, builtAt)
        : releaseBuildInfo(release, manifest.latest, renderer, builtAt)
    const destinations =
      release.tag === manifest.latest
        ? [
            { path: '', base },
            { path: release.path, base: `${base}${release.path}` },
          ]
        : [{ path: release.path, base: `${base}${release.path}` }]
    for (const destination of destinations) {
      if (legacy)
        await prepareLegacy({
          repo,
          site: target,
          release,
          base: destination.base,
        })
      await configure(target, release, manifest, info, destination.base, legacy)
      await run(
        process.execPath,
        [
          resolve(site, 'node_modules/vitepress/bin/vitepress.js'),
          'build',
          target,
        ],
        target,
        { DOCS_BASE: destination.base }
      )
      await cp(
        resolve(target, '.vitepress/dist'),
        resolve(assembled, destination.path),
        {
          recursive: true,
        }
      )
      await rm(resolve(target, '.vitepress/dist'), {
        recursive: true,
        force: true,
      })
    }
    await rm(archive, { recursive: true, force: true })
  }
  await mkdir(resolve(assembled, 'history'))
  for (const { metadata, snapshot } of sources)
    await writeFile(
      resolve(assembled, 'history', `${metadata.tag}.json`),
      JSON.stringify(snapshot) + '\n'
    )
  await run(
    process.execPath,
    [resolve(site, 'scripts/check-build.mjs')],
    site,
    {
      DOCS_BASE: base,
      DOCS_DIST: assembled,
    }
  )
  await replaceDirectory(assembled, output)
  console.log(
    `Published build ready: ${output} (${sources.length} stable releases, stable ${manifest.latest}, rolling ${rolling.commit.slice(0, 8)})`
  )
} finally {
  await rm(temporary, { recursive: true, force: true })
}
