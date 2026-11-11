/* eslint-disable @typescript-eslint/no-require-imports */
// Run against a disposable local instance seeded by scripts/meticulous/seed.cjs.
const assert = require('node:assert/strict')
const { mkdir } = require('node:fs/promises')
const {
  chromium,
  expect,
} = require('../../docs/site/node_modules/@playwright/test')
const origin = process.env.FLARE_UX_ORIGIN || 'http://localhost:3049'
if (!['localhost', '127.0.0.1'].includes(new URL(origin).hostname))
  throw new Error('Use a disposable local instance.')
const output = '.agent-artifacts/ux-current'
async function main() {
  await mkdir(output, { recursive: true })
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
      reducedMotion: 'reduce',
    })
    const errors = []
    page.on('pageerror', (e) => errors.push(e.message))
    await page.goto(origin + '/auth/login')
    await page.getByLabel('Email address').fill('meticulous@example.test')
    await page
      .getByLabel('Password', { exact: true })
      .fill('Flare-test-only-2026!')
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()
    await page.waitForURL('**/dashboard')
    const shot = (name) =>
      page.screenshot({ path: `${output}/${name}.png`, animations: 'disabled' })
    const goto = (route) => page.goto(origin + route)
    await goto('/dashboard/profile?section=integrations')
    for (const [button, title, prefix] of [
      ['New token', 'New API token', 'token'],
      ['Add webhook', 'Add webhook', 'webhook'],
    ]) {
      const trigger = page.getByRole('button', { name: button, exact: true })
      await trigger.click()
      await expect(page.getByRole('dialog', { name: title })).toBeVisible()
      await shot(prefix + '-desktop')
      await page.setViewportSize({ width: 390, height: 844 })
      await shot(prefix + '-mobile')
      const box = await page.getByRole('dialog').boundingBox()
      assert.ok(box.x >= 0 && box.x + box.width <= 390)
      await page.keyboard.press('Escape')
      await expect(page.getByRole('dialog')).toHaveCount(0)
      await expect(trigger).toBeFocused()
      await page.setViewportSize({ width: 1440, height: 1000 })
    }
    await page.getByRole('button', { name: 'New token', exact: true }).click()
    await page.getByLabel('Connection name').fill('UX disposable token')
    await page.getByLabel('Upload files', { exact: false }).check()
    await page
      .getByRole('button', { name: 'Create token', exact: true })
      .click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(
      page.getByRole('heading', { name: 'Save your API token' })
    ).toBeVisible()
    await page.getByRole('button', { name: 'I saved it' }).click()
    await goto('/dashboard/profile?section=uploads')
    await page.getByRole('button', { name: /^Temporary clips/ }).click()
    await expect(
      page.getByRole('dialog', { name: 'Create a profile' })
    ).toBeVisible()
    await shot('profile-desktop')
    await page.setViewportSize({ width: 390, height: 844 })
    await shot('profile-mobile')
    await page
      .getByRole('button', { name: 'Save profile', exact: true })
      .scrollIntoViewIfNeeded()
    await shot('profile-mobile-scrolled')
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(
      page.getByRole('button', { name: /^Temporary clips/ })
    ).toBeFocused()
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 })
      for (const route of ['upload', 'paste']) {
        await goto('/dashboard/' + route)
        await expect(page.locator('main h1')).toBeVisible()
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth > innerWidth
          ),
          false
        )
        // The page wrapper fills the common dashboard container.
        const wrapper = page.locator('main > div').first()
        assert.ok((await wrapper.boundingBox()).width > width * 0.8)
        await shot(`${route}-${width}`)
      }
      await goto('/dashboard/profile?section=invites')
      const heading = page.getByRole('heading', {
        name: 'Invite people',
        exact: true,
      })
      await expect(heading).toBeVisible()
      await expect(
        page.getByText('Loading invites…', { exact: true })
      ).toHaveCount(0)
      const padding = await heading.evaluate((e) => {
        const card = e.closest('[class*="bg-panel"]')
        return parseFloat(getComputedStyle(card.firstElementChild).paddingTop)
      })
      assert.ok(padding >= 16, `Invite card padding: ${padding}`)
      await shot(`invites-${width}`)
    }
    await page.setViewportSize({ width: 1440, height: 1000 })
    const fixture = await page.request.post(origin + '/api/folders', {
      headers: { Origin: origin },
      data: { name: 'UX layout ' + Date.now() },
    })
    assert.ok(fixture.ok())
    const folderId = (await fixture.json()).data.id
    await goto('/dashboard')
    const toggle = page.getByRole('button', { name: /^Folders \d+/ })
    await toggle.click()
    const folders = page.getByRole('region', { name: 'Folders', exact: true })
    await expect(folders).toBeVisible()
    assert.equal(
      await folders.evaluate((e) => getComputedStyle(e).marginTop),
      '12px'
    )
    const gap =
      (await folders.boundingBox()).y -
      ((await toggle.boundingBox()).y + (await toggle.boundingBox()).height)
    assert.ok(gap >= 8, `Folder gap: ${gap}`)
    await shot('folders-desktop')
    await page.setViewportSize({ width: 390, height: 844 })
    await shot('folders-mobile')
    assert.ok(
      (
        await page.request.delete(origin + '/api/folders/' + folderId, {
          headers: { Origin: origin },
        })
      ).ok()
    )
    await goto('/dashboard/profile')
    await expect(
      page.getByText('Your access combines Everyone with your assigned roles.')
    ).toBeVisible()
    await expect(page.getByText('Your roles', { exact: true })).toHaveCount(0)
    assert.deepEqual(errors, [])
    console.log(
      'PASS: desktop/mobile forms, modal focus/Escape/scrolling, invite padding, account roles; no page errors'
    )
  } finally {
    await browser.close()
  }
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
