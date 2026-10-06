import { expect, test } from '@playwright/test'
import axe from 'axe-core'

test('visible version and source commit match the build metadata', async ({
  page,
  request,
}) => {
  const response = await request.get('./build-info.json')
  expect(response.ok()).toBe(true)
  const build = await response.json()
  expect(build.version).toMatch(/^\d+\.\d+\.\d+/)
  expect(Number.isNaN(Date.parse(build.builtAt))).toBe(false)
  for (const path of ['./', './guide/index.html']) {
    await page.goto(path)
    const stamp = page.getByLabel('Documentation version and source revision')
    await expect(stamp).toBeVisible()
    await expect(stamp).toContainText(`Flare v${build.version}`)
    if (build.commit) {
      await expect(
        stamp.getByRole('link', { name: build.shortCommit })
      ).toHaveAttribute(
        'href',
        `https://github.com/FlintSH/Flare/commit/${build.commit}`
      )
      await expect(page.locator('meta[name="flare:commit"]')).toHaveAttribute(
        'content',
        build.commit
      )
    }
    if (build.dirty) await expect(stamp).toContainText('Uncommitted changes')
  }
})

test('feature filters and search direct readers to a relevant guide', async ({
  page,
}) => {
  await page.goto('./features.html')
  await page.getByRole('button', { name: 'Automate', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('3 of 31')
  await page.getByLabel('Find a capability').fill('webhook')
  await expect(page.locator('.feature-card')).toHaveCount(1)
  await page.locator('.feature-card').click()
  await expect(page).toHaveURL(/api\/webhooks/)
})

test('walkthrough, screenshot dialog, and upload precedence are interactive', async ({
  page,
}) => {
  await page.goto('./demos.html')
  await page.getByRole('button', { name: '2. Upload', exact: true }).click()
  await expect(page.locator('.tour-description')).toContainText(
    'Upload with intention'
  )
  await page
    .getByRole('button', { name: 'Enlarge screenshot: Upload with intention' })
    .click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).not.toBeVisible()
  await expect(page.getByLabel('1. Starting visibility')).toBeDisabled()
  await page.getByLabel('2. Saved profile').selectOption('PUBLIC')
  await page.getByLabel('3. This upload').selectOption('PRIVATE')
  await expect(page.locator('.lab-result strong')).toHaveText('Private')
  await page.getByLabel('Use a token bound to this profile').check()
  await expect(page.getByLabel('3. This upload')).toBeDisabled()
  await expect(page.locator('.lab-result strong')).toHaveText('Public')
})

test('continuous library guide and its real recording are discoverable', async ({
  page,
}) => {
  await page.goto('./features.html')
  await page.getByLabel('Find a capability').fill('timeline')
  await expect(page.locator('.feature-card')).toHaveCount(1)
  await page.locator('.feature-card').click()
  await expect(page).toHaveURL(/guide\/library\.html$/)
  await expect(page.locator('h2#scroll-through-your-library')).toBeVisible()
  for (const name of [
    'library-desktop',
    'library-date-jump',
    'library-mobile',
    'library-selection',
    'library-image-viewer',
  ]) {
    const screenshot = page.locator(
      `.screenshot-button img[src$="${name}.webp"]`
    )
    await screenshot.scrollIntoViewIfNeeded()
    await expect(screenshot).toBeVisible()
    await expect
      .poll(() => screenshot.evaluate((image) => image.naturalWidth))
      .toBeGreaterThan(0)
  }
  await page.getByRole('link', { name: 'recorded library walkthrough' }).click()
  await expect(page).toHaveURL(/demos\.html#browse-a-large-library$/)
  for (const name of ['timeline-scroll', 'timeline-mobile']) {
    const video = page.locator(`video[src$="${name}.mp4"]`)
    await expect(video).toHaveAttribute('preload', 'none')
    expect(await video.getAttribute('autoplay')).toBeNull()
    const duration = await video.evaluate(
      (element) =>
        new Promise((resolve, reject) => {
          const timeout = setTimeout(
            () => reject(new Error('Timeline recording metadata timed out')),
            10000
          )
          element.addEventListener(
            'loadedmetadata',
            () => {
              clearTimeout(timeout)
              resolve(element.duration)
            },
            { once: true }
          )
          element.addEventListener(
            'error',
            () => {
              clearTimeout(timeout)
              reject(new Error('Timeline recording failed to load'))
            },
            { once: true }
          )
          element.load()
        })
    )
    expect(duration).toBeGreaterThan(1)
    await video.evaluate((element) => element.play())
    await expect
      .poll(() => video.evaluate((element) => element.currentTime))
      .toBeGreaterThan(0)
    await video.evaluate((element) => element.pause())
  }
})

test('API builder generates valid examples without contacting an instance', async ({
  page,
}) => {
  const requests = []
  page.on('request', (req) => {
    if (req.url().includes('example.test')) requests.push(req.url())
  })
  await page.goto('./demos.html')
  await page.getByLabel('Instance URL').fill('https://demo.example.test')
  await page.getByLabel('Operation', { exact: true }).selectOption('createUrl')
  await expect(page.locator('.demo-code')).toContainText(
    'https://demo.example.test/api/urls'
  )
  await expect(page.locator('.demo-code')).toContainText('FLARE_TOKEN')
  await page.getByRole('button', { name: 'JavaScript', exact: true }).click()
  await expect(page.locator('.demo-code')).toContainText("method: 'POST'")
  await page
    .getByLabel('Operation', { exact: true })
    .selectOption('selectedFiles')
  await expect(page.locator('.demo-code')).toContainText(
    '/api/files?ids=FILE_ID_1,FILE_ID_2&limit=100'
  )
  await expect(page.locator('.demo-code')).toContainText("method: 'GET'")
  await expect(
    page.getByText('Replace FILE_ID_1 and FILE_ID_2', { exact: false })
  ).toBeVisible()
  await page
    .getByLabel('Instance URL')
    .fill('https://user:password@example.test/path')
  await expect(page.getByRole('button', { name: 'Copy code' })).toBeDisabled()
  expect(requests).toEqual([])
})

test('local full-text search finds the webhook reference', async ({ page }) => {
  await page.goto('./')
  await page
    .getByRole('button', { name: /Search/ })
    .first()
    .click()
  await page.locator('#localsearch-input').fill('X-Flare-Signature')
  await expect(page.locator('.VPLocalSearchBox')).toContainText(/webhook/i)
})

for (const width of [390, 1440]) {
  test(`pages fit the ${width}px viewport and load without browser errors`, async ({
    page,
  }) => {
    test.setTimeout(60_000)
    await page.setViewportSize({ width, height: 900 })
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    page.on('response', (response) => {
      if (response.status() >= 400)
        errors.push(`${response.status()} ${response.url()}`)
    })
    for (const url of [
      './',
      './features.html',
      './versions.html',
      './demos.html',
      './contributing.html',
      './guide/index.html',
      './hosting/docker.html',
      './api/files.html',
      './admin/roles.html',
      './api/roles.html',
      './guide/account.html',
      './guide/library.html',
      './guide/folders.html',
      './guide/tags.html',
      './guide/security.html',
      './api/security.html',
      './admin/audit.html',
      './api/activity.html',
      './guide/archives.html',
      './api/archives.html',
    ]) {
      await page.goto(url)
      await page.waitForLoadState('networkidle')
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth + 1
        ),
        url
      ).toBe(true)
      expect(await page.locator('h1').count(), url).toBe(1)
      expect(
        await page
          .locator('img')
          .evaluateAll(
            (images) =>
              images.filter(
                (image) =>
                  image.loading !== 'lazy' &&
                  (!image.complete || image.naturalWidth === 0)
              ).length
          ),
        url
      ).toBe(0)
    }
    expect(errors).toEqual([])
  })
}

