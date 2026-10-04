import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import test from 'node:test'
import { createMarkdownRenderer } from 'vitepress'
import { parse } from 'vue/compiler-sfc'
import {
  discoverReleases,
  releaseBuildInfo,
  releaseSource,
  selectReleases,
} from './release-data.mjs'
import { prepareLegacy, renderLegacyMarkdown } from './release-render.mjs'

const publishedAt = '2026-09-20T09:30:00Z'
const release = (tag, overrides = {}) => ({
  tag_name: tag,
  draft: false,
  prerelease: false,
  published_at: publishedAt,
  ...overrides,
})

test('selects only published stable semver tags and honors GitHub latest', () => {
  const latest = release('v2.1.0')
  const selected = selectReleases(latest, [
    release('development'),
    release('rolling'),
    release('v02.1.0'),
    release('v2.2.0-rc.1'),
    release('v9.0.0', { prerelease: true }),
    release('v8.0.0', { draft: true }),
    release('v1.9.0'),
    release('v1.10.0'),
    latest,
  ])
  assert.deepEqual(
    selected.map((entry) => entry.tag_name),
    ['v2.1.0', 'v1.10.0', 'v1.9.0']
  )
  assert.throws(() => selectReleases(release('rolling'), selected), /latest/)
  assert.throws(() => selectReleases(release('v3.0.0'), selected), /latest/)
})

test('fails closed on missing dates, duplicate releases and discovery races', () => {
  const latest = release('v2.1.0')
  assert.throws(
    () =>
      selectReleases(latest, [
        latest,
        release('v1.0.0', { published_at: null }),
      ]),
    /publication date/
  )
  assert.throws(
    () => selectReleases(latest, [latest, latest]),
    /Duplicate release/
  )
  assert.throws(
    () =>
      selectReleases({ ...latest, published_at: '2026-09-21T00:00:00Z' }, [
        latest,
      ]),
    /changed during discovery/
  )
})

test('discovers all paginated GitHub releases without fetching docs from main', async () => {
  const requests = []
  const latest = release('v2.1.0')
  const result = await discoverReleases({
    token: 'fixture-token',
    fetchImpl: async (url, options) => {
      requests.push(url)
      assert.equal(options.headers.Authorization, 'Bearer fixture-token')
      return {
        ok: true,
        json: async () =>
          url.endsWith('/latest')
            ? latest
            : url.endsWith('page=1')
              ? [
                  latest,
                  ...Array.from({ length: 99 }, (_, i) =>
                    release(`rolling-${i}`)
                  ),
                ]
              : [release('v1.0.0')],
      }
    },
  })
  assert.equal(requests.length, 3)
  assert.match(requests[2], /page=2$/)
  assert.equal(result.latest.tag_name, 'v2.1.0')
  assert.equal(result.releases.length, 2)
  await assert.rejects(
    discoverReleases({ fetchImpl: async () => ({ ok: false, status: 403 }) }),
    /failed \(403\)/
  )
})

