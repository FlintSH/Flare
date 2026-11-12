import { expect, test } from '@playwright/test'

const chapters = [
  ['Capture', 'capture'],
  ['Organize', 'organize'],
  ['OCR', 'ocr'],
  ['Storage', 'storage'],
  ['API', 'api'],
  ['Roles', 'roles'],
]

test('reduced-motion showcase has six keyboard-accessible, silent local illustrations', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const requests = []
  page.on('request', (request) => {
    if (
      ['fetch', 'xhr'].includes(request.resourceType()) &&
      new URL(request.url()).pathname.startsWith('/api/')
    )
      requests.push(request.url())
  })
  await page.goto('./')
  const showcase = page.getByRole('region', {
    name: 'Interactive Flare feature preview',
  })
  await expect(showcase).toHaveAttribute('data-mode', 'paused')
  await expect(showcase).toHaveAttribute('data-progress', '1.0000')
  await expect(showcase).toContainText('Interactive demo')
  await expect(showcase).toContainText('Sample data')
  for (const [label, id] of chapters) {
    const tab = showcase.getByRole('tab', { name: label, exact: true })
    await tab.click()
    await expect(tab).toHaveAttribute('aria-selected', 'true')
    await expect(showcase).toHaveAttribute('data-scene', id)
    await expect(showcase).toHaveAttribute('data-running', 'false')
  }
  await showcase.getByRole('tab', { name: 'OCR', exact: true }).click()
  await expect(showcase.locator('.fs-search-result')).toContainText(
    'scan-042.png'
  )
  await expect(showcase.locator('.fs-search-result')).toContainText(
    'Matched text in image'
  )
  await showcase.getByRole('tab', { name: 'API', exact: true }).click()
  await expect(showcase.locator('.fs-terminal')).toContainText('$FLARE_TOKEN')
  await expect(showcase.locator('.fs-terminal')).toContainText('/api/files')
  await showcase.getByRole('tab', { name: 'Capture', exact: true }).click()
  await page.keyboard.press('End')
  await expect(
    showcase.getByRole('tab', { name: 'Roles', exact: true })
  ).toBeFocused()
  await page.keyboard.press('Home')
  await expect(
    showcase.getByRole('tab', { name: 'Capture', exact: true })
  ).toBeFocused()
  await page.keyboard.press('ArrowRight')
  await expect(
    showcase.getByRole('tab', { name: 'Organize', exact: true })
  ).toBeFocused()
  await expect(page.locator('audio,video')).toHaveCount(0)
  expect(requests).toEqual([])
})

test('playback pauses, resumes, advances chapters, and respects reduced-motion changes', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.goto('./')
  const showcase = page.locator('.flare-showcase')
  await expect(showcase).toHaveAttribute('data-running', 'true')
  await showcase.getByRole('button', { name: 'Pause feature showcase' }).click()
  const progress = await showcase.getAttribute('data-progress')
  await page.waitForTimeout(350)
  await expect(showcase).toHaveAttribute('data-progress', progress)
  await showcase.getByRole('button', { name: 'Play feature showcase' }).click()
  await expect
    .poll(async () => Number(await showcase.getAttribute('data-progress')))
    .toBeGreaterThan(Number(progress))
  await expect(showcase).toHaveAttribute('data-scene', 'organize', {
    timeout: 10000,
  })
  await showcase.getByRole('tab', { name: 'Organize', exact: true }).focus()
  await expect(showcase).toHaveAttribute('data-mode', 'paused')
  await showcase.getByRole('button', { name: 'Play feature showcase' }).click()
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await expect(showcase).toHaveAttribute('data-mode', 'paused')
})

test('automatic playback stops outside the viewport and resumes when visible', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 600 })
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.goto('./')
  const showcase = page.locator('.flare-showcase')
  await showcase.scrollIntoViewIfNeeded()
  await expect(showcase).toHaveAttribute('data-running', 'true')
  await page.locator('.project-credit').scrollIntoViewIfNeeded()
  await expect(showcase).toHaveAttribute('data-running', 'false')
  const progress = await showcase.getAttribute('data-progress')
  await page.waitForTimeout(350)
  await expect(showcase).toHaveAttribute('data-progress', progress)
  await showcase.scrollIntoViewIfNeeded()
  await expect(showcase).toHaveAttribute('data-running', 'true')
})

for (const theme of ['dark', 'light'])
  test(`${theme} showcase chapters fit phones, tablets and desktop`, async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: theme })
    await page.addInitScript(
      (value) => localStorage.setItem('vitepress-theme-appearance', value),
      theme
    )
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 })
      await page.goto('./')
      const showcase = page.locator('.flare-showcase')
      for (const [label] of chapters) {
        await showcase.getByRole('tab', { name: label, exact: true }).click()
        expect(
          await showcase.evaluate(
            (element) => element.scrollWidth <= element.clientWidth + 1
          ),
          `${theme}/${width}/${label}`
        ).toBe(true)
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1
          )
        ).toBe(true)
      }
    }
  })

test('phone showcase controls have usable touch targets', async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 320, height: 800 },
    hasTouch: true,
    reducedMotion: 'reduce',
  })
  const page = await context.newPage()
  await page.goto(test.info().project.use.baseURL)
  const showcase = page.locator('.flare-showcase')
  for (const control of await showcase
    .locator('.fs-tabs button, .fs-playback, .fs-footer a')
    .all()) {
    const box = await control.boundingBox()
    expect(box.height).toBeGreaterThanOrEqual(44)
    expect(box.width).toBeGreaterThanOrEqual(44)
  }
  await showcase.getByRole('tab', { name: 'OCR', exact: true }).click()
  await showcase.getByRole('link', { name: 'Read the guide' }).click()
  await expect(page).toHaveURL(
    /guide\/library\.html#read-text-in-images-with-ocr$/
  )
  await expect(page.locator('#read-text-in-images-with-ocr')).toBeVisible()
  await context.close()
})
