import { execFileSync } from 'node:child_process'
import { posix } from 'node:path'

export const repository = 'FlintSH/Flare'
const stableTag = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/

export function selectReleases(latest, releases) {
  const stable = releases.filter(
    (release) =>
      !release.draft &&
      !release.prerelease &&
      stableTag.test(release.tag_name || '')
  )
  const seen = new Set()
  for (const release of stable) {
    if (seen.has(release.tag_name))
      throw new Error(`Duplicate release ${release.tag_name}`)
    seen.add(release.tag_name)
    if (
      !release.published_at ||
      !Number.isFinite(Date.parse(release.published_at))
    )
      throw new Error(`Missing publication date for ${release.tag_name}`)
  }
  if (
    !latest ||
    latest.draft ||
    latest.prerelease ||
    !stableTag.test(latest.tag_name || '') ||
    !seen.has(latest.tag_name)
  )
    throw new Error(
      'GitHub latest release must be a published stable vX.Y.Z tag'
    )
  const matched = stable.find((release) => release.tag_name === latest.tag_name)
  if (matched.published_at !== latest.published_at)
    throw new Error('Latest release changed during discovery; retry the build')
  return stable.sort((a, b) => {
    const left = a.tag_name.slice(1).split('.').map(BigInt)
    const right = b.tag_name.slice(1).split('.').map(BigInt)
    for (let i = 0; i < 3; i++) {
      if (left[i] !== right[i]) return left[i] > right[i] ? -1 : 1
    }
    return 0
  })
}

export async function discoverReleases({ token, fetchImpl = fetch } = {}) {
  const headers = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }
  async function request(path) {
    const response = await fetchImpl(
      `https://api.github.com/repos/${repository}/${path}`,
      { headers, signal: AbortSignal.timeout(30_000) }
    )
    if (!response.ok)
      throw new Error(`GitHub release discovery failed (${response.status})`)
    return response.json()
  }
  const latest = await request('releases/latest')
  const rolling = await request('releases/tags/rolling')
  rollingIdentity(rolling)
  const releases = []
  for (let page = 1; ; page++) {
    const batch = await request(`releases?per_page=100&page=${page}`)
    if (!Array.isArray(batch))
      throw new Error('Invalid GitHub releases response')
    releases.push(...batch)
    if (batch.length < 100) break
  }
  return { latest, rolling, releases: selectReleases(latest, releases) }
}

