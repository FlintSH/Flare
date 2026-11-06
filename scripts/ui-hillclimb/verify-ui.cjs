/* eslint-disable @typescript-eslint/no-require-imports */
// Run against a disposable, populated local Flare instance. The account must
// be a demo administrator with a .test email. Creates and deletes two uploads.
// FLARE_HILLCLIMB_ORIGIN=http://localhost:3193
// FLARE_HILLCLIMB_AUTH=/absolute/path/to/disposable-storage-state.json
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs/promises')
const {
  chromium,
  expect,
} = require('../../docs/site/node_modules/@playwright/test')
const origin = process.env.FLARE_HILLCLIMB_ORIGIN || 'http://localhost:3193'
const auth = process.env.FLARE_HILLCLIMB_AUTH
const output =
  process.env.FLARE_HILLCLIMB_OUTPUT || '.agent-artifacts/visual-polish/qa'
if (!['localhost', '127.0.0.1'].includes(new URL(origin).hostname) || !auth)
  throw new Error('Use a disposable local instance and FLARE_HILLCLIMB_AUTH.')
const results = []
const pass = (check, details = {}) => {
  results.push({ check, ...details })
  console.log('PASS:', check)
}

async function main() {
  await fs.mkdir(output, { recursive: true })
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({
    storageState: auth,
    viewport: { width: 1440, height: 900 },
    reducedMotion: 'reduce',
  })
  const session = await context.request
    .get(origin + '/api/auth/session')
    .then((r) => r.json())
  assert.match(
    session.user?.email || '',
    /@[^@]+\.test$/,
    'Disposable demo account required'
  )
  assert.ok(
    session.user?.permissions?.includes('administrator'),
    'Demo administrator required'
  )
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  const goto = async (route) => {
    await page.goto(origin + route)
    await page.locator('#main-content').waitFor()
    await page.addStyleTag({
      content: 'nextjs-portal { display:none!important }',
    })
  }
  const pick = async (id, name) => {
    await page.locator(id).click()
    await page.getByRole('option', { name, exact: true }).click()
  }
  const prefix = `hillclimb-check-${Date.now()}`
  try {
    for (const size of [
      { width: 1440, height: 900 },
      { width: 390, height: 844 },
      { width: 320, height: 740 },
      { width: 820, height: 1000 },
    ]) {
      await page.setViewportSize(size)
      await goto('/dashboard')
      // A fresh library visit starts at the top; prior viewport checks may
      // have scrolled while opening controls, which history restores.
      await page.evaluate(() => window.scrollTo(0, 0))
      await page.waitForTimeout(300)
      const first = page.locator('a[aria-label^="Open "]').first()
      await expect(first).toBeVisible()
      const box = await first.boundingBox()
      assert.ok(
        box.y < size.height,
        `First file starts in viewport at ${size.width}`
      )
      assert.ok(
        Math.abs(box.width / box.height - 4 / 3) < 0.03,
        '4:3 preview geometry'
      )
      const folders = page.getByRole('button', { name: /^Folders \d/ })
      await expect(folders).toHaveAttribute('aria-expanded', 'false')
      await folders.click()
      await expect(
        page.getByRole('button', { name: /^Open folder / }).first()
      ).toBeVisible()
      await page.reload()
      await expect(
        page.getByRole('button', { name: /^Folders \d/ })
      ).toHaveAttribute('aria-expanded', 'true')
      await page.getByRole('button', { name: /^Folders \d/ }).click()
      if (size.width < 640) {
        const filters = page.getByRole('button', { name: /^Filters/ })
        await expect(filters).toHaveAttribute('aria-expanded', 'false')
        await filters.click()
        await expect(
          page.getByRole('button', { name: 'File type', exact: true })
        ).toBeVisible()
        await filters.click()
      }
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth
        ),
        'No horizontal page overflow'
      )
      pass(`Library geometry and disclosures at ${size.width}`, {
        firstPreviewY: Math.round(box.y),
      })
      await page.screenshot({
        path: path.join(output, `library-${size.width}.png`),
      })
    }
    await goto(
      '/dashboard?search=release&visibility=private,hasPassword&groupBy=month'
    )
    await page
      .getByRole('button', { name: 'Remove Private filter', exact: true })
      .click()
    await expect
      .poll(() => new URL(page.url()).searchParams.get('visibility'))
      .toBe('hasPassword')
    assert.equal(new URL(page.url()).searchParams.get('search'), 'release')
    assert.equal(new URL(page.url()).searchParams.get('groupBy'), 'month')
    await page
      .getByRole('button', {
        name: 'Remove Search: release filter',
        exact: true,
      })
      .click()
    await expect
      .poll(() => new URL(page.url()).searchParams.get('search'))
      .toBe(null)
    assert.equal(
      new URL(page.url()).searchParams.get('visibility'),
      'hasPassword'
    )
    pass('Removing one filter preserves all unrelated constraints')

    await page.setViewportSize({ width: 390, height: 844 })
    await goto('/dashboard/profile')
    await page.getByRole('combobox', { name: 'Profile section' }).click()
    await expect(
      page.getByRole('option', { name: 'Integrations' })
    ).toBeVisible()
    await page.getByRole('option', { name: 'Uploads', exact: true }).click()
    await expect
      .poll(() => new URL(page.url()).searchParams.get('section'))
      .toBe('uploads')
    await expect
      .poll(() => page.evaluate(() => document.activeElement?.tagName))
      .toBe('H2')
    await page.goBack()
    await expect(
      page.getByRole('heading', { name: 'Account', exact: true })
    ).toBeVisible()
    await page.getByRole('link', { name: 'Appearance', exact: true }).click()
    await expect
      .poll(() => new URL(page.url()).hash)
      .toBe('#workspace-appearance')
    await expect
      .poll(() => page.evaluate(() => document.activeElement?.id))
      .toBe('workspace-appearance')
    pass(
      'Complete mobile section picker, focus, Back and account anchor navigation'
    )
    for (const [label, id] of [
      ['Identity', 'profile-identity'],
      ['Sign-in security', 'sign-in-security'],
      ['Active sessions', 'active-sessions'],
      ['Login history', 'login-history'],
      ['Password', 'password'],
      ['Appearance', 'workspace-appearance'],
    ]) {
      await page.getByRole('link', { name: label, exact: true }).focus()
      await page.keyboard.press('Enter')
      await expect(page.locator('#' + id)).toBeFocused()
      const outline = await page.locator('#' + id).evaluate((el) => {
        const style = getComputedStyle(el)
        return {
          style: style.outlineStyle,
          width: parseFloat(style.outlineWidth),
          color: style.outlineColor,
        }
      })
      assert.ok(
        outline.style === 'none' ||
          outline.width === 0 ||
          outline.color === 'rgba(0, 0, 0, 0)',
        'Shortcut targets have no unintended visible browser outline'
      )
    }
    pass('All six account shortcuts move keyboard focus consistently')

    await goto('/dashboard/settings')
    const ocr = page.getByRole('switch', { name: 'Background OCR processing' })
    const original = await ocr.getAttribute('aria-checked')
    await ocr.click()
    await pick('[aria-label="Settings section"]', 'Storage')
    await page.getByRole('combobox', { name: 'Settings section' }).click()
    await page
      .getByRole('option', { name: 'General · Unsaved changes' })
      .click()
    await expect(ocr).toHaveAttribute(
      'aria-checked',
      original === 'true' ? 'false' : 'true'
    )
    await ocr.click() // Restore local draft without any server write.
    pass(
      'Settings section changes retain unsaved edits and name dirty sections'
    )

    await page.setViewportSize({ width: 1440, height: 900 })
    await goto('/dashboard/roles')
    const group = page.locator('h3 button[aria-expanded]').first()
    await expect(group).toHaveAttribute('aria-expanded', 'false')
    await group.click()
    await expect(group).toHaveAttribute('aria-expanded', 'true')
    await page
      .getByRole('textbox', { name: 'Search permissions' })
      .fill('upload')
    await expect(page.getByRole('switch').first()).toBeVisible()
    pass(
      'Permission groups disclose explicitly and searching exposes matching controls'
    )

    await goto('/dashboard/audit')
    await page.getByRole('button', { name: 'Sign-ins', exact: true }).click()
    await expect(
      page.getByRole('button', { name: 'Sign-ins', exact: true })
    ).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByLabel('Applied filters')).toContainText('Auth login')
    await page
      .getByRole('button', { name: 'All activity', exact: true })
      .click()
    await expect(
      page.getByRole('button', { name: 'All activity', exact: true })
    ).toHaveAttribute('aria-pressed', 'true')
    pass('Audit presets apply supported filters and can return to All activity')

    await goto('/dashboard/users')
    await page
      .getByRole('button', { name: /^More actions for / })
      .first()
      .click()
    await expect(
      page.getByRole('menuitem', { name: /^View content for / })
    ).toBeVisible()
    await expect(page.getByRole('menuitem', { name: /^Delete / })).toBeVisible()
    await page.keyboard.press('Escape')
    pass('User overflow menu exposes named secondary and destructive actions')
    const returnTarget = page.getByRole('button', {
      name: 'More actions for Sam Okafor',
      exact: true,
    })
    for (const action of [
      'Delete Sam Okafor',
      'Revoke sessions for Sam Okafor',
    ]) {
      await returnTarget.click()
      await page.getByRole('menuitem', { name: action, exact: true }).click()
      await expect(page.getByRole('alertdialog')).toBeVisible()
      await page.getByRole('button', { name: 'Cancel', exact: true }).click()
      await expect(returnTarget).toBeFocused()
    }
    pass('Cancelling Delete and Revoke returns focus to the user menu trigger')

    for (const mode of ['paste', 'upload']) {
      await goto('/dashboard/' + mode)
      const name = `${prefix}-${mode}.txt`
      if (mode === 'paste') {
        await page
          .locator('#content')
          .fill('A disposable UI verification file.')
        await page.locator('#filename').fill(name)
      } else {
        await page
          .getByRole('button', { name: 'Choose files to upload', exact: true })
          .locator('input[type=file]')
          .setInputFiles({
            name,
            mimeType: 'text/plain',
            buffer: Buffer.from('Disposable upload fixture'),
          })
      }
      const options = page.locator('details').filter({
        has: page.getByText(
          mode === 'paste' ? 'Sharing options' : 'Upload options',
          { exact: true }
        ),
      })
      await expect(options).not.toHaveAttribute('open')
      await options.locator('summary').click()
      await pick(`#${mode}-visibility`, 'Private (only me)')
      await page.locator(`#${mode}-password`).fill('Demo-check-only-2026!')
      await options.locator('summary').click()
      await expect(page.getByText(/Private · password protected/)).toBeVisible()
      const created = page.waitForResponse(
        (r) =>
          new URL(r.url()).pathname === '/api/files' &&
          r.request().method() === 'POST'
      )
      await page
        .getByRole('button', {
          name: mode === 'paste' ? 'Create paste' : 'Upload 1 file',
          exact: true,
        })
        .click()
      const response = await created
      assert.equal(response.status(), 200)
      await expect(
        page
          .locator('#main-content')
          .getByText(mode === 'paste' ? /^Paste created:/ : 'Upload complete', {
            exact: mode === 'upload',
          })
      ).toBeVisible()
      const saved = await context.request
        .get(origin + '/api/files?search=' + encodeURIComponent(name))
        .then((r) => r.json())
      const file = saved.data.find((f) => f.name === name)
      assert.ok(file, 'File is persisted')
      assert.equal(file.visibility, 'PRIVATE')
      assert.equal(file.hasPassword, true)
      pass(
        `${mode} keeps private/password overrides when options close and persists real content`
      )
    }
    const touch = await browser.newContext({
      storageState: auth,
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      isMobile: true,
      reducedMotion: 'reduce',
    })
    const phone = await touch.newPage()
    phone.on('pageerror', (error) => errors.push(error.message))
    try {
      await phone.goto(origin + '/dashboard/settings')
      assert.ok(
        await phone.evaluate(() => matchMedia('(pointer: coarse)').matches),
        'Actual coarse pointer'
      )
      const toggle = phone.getByRole('switch', {
        name: 'Background OCR processing',
      })
      await expect(toggle).toBeVisible()
      const track = await toggle.boundingBox()
      const hit = await toggle.evaluate((el) => {
        const s = getComputedStyle(el, '::after')
        return { width: parseFloat(s.width), height: parseFloat(s.height) }
      })
      assert.ok(hit.width >= 44 && hit.height >= 44, 'Switch hit area is 44px')
      const before = await toggle.getAttribute('aria-checked')
      await phone.touchscreen.tap(track.x + track.width / 2, track.y - 6)
      await expect(toggle).toHaveAttribute(
        'aria-checked',
        before === 'true' ? 'false' : 'true'
      )
      await phone.touchscreen.tap(track.x + track.width / 2, track.y - 6)
      await expect(toggle).toHaveAttribute('aria-checked', before)
      pass(
        'Real coarse-pointer switch extension toggles without enlarging visible track'
      )
      for (const width of [320, 390]) {
        await phone.setViewportSize({ width, height: 844 })
        await phone.goto(origin + '/dashboard')
        await phone.getByRole('button', { name: 'Unfiled', exact: true }).tap()
        const folderLabel = phone.getByText('New folder', { exact: true })
        await expect(folderLabel).toBeVisible()
        const labelBounds = await folderLabel.boundingBox()
        assert.ok(labelBounds.width > 60 && labelBounds.height >= 20)
        assert.ok(
          await phone.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth
          ),
          'Labeled folder creation fits the phone'
        )
        pass(`Phone folder creation remains visibly labeled at ${width}`)
        for (const mode of ['paste', 'upload']) {
          await phone.goto(origin + '/dashboard/' + mode)
          if (mode === 'paste')
            await phone.locator('#content').fill('Disposable validation check')
          else
            await phone
              .getByRole('button', {
                name: 'Choose files to upload',
                exact: true,
              })
              .locator('input[type=file]')
              .setInputFiles({
                name: 'validation-only.txt',
                mimeType: 'text/plain',
                buffer: Buffer.from('Not sent'),
              })
          const options = phone.locator('details').filter({
            has: phone.getByText(
              mode === 'paste' ? 'Sharing options' : 'Upload options',
              { exact: true }
            ),
          })
          const submit = phone.getByRole('button', {
            name: mode === 'paste' ? 'Create paste' : 'Upload 1 file',
            exact: true,
          })
          for (const invalid of ['short', '😀'.repeat(20)]) {
            await options.locator('summary').click()
            await phone.locator(`#${mode}-password`).fill(invalid)
            await expect(
              phone
                .locator('p:visible')
                .filter({ hasText: /^Use at (least|most)/ })
            ).toHaveCount(1)
            await expect(
              phone.getByRole('button', {
                name: 'Review password',
                exact: true,
              })
            ).toHaveCount(0)
            await expect(
              phone
                .getByRole('alert')
                .filter({ hasText: /Use at (least|most)/ })
            ).toHaveCount(0)
            await options.locator('summary').click()
            await expect(
              phone
                .getByRole('status')
                .filter({ hasText: /Use at (least|most)/ })
            ).toBeVisible()
            await expect(submit).toBeDisabled()
            await expect(
              phone.getByText(/password needs attention/)
            ).toBeVisible()
            await phone
              .getByRole('button', { name: 'Review password', exact: true })
              .click()
            await expect(phone.locator(`#${mode}-password`)).toBeFocused()
            await expect(
              phone
                .locator('p:visible')
                .filter({ hasText: /^Use at (least|most)/ })
            ).toHaveCount(1)
            await expect(
              phone
                .getByRole('status')
                .filter({ hasText: /Use at (least|most)/ })
            ).toHaveCount(0)
            await phone.locator(`#${mode}-password`).fill('')
            await options.locator('summary').click()
            await expect(submit).toBeEnabled()
          }
          pass(
            `${mode} closed-option short and multibyte password recovery at ${width}`
          )
          if (mode === 'upload') {
            await options.locator('summary').click()
            await phone.locator('#upload-expiration').click()
            await phone.locator('#expiry-date').click()
            const calendar = phone.locator('.flare-calendar')
            await expect(calendar).toBeVisible()
            for (const name of ['previous-month', 'next-month']) {
              await expect
                .poll(async () => {
                  const rect = await calendar
                    .locator(`button[name="${name}"]`)
                    .boundingBox()
                  return Math.min(rect.width, rect.height)
                })
                .toBeGreaterThanOrEqual(43.99)
              const b = await calendar
                .locator(`button[name="${name}"]`)
                .boundingBox()
              assert.ok(
                b.width >= 43.99 && b.height >= 43.99,
                'Calendar navigation 44px'
              )
            }
            const day = await calendar
              .locator('button[name="day"]:not([disabled])')
              .first()
              .boundingBox()
            assert.ok(
              day.width >= 24 && day.height >= 40,
              'Dense day target fits seven columns'
            )
            const rect = await calendar.boundingBox()
            assert.ok(
              rect.x >= 0 && rect.x + rect.width <= width,
              'Calendar stays inside viewport'
            )
            await calendar.locator('button[name="next-month"]').tap()
            await calendar
              .locator('button[name="day"]:not([disabled])')
              .first()
              .tap()
            await phone.keyboard.press('Escape')
            pass(
              `Actual touch calendar targets, selection and no overflow at ${width}`
            )
          }
        }
        for (const height of [740, 844]) {
          await phone.setViewportSize({ width, height })
          await phone.goto(origin + '/dashboard')
          await phone.getByRole('button', { name: /^Filters/ }).click()
          await phone
            .getByRole('button', { name: 'Upload date', exact: true })
            .tap()
          const datePopover = phone
            .getByRole('dialog')
            .filter({ has: phone.locator('.flare-calendar') })
          await expect(datePopover).toBeVisible()
          await expect
            .poll(async () => {
              const rect = await datePopover.boundingBox()
              return Math.max(16 - rect.y, rect.y + rect.height - (height - 16))
            })
            .toBeLessThanOrEqual(1)
          await datePopover
            .locator('button[name="day"]:not([disabled])')
            .first()
            .tap()
          const clearDate = datePopover.getByRole('button', {
            name: 'Clear date range',
            exact: true,
          })
          await expect(clearDate).toBeVisible()
          const selectedBounds = await datePopover.boundingBox()
          const clearBounds = await clearDate.boundingBox()
          assert.ok(
            selectedBounds.y >= 15 &&
              selectedBounds.y + selectedBounds.height <= height - 15,
            'Selected date range footer stays bounded'
          )
          assert.ok(
            clearBounds.y >= selectedBounds.y &&
              clearBounds.y + clearBounds.height <=
                selectedBounds.y + selectedBounds.height,
            'Clear date range stays fully visible without scrolling'
          )
          await clearDate.tap()
          await expect(clearDate).toHaveCount(0)
          const grouping = datePopover.getByRole('combobox', {
            name: 'Group files by upload date',
          })
          await grouping.scrollIntoViewIfNeeded()
          await expect(grouping).toBeVisible()
          const groupBounds = await grouping.boundingBox()
          const clearedBounds = await datePopover.boundingBox()
          assert.ok(
            groupBounds.y >= clearedBounds.y &&
              groupBounds.y + groupBounds.height <=
                clearedBounds.y + clearedBounds.height,
            'Group files stays fully visible'
          )
          await phone.screenshot({
            path: path.join(output, `filter-date-${width}-${height}.png`),
            animations: 'disabled',
          })
          await phone.keyboard.press('Escape')
          pass(
            `Phone date popover bounds and selected-range clearing at ${width}×${height}`
          )
        }
      }
      await phone.setViewportSize({ width: 820, height: 1000 })
      await phone.goto(origin + '/dashboard/users')
      const invitations = phone.getByRole('tab', {
        name: 'Invites',
        exact: true,
      })
      await expect(invitations).toBeVisible()
      const tabBox = await invitations.boundingBox()
      assert.ok(
        tabBox.height >= 43.99 && tabBox.width >= 43.99,
        'Tablet tabs retain touch targets'
      )
      await invitations.tap()
      await expect(invitations).toHaveAttribute('data-state', 'active')
      assert.ok(
        await phone.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth
        ),
        'No tablet overflow'
      )
      pass('Real coarse-pointer tablet tabs at 820')
    } finally {
      await touch.close()
    }
    const zoom = await browser.newContext({
      storageState: auth,
      viewport: { width: 720, height: 450 },
      deviceScaleFactor: 2,
      reducedMotion: 'reduce',
    })
    try {
      const magnified = await zoom.newPage()
      magnified.on('pageerror', (error) => errors.push(error.message))
      await magnified.goto(origin + '/dashboard/settings')
      await expect(
        magnified.getByRole('heading', { name: 'Settings', exact: true })
      ).toBeVisible()
      assert.ok(
        await magnified.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth
        ),
        '200% layout emulation has no horizontal overflow'
      )
      await magnified.screenshot({
        path: path.join(output, 'settings-200-percent-layout.png'),
      })
      pass('200% layout emulation at 720 CSS px with 2x device scale')
    } finally {
      await zoom.close()
    }
    assert.deepEqual(errors, [], 'No uncaught browser errors')
    pass('No uncaught browser errors')
  } catch (error) {
    await page.screenshot({
      path: path.join(output, 'failure.png'),
      fullPage: true,
    })
    throw error
  } finally {
    const saved = await context.request
      .get(origin + '/api/files?search=' + encodeURIComponent(prefix))
      .then((r) => r.json())
      .catch(() => null)
    for (const file of saved?.data || []) {
      if (file.name.startsWith(prefix))
        await context.request.delete(origin + '/api/files/' + file.id, {
          headers: { Origin: origin },
        })
    }
    await fs.writeFile(
      path.join(output, 'results.json'),
      JSON.stringify(results, null, 2)
    )
    await browser.close()
  }
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
