import { execFileSync } from 'node:child_process'
import { expect, test } from '@playwright/test'
import axe from 'axe-core'

async function json(request, path) {
  const response = await request.get(`./${path}`)
  expect(response.ok(), path).toBe(true)
  return response.json()
}

async function releaseData(request) {
  const manifest = await json(request, 'docs-versions.json')
  expect(manifest.releases.length).toBeGreaterThan(1)
  const latest = manifest.releases.find(
    (release) => release.tag === manifest.latest
  )
  expect(latest).toBeTruthy()
  return { manifest, latest, oldest: manifest.releases.at(-1) }
}

const compareUrl = (from, to) =>
  `./versions.html?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`

function source(commit, path) {
  return execFileSync('git', ['show', `${commit}:${path}`], {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  })
}

function resolveSitePath(baseURL, path) {
  return new URL(path, baseURL).pathname
}

async function expectA11y(page) {
  await page.addScriptTag({ content: axe.source })
  const violations = await page.evaluate(async () => {
    const result = await window.axe.run(document, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] },
    })
    return result.violations.map((item) => ({
      rule: item.id,
      nodes: item.nodes.map((node) => node.target),
    }))
  })
  expect(violations).toEqual([])
}

test('default handbook matches the exact stable tag and excludes unreleased guidance', async ({
  page,
  request,
}) => {
  const { latest } = await releaseData(request)
  const build = await json(request, 'build-info.json')
  const taggedCommit = execFileSync(
    'git',
    ['rev-parse', `refs/tags/${latest.tag}^{commit}`],
    { encoding: 'utf8' }
  ).trim()
  expect(build.commit).toBe(taggedCommit)
  expect(build.version).toBe(
    JSON.parse(source(taggedCommit, 'package.json')).version
  )
  expect(build.dirty).toBe(false)
  expect(build.release).toEqual({
    tag: latest.tag,
    publishedAt: latest.publishedAt,
    latest: true,
  })
  expect(build.renderer).toHaveProperty('commit')
  expect(Number.isNaN(Date.parse(build.builtAt))).toBe(false)
  await page.goto('./')
  const stamp = page.getByLabel('Documentation version and source revision')
  await expect(stamp).toContainText(`Flare ${latest.tag}`)
  await expect(stamp).toContainText('Latest stable')
  await expect(stamp.locator('time')).toHaveAttribute(
    'datetime',
    latest.publishedAt
  )
  await expect(page.locator('meta[name="flare:commit"]')).toHaveAttribute(
    'content',
    taggedCommit
  )
  await expect(
    stamp.getByRole('link', { name: build.shortCommit })
  ).toHaveAttribute(
    'href',
    `https://github.com/FlintSH/Flare/commit/${taggedCommit}`
  )
  if (!latest.pages.some((entry) => entry.path === 'admin/roles.html')) {
    await expect(page.locator('a[href$="admin/roles.html"]')).toHaveCount(0)
    await page.goto('./features.html')
    await expect(page.locator('a[href$="admin/roles.html"]')).toHaveCount(0)
    await expect(
      page.locator('.feature-card').filter({ hasText: 'Granular roles' })
    ).toHaveCount(0)
  }
})

test('every release has dated archives, original source snapshots, and accessible pages', async ({
  page,
  request,
}) => {
  const { manifest } = await releaseData(request)
  for (const release of manifest.releases) {
    const build = await json(request, `${release.path}build-info.json`)
    expect(build.commit, release.tag).toBe(release.commit)
    expect(build.version, release.tag).toBe(release.version)
    expect(build.release.publishedAt, release.tag).toBe(release.publishedAt)
    expect(build.dirty, release.tag).toBe(false)
    const snapshot = await json(request, `history/${release.tag}.json`)
    expect(snapshot.tag).toBe(release.tag)
    for (const [path, file] of Object.entries(snapshot.files)) {
      expect(file.content, `${release.tag}:${path}`).toBe(
        source(release.commit, path)
      )
    }
    for (const entry of release.pages) {
      const response = await request.get(`./${release.path}${entry.path}`)
      expect(response.status(), `${release.tag}:${entry.path}`).toBe(200)
      expect(await response.text(), `${release.tag}:${entry.path}`).toContain(
        release.commit
      )
      expect(snapshot.files[entry.source].url).toBe(
        `${release.path}${entry.path}`
      )
    }
    await page.goto(`./${release.path}`, { waitUntil: 'domcontentloaded' })
    await expect(page.locator('h1')).toHaveCount(1)
    const stamp = page.getByLabel('Documentation version and source revision')
    await expect(stamp).toContainText(`Flare ${release.tag}`)
    if (release.version !== release.tag.slice(1)) {
      await expect(stamp).toContainText(`Source package v${release.version}`)
    }
    await expect(stamp).toContainText(
      release.tag === manifest.latest ? 'Latest stable' : 'Archived release'
    )
    await expect(stamp.locator('time')).toHaveText(
      release.publishedAt.slice(0, 10)
    )
    await expect(
      page
        .getByRole('link', { name: 'Versions & changes', exact: true })
        .first()
    ).toBeVisible()
  }
})