for (const theme of ['dark', 'light']) {
  test(`${theme} theme has no detected WCAG accessibility violations`, async ({
    page,
  }) => {
    test.setTimeout(60_000)
    await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: theme })
    await page.addInitScript(
      (value) => localStorage.setItem('vitepress-theme-appearance', value),
      theme
    )
    await page.setViewportSize({
      width: theme === 'dark' ? 1440 : 390,
      height: 900,
    })
    for (const path of [
      './',
      './features.html',
      './versions.html',
      './demos.html',
      './contributing.html',
      './guide/index.html',
      './api/files.html',
      './admin/roles.html',
      './api/roles.html',
      './guide/account.html',
      './guide/library.html',
      './guide/folders.html',
      './guide/tags.html',
      './guide/security.html',
      './api/security.html',
      './admin/audit.html',
      './api/activity.html',
      './guide/archives.html',
      './api/archives.html',
      './hosting/docker.html',
      './guide/sharing.html',
    ]) {
      await page.goto(path)
      await page.waitForLoadState('networkidle')
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
      expect(violations, path).toEqual([])
    }
  })
}

test('role simulation explains additive grants and token scope intersection', async ({
  page,
}) => {
  await page.goto('./admin/roles.html')
  const lab = page.getByLabel('Role permissions demonstration')
  const result = lab.getByRole('status')
  await expect(result).toContainText('Dashboard upload: Allowed')
  await lab.getByLabel('Everyone grants uploads').uncheck()
  await expect(result).toContainText('Dashboard upload: Denied')
  await expect(result).toContainText('Named-token upload: Denied')
  await lab.getByLabel('Assign Contributors (grants uploads)').check()
  await expect(result).toContainText('Named-token upload: Allowed')
  await lab.getByLabel('Named token has files:upload scope').uncheck()
  await lab
    .getByLabel('Assign Admin (grants Administrator)', { exact: true })
    .check()
  await expect(result).toContainText('Dashboard upload: Allowed')
  await expect(result).toContainText('Named-token upload: Denied')
  await lab.getByLabel('Named token has files:upload scope').check()
  await expect(result).toContainText('Named-token upload: Allowed')
})

