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
  await expect(page.getByRole('status')).toContainText('3 of 24')
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
      './demos.html',
      './hosting/docker.html',
      './api/files.html',
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
      './demos.html',
      './api/files.html',
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