test('release list shows publication dates and links to every archive and release notes', async ({
  page,
  request,
  baseURL,
}) => {
  const { manifest } = await releaseData(request)
  await page.goto('./versions.html')
  await expect(
    page.getByRole('heading', { name: 'Browse releases', exact: true })
  ).toBeVisible()
  await expect(page.locator('.release-list li')).toHaveCount(
    manifest.releases.length
  )
  for (const release of manifest.releases) {
    const row = page.locator('.release-list li').filter({
      has: page.getByRole('link', {
        name: `Flare ${release.tag}`,
        exact: true,
      }),
    })
    await expect(row.locator('time')).toHaveText(
      release.publishedAt.slice(0, 10)
    )
    await expect(
      row.getByRole('link', { name: `Flare ${release.tag}`, exact: true })
    ).toHaveAttribute('href', resolveSitePath(baseURL, release.path))
    await expect(
      row.getByRole('link', { name: /Release notes/ })
    ).toHaveAttribute(
      'href',
      `https://github.com/FlintSH/Flare/releases/tag/${release.tag}`
    )
  }
})

test('selecting the same release reports no documentation changes', async ({
  page,
  request,
}) => {
  const { latest } = await releaseData(request)
  await page.goto('./versions.html')
  await page
    .getByRole('combobox', { name: 'From release', exact: true })
    .selectOption(latest.tag)
  await page
    .getByRole('combobox', { name: 'To release', exact: true })
    .selectOption(latest.tag)
  await page.getByRole('button', { name: 'Show changes', exact: true }).click()
  await expect(page.locator('.comparison-status')).toContainText(
    '0 changed files. No documentation changes.'
  )
  await expect(
    page.getByRole('listbox', { name: 'Changed file', exact: true })
  ).toHaveCount(0)
  await expect(page).toHaveURL(
    new RegExp(
      `from=${latest.tag.replaceAll('.', '\\.')}&to=${latest.tag.replaceAll('.', '\\.')}`
    )
  )
})

