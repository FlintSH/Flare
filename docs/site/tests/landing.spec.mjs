import { expect, test } from '@playwright/test'

const demo = (page) => page.locator('.product-demo')
const recording = (page) => page.locator('.product-demo video')

test('the recording waits for Play when reduced motion is requested', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const requests = []
  page.on('request', (request) => {
    if (['fetch', 'xhr'].includes(request.resourceType()))
      requests.push(request.url())
  })
  await page.goto('./')
  await expect(demo(page)).toHaveAttribute('data-playing', 'false')
  // The still is a real screen of the app, visible without the recording.
  const still = page.locator('.product-demo-still:visible img')
  await expect(still).toHaveCount(1)
  await expect
    .poll(() => still.evaluate((image) => image.naturalWidth))
    .toBeGreaterThan(0)
  await page.getByRole('button', { name: 'Play the recording' }).click()
  await expect(demo(page)).toHaveAttribute('data-playing', 'true')
  await expect
    .poll(() => recording(page).evaluate((video) => video.currentTime))
    .toBeGreaterThan(0)
  await page.getByRole('button', { name: 'Pause the recording' }).click()
  await expect(demo(page)).toHaveAttribute('data-playing', 'false')
  await expect(page.locator('audio')).toHaveCount(0)
  expect(await recording(page).evaluate((video) => video.muted)).toBe(true)
  // The page makes no requests of its own to an instance or anything else.
  expect(requests.filter((url) => !url.endsWith('.json'))).toEqual([])
})

test('the recording plays on its own, stops off screen and resumes', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 700 })
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.goto('./')
  await expect(demo(page)).toHaveAttribute('data-playing', 'true')
  await page.locator('.project-credit').scrollIntoViewIfNeeded()
  await expect(demo(page)).toHaveAttribute('data-playing', 'false')
  await demo(page).scrollIntoViewIfNeeded()
  await expect(demo(page)).toHaveAttribute('data-playing', 'true')
  // Pausing by hand holds while the page scrolls away and back.
  await page.getByRole('button', { name: 'Pause the recording' }).click()
  await page.locator('.project-credit').scrollIntoViewIfNeeded()
  await demo(page).scrollIntoViewIfNeeded()
  await expect(demo(page)).toHaveAttribute('data-playing', 'false')
})

test('asking for reduced motion while it plays stops the recording', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.goto('./')
  await expect(demo(page)).toHaveAttribute('data-playing', 'true')
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await expect(demo(page)).toHaveAttribute('data-playing', 'false')
  // It stays stopped when it comes back on screen, and Play still works.
  await page.locator('.project-credit').scrollIntoViewIfNeeded()
  await demo(page).scrollIntoViewIfNeeded()
  await expect(demo(page)).toHaveAttribute('data-playing', 'false')
  await page.getByRole('button', { name: 'Play the recording' }).click()
  await expect(demo(page)).toHaveAttribute('data-playing', 'true')
})

test('phones and each theme get their own recording', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.addInitScript(() =>
    localStorage.setItem('vitepress-theme-appearance', 'dark')
  )
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto('./')
  await expect(demo(page)).toHaveAttribute('data-variant', 'desktop-dark')
  await expect
    .poll(() => recording(page).evaluate((video) => video.currentSrc))
    .toMatch(/landing\/desktop-dark\.(mp4|webm)$/)
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(demo(page)).toHaveAttribute('data-variant', 'mobile-dark')
  await expect(
    page.locator('.product-demo-still:visible img')
  ).toHaveJSProperty('naturalWidth', 780)
  await page.getByRole('button', { name: 'mobile navigation' }).click()
  await page
    .locator('.VPNavScreen')
    .getByRole('switch', { name: /theme/i })
    .click()
  await expect(demo(page)).toHaveAttribute('data-variant', 'mobile-light')
  await expect
    .poll(() => recording(page).evaluate((video) => video.currentSrc))
    .toMatch(/landing\/mobile-light\.(mp4|webm)$/)
})

for (const theme of ['dark', 'light'])
  test(`${theme} homepage fits phones, tablets and desktop`, async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.addInitScript(
      (value) => localStorage.setItem('vitepress-theme-appearance', value),
      theme
    )
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 })
      await page.goto('./')
      await expect(page.locator('.product-feature')).toHaveCount(4)
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1
        ),
        `${theme}/${width}`
      ).toBe(true)
      // The frame keeps the recording's shape, so nothing moves when it loads.
      const frame = await page.locator('.product-demo-frame').boundingBox()
      const ratio = width <= 900 ? 780 / 1240 : 2240 / 1400
      expect(Math.abs(frame.width / frame.height - ratio)).toBeLessThan(0.01)
    }
  })

test('phone controls are easy to tap and the page has no stray menu', async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 320, height: 800 },
    hasTouch: true,
    reducedMotion: 'reduce',
  })
  const page = await context.newPage()
  await page.goto(test.info().project.use.baseURL)
  for (const control of await page
    .locator('.product-actions a, .product-demo-toggle, .product-run a')
    .all()) {
    const box = await control.boundingBox()
    expect(box.height).toBeGreaterThanOrEqual(44)
  }
  // Scrolling a page without sections used to bring up a "Return to top" bar.
  await page.evaluate(() => scrollTo(0, 600))
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(400)
  await expect(page.getByText('Return to top')).toBeHidden()
  await expect(page.locator('.VPLocalNav')).toBeHidden()
  await page.getByRole('link', { name: 'Docker Compose' }).click()
  await expect(page).toHaveURL(/hosting\/docker\.html$/)
  await context.close()
})