export function git(repo, args) {
  return execFileSync('git', args, {
    cwd: repo,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trimEnd()
}

export function readSource(repo, commit, path) {
  // Do not trim: comparison downloads preserve the exact source bytes as text.
  return execFileSync('git', ['show', `${commit}:${path}`], {
    cwd: repo,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  })
}

export function titleFor(path, content) {
  const frontmatter =
    content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1] || ''
  return (
    frontmatter.match(/^title:\s*['"]?(.+?)['"]?\s*$/m)?.[1] ||
    content.match(/^#\s+(.+)$/m)?.[1] ||
    (path === 'README.md'
      ? 'Release README'
      : posix.basename(path).replace(/\.(?:md|vue|json)$/, ''))
  )
}

function inspectSource(repo, commit) {
  const version = JSON.parse(readSource(repo, commit, 'package.json')).version
  const paths = git(repo, ['ls-tree', '-r', '--name-only', commit]).split('\n')
  const kind = paths.includes('docs/site/.vitepress/config.mjs')
    ? 'handbook'
    : 'legacy'
  const pageSources = paths.filter((path) =>
    kind === 'handbook'
      ? path.startsWith('docs/site/') &&
        path.endsWith('.md') &&
        !path.includes('/.vitepress/') &&
        !path.includes('/node_modules/')
      : path === 'README.md' || /^docs\/[^/]+\.md$/.test(path)
  )
  const pages = pageSources.map((source) => ({
    path:
      kind === 'handbook'
        ? source.slice('docs/site/'.length).replace(/\.md$/, '.html')
        : source === 'README.md'
          ? 'index.html'
          : source.replace(/\.md$/, '.html'),
    source,
    title: titleFor(source, readSource(repo, commit, source)),
  }))
  return { version, paths, kind, pageSources, pages }
}

export function releaseSource(repo, release, { latest = false } = {}) {
  const tag = release.tag_name
  if (!stableTag.test(tag)) throw new Error(`Invalid stable release tag ${tag}`)
  let commit
  try {
    commit = git(repo, ['rev-parse', '--verify', `refs/tags/${tag}^{commit}`])
  } catch {
    throw new Error(
      `Missing release tag ${tag}; fetch all tags before building`
    )
  }
  const { version, paths, kind, pageSources, pages } = inspectSource(
    repo,
    commit
  )
  if (!stableTag.test(`v${version}`))
    throw new Error(`${tag} has an invalid source package version: ${version}`)
  if (latest && version !== tag.slice(1))
    throw new Error(
      `${tag} package version is ${version}; refusing mislabeled docs`
    )
  const metadata = {
    tag,
    version,
    publishedAt: new Date(release.published_at).toISOString(),
    commit,
    path: `versions/${tag}/`,
    kind,
    pages,
  }
  const compared = new Set(pageSources)
  if (kind === 'handbook')
    for (const path of paths) {
      if (
        /^docs\/site\/\.vitepress\/theme\/components\/[^/]+\.vue$/.test(path) ||
        /^docs\/site\/public\/[^/]+\.json$/.test(path)
      )
        compared.add(path)
    }
  const files = Object.fromEntries(
    [...compared].sort().map((path) => {
      const content = readSource(repo, commit, path)
      const page = pages.find((entry) => entry.source === path)
      return [
        path,
        {
          title: titleFor(path, content),
          content,
          url: page
            ? `${metadata.path}${page.path}`
            : `https://github.com/${repository}/blob/${commit}/${path}`,
        },
      ]
    })
  )
  return { metadata, snapshot: { tag, files } }
}

export function rollingIdentity(release) {
  if (
    release?.tag_name !== 'rolling' ||
    release.draft !== false ||
    release.prerelease !== true
  )
    throw new Error(
      'Rolling documentation requires the published rolling prerelease'
    )
  if (!release.updated_at || !Number.isFinite(Date.parse(release.updated_at)))
    throw new Error('Rolling release has no valid update date')
  // Match the application's rolling-update contract in lib/releases.ts. The
  // publish workflow updates this marker after images ship; target_commitish
  // and the movable rolling tag can still point to a previous build.
  const markers = [
    ...(release.body || '').matchAll(
      /<!-- flare-commit-sha: ([a-f0-9]{40}) -->/gi
    ),
  ]
  if (markers.length !== 1)
    throw new Error(
      'Published rolling release must identify one immutable commit in its flare-commit-sha marker'
    )
  return {
    commit: markers[0][1].toLowerCase(),
    updatedAt: new Date(release.updated_at).toISOString(),
  }
}

export function rollingSource(repo, release) {
  const { commit, updatedAt } = rollingIdentity(release)
  let resolved
  try {
    resolved = git(repo, ['rev-parse', '--verify', `${commit}^{commit}`])
  } catch {
    // Fetch the published immutable object without moving a local rolling tag.
    git(repo, ['fetch', '--no-tags', 'origin', commit])
    resolved = git(repo, ['rev-parse', '--verify', `${commit}^{commit}`])
  }
  if (resolved !== commit)
    throw new Error('Rolling release marker must identify a Git commit object')
  const { version, kind, pages } = inspectSource(repo, commit)
  if (typeof version !== 'string' || !version)
    throw new Error('Rolling source has no package version')
  if (kind !== 'handbook')
    throw new Error('Published rolling release does not contain the handbook')
  return { path: 'rolling/', commit, version, updatedAt, pages, kind }
}

export function rollingBuildInfo(rolling, renderer, builtAt) {
  return {
    version: rolling.version,
    commit: rolling.commit,
    shortCommit: rolling.commit.slice(0, 8),
    dirty: false,
    builtAt,
    channel: 'rolling',
    rolling: { updatedAt: rolling.updatedAt },
    renderer: { commit: renderer.commit, dirty: renderer.dirty },
  }
}

export function releaseBuildInfo(release, latest, renderer, builtAt) {
  return {
    version: release.version,
    commit: release.commit,
    shortCommit: release.commit.slice(0, 8),
    dirty: false,
    builtAt,
    release: {
      tag: release.tag,
      publishedAt: release.publishedAt,
      latest: release.tag === latest,
    },
    renderer: { commit: renderer.commit, dirty: renderer.dirty },
  }
}