test('shareable comparisons show added and removed pages, source text, and rendered links', async ({
  page,
  request,
  baseURL,
}) => {
  const { latest, oldest } = await releaseData(request)
  const before = await json(request, `history/${oldest.tag}.json`)
  const after = await json(request, `history/${latest.tag}.json`)
  const removed = Object.keys(before.files).find(
    (path) => !(path in after.files)
  )
  const added = Object.keys(after.files).find(
    (path) =>
      !(path in before.files) && !after.files[path].url.startsWith('https:')
  )
  expect(removed).toBeTruthy()
  expect(added).toBeTruthy()
  await page.goto(compareUrl(oldest.tag, latest.tag))
  await expect(page.locator('.comparison-status')).toContainText(
    `${oldest.tag} → ${latest.tag}`
  )
  await expect(
    page.getByRole('combobox', { name: 'From release', exact: true })
  ).toHaveValue(oldest.tag)
  await expect(
    page.getByRole('combobox', { name: 'To release', exact: true })
  ).toHaveValue(latest.tag)
  await page
    .getByRole('listbox', { name: 'Changed file', exact: true })
    .selectOption(added)
  const diff = page.getByRole('article', {
    name: 'Documentation changes',
    exact: true,
  })
  await expect(diff).toContainText(`Added · ${added}`)
  await expect(diff.locator('.diff-added')).toContainText(
    after.files[added].content.trim().split('\n')[0]
  )
  await expect(
    diff.getByRole('link', { name: 'Read before', exact: true })
  ).toHaveCount(0)
  await expect(
    diff.getByRole('link', { name: 'Read after', exact: true })
  ).toHaveAttribute('href', resolveSitePath(baseURL, after.files[added].url))
  await page
    .getByRole('listbox', { name: 'Changed file', exact: true })
    .selectOption(removed)
  await expect(diff).toContainText(`Removed · ${removed}`)
  await expect(
    diff.getByRole('link', { name: 'Read after', exact: true })
  ).toHaveCount(0)
  await expect(
    diff.getByRole('link', { name: 'Read before', exact: true })
  ).toHaveAttribute('href', resolveSitePath(baseURL, before.files[removed].url))
  await page
    .getByLabel('Find a changed file', { exact: true })
    .fill('no-documentation-file-matches-this-query')
  await expect(
    page.getByText('No files match your search.', { exact: true })
  ).toBeVisible()
  await page.getByLabel('Find a changed file', { exact: true }).fill(added)
  await expect(
    page
      .getByRole('listbox', { name: 'Changed file', exact: true })
      .locator('option')
  ).toHaveCount(1)
  await page
    .getByRole('listbox', { name: 'Changed file', exact: true })
    .selectOption(added)
  await diff.getByRole('link', { name: 'Read after', exact: true }).click()
  await expect(page).toHaveURL(
    new URL(after.files[added].url.replace(/index\.html$/, ''), baseURL).href
  )
  await expect(
    page.getByLabel('Documentation version and source revision')
  ).toContainText(`Flare ${latest.tag}`)
})

test('reversing an arbitrary release comparison reverses added and removed files', async ({
  page,
  request,
}) => {
  const { latest, oldest } = await releaseData(request)
  const before = await json(request, `history/${oldest.tag}.json`)
  const after = await json(request, `history/${latest.tag}.json`)
  const previouslyAdded = Object.keys(after.files).find(
    (path) => !(path in before.files)
  )
  const previouslyRemoved = Object.keys(before.files).find(
    (path) => !(path in after.files)
  )
  await page.goto(compareUrl(latest.tag, oldest.tag))
  await expect(page.locator('.comparison-status')).toContainText(
    `${latest.tag} → ${oldest.tag}`
  )
  const files = page.getByRole('listbox', { name: 'Changed file', exact: true })
  await expect(
    files.locator('option', { hasText: `Removed · ${previouslyAdded}` })
  ).toHaveCount(1)
  await expect(
    files.locator('option', { hasText: `Added · ${previouslyRemoved}` })
  ).toHaveCount(1)
})

test('failed snapshot downloads can be retried without reloading', async ({
  page,
  request,
}) => {
  const { latest, oldest } = await releaseData(request)
  const pattern = '**/history/*.json'
  await page.route(pattern, (route) => route.abort('internetdisconnected'))
  await page.goto(compareUrl(oldest.tag, latest.tag))
  await expect(page.getByRole('alert')).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Show changes', exact: true })
  ).toBeEnabled()
  await page.unroute(pattern)
  await page.getByRole('button', { name: 'Show changes', exact: true }).click()
  await expect(page.locator('.comparison-status')).toContainText(
    `${oldest.tag} → ${latest.tag}`
  )
  await expect(page.getByRole('alert')).toHaveCount(0)
})

test('historical Vue and HTML are displayed as source text without executing', async ({
  page,
  request,
}) => {
  const { latest, oldest } = await releaseData(request)
  const malicious =
    '<img src=x onerror="window.__historicalMarkupExecuted=true">\n<script>window.__historicalMarkupExecuted=true</script>\n{{ window.location }}\n<VersionHistory />\n'
  await page.route('**/history/*.json', async (route) => {
    const tag = decodeURIComponent(
      new URL(route.request().url()).pathname
        .split('/')
        .at(-1)
        .replace(/\.json$/, '')
    )
    await route.fulfill({
      json: {
        tag,
        files: {
          'unsafe-example.vue': {
            title: 'Source example',
            content: tag === oldest.tag ? 'Original source\n' : malicious,
          },
        },
      },
    })
  })
  await page.goto(compareUrl(oldest.tag, latest.tag))
  const diff = page.getByRole('article', {
    name: 'Documentation changes',
    exact: true,
  })
  await expect(diff).toContainText(
    '<img src=x onerror="window.__historicalMarkupExecuted=true">'
  )
  await expect(diff).toContainText('{{ window.location }}')
  await expect(diff.locator('img, script')).toHaveCount(0)
  expect(
    await page.evaluate(() => window.__historicalMarkupExecuted)
  ).toBeUndefined()
})

