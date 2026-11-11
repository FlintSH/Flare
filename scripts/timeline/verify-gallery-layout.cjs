/* eslint-disable @typescript-eslint/no-require-imports */
// Run against the disposable timeline fixture after scripts/timeline/seed.cjs.
const assert = require('node:assert/strict')
const { chromium } = require('../../docs/site/node_modules/@playwright/test')
const origin = process.env.FLARE_TIMELINE_TEST_ORIGIN || 'http://localhost:3064'
if (new URL(origin).hostname !== 'localhost')
  throw new Error('Use disposable localhost fixtures')
;(async () => {
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage()
    await page.goto(`${origin}/auth/login`)
    await page
      .getByLabel('Email address', { exact: true })
      .fill('timeline-demo-alex@example.test')
    await page
      .getByLabel('Password', { exact: true })
      .fill('Timeline-demo-only-2026!')
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()
    await page.waitForURL('**/dashboard')
    for (const width of [320, 390, 640, 768, 1024, 1100, 1280, 1440]) {
      await page.setViewportSize({ width, height: 900 })
      const list = page.getByRole('list', { name: 'Your files', exact: true })
      await list.waitFor()
      await page.waitForFunction(
        () => document.querySelector('[data-file-index] img')?.naturalWidth > 0
      )
      await page.waitForTimeout(300)
      await page.evaluate(() => window.scrollTo(0, 0))
      const geometry = await page.evaluate(() => {
        const list = document.querySelector('[aria-label="Your files"]')
        const panel = document.querySelector(
          '[aria-label="Find and filter files"]'
        )
        const row = list.querySelector('[data-row] > .grid')
        const rail = document.querySelector('[role="slider"]')
        return {
          left: list.getBoundingClientRect().left,
          right: list.getBoundingClientRect().right,
          panelLeft: panel.getBoundingClientRect().left,
          panelRight: panel.getBoundingClientRect().right,
          columns: getComputedStyle(row).gridTemplateColumns.split(' ').length,
          railLeft: rail?.getBoundingClientRect().left ?? Infinity,
          overflow: document.documentElement.scrollWidth > innerWidth,
        }
      })
      assert(Math.abs(geometry.left - geometry.panelLeft) < 1)
      assert(Math.abs(geometry.right - geometry.panelRight) < 1)
      assert(
        geometry.right <= geometry.railLeft,
        'Date rail must not intercept cards'
      )
      assert(!geometry.overflow)
      if (width < 640) {
        assert.equal(geometry.columns, 2)
        const toggle = page.getByRole('button', { name: /Sort & filters/ })
        await toggle.click()
        await page.getByRole('combobox', { name: 'Sort files' }).waitFor()
        await toggle.click()
        assert.equal(
          await page.getByRole('combobox', { name: 'Sort files' }).isVisible(),
          false
        )
      }
      console.log(
        `PASS ${width}px: ${geometry.columns} columns, aligned edges, no rail overlap or overflow`
      )
    }
    const rail = page.getByRole('slider', { name: 'Browse files by date' })
    await rail.press('End')
    await page.locator('[data-file-index="11999"]').waitFor()
    await page.setViewportSize({ width: 390, height: 844 })
    await page.locator('[data-file-index="11999"]').waitFor()
    await rail.press('Home')
    await page.locator('[data-file-index="0"]').waitFor()
    console.log('PASS date navigation and resize at end of library')
  } finally {
    await browser.close()
  }
})().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
