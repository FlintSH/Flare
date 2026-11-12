import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import { readPalette } from '../scripts/appearance-assets.mjs'

const source = await readFile(
  new URL('../../../lib/customization/schema.ts', import.meta.url),
  'utf8'
)

test('floating navigation fits narrow phones, tablets, and desktop breakpoints', async ({
  page,
}) => {
  for (const width of [320, 768, 960, 1280]) {
    await page.setViewportSize({ width, height: 900 })
    for (const path of ['./', './hosting/docker.html']) {
      await page.goto(path)
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth
        ),
        `${path} at ${width}px`
      ).toBe(true)
      const header = page.locator('.VPNavBar > .wrapper > .container')
      const box = await header.boundingBox()
      expect(box.x).toBeGreaterThanOrEqual(0)
      expect(box.x + box.width).toBeLessThanOrEqual(width)
    }
  }
})

for (const theme of ['dark', 'light']) {
  test(`${theme} docs load the real Flare palette and bundled Inter`, async ({
    page,
  }) => {
    await page.addInitScript(
      (value) => localStorage.setItem('vitepress-theme-appearance', value),
      theme
    )
    await page.goto('./')
    await page.evaluate(() => document.fonts.ready)
    const palette = readPalette(source, `${theme.toUpperCase()}_PALETTE`)
    const colors = await page.evaluate(() => {
      const style = getComputedStyle(document.documentElement)
      return {
        background: style.getPropertyValue('--background').trim(),
        primary: style.getPropertyValue('--primary').trim(),
        card: style.getPropertyValue('--card').trim(),
        fonts: [...document.fonts]
          .filter((font) => font.status === 'loaded')
          .map((font) => font.family),
      }
    })
    expect(colors).toMatchObject({
      background: palette.background,
      primary: palette.primary,
      card: palette.card,
    })
    expect(colors.fonts).toContain('Inter')
    const stylesheet = page.locator('link[href$="flare-theme.css"]')
    const response = await page.request.get(
      await stylesheet.getAttribute('href')
    )
    expect(response.ok()).toBe(true)
    await expect(page.getByRole('link', { name: /Set up Flare/ })).toBeVisible()
  })
}

test('mobile readers can open the sidebar and navigate', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('./guide/index.html')
  const menu = page.getByRole('button', { name: 'Menu', exact: true })
  await menu.click()
  const sidebar = page.locator('.VPSidebar')
  await expect(sidebar).toBeVisible()
  await sidebar.getByRole('link', { name: 'Upload files', exact: true }).click()
  await expect(page).toHaveURL(/guide\/uploading\.html$/)
  await expect(page.locator('h1')).toBeVisible()
  await expect(menu).toHaveAttribute('aria-expanded', 'false')
  await page.getByRole('button', { name: 'mobile navigation' }).click()
  await expect(
    page
      .locator('.VPNavScreen')
      .getByRole('link', { name: 'Explore', exact: true })
  ).toBeVisible()
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)
    )
    .toBe(true)
})

test('search and screenshot dialogs keep keyboard focus and readable controls', async ({
  page,
}) => {
  await page.goto('./demos.html')
  await page
    .getByRole('button', { name: /Search/ })
    .first()
    .click()
  await expect(page.locator('#localsearch-input')).toBeFocused()
  await page.locator('#localsearch-input').fill('webhook')
  await expect(page.locator('.VPLocalSearchBox')).toContainText(/webhook/i)
  await expect(
    page.locator('.VPLocalSearchBox .result:not(.selected) .excerpt').first()
  ).toHaveCSS('opacity', '1')
  await expect(page.locator('.VPLocalSearchBox .result').first()).not.toHaveCSS(
    'background-color',
    'rgba(0, 0, 0, 0)'
  )
  await page.keyboard.press('Escape')
  await expect(page.locator('.VPLocalSearchBox')).not.toBeVisible()
  const screenshot = page.locator('.screenshot-button').first()
  await screenshot.click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('button', { name: /Close/ })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(screenshot).toBeFocused()
})