test('role walkthrough links to the guide and recording loads without autoplay', async ({
  page,
}) => {
  await page.goto('./demos.html')
  await page.getByRole('button', { name: '6. Delegate', exact: true }).click()
  await expect(page.locator('.tour-description')).toContainText(
    'Give every role a clear purpose'
  )
  await expect(page.locator('.tour-description a')).toHaveAttribute(
    'href',
    /admin\/roles\.html$/
  )
  const video = page.locator('video[src$="roles-demo.mp4"]')
  await expect(video).toHaveAttribute('preload', 'none')
  expect(await video.getAttribute('autoplay')).toBeNull()
  const duration = await video.evaluate(
    (element) =>
      new Promise((resolve, reject) => {
        element.addEventListener(
          'loadedmetadata',
          () => resolve(element.duration),
          { once: true }
        )
        element.addEventListener(
          'error',
          () => reject(new Error('Role recording failed to load')),
          { once: true }
        )
        element.load()
      })
  )
  expect(duration).toBeGreaterThan(1)
  await page.locator('.tour-description a').click()
  await expect(page).toHaveURL(/admin\/roles\.html$/)
  await expect(page.locator('h1')).toContainText('Roles and permissions')
})

test('security guide is discoverable and all three recordings load without autoplay', async ({
  page,
}) => {
  await page.goto('./features.html')
  await page.getByLabel('Find a capability').fill('passkeys')
  await expect(page.locator('.feature-card')).toHaveCount(1)
  await page.locator('.feature-card').click()
  await expect(page).toHaveURL(/guide\/security\.html$/)
  await expect(page.locator('h2#add-a-passkey')).toBeVisible()
  await page.goto('./demos.html')
  await page.getByRole('button', { name: '7. Secure', exact: true }).click()
  await expect(page.locator('.tour-description a')).toHaveAttribute(
    'href',
    /guide\/security\.html$/
  )
  for (const name of [
    'two-factor-demo.webm',
    'passkey-demo.webm',
    'passkey-required-demo.webm',
  ]) {
    const video = page.locator(`video[src$="${name}"]`)
    await expect(video).toHaveAttribute('preload', 'none')
    expect(await video.getAttribute('autoplay')).toBeNull()
    const duration = await video.evaluate(
      (element) =>
        new Promise((resolve, reject) => {
          const timeout = setTimeout(
            () => reject(new Error('Recording metadata timed out')),
            10000
          )
          element.addEventListener(
            'loadedmetadata',
            () => {
              clearTimeout(timeout)
              resolve(element.duration)
            },
            { once: true }
          )
          element.addEventListener(
            'error',
            () => {
              clearTimeout(timeout)
              reject(new Error('Security recording failed to load'))
            },
            { once: true }
          )
          element.load()
        })
    )
    expect(duration).toBeGreaterThan(1)
  }
  await expect(
    page.getByRole('heading', {
      name: 'Enable, use, and recover two-factor authentication',
    })
  ).toBeVisible()
  await expect(
    page.getByRole('heading', { name: 'Create, use, and remove a passkey' })
  ).toBeVisible()
  await expect(
    page.getByRole('heading', { name: 'Require a passkey and recover access' })
  ).toBeVisible()
})