test('release navigation reloads the matching page with the correct archive asset base', async ({
  page,
  request,
  baseURL,
}) => {
  const { latest, oldest } = await releaseData(request)
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('response', (response) => {
    if (
      response.status() >= 400 &&
      new URL(response.url()).origin === new URL(baseURL).origin
    )
      errors.push(`${response.status()} ${response.url()}`)
  })
  await page.goto('./')
  await page.evaluate(() => {
    window.__releaseNavigationSentinel = true
  })
  await page
    .getByLabel('Documentation release', { exact: true })
    .selectOption(oldest.tag)
  await page.getByRole('link', { name: 'View docs', exact: true }).click()
  await expect(page).toHaveURL((url) =>
    [
      new URL(oldest.path, baseURL).pathname,
      new URL(`${oldest.path}index.html`, baseURL).pathname,
    ].includes(url.pathname)
  )
  await page.waitForLoadState('networkidle')
  expect(
    await page.evaluate(() => window.__releaseNavigationSentinel)
  ).toBeUndefined()
  await expect(
    page.getByLabel('Documentation version and source revision')
  ).toContainText(`Flare ${oldest.tag}`)
  await page
    .getByRole('link', { name: 'Versions & changes', exact: true })
    .first()
    .click()
  await expect(page).toHaveURL(new URL('versions.html', baseURL).href)
  await expect(
    page.getByRole('heading', { name: 'Browse releases', exact: true })
  ).toBeVisible()
  const uniquePage = latest.pages.find(
    (entry) => !oldest.pages.some((old) => old.path === entry.path)
  )
  expect(uniquePage).toBeTruthy()
  await page.goto(`./${latest.path}${uniquePage.path}`)
  await page
    .getByLabel('Documentation release', { exact: true })
    .selectOption(oldest.tag)
  await expect(
    page.getByRole('link', { name: 'View docs', exact: true })
  ).toHaveAttribute('href', resolveSitePath(baseURL, oldest.path))
  await page.getByRole('link', { name: 'View docs', exact: true }).click()
  await expect(page).toHaveURL(new URL(oldest.path, baseURL).href)
  await page.waitForLoadState('networkidle')
  expect(errors).toEqual([])
})

for (const [width, theme] of [
  [390, 'light'],
  [1440, 'dark'],
]) {
  test(`release archive and comparison fit ${width}px and pass ${theme} accessibility checks`, async ({
    page,
    request,
  }) => {
    const { latest, oldest } = await releaseData(request)
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.setViewportSize({ width, height: 900 })
    await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: theme })
    await page.addInitScript(
      (value) => localStorage.setItem('vitepress-theme-appearance', value),
      theme
    )
    for (const path of [
      compareUrl(oldest.tag, latest.tag),
      `./${oldest.path}`,
    ]) {
      await page.goto(path)
      await page.waitForLoadState('networkidle')
      if (path.includes('versions.html?'))
        await expect(page.locator('.comparison-status')).toBeVisible()
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth + 1
        ),
        path
      ).toBe(true)
      await expect(page.locator('h1')).toHaveCount(1)
      await expectA11y(page)
    }
    expect(errors).toEqual([])
  })
}

test('legacy commands remain horizontally scrollable by keyboard on mobile', async ({
  page,
  request,
}) => {
  const { oldest } = await releaseData(request)
  await page.setViewportSize({ width: 390, height: 900 })
  await page.goto(`./${oldest.path}`)
  const blocks = page.locator('.release-original pre')
  const index = await blocks.evaluateAll((elements) =>
    elements.findIndex((element) => element.scrollWidth > element.clientWidth)
  )
  expect(index).toBeGreaterThanOrEqual(0)
  const command = blocks.nth(index)
  await expect(command).toHaveAttribute('tabindex', '0')
  await command.focus()
  await expect(command).toBeFocused()
  await page.keyboard.press('ArrowRight')
  await expect
    .poll(() => command.evaluate((element) => element.scrollLeft))
    .toBeGreaterThan(0)
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1
    )
  ).toBe(true)
})