async function fixture(t) {
  const repo = await mkdtemp(resolve(tmpdir(), 'flare-release-fixture-'))
  t.after(() => rm(repo, { recursive: true, force: true }))
  const git = (...args) =>
    execFileSync('git', args, {
      cwd: repo,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim()
  git('init')
  git('config', 'user.name', 'Documentation fixture')
  git('config', 'user.email', 'fixture@example.test')
  async function write(path, text) {
    await mkdir(resolve(repo, path, '..'), { recursive: true })
    await writeFile(resolve(repo, path), text)
  }
  async function commit(tag, version, paths) {
    await write('package.json', JSON.stringify({ version }))
    for (const [path, content] of Object.entries(paths))
      await write(path, content)
    git('add', '.')
    git('commit', '-m', tag)
    git('tag', tag)
    return git('rev-parse', 'HEAD')
  }
  return { repo, write, commit, git }
}

test('snapshots exact tagged source, release publication dates and original pages', async (t) => {
  const { repo, commit, write } = await fixture(t)
  const markdown = '# Original README\n\n[Guide](docs/setup.md)\n'
  const revision = await commit('v1.0.0', '1.0.0', {
    'README.md': markdown,
    'docs/setup.md': '# Original setup\n',
  })
  await write('README.md', '# Unreleased changes must not appear\n')
  const { metadata, snapshot } = releaseSource(repo, release('v1.0.0'))
  assert.equal(metadata.commit, revision)
  assert.equal(metadata.kind, 'legacy')
  assert.equal(metadata.publishedAt, '2026-09-20T09:30:00.000Z')
  assert.equal(snapshot.files['README.md'].content, markdown)
  assert.equal(snapshot.files['README.md'].url, 'versions/v1.0.0/index.html')
  assert.equal(
    snapshot.files['docs/setup.md'].url,
    'versions/v1.0.0/docs/setup.html'
  )
  assert.throws(
    () => releaseSource(repo, release('v7.0.0')),
    /Missing release tag/
  )
})

test('handbook snapshot includes historical components and public contracts', async (t) => {
  const { repo, commit } = await fixture(t)
  await commit('v2.1.0', '2.1.0', {
    'README.md': '# Repository overview\n',
    'docs/site/.vitepress/config.mjs': 'export default {}\n',
    'docs/site/index.md': '# Handbook\n',
    'docs/site/.vitepress/theme/components/FeatureExplorer.vue':
      '<template>Old capability</template>\n',
    'docs/site/public/openapi.json': '{"openapi":"3.1.0"}\n',
  })
  const { metadata, snapshot } = releaseSource(repo, release('v2.1.0'))
  assert.equal(metadata.kind, 'handbook')
  assert.equal(metadata.pages.length, 1)
  assert.equal(metadata.pages[0].source, 'docs/site/index.md')
  assert.equal(Object.keys(snapshot.files).length, 3)
  assert.match(
    snapshot.files['docs/site/.vitepress/theme/components/FeatureExplorer.vue']
      .content,
    /Old capability/
  )
  assert.match(
    snapshot.files['docs/site/public/openapi.json'].url,
    /github\.com/
  )
})

test('preserves historical package mismatches but refuses them for latest stable', async (t) => {
  const { repo, commit } = await fixture(t)
  await commit('v1.0.0', '0.9.9', { 'README.md': '# Wrong version\n' })
  const { metadata } = releaseSource(repo, release('v1.0.0'))
  assert.equal(metadata.tag, 'v1.0.0')
  assert.equal(metadata.version, '0.9.9')
  assert.throws(
    () => releaseSource(repo, release('v1.0.0'), { latest: true }),
    /refusing mislabeled docs/
  )
})

test('records clean source provenance separately from dirty renderer provenance', () => {
  const source = {
    tag: 'v2.1.0',
    version: '2.1.0',
    commit: 'a'.repeat(40),
    publishedAt,
  }
  const info = releaseBuildInfo(
    source,
    'v2.1.0',
    { commit: 'b'.repeat(40), dirty: true },
    '2026-10-01T00:00:00Z'
  )
  assert.equal(info.dirty, false)
  assert.equal(info.commit, source.commit)
  assert.deepEqual(info.renderer, { commit: 'b'.repeat(40), dirty: true })
  assert.equal(info.release.latest, true)
  assert.equal(info.release.publishedAt, publishedAt)
  assert.equal(info.builtAt, '2026-10-01T00:00:00Z')
})

test('legacy renderer preserves useful HTML while blocking scripts and Vue evaluation', () => {
  const html = renderLegacyMarkdown(
    '# Original guide\n\n<div>{{ state.secret }}<img src="banner.png" onerror="alert(1)"></div>\n\n<script>alert(1)</script>\n\n[Unsafe](javascript:alert%281%29)\n',
    (url) =>
      url === 'banner.png'
        ? '/Flare/versions/v1.0.0/source-assets/banner.png'
        : url
  )
  assert.match(html, /<div v-pre/)
  assert.match(html, /\{\{ state.secret \}\}/)
  assert.match(html, /id="original-guide"/)
  assert.match(
    html,
    /src="\/Flare\/versions\/v1.0.0\/source-assets\/banner.png"/
  )
  assert.doesNotMatch(html, /<script|onerror=|href="javascript:/)
})

test('legacy fenced examples with blank lines survive the VitePress/Vue pipeline', async () => {
  const original = [
    '# Docker deployment',
    '',
    '1. Copy this configuration:',
    '',
    '   ```yaml',
    '   services:',
    '     db:',
    '       image: postgres:17-alpine',
    '',
    '     flare:',
    '       image: flintsh/flare:latest',
    '   ```',
    '',
    '2. Run `docker compose up -d`.',
  ].join('\n')
  const renderer = await createMarkdownRenderer(process.cwd())
  const html = renderer.render(renderLegacyMarkdown(original))
  const { errors } = parse(`<template>${html}</template>`)
  assert.deepEqual(errors, [])
  assert.match(html, /<pre tabindex="0"><code class="language-yaml">/)
  assert.match(html, /postgres:17-alpine&#10;&#10;/)
  assert.doesNotMatch(html, /&lt;\/code&gt;/)
})

test('legacy archive rewrites relative docs/assets under a non-root base', async (t) => {
  const { repo, commit } = await fixture(t)
  await commit('v1.0.0', '1.0.0', {
    'README.md':
      '# README\n\n[Setup](docs/setup.md)\n\n![Banner](public/banner.svg)\n\n[Source](src/index.ts)\n',
    'docs/setup.md': '# Setup\n\n[Back](../README.md)\n',
    'public/banner.svg': '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
  })
  const { metadata } = releaseSource(repo, release('v1.0.0'))
  const site = resolve(repo, 'generated')
  await prepareLegacy({
    repo,
    site,
    release: metadata,
    base: '/Flare/versions/v1.0.0/',
  })
  const home = await readFile(resolve(site, 'index.md'), 'utf8')
  const setup = await readFile(resolve(site, 'docs/setup.md'), 'utf8')
  assert.match(home, /href="\/Flare\/versions\/v1.0.0\/docs\/setup.html"/)
  assert.match(
    home,
    /src="\/Flare\/versions\/v1.0.0\/source-assets\/public\/banner.svg"/
  )
  assert.match(
    home,
    new RegExp(`github.com/FlintSH/Flare/blob/${metadata.commit}/src/index.ts`)
  )
  assert.match(setup, /href="\/Flare\/versions\/v1.0.0\/index.html"/)
  assert.equal(
    await readFile(
      resolve(site, 'public/source-assets/public/banner.svg'),
      'utf8'
    ),
    '<svg xmlns="http://www.w3.org/2000/svg"></svg>'
  )
})

test('legacy pages add an accessible title only when the original has no h1', async (t) => {
  const { repo, commit } = await fixture(t)
  await commit('v1.0.0', '1.0.0', {
    'README.md': '<div align="center">Flare banner</div>\n\n## Features\n',
    'docs/setup.md': '# Original setup title\n\nStart here.\n',
    'docs/example.md':
      '---\ntitle: "{{ caller() }} <script>"\n---\n\n## Example\n',
  })
  const { metadata } = releaseSource(repo, release('v1.0.0'))
  const site = resolve(repo, 'generated')
  await prepareLegacy({
    repo,
    site,
    release: metadata,
    base: '/versions/v1.0.0/',
  })
  const home = await readFile(resolve(site, 'index.md'), 'utf8')
  const setup = await readFile(resolve(site, 'docs/setup.md'), 'utf8')
  const example = await readFile(resolve(site, 'docs/example.md'), 'utf8')
  assert.match(home, /<h1 v-pre>Flare v1\.0\.0<\/h1>/)
  assert.equal([...home.matchAll(/<h1\b/g)].length, 1)
  assert.equal([...setup.matchAll(/<h1\b/g)].length, 1)
  assert.match(
    setup,
    /<h1 id="original-setup-title">Original setup title<\/h1>/
  )
  assert.match(example, /<h1 v-pre>\{\{ caller\(\) \}\} &lt;script&gt;<\/h1>/)
})