test('archive guide, API contracts, tour, and recordings are discoverable', async ({
  page,
}) => {
  await page.goto('./features.html')
  await page.getByLabel('Find a capability').fill('archives')
  await expect(page.locator('.feature-card')).toHaveCount(1)
  await page.locator('.feature-card').click()
  await expect(page).toHaveURL(/guide\/archives\.html$/)
  await expect(
    page.locator('h2#choose-an-upload-profile-deliberately')
  ).toBeVisible()
  await expect(
    page.locator('h2#browse-an-archive-shared-with-you')
  ).toBeVisible()
  await page.getByRole('link', { name: 'archive API', exact: true }).click()
  await expect(page).toHaveURL(/api\/archives\.html$/)
  await expect(page.locator('.vp-doc')).toContainText('profileRevision')
  await expect(page.locator('.vp-doc')).toContainText(
    'profileEffectiveRevision'
  )
  await expect(page.locator('.vp-doc')).toContainText('/archive/share/entry')
  await page.goto('./demos.html')
  await page.getByRole('button', { name: '11. Archives', exact: true }).click()
  await expect(page.locator('.tour-description a')).toHaveAttribute(
    'href',
    /guide\/archives\.html$/
  )
  for (const name of [
    'archive-browse-extract.webm',
    'archive-create.webm',
    'archive-share-browse.webm',
  ]) {
    const video = page.locator(`video[src$="${name}"]`)
    await expect(video).toHaveAttribute('preload', 'none')
    expect(await video.getAttribute('autoplay')).toBeNull()
    const duration = await video.evaluate(
      (element) =>
        new Promise((resolve, reject) => {
          const timeout = setTimeout(
            () => reject(new Error('Archive recording timed out')),
            10000
          )
          element.addEventListener(
            'loadedmetadata',
            () => {
              clearTimeout(timeout)
              resolve(element.duration)
            },
            { once: true }
          )
          element.addEventListener(
            'error',
            () => {
              clearTimeout(timeout)
              reject(new Error('Archive recording failed to load'))
            },
            { once: true }
          )
          element.load()
        })
    )
    expect(duration).toBeGreaterThan(1)
  }
  await page.locator('.tour-description a').click()
  await expect(page).toHaveURL(/guide\/archives\.html$/)
})

test('development preview explains where dated release docs are available', async ({
  page,
}) => {
  await page.goto('./versions.html')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'Documentation versions and changes'
  )
  await expect(page.locator('.version-notice')).toContainText(
    'Development preview'
  )
  await expect(
    page.getByRole('link', {
      name: 'Open rolling docs (unreleased)',
      exact: true,
    })
  ).toHaveCount(0)
  await expect(page.locator('.version-notice')).toContainText(
    'npm run build:releases --prefix docs/site'
  )
  await expect(
    page.getByLabel('Documentation version and source revision')
  ).toContainText('Development preview')
})

test('sessions and audit guides, walkthroughs, and recordings are discoverable', async ({
  page,
}) => {
  for (const [query, target] of [
    ['active sessions', /guide\/account\.html$/],
    ['audit log', /admin\/audit\.html$/],
  ]) {
    await page.goto('./features.html')
    await page.getByLabel('Find a capability').fill(query)
    await expect(page.locator('.feature-card')).toHaveCount(1)
    await page.locator('.feature-card').click()
    await expect(page).toHaveURL(target)
  }
  await page.goto('./demos.html')
  for (const [label, target] of [
    ['8. Sessions', /guide\/account\.html$/],
    ['9. Audit', /admin\/audit\.html$/],
  ]) {
    await page.getByRole('button', { name: label, exact: true }).click()
    await expect(page.locator('.tour-description a')).toHaveAttribute(
      'href',
      target
    )
  }
  for (const name of ['session-management.webm', 'audit-investigation.webm']) {
    const video = page.locator(`video[src$="${name}"]`)
    await expect(video).toHaveAttribute('preload', 'none')
    expect(await video.getAttribute('autoplay')).toBeNull()
    const duration = await video.evaluate(
      (element) =>
        new Promise((resolve, reject) => {
          const timeout = setTimeout(
            () => reject(new Error('Recording metadata timed out')),
            10000
          )
          element.addEventListener(
            'loadedmetadata',
            () => {
              clearTimeout(timeout)
              resolve(element.duration)
            },
            { once: true }
          )
          element.addEventListener(
            'error',
            () => {
              clearTimeout(timeout)
              reject(new Error('Activity recording failed to load'))
            },
            { once: true }
          )
          element.load()
        })
    )
    expect(duration).toBeGreaterThan(1)
  }
})
