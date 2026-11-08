/* eslint-disable @typescript-eslint/no-require-imports */
// Browser checks against the same disposable demo used by verify-ui. The optional
// account-switch check creates two nonce links and removes only those own links.
// Network timing/failure cases are simulated explicitly; stored bytes are real.
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const { isDeepStrictEqual } = require('node:util')
const {
  chromium,
  expect,
} = require('../../docs/site/node_modules/@playwright/test')
const origin = process.env.FLARE_HILLCLIMB_ORIGIN
const auth = process.env.FLARE_HILLCLIMB_AUTH
const out =
  process.env.FLARE_HILLCLIMB_OUTPUT || '.agent-artifacts/refinement/qa'
const flow = process.env.FLARE_REFINEMENT_FLOW || 'all'
if (!['all', 'm2'].includes(flow))
  throw new Error('Use all or m2 for FLARE_REFINEMENT_FLOW')
if (
  !origin ||
  !auth ||
  !['localhost', '127.0.0.1'].includes(new URL(origin).hostname)
)
  throw new Error('Disposable local origin and auth required')
const checks = []
async function main() {
  await fs.mkdir(out, { recursive: true })
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({
    storageState: auth,
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    reducedMotion: 'reduce',
  })
  let session
  try {
    session = await context.request
      .get(origin + '/api/auth/session')
      .then((r) => r.json())
    assert.match(session.user?.email || '', /@[^@]+\.test$/)
  } catch (failure) {
    await context.close()
    await browser.close()
    throw failure
  }
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  const check = (name, data = {}) => {
    checks.push({ name, passed: true, ...data })
    console.log('PASS:', name)
  }
  const goto = async (route) => {
    await page.goto(origin + route)
    await page.locator('#main-content').waitFor()
    await page.addStyleTag({ content: 'nextjs-portal{display:none!important}' })
  }
  try {
    if (flow === 'all') {
      for (const width of [320, 390, 820, 1440]) {
        await page.setViewportSize({ width, height: 900 })
        await goto('/dashboard/profile')
        const title = await page
          .getByRole('heading', { name: 'Profile', exact: true })
          .boundingBox()
        const action = await page
          .getByRole('button', { name: 'Sign out', exact: true })
          .boundingBox()
        if (width < 640)
          assert.ok(
            Math.abs(
              title.y + title.height / 2 - action.y - action.height / 2
            ) < 10,
            'Action beside title'
          )
        const roles = page
          .locator('details')
          .filter({ has: page.getByText('Your roles', { exact: true }) })
        await expect(roles).not.toHaveAttribute('open')
        await roles.locator('summary').click()
        await expect(roles).toContainText('Your access combines Everyone')
        await roles.locator('summary').click()
        await page.evaluate(() => window.scrollTo(0, 0))
        const identity = await page.locator('#profile-identity').boundingBox()
        assert.ok(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth
          )
        )
        check('Profile header, role disclosure and bounds at ' + width, {
          identityY: Math.round(identity.y),
        })
        await page.screenshot({
          path: path.join(out, 'profile-' + width + '.png'),
        })
      }
    }
    // Exercise the authorized, complete collection from the actual local API.
    await page.setViewportSize({ width: 390, height: 844 })
    await goto('/dashboard/urls')
    const linksReply = await context.request.get(origin + '/api/urls')
    assert.equal(linksReply.status(), 200)
    const actualLinks = (await linksReply.json()).data.urls
    assert.ok(actualLinks.length >= 2, 'Demo needs two real short links')
    assert.ok(actualLinks.every((link) => link.userId === session.user.id))
    const linkSearch = page.getByRole('searchbox', {
      name: 'Search links',
      exact: true,
    })
    const linkCount = page
      .getByRole('search', { name: 'Find a short link' })
      .getByRole('status')
    const linkSort = page.getByRole('combobox', { name: /^Sort links:/ })
    const visibleCodes = () =>
      page
        .getByRole('table', { name: 'Shortened URLs' })
        .locator('tbody a[href^="/u/"]')
        .evaluateAll((anchors) =>
          anchors.map((anchor) => anchor.getAttribute('href').slice(3))
        )
    const assertCodes = async (links) => {
      await expect
        .poll(visibleCodes)
        .toEqual(links.map((link) => link.shortCode))
    }
    await expect(linkCount).toHaveText(
      `${actualLinks.length} of ${actualLinks.length} links`
    )
    await assertCodes(actualLinks)
    await expect(linkSort).toHaveAccessibleName('Sort links: Newest first')
    const sampleLink = actualLinks[0]
    await linkSearch.fill(sampleLink.targetUrl)
    await expect(linkCount).toHaveText(
      `${actualLinks.filter((link) => link.targetUrl.toLowerCase().includes(sampleLink.targetUrl.toLowerCase())).length} of ${actualLinks.length} links`
    )
    await expect(
      page.getByRole('link', {
        name: `/u/${sampleLink.shortCode}`,
        exact: true,
      })
    ).toBeVisible()
    await linkSearch.fill(sampleLink.shortCode.toUpperCase())
    await expect(
      page.getByRole('link', {
        name: `/u/${sampleLink.shortCode}`,
        exact: true,
      })
    ).toBeVisible()
    await page
      .getByRole('button', { name: 'Clear link search', exact: true })
      .click()
    await expect(linkSearch).toBeFocused()
    await expect(linkSearch).toHaveValue('')
    await assertCodes(actualLinks)
    await linkSort.click()
    await page
      .getByRole('option', { name: 'Oldest first', exact: true })
      .click()
    const oldestLinks = actualLinks
      .map((link, index) => ({ link, index }))
      .sort(
        (a, b) =>
          Date.parse(a.link.createdAt) - Date.parse(b.link.createdAt) ||
          a.index - b.index
      )
      .map(({ link }) => link)
    await assertCodes(oldestLinks)
    await linkSearch.fill('no matching refinement link 7ed5a4')
    await expect(linkCount).toHaveText(`0 of ${actualLinks.length} links`)
    await expect(
      page.getByText('No links match your search.', { exact: true })
    ).toBeVisible()
    await expect(
      page.getByRole('table', { name: 'Shortened URLs' })
    ).toHaveCount(0)
    await page
      .getByRole('button', { name: 'Clear search', exact: true })
      .click()
    await expect(linkSearch).toBeFocused()
    await expect(linkSort).toHaveAccessibleName('Sort links: Oldest first')
    await assertCodes(oldestLinks)
    await linkSort.click()
    await page.getByRole('option', { name: 'Most clicks', exact: true }).click()
    await assertCodes(
      actualLinks
        .map((link, index) => ({ link, index }))
        .sort((a, b) => b.link.clicks - a.link.clicks || a.index - b.index)
        .map(({ link }) => link)
    )
    check(
      'Real short-link destination/code search, stable sorts, counts and zero-result recovery'
    )
    for (const width of [320, 390, 820, 1440]) {
      await page.setViewportSize({ width, height: 844 })
      const searchBounds = await linkSearch.boundingBox()
      const sortBounds = await linkSort.boundingBox()
      assert.ok(
        Math.abs(searchBounds.y - sortBounds.y) < 2,
        'Compact search and sort share one row'
      )
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth
        )
      )
      await page.screenshot({
        path: path.join(out, `links-retrieval-${width}.png`),
      })
    }
    check(
      'Short-link retrieval controls fit a single toolbar row at phone, tablet and desktop widths'
    )

    const switchAuth = process.env.FLARE_HILLCLIMB_SWITCH_AUTH
    if (switchAuth) {
      const originalCookies = await context.cookies()
      const replacementState = JSON.parse(await fs.readFile(switchAuth, 'utf8'))
      const fixtureBase = `https://example.test/refinement-scope-${Date.now()}-${Math.random().toString(36).slice(2)}`
      const fixtureTargets = new Set([
        fixtureBase + '/visible',
        fixtureBase + '/pending',
      ])
      const fixtureIds = new Set()
      const fixtureRecords = []
      const privateReceipts =
        process.env.FLARE_HILLCLIMB_PRIVATE_RECEIPTS ||
        path.join(out, '.private')
      await fs.mkdir(privateReceipts, { recursive: true, mode: 0o700 })
      await fs.chmod(privateReceipts, 0o700)
      assert.equal((await fs.stat(privateReceipts)).mode & 0o777, 0o700)
      const receiptFile = path.join(
        privateReceipts,
        new URL(fixtureBase).pathname.slice(1) + '.json'
      )
      const persistFixture = async (fixture) => {
        assert.equal(fixture.userId, session.user.id)
        assert.ok(fixtureTargets.has(fixture.targetUrl))
        fixtureRecords.push({
          id: fixture.id,
          userId: fixture.userId,
          targetUrl: fixture.targetUrl,
          shortCode: fixture.shortCode,
          createdAt: fixture.createdAt,
        })
        await fs.writeFile(
          receiptFile,
          JSON.stringify(
            {
              purpose: 'Owned disposable link cleanup after interrupted UI QA',
              created: fixtureRecords,
            },
            null,
            2
          ) + '\n',
          { mode: 0o600 }
        )
        await fs.chmod(receiptFile, 0o600)
        assert.equal((await fs.stat(receiptFile)).mode & 0o777, 0o600)
      }
      let releasePending = () => {}
      let heldHandler
      try {
        const urlField = page.getByRole('textbox', {
          name: 'URL to shorten',
          exact: true,
        })
        const firstCreated = page.waitForResponse(
          (response) =>
            new URL(response.url()).pathname === '/api/urls' &&
            response.request().method() === 'POST'
        )
        await urlField.fill(fixtureBase + '/visible')
        await page.getByRole('button', { name: 'Shorten', exact: true }).click()
        const firstResponse = await firstCreated
        assert.equal(firstResponse.status(), 200)
        const firstFixture = (await firstResponse.json()).data
        assert.equal(firstFixture.userId, session.user.id)
        assert.equal(firstFixture.targetUrl, fixtureBase + '/visible')
        fixtureIds.add(firstFixture.id)
        await persistFixture(firstFixture)
        await expect(
          page.getByRole('textbox', { name: 'New short link', exact: true })
        ).toHaveValue(origin + '/u/' + firstFixture.shortCode)
        await page
          .getByRole('button', { name: 'Dismiss notification', exact: true })
          .click()
        await expect(
          page.getByRole('button', {
            name: 'Dismiss notification',
            exact: true,
          })
        ).toBeHidden()
        let recordPending
        const pendingRecorded = new Promise((resolve) => {
          recordPending = resolve
        })
        const gate = new Promise((resolve) => {
          releasePending = resolve
        })
        heldHandler = async (route) => {
          if (route.request().method() !== 'POST') return route.continue()
          try {
            // The server really creates this nonce link before its response is held.
            const response = await route.fetch()
            assert.equal(response.status(), 200)
            const fixture = (await response.json()).data
            assert.equal(fixture.userId, session.user.id)
            assert.equal(fixture.targetUrl, fixtureBase + '/pending')
            fixtureIds.add(fixture.id)
            await persistFixture(fixture)
            recordPending(null)
            await gate
            await route.fulfill({ response }).catch((error) => {
              if (!/already handled|closed|canceled/i.test(error.message))
                throw error
            })
          } catch (error) {
            recordPending(error)
            await route.abort().catch(() => {})
          }
        }
        await page.route('**/api/urls', heldHandler)
        const pendingBrowserResponse = page
          .waitForResponse(
            (response) =>
              new URL(response.url()).pathname === '/api/urls' &&
              response.request().method() === 'POST'
          )
          .catch(() => null)
        await urlField.fill(fixtureBase + '/pending')
        await page.getByRole('button', { name: 'Shorten', exact: true }).click()
        const pendingFailure = await pendingRecorded
        if (pendingFailure) throw pendingFailure
        await linkSearch.fill(sampleLink.shortCode)
        await page
          .getByRole('button', {
            name: `Delete short link ${sampleLink.shortCode}`,
            exact: true,
          })
          .last()
          .click()
        await expect(
          page.getByRole('alertdialog', { name: 'Delete this short link?' })
        ).toBeVisible()
        await context.clearCookies()
        await context.addCookies(replacementState.cookies)
        const replacementSession = await context.request
          .get(origin + '/api/auth/session')
          .then((response) => response.json())
        assert.match(replacementSession.user?.email || '', /@[^@]+\.test$/)
        assert.notEqual(replacementSession.user.id, session.user.id)
        const replacementReply = await context.request.get(origin + '/api/urls')
        assert.equal(
          replacementReply.status(),
          200,
          'Replacement demo account can list its own links'
        )
        const replacementLinks = (await replacementReply.json()).data.urls
        assert.ok(
          replacementLinks.every(
            (link) => link.userId === replacementSession.user.id
          )
        )
        await page.evaluate(() =>
          document.dispatchEvent(new Event('visibilitychange'))
        )
        await expect(
          page.getByRole('alertdialog', { name: 'Delete this short link?' })
        ).toHaveCount(0)
        if (replacementLinks.length) {
          await expect(linkSearch).toHaveValue('')
          await expect(linkSort).toHaveAccessibleName(
            'Sort links: Newest first'
          )
          await assertCodes(replacementLinks)
        } else {
          await expect(
            page.getByText(
              'No shortened URLs yet. Add a URL above to get started.',
              { exact: true }
            )
          ).toBeVisible()
          await expect(linkSearch).toHaveCount(0)
        }
        for (const link of actualLinks)
          await expect(
            page.getByRole('link', {
              name: `/u/${link.shortCode}`,
              exact: true,
            })
          ).toHaveCount(0)
        await expect(
          page.getByRole('textbox', { name: 'New short link', exact: true })
        ).toHaveCount(0)
        const replacementForm = page.getByRole('textbox', {
          name: 'URL to shorten',
          exact: true,
        })
        if (await replacementForm.count())
          await expect(replacementForm).toHaveValue('')
        releasePending()
        const deliveredResponse = await pendingBrowserResponse
        assert.ok(
          deliveredResponse,
          'The held real creation response is delivered after the account switch'
        )
        await deliveredResponse.finished()
        const afterDeliverySession = await context.request
          .get(origin + '/api/auth/session')
          .then((response) => response.json())
        assert.equal(
          typeof replacementSession.user.sessionId,
          'string',
          'The replacement fixture has a tracked browser session'
        )
        assert.ok(
          afterDeliverySession.user?.id === replacementSession.user.id,
          'A late creation response preserves the replacement account'
        )
        assert.ok(
          afterDeliverySession.user?.sessionId ===
            replacementSession.user.sessionId,
          'A late creation response preserves the replacement browser session'
        )
        await page.evaluate(
          () =>
            new Promise((resolve) =>
              requestAnimationFrame(() => requestAnimationFrame(resolve))
            )
        )
        await expect(
          page.getByRole('textbox', { name: 'New short link', exact: true })
        ).toHaveCount(0)
        await expect(
          page.getByRole('button', {
            name: 'Dismiss notification',
            exact: true,
          })
        ).toBeHidden()
        check(
          'Real same-tab account switch clears link query, sort, confirmation and created result; a held real creation cannot publish an old-session result or toast'
        )
      } finally {
        releasePending()
        if (heldHandler) await page.unroute('**/api/urls', heldHandler)
        await context.clearCookies()
        await context.addCookies(originalCookies)
        const cleanupReply = await context.request.get(origin + '/api/urls')
        assert.equal(cleanupReply.status(), 200)
        const cleanupLinks = (await cleanupReply.json()).data.urls
        for (const link of cleanupLinks) {
          if (!fixtureTargets.has(link.targetUrl)) continue
          assert.equal(link.userId, session.user.id)
          assert.ok(
            fixtureIds.has(link.id),
            'Cleanup accepts only IDs returned by the real fixture creations'
          )
          assert.equal(
            (
              await context.request.delete(origin + '/api/urls/' + link.id)
            ).status(),
            204
          )
        }
        const remainingLinks = (
          await context.request
            .get(origin + '/api/urls')
            .then((response) => response.json())
        ).data.urls
        assert.ok(
          remainingLinks.every(
            (link) =>
              !fixtureIds.has(link.id) && !fixtureTargets.has(link.targetUrl)
          )
        )
        await context.clearCookies()
        await context.addCookies(originalCookies)
        const cookieOrder = (a, b) =>
          `${a.domain}|${a.path}|${a.name}`.localeCompare(
            `${b.domain}|${b.path}|${b.name}`
          )
        assert.ok(
          isDeepStrictEqual(
            (await context.cookies()).sort(cookieOrder),
            [...originalCookies].sort(cookieOrder)
          ),
          'All original cookie values, scopes, flags and expiry fields are restored'
        )
        await goto('/dashboard/urls')
        await expect(linkSearch).toHaveValue('')
        await expect(linkSort).toHaveAccessibleName('Sort links: Newest first')
        await assertCodes(actualLinks)
      }
    } else {
      console.log(
        'SKIP: same-tab short-link account switch requires FLARE_HILLCLIMB_SWITCH_AUTH'
      )
    }

    await page.setViewportSize({ width: 390, height: 844 })
    const themeBefore = await page.evaluate(() => ({
      className: document.documentElement.className,
      colorScheme: document.documentElement.style.colorScheme,
    }))
    try {
      for (const mode of ['light', 'dark']) {
        await page.evaluate((value) => {
          document.documentElement.classList.remove('light', 'dark')
          document.documentElement.classList.add(value)
          document.documentElement.style.colorScheme = value
        }, mode)
        const urlField = page.getByRole('textbox', {
          name: 'URL to shorten',
          exact: true,
        })
        await expect(urlField).toHaveValue('')
        await expect(urlField).toHaveAttribute('placeholder', 'Enter a URL')
        const hintStyles = await urlField.evaluate((input) => ({
          hint: getComputedStyle(input, '::placeholder').color,
          value: getComputedStyle(input).color,
          helper: getComputedStyle(document.querySelector('#url-help')).color,
          fontStyle: getComputedStyle(input, '::placeholder').fontStyle,
          opacity: getComputedStyle(input, '::placeholder').opacity,
        }))
        assert.equal(hintStyles.fontStyle, 'italic')
        assert.equal(hintStyles.opacity, '1')
        assert.notEqual(hintStyles.hint, hintStyles.value)
        assert.notEqual(hintStyles.hint, hintStyles.helper)
        const shorten = page.getByRole('button', {
          name: 'Shorten',
          exact: true,
        })
        await expect(shorten).toBeDisabled()
        assert.equal(
          await shorten.evaluate((button) => getComputedStyle(button).opacity),
          '1'
        )
        await urlField.fill('https://example.test/entered-value')
        await expect(shorten).toBeEnabled()
        await urlField.fill('')
        await page.screenshot({
          path: path.join(out, `links-hints-${mode}.png`),
        })
        check(
          `Opaque italic input hint differs from values and helper copy; inactive primary remains readable in ${mode}`
        )
      }
      await goto('/dashboard/paste')
      const pasteContent = page.getByRole('textbox', {
        name: 'Content',
        exact: true,
      })
      const textareaHint = await pasteContent.evaluate((input) => ({
        color: getComputedStyle(input, '::placeholder').color,
        value: getComputedStyle(input).color,
        fontStyle: getComputedStyle(input, '::placeholder').fontStyle,
        opacity: getComputedStyle(input, '::placeholder').opacity,
      }))
      assert.equal(textareaHint.fontStyle, 'italic')
      assert.equal(textareaHint.opacity, '1')
      assert.notEqual(textareaHint.color, textareaHint.value)
      check(
        'Shared textarea retains a fully opaque, distinct italic placeholder'
      )
    } finally {
      await page.evaluate((value) => {
        document.documentElement.className = value.className
        document.documentElement.style.colorScheme = value.colorScheme
      }, themeBefore)
    }
    await goto('/dashboard/users')
    await page.getByRole('button', { name: 'New user', exact: true }).click()
    const newUser = page.getByRole('dialog', { name: 'New user', exact: true })
    const newPassword = newUser.getByLabel('Password', { exact: true })
    const passwordRequirements =
      'Use at least 8 characters and at most 72 bytes. Some emoji count as more than one toward the minimum. Plain English letters use one byte each; emoji and accented letters can use more.'
    await expect(newPassword).toHaveAccessibleDescription(passwordRequirements)
    await newPassword.fill('Demo-password-8')
    await expect(newPassword).toHaveAccessibleDescription(passwordRequirements)
    await expect(
      newUser.getByText(passwordRequirements, { exact: true })
    ).toBeVisible()
    assert.equal(await newPassword.evaluate((input) => input.minLength), 8)
    assert.equal(
      await newPassword.evaluate((input) => input.maxLength),
      -1,
      'UTF-8 byte limit is not mistaken for a character cap'
    )
    await page.screenshot({
      path: path.join(out, 'new-user-password-help.png'),
    })
    await newUser.getByRole('button', { name: 'Cancel', exact: true }).click()
    await page
      .getByRole('button', { name: /^Edit / })
      .first()
      .click()
    const editUser = page.getByRole('dialog', {
      name: 'Edit user',
      exact: true,
    })
    const editPassword = editUser.getByLabel(/^New password/)
    await expect(editPassword).toHaveAccessibleDescription(
      `${passwordRequirements} Leave empty to keep the current password.`
    )
    await editPassword.fill('Demo-password-8')
    await expect(editPassword).toHaveAccessibleDescription(
      `${passwordRequirements} Leave empty to keep the current password.`
    )
    await expect(
      editUser.getByText(
        `${passwordRequirements} Leave empty to keep the current password.`,
        { exact: true }
      )
    ).toBeVisible()
    await editUser.getByRole('button', { name: 'Cancel', exact: true }).click()
    check(
      'Create/edit account password rules remain visible and associated while typing, without submitting changes'
    )
    if (flow === 'm2') {
      assert.deepEqual(errors, [])
      check('No uncaught browser errors during M2 flows')
      return
    }
    await page.setViewportSize({ width: 390, height: 844 })
    await goto('/dashboard/audit')
    const more = page.getByRole('button', { name: 'More filters', exact: true })
    await expect(more).toHaveAttribute('aria-expanded', 'false')
    await expect(
      page.getByRole('textbox', { name: 'Search activity', exact: true })
    ).toBeVisible()
    await expect(page.getByLabel('Audit events')).toBeVisible()
    const events = await page.getByLabel('Audit events').boundingBox()
    assert.ok(events.y < 744, 'Activity starts in phone viewport')
    await expect(page.getByLabel('Audit events')).toHaveAttribute(
      'aria-busy',
      'false'
    )
    const firstActivity = await page
      .getByLabel('Audit events')
      .locator('summary')
      .first()
      .boundingBox()
    assert.ok(
      firstActivity && firstActivity.y + firstActivity.height <= 844,
      'The first activity row fits in the initial phone viewport'
    )
    await page.screenshot({ path: path.join(out, 'audit-collapsed.png') })
    await expect(page.locator('#audit-quick-view')).toHaveValue('Changes')
    await expect(
      page.getByText('Event scope: Changes', { exact: true })
    ).toBeVisible()
    await expect(
      page.getByText('0 active filters', { exact: true })
    ).toBeVisible()
    await expect(page.getByLabel('Applied filters')).toHaveCount(0)
    const omitted = await context.request
      .get(origin + '/api/audit?view=changes&limit=5')
      .then((r) => r.json())
    const requests = await context.request
      .get(origin + '/api/audit?category=requests&limit=1')
      .then((r) => r.json())
    const contradictory = await context.request
      .get(origin + '/api/audit?category=requests&view=changes')
      .then((r) => r.json())
    const routine = [
      'file.thumbnail',
      'file.view',
      'file.read',
      'file.download',
      'archive.browse',
      'archive.entry.read',
      'archive.member.read',
      'archive.source.read',
    ]
    assert.ok(
      omitted.events.length &&
        omitted.events.every(
          (e) =>
            e.category !== 'requests' &&
            !(e.outcome === 'success' && routine.includes(e.action))
        )
    )
    assert.ok(
      requests.total > 0 &&
        requests.events.every((e) => e.category === 'requests')
    )
    assert.equal(contradictory.total, 0)
    assert.deepEqual(contradictory.events, [])
    check(
      'Changes excludes routine successful access; comprehensive API defaults and contradictory filters retain accurate totals'
    )
    await more.click()
    const search = page.getByRole('textbox', {
      name: 'Search activity',
      exact: true,
    })
    await search.fill('refinement draft')
    await page
      .getByRole('button', { name: 'Hide filters', exact: true })
      .click()
    await expect(
      page.getByText('You have unapplied filter edits.', { exact: false })
    ).toBeVisible()
    await more.click()
    await expect(search).toHaveValue('refinement draft')
    const auditPicker = page.locator('#audit-quick-view')
    await expect(auditPicker).toHaveValue('Changes')
    const reapply = page.getByRole('button', {
      name: 'Reapply Changes quick view',
      exact: true,
    })
    await expect(reapply).toBeVisible()
    await reapply.click()
    await expect(
      page.getByText('Search: refinement draft', { exact: true })
    ).toBeVisible()
    await expect(auditPicker).toHaveValue('Changes')
    await expect(reapply).not.toBeVisible()
    await expect(
      page.getByText('1 active filter', { exact: true })
    ).toBeVisible()
    await expect(
      page.getByLabel('Applied filters').getByRole('button')
    ).toHaveCount(1)
    check(
      'Phone quick view keeps its applied selection and explicitly reapplies pending search edits'
    )
    const emptyActivity = page.getByText('No activity matches these filters', {
      exact: true,
    })
    await expect(emptyActivity).toBeVisible()
    await expect(
      page.getByText(
        'Remove a filter or reset all filters to broaden the results.',
        { exact: true }
      )
    ).toBeVisible()
    await page
      .getByRole('button', { name: 'Hide filters', exact: true })
      .click()
    const resetActivity = page.getByRole('button', {
      name: 'Reset filters',
      exact: true,
    })
    await expect(resetActivity).toBeVisible()
    await resetActivity.click()
    await expect(search).toHaveValue('')
    await expect(auditPicker).toHaveValue('All activity')
    await expect(
      page.getByText('Event scope: All activity', { exact: true })
    ).toBeVisible()
    await expect(
      page.getByText('0 active filters', { exact: true })
    ).toBeVisible()
    await expect(page.getByLabel('Applied filters')).toHaveCount(0)
    await expect(more).toHaveAttribute('aria-expanded', 'false')
    await expect
      .poll(async () => {
        const text = await page.getByLabel('Audit events').innerText()
        return Number(
          text.match(/([\d,]+) matching events/)?.[1].replaceAll(',', '') || 0
        )
      })
      .toBeGreaterThan(0)
    await expect(emptyActivity).not.toBeVisible()
    check(
      'Empty audit results reset to All activity without opening More filters'
    )
    await more.click()
    await search.fill('refinement draft')
    await page
      .getByRole('button', { name: 'Apply filters', exact: true })
      .click()
    await expect(emptyActivity).toBeVisible()
    await page
      .getByRole('button', { name: 'Clear filters', exact: true })
      .click()
    await expect(search).toHaveValue('')
    await expect(auditPicker).toHaveValue('All activity')
    await expect(emptyActivity).not.toBeVisible()
    check('Audit disclosure retains drafts and exposes activity', {
      activityY: Math.round(events.y),
    })
    await auditPicker.selectOption({ label: 'Requests' })
    await expect(page.getByLabel('Applied filters')).toContainText(
      'Category: requests'
    )
    await expect(
      page.getByText('Event scope: All activity', { exact: true })
    ).toBeVisible()
    check('Requests and All activity remain explicit comprehensive scopes')
    await search.fill('refinement draft')
    await page.getByLabel('Outcome', { exact: true }).selectOption('denied')
    await page.getByLabel('Time range', { exact: true }).selectOption('7')
    await page
      .getByRole('button', { name: 'Apply filters', exact: true })
      .click()
    await expect(emptyActivity).toBeVisible()
    await expect(
      page.getByText('4 active filters', { exact: true })
    ).toBeVisible()
    await expect(
      page.getByLabel('Applied filters').getByRole('button')
    ).toHaveCount(4)
    for (const chip of await page
      .getByLabel('Applied filters')
      .getByRole('button')
      .all()) {
      const bounds = await chip.boundingBox()
      assert.ok(
        bounds && bounds.width >= 44 && bounds.height >= 44,
        'Applied audit filter chips retain touch targets'
      )
    }
    await expect(
      page.getByText(
        'Try a wider time range, remove a filter, or reset all filters.',
        { exact: true }
      )
    ).toBeVisible()
    await search.fill('unapplied follow-up')
    await page
      .getByRole('button', {
        name: 'Remove Time: last 7 days filter',
        exact: true,
      })
      .click()
    await expect(page.getByLabel('Time range', { exact: true })).toHaveValue(
      'all'
    )
    await expect(search).toHaveValue('unapplied follow-up')
    await expect(
      page.getByRole('button', {
        name: 'Remove Search: refinement draft filter',
        exact: true,
      })
    ).toBeVisible()
    await expect(
      page.getByRole('button', {
        name: 'Remove Outcome: Denied filter',
        exact: true,
      })
    ).toBeVisible()
    await expect(
      page.getByRole('button', {
        name: 'Remove Category: requests filter',
        exact: true,
      })
    ).toBeVisible()
    await expect(
      page.getByText('3 active filters', { exact: true })
    ).toBeVisible()
    await expect(
      page.getByLabel('Applied filters').getByRole('button')
    ).toHaveCount(3)
    await expect(
      page.getByText(
        'Remove a filter or reset all filters to broaden the results.',
        { exact: true }
      )
    ).toBeVisible()
    await page
      .getByRole('button', {
        name: 'Remove Category: requests filter',
        exact: true,
      })
      .click()
    await expect(page.getByLabel('Category', { exact: true })).toHaveValue('')
    await expect(page.getByLabel('Outcome', { exact: true })).toHaveValue(
      'denied'
    )
    await expect(search).toHaveValue('unapplied follow-up')
    await expect(
      page.getByText('Event scope: All activity', { exact: true })
    ).toBeVisible()
    await expect(
      page.getByText('2 active filters', { exact: true })
    ).toBeVisible()
    await expect(
      page.getByLabel('Applied filters').getByRole('button')
    ).toHaveCount(2)
    await page
      .getByRole('button', {
        name: 'Remove Search: refinement draft filter',
        exact: true,
      })
      .click()
    await expect(search).toHaveValue('')
    await expect(
      page.getByText('1 active filter', { exact: true })
    ).toBeVisible()
    await expect(
      page.getByLabel('Applied filters').getByRole('button')
    ).toHaveCount(1)
    await page
      .getByRole('button', {
        name: 'Remove Outcome: Denied filter',
        exact: true,
      })
      .click()
    await expect(
      page.getByText('0 active filters', { exact: true })
    ).toBeVisible()
    await expect(page.getByLabel('Applied filters')).toHaveCount(0)
    await expect(auditPicker).toHaveValue('All activity')
    await expect(page.getByLabel('Audit events')).toHaveAttribute(
      'aria-busy',
      'false'
    )
    check(
      'Audit chips remove only their own constraints and preserve unrelated applied filters, drafts, and event scope'
    )
    await page.getByLabel('Time range', { exact: true }).selectOption('custom')
    await page
      .getByRole('button', { name: 'Apply filters', exact: true })
      .click()
    await expect(page.getByLabel('Audit events')).toHaveAttribute(
      'aria-busy',
      'false'
    )
    await expect(
      page.getByText('0 active filters', { exact: true })
    ).toBeVisible()
    await expect(page.getByLabel('Applied filters')).toHaveCount(0)
    await page
      .getByLabel('From (local time)', { exact: true })
      .fill('2000-01-01T00:00')
    await page
      .getByLabel('To (local time)', { exact: true })
      .fill('2000-01-02T00:00')
    await page
      .getByRole('button', { name: 'Apply filters', exact: true })
      .click()
    await expect(emptyActivity).toBeVisible()
    await expect(
      page.getByText('1 active filter', { exact: true })
    ).toBeVisible()
    await page
      .getByRole('button', {
        name: 'Remove Time: 2000-01-01 00:00 to 2000-01-02 00:00 filter',
        exact: true,
      })
      .click()
    await expect(page.getByLabel('Time range', { exact: true })).toHaveValue(
      'all'
    )
    await expect(
      page.getByText('0 active filters', { exact: true })
    ).toBeVisible()
    await expect(page.getByLabel('Applied filters')).toHaveCount(0)
    await page.getByLabel('Time range', { exact: true }).selectOption('custom')
    await expect(
      page.getByLabel('From (local time)', { exact: true })
    ).toHaveValue('')
    await expect(
      page.getByLabel('To (local time)', { exact: true })
    ).toHaveValue('')
    await page
      .getByRole('button', { name: 'Clear filters', exact: true })
      .click()
    check(
      'Custom time counts only a real bound and removing its chip clears both endpoints'
    )
    await goto('/dashboard/roles')
    const picker = page.getByLabel('Role to edit', { exact: true })
    await expect(
      picker.locator('option').filter({ hasText: 'Everyone' })
    ).toHaveCount(1)
    const options = await picker
      .locator('option')
      .evaluateAll((options) =>
        options.map((o) => ({ value: o.value, label: o.textContent }))
      )
    const everyone = options.find((o) => o.label.includes('Everyone'))
    await picker.selectOption(everyone.value)
    await expect(page.locator('#role-editor')).toBeVisible()
    const help = page.getByText('How role permissions combine', { exact: true })
    await help.click()
    await expect(
      page.getByText('Everyone is the baseline.', { exact: false }).last()
    ).toBeVisible()
    const description = page.locator('#role-description')
    const savedDescription = await description.inputValue()
    await description.fill(savedDescription + ' unsaved check')
    const alternative = options.find(
      (option) => option.value !== everyone.value
    )
    await picker.selectOption(alternative.value)
    await expect(page.getByRole('alertdialog')).toBeVisible()
    await page
      .getByRole('button', { name: 'Keep editing', exact: true })
      .click()
    await expect(picker).toHaveValue(everyone.value)
    await expect(description).toHaveValue(savedDescription + ' unsaved check')
    await description.fill(savedDescription)
    check('Mobile role picker and permission explanation')
    await goto('/dashboard/settings?section=appearance')
    const appearancePicker = page.getByLabel('Appearance section', {
      exact: true,
    })
    await expect(appearancePicker).toBeVisible()
    await appearancePicker.click()
    await expect(page.getByRole('option')).toHaveCount(4)
    await page.keyboard.press('Escape')
    const chooseAppearance = async (name) => {
      await appearancePicker.click()
      await page.getByRole('option', { name, exact: true }).click()
    }
    const pickerBounds = await appearancePicker.boundingBox()
    assert.ok(pickerBounds.height >= 44)
    await chooseAppearance('Theme')
    await expect(page.locator('#default-theme-mode')).toBeVisible()
    await chooseAppearance('Sharing')
    await expect(page.locator('#sharing-image-fit')).toBeVisible()
    await chooseAppearance('Appearance packs')
    await expect(
      page
        .locator('[data-flare-surface] .font-semibold.leading-none')
        .filter({ hasText: /^Appearance packs$/ })
    ).toBeVisible()
    await chooseAppearance('Identity')
    await page.setViewportSize({ width: 820, height: 1000 })
    const tabs = page
      .getByRole('navigation', { name: 'Appearance sections' })
      .getByRole('button')
    await expect(tabs).toHaveCount(4)
    for (const tab of await tabs.all()) {
      const box = await tab.boundingBox()
      assert.ok(box.height >= 44)
    }
    await page.setViewportSize({ width: 390, height: 844 })
    check(
      'Labeled appearance picker covers every section and tablet tabs retain 44px targets'
    )

    await goto('/dashboard')
    await expect(page.locator('a[aria-label^="Open "]').first()).toBeVisible()
    const rail = page.getByRole('slider', { name: 'Browse files by date' })
    await expect(rail).toBeVisible()
    const point = await rail.boundingBox()
    const handle = page.locator('[data-date-rail-handle]')
    const hit = await handle.boundingBox()
    assert.ok(hit.width >= 44 && hit.height >= 44)
    assert.equal(
      await rail.evaluate((el) => getComputedStyle(el).pointerEvents),
      'none'
    )
    assert.equal(
      await handle.evaluate((el) => getComputedStyle(el).pointerEvents),
      'auto'
    )
    // Send genuine Chromium touch input through the non-thumb portion of the rail.
    const y = Math.min(point.y + point.height - 30, 700)
    const cdp = await context.newCDPSession(page)
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: point.x + 15, y }],
    })
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: point.x + 15, y: y - 120 }],
    })
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchEnd',
      touchPoints: [],
    })
    await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(40)
    await goto('/dashboard')
    await expect(
      page
        .getByRole('list', { name: 'Your files', exact: true })
        .locator('a[aria-label^="Open "]')
        .first()
    ).toBeVisible()
    const fileList = page.getByRole('list', {
      name: 'Your files',
      exact: true,
    })
    await expect(fileList).toHaveAttribute('aria-busy', 'false')
    const touchThumb = await handle.boundingBox()
    const railPlacement = await fileList.evaluate((list) => {
      const rail = document.querySelector('[data-date-rail-track]')
      const thumb = document.querySelector('[data-date-rail-handle]')
      const lane = rail.querySelector('div[aria-hidden="true"]')
      const header = document.querySelector(
        'section[aria-label="Find and filter files"]'
      )
      const card = list.querySelector('[data-file-card]')
      const box = (element) => element.getBoundingClientRect().toJSON()
      const overlaps = (a, b) =>
        Math.min(a.right, b.right) > Math.max(a.x, b.x) &&
        Math.min(a.bottom, b.bottom) > Math.max(a.y, b.y)
      const railBox = box(rail)
      const thumbBox = box(thumb)
      const laneBox = box(lane)
      const actions = [...list.querySelectorAll('button, a')]
        .map((element) => ({
          box: box(element),
          label: element.getAttribute('aria-label') || element.textContent,
        }))
        .filter(
          ({ box }) =>
            box.width > 0 &&
            box.height > 0 &&
            box.y < innerHeight &&
            box.bottom > 0
        )
      return {
        list: box(list),
        card: box(card),
        header: box(header),
        rail: railBox,
        thumb: thumbBox,
        lane: laneBox,
        reservedWidth: parseFloat(getComputedStyle(list).marginRight),
        actionOverlaps: actions.filter(
          ({ box }) =>
            overlaps(box, railBox) ||
            overlaps(box, thumbBox) ||
            overlaps(box, laneBox)
        ),
      }
    })
    assert.ok(
      touchThumb.y >= railPlacement.header.bottom - 1,
      'Date thumb is clear of the actual search/filter header'
    )
    assert.ok(
      Math.abs(touchThumb.y - railPlacement.card.y - 8) <= 1 &&
        Math.abs(railPlacement.rail.y - railPlacement.list.y - 8) <= 1,
      'Date rail starts 8px below the filename-first card and list top'
    )
    assert.ok(
      touchThumb.width >= 44 && touchThumb.height >= 44,
      'Date thumb retains its 44px touch target after reload'
    )
    assert.ok(
      railPlacement.reservedWidth >= 28 &&
        railPlacement.list.right <= railPlacement.rail.x + 1 &&
        railPlacement.card.right <= railPlacement.rail.x + 1 &&
        railPlacement.lane.width >= 16 &&
        railPlacement.lane.x >= railPlacement.rail.x &&
        railPlacement.lane.right <= railPlacement.rail.right,
      'Marked date lane stays in its reserved column beside the cards'
    )
    assert.deepEqual(
      railPlacement.actionOverlaps,
      [],
      'Date rail, thumb and visible lane overlap no visible card action'
    )
    const initialRow = await rail.getAttribute('aria-valuenow')
    const initialScroll = await page.evaluate(() => scrollY)
    const restingColor = await handle
      .locator('div')
      .first()
      .evaluate((el) => getComputedStyle(el).backgroundColor)
    const grab = {
      x: touchThumb.x + touchThumb.width / 2,
      y: touchThumb.y + touchThumb.height - 3,
    }
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [grab],
    })
    await expect(rail).toHaveAttribute('aria-valuenow', initialRow)
    assert.ok(
      Math.abs((await page.evaluate(() => scrollY)) - initialScroll) < 2,
      'Grabbing the thumb does not jump the page'
    )
    await expect
      .poll(() =>
        handle
          .locator('div')
          .first()
          .evaluate((el) => getComputedStyle(el).backgroundColor)
      )
      .not.toBe(restingColor)
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: grab.x, y: grab.y + 60 }],
    })
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchEnd',
      touchPoints: [],
    })
    await expect
      .poll(async () => Number(await rail.getAttribute('aria-valuenow')))
      .toBeGreaterThan(Number(initialRow))
    const dateBubble = handle.locator('[aria-hidden="true"]')
    await expect
      .poll(() => rail.evaluate((el) => getComputedStyle(el).boxShadow))
      .toBe('none')
    await expect
      .poll(() => dateBubble.evaluate((el) => getComputedStyle(el).opacity))
      .toBe('0')
    await expect(rail).toBeFocused()
    await page.keyboard.press('Shift+Tab')
    await expect(rail).not.toBeFocused()
    await page.keyboard.press('Tab')
    await expect(rail).toBeFocused()
    await expect
      .poll(() => rail.evaluate((el) => getComputedStyle(el).boxShadow))
      .toContain('2px')
    await expect
      .poll(() => dateBubble.evaluate((el) => getComputedStyle(el).opacity))
      .toBe('1')
    await page.keyboard.press('ArrowDown')
    await expect(rail).toBeFocused()
    await expect
      .poll(() => rail.evaluate((el) => getComputedStyle(el).boxShadow))
      .toContain('2px')
    await expect
      .poll(() => dateBubble.evaluate((el) => getComputedStyle(el).opacity))
      .toBe('1')
    await cdp.detach()
    check(
      'Thumb remains below the header, preserves a grab, signals active drag and seeks with actual touch'
    )
    check(
      'Date track lets touch scrolling through outside its visible 44px thumb'
    )
    check(
      'Touch release hides date focus decoration; Tab and ArrowDown retain a strong ring and date label'
    )
    const settledMenuTarget = async (target, width, height) => {
      let measurement
      let previous
      await expect
        .poll(async () => {
          measurement = await target.evaluate((element) => {
            const box = element.getBoundingClientRect()
            const clip = {
              left: 0,
              top: 0,
              right: innerWidth,
              bottom: innerHeight,
            }
            const ancestors = []
            for (
              let parent = element.parentElement;
              parent;
              parent = parent.parentElement
            ) {
              const style = getComputedStyle(parent)
              const bounds = parent.getBoundingClientRect()
              const clipsX = /auto|scroll|hidden|clip/.test(style.overflowX)
              const clipsY = /auto|scroll|hidden|clip/.test(style.overflowY)
              // Root overflow clips the viewport. Its document rectangle
              // moves with scrollY, while clientHeight remains viewport-sized.
              const viewportRoot = parent === document.documentElement
              if (clipsX) {
                clip.left = Math.max(
                  clip.left,
                  viewportRoot ? 0 : bounds.left + parent.clientLeft
                )
                clip.right = Math.min(
                  clip.right,
                  viewportRoot
                    ? parent.clientWidth
                    : bounds.left + parent.clientLeft + parent.clientWidth
                )
              }
              if (clipsY) {
                clip.top = Math.max(
                  clip.top,
                  viewportRoot ? 0 : bounds.top + parent.clientTop
                )
                clip.bottom = Math.min(
                  clip.bottom,
                  viewportRoot
                    ? parent.clientHeight
                    : bounds.top + parent.clientTop + parent.clientHeight
                )
              }
              if (clipsX || clipsY)
                ancestors.push({
                  tag: parent.tagName,
                  role: parent.getAttribute('role'),
                  bounds: bounds.toJSON(),
                  clipsX,
                  clipsY,
                  viewportRoot,
                })
            }
            const hits = [0.1, 0.5, 0.9].map((fraction) => {
              const hit = document.elementFromPoint(
                box.x + box.width * fraction,
                box.y + box.height / 2
              )
              return hit === element || element.contains(hit)
            })
            return {
              target: box.toJSON(),
              menu: element
                .closest('[role="menu"]')
                .getBoundingClientRect()
                .toJSON(),
              scroll: element
                .closest('[data-file-menu-scroll]')
                .getBoundingClientRect()
                .toJSON(),
              clip,
              ancestors,
              hits,
              focused: document.activeElement === element,
              windowScrollY: scrollY,
            }
          })
          const { target: box, menu, scroll, clip, hits } = measurement
          const signature = JSON.stringify([box, menu, scroll, clip])
          const stable = signature === previous
          previous = signature
          return (
            stable &&
            measurement.focused &&
            menu.x >= 15.9 &&
            menu.right <= width - 15.9 &&
            menu.y >= 15.9 &&
            menu.bottom <= height - 15.9 &&
            box.y >= menu.y &&
            box.bottom <= menu.bottom + 1 &&
            box.y >= scroll.y - 1 &&
            box.bottom <= scroll.bottom + 1 &&
            box.left >= clip.left - 1 &&
            box.right <= clip.right + 1 &&
            box.top >= clip.top - 1 &&
            box.bottom <= clip.bottom + 1 &&
            hits.every(Boolean)
          )
        })
        .toBe(true)
      return measurement
    }
    let overflowingFileMenus = 0
    for (const width of [320, 390]) {
      for (const height of [568, 740, 844]) {
        await page.setViewportSize({ width, height })
        await goto('/dashboard')
        const triggers = page
          .getByRole('list', { name: 'Your files', exact: true })
          .locator('button[aria-haspopup="menu"]')
        const scrolledCase = width === 390 && height === 844
        let trigger = triggers.first()
        if (scrolledCase) {
          await page.evaluate(() => window.scrollTo(0, 1000))
          await expect
            .poll(() => page.evaluate(() => scrollY))
            .toBeGreaterThan(0)
          let index = -1
          await expect
            .poll(async () => {
              index = await triggers.evaluateAll((elements) =>
                elements.findIndex((element) => {
                  const box = element.getBoundingClientRect()
                  const hit = document.elementFromPoint(
                    box.x + box.width / 2,
                    box.y + box.height / 2
                  )
                  return (
                    box.top >= 80 &&
                    box.bottom <= innerHeight - 16 &&
                    (hit === element || element.contains(hit))
                  )
                })
              )
              return index
            })
            .toBeGreaterThanOrEqual(0)
          trigger = triggers.nth(index)
        }
        // Virtualized rows can change which button is first during native
        // scrolling. Keep this case attached to the file that opens the menu.
        const opener = await trigger.evaluate((element) => ({
          fileIndex: element
            .closest('[data-file-index]')
            ?.getAttribute('data-file-index'),
          name: element.getAttribute('aria-label'),
        }))
        assert.match(opener.fileIndex || '', /^\d+$/)
        assert.ok(opener.name)
        trigger = page
          .getByRole('list', { name: 'Your files', exact: true })
          .locator(`[data-file-index="${opener.fileIndex}"]`)
          .getByRole('button', { name: opener.name, exact: true })
        await trigger.click()
        if (scrolledCase)
          assert.ok(
            await page.evaluate(() => scrollY > 0),
            'Opening the visible menu retains native page scroll'
          )
        const menu = page.getByRole('menu')
        await expect(menu).toBeVisible()
        await expect
          .poll(async () => {
            const rect = await menu.boundingBox()
            return rect.y >= 15.9 && rect.y + rect.height <= height - 15.9
          })
          .toBe(true)
        const bounds = await menu.boundingBox()
        assert.ok(
          bounds.y + bounds.height <= height - 15.9,
          'Menu stays inside short phone'
        )
        await expect(
          menu.getByText('Manage file', { exact: true })
        ).toBeVisible()
        const menuScroll = menu.locator('[data-file-menu-scroll]')
        const aboveCue = menu.locator('[data-file-menu-scroll-cue="above"]')
        const belowCue = menu.locator('[data-file-menu-scroll-cue="below"]')
        await expect(menuScroll).toHaveCount(1)
        await expect(menuScroll).not.toHaveAttribute('data-scroll-above')
        await expect(aboveCue).toBeHidden()
        const overflowing = await menuScroll.evaluate(
          (el) => el.scrollHeight > el.clientHeight + 1
        )
        if (overflowing) {
          overflowingFileMenus++
          await expect(menuScroll).toHaveAttribute('data-scroll-below', '')
          await expect(belowCue).toBeVisible()
        } else {
          await expect(belowCue).toBeHidden()
        }
        assert.equal(
          await menuScroll.evaluate((el) => getComputedStyle(el).maskImage),
          'none',
          'Scroll cues do not mask focused menu items'
        )
        const items = menu.getByRole('menuitem')
        for (const item of await items.all())
          assert.ok(
            (await item.boundingBox()).height >= 44,
            'File actions retain 44px targets'
          )
        await expect(
          menu.getByRole('menuitem', { name: 'Manage expiration', exact: true })
        ).toHaveCount(1)
        await expect(
          menu.getByRole('menuitem', { name: 'Delete file', exact: true })
        ).toHaveCount(1)
        await page.screenshot({
          path: path.join(out, `file-menu-start-${width}-${height}.png`),
        })
        await page.keyboard.press('End')
        const last = menu.getByRole('menuitem').last()
        await expect(last).toBeFocused()
        if (overflowing) {
          await expect(menuScroll).toHaveAttribute('data-scroll-above', '')
          await expect(aboveCue).toBeVisible()
          await expect(belowCue).toBeHidden()
        }
        // Cue strips can resize/reposition the popup. Check its settled current
        // geometry after the cue update, rather than its pre-keyboard rectangle.
        const end = await settledMenuTarget(last, width, height)
        await page.screenshot({
          path: path.join(out, `file-menu-${width}-${height}.png`),
        })
        await page.keyboard.press('Home')
        await expect(items.first()).toBeFocused()
        await expect(aboveCue).toBeHidden()
        if (overflowing) await expect(belowCue).toBeVisible()
        const home = await settledMenuTarget(items.first(), width, height)
        if (scrolledCase)
          assert.ok(
            end.windowScrollY > 0 && home.windowScrollY > 0,
            'End and Home retain a nonzero native page scroll while menu clipping is checked'
          )
        await page.keyboard.press('Escape')
        await expect(trigger).toBeFocused()
        check(
          `Complete file menu bounds, directional scroll cues and keyboard End/Home at ${width}×${height}`,
          { opener, initialBounds: bounds, end, home }
        )
      }
      await goto('/dashboard?search=release-checklist.md')
      const generic = page.getByRole('link', {
        name: 'Open release-checklist.md',
        exact: true,
      })
      await expect(generic).toBeVisible()
      const genericCard = generic.locator(
        'xpath=ancestor::*[@data-file-card][1]'
      )
      await expect(genericCard).toHaveAttribute('data-file-kind', 'generic')
      const genericReply = await context.request.get(
        origin + '/api/files?search=release-checklist.md'
      )
      assert.equal(genericReply.status(), 200)
      const genericMeta = (await genericReply.json()).data.find(
        (file) => file.name === 'release-checklist.md'
      )
      assert.ok(
        genericMeta,
        'The compact card comes from the actual owner API collection'
      )
      const preview = await generic.boundingBox()
      assert.ok(
        Math.abs(preview.height - 52) < 1,
        'Generic kind stage is exactly52px at the standard text size'
      )
      await expect(generic.getByText('MD', { exact: true })).toBeVisible()
      const badgeRegion = generic
        .locator('..')
        .locator(':scope > [data-preview-badges]')
      await expect(badgeRegion).toHaveCSS('position', 'static')
      const badges = await badgeRegion.boundingBox()
      assert.ok(
        badges.y >= preview.y + preview.height - 0.5,
        'Generic visibility and age badges flow below the header'
      )
      const visibility = badgeRegion.locator(':scope > span').first()
      const age = badgeRegion.locator(':scope > span').last()
      await expect(visibility).toHaveText(
        genericMeta.hasPassword
          ? 'Protected'
          : genericMeta.visibility === 'PUBLIC'
            ? 'Public'
            : 'Private'
      )
      await expect(age).toHaveAttribute(
        'title',
        require('../../node_modules/date-fns').format(
          new Date(genericMeta.uploadedAt),
          'PPP p'
        )
      )
      assert.ok(
        (await age.innerText()).trim().length > 0,
        'Upload age remains visible'
      )
      const name = genericCard.locator('[data-file-name]')
      await expect(name).toHaveAccessibleName(genericMeta.name)
      await expect(name).toHaveAttribute('title', genericMeta.name)
      const filenameGeometry = await name.evaluate((element) => {
        const box = element.getBoundingClientRect()
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
        const glyphs = []
        while (walker.nextNode()) {
          const node = walker.currentNode
          let offset = 0
          for (const glyph of node.textContent) {
            const end = offset + glyph.length
            if (/\S/u.test(glyph)) {
              const range = document.createRange()
              range.setStart(node, offset)
              range.setEnd(node, end)
              const rect = range.getBoundingClientRect()
              glyphs.push({
                glyph,
                x: rect.x,
                y: rect.y,
                right: rect.right,
                bottom: rect.bottom,
                width: rect.width,
                height: rect.height,
              })
            }
            offset = end
          }
        }
        return {
          text: element.textContent,
          box: { x: box.x, y: box.y, right: box.right, bottom: box.bottom },
          glyphs,
        }
      })
      assert.equal(
        filenameGeometry.text,
        genericMeta.name,
        'The complete short filename remains unchanged across display spans'
      )
      assert.ok(
        filenameGeometry.glyphs.length > 0 &&
          filenameGeometry.glyphs.every(
            (glyph) =>
              glyph.width > 0 &&
              glyph.height > 0 &&
              glyph.x >= filenameGeometry.box.x - 0.5 &&
              glyph.y >= filenameGeometry.box.y - 0.5 &&
              glyph.right <= filenameGeometry.box.right + 0.5 &&
              glyph.bottom <= filenameGeometry.box.bottom + 0.5
          ),
        'Every short filename glyph is visible inside its link bounds'
      )
      const nameBounds = await name.boundingBox()
      assert.ok(
        nameBounds.y + nameBounds.height <= preview.y + 0.5 &&
          nameBounds.y >= (await genericCard.boundingBox()).y,
        'The complete filename leads the card before its preview and badge row'
      )
      const sizeBytes = genericMeta.size * 1024 * 1024
      const sizeLabel =
        sizeBytes === 0
          ? '0 B'
          : sizeBytes < 1024
            ? `${sizeBytes.toFixed(0)} B`
            : sizeBytes < 1024 * 1024
              ? `${(sizeBytes / 1024).toFixed(2)} KB`
              : sizeBytes < 1024 * 1024 * 1024
                ? `${(sizeBytes / 1024 / 1024).toFixed(2)} MB`
                : `${(sizeBytes / 1024 / 1024 / 1024).toFixed(2)} GB`
      let visibleSizes = 0
      for (const size of await genericCard
        .getByText(sizeLabel, { exact: true })
        .all())
        if (await size.isVisible()) visibleSizes++
      assert.equal(
        visibleSizes,
        1,
        'The actual file size remains visible once at the current pointer layout'
      )
      for (const [field, label] of [
        ['views', 'views'],
        ['downloads', 'downloads'],
      ]) {
        const exact = `${genericMeta[field].toLocaleString()} ${label}`
        const stat = genericCard.locator(`span[title="${exact}"]`)
        await expect(stat).toBeVisible()
        await expect(stat.locator('.sr-only')).toHaveText(exact)
        await expect(stat).not.toHaveAttribute('aria-label', /.+/)
      }
      let genericFolder
      if (genericMeta.folderId) {
        const foldersReply = await context.request.get(origin + '/api/folders')
        assert.equal(foldersReply.status(), 200)
        genericFolder = (await foldersReply.json()).data.find(
          (folder) => folder.id === genericMeta.folderId
        )
        assert.ok(genericFolder)
        await expect(
          genericCard.getByRole('button', {
            name: `Open folder ${genericFolder.name}`,
            exact: true,
          })
        ).toBeVisible()
      }
      const visibleTags = (genericMeta.tags || []).slice(
        0,
        genericFolder ? 1 : 2
      )
      for (const tag of visibleTags)
        await expect(
          genericCard.getByRole('button', {
            name: `Show files tagged ${tag.name}`,
            exact: true,
          })
        ).toBeVisible()
      const extraTags = (genericMeta.tags || []).length - visibleTags.length
      if (extraTags > 0)
        await expect(
          genericCard.getByRole('button', {
            name: `+${extraTags}: view all ${genericMeta.tags.length} tags`,
            exact: true,
          })
        ).toBeVisible()
      const expiry = genericCard.locator(
        'button[title^="Expiration scheduled for "]'
      )
      if (genericMeta.expiresAt) {
        await expect(expiry).toBeVisible()
        await expect(expiry).toHaveAttribute(
          'title',
          `Expiration scheduled for ${require('../../node_modules/date-fns').format(new Date(genericMeta.expiresAt), 'PPP p')}`
        )
        assert.equal(
          await expiry.getAttribute('data-flare-icon'),
          null,
          'Textual expiration is never marked as a square icon control'
        )
      } else await expect(expiry).toHaveCount(0)
      await page.keyboard.press('Tab')
      await generic.focus()
      const overlay = generic
        .locator('..')
        .locator(':scope > [data-preview-actions]')
      await expect(overlay).toHaveCount(1)
      await expect
        .poll(() =>
          overlay.evaluate((element) =>
            Number(getComputedStyle(element).opacity)
          )
        )
        .toBe(1)
      const inline = overlay.locator('button, a')
      await expect(inline).toHaveCount(3)
      await expect(
        overlay.getByRole('link', { name: 'View', exact: true })
      ).toBeVisible()
      await expect(
        overlay.getByRole('button', {
          name: `Copy link to ${genericMeta.name}`,
          exact: true,
        })
      ).toBeVisible()
      await expect(
        overlay.getByRole('link', {
          name: `Download ${genericMeta.name}`,
          exact: true,
        })
      ).toBeVisible()
      const controlBoxes = []
      for (const control of await inline.all()) {
        const box = await control.boundingBox()
        assert.ok(
          box.width >= 44 && box.height >= 44,
          'Every inline shortcut retains a44px target'
        )
        assert.ok(
          box.x >= preview.x &&
            box.x + box.width <= preview.x + preview.width + 0.5 &&
            box.y >= preview.y &&
            box.y + box.height <= preview.y + preview.height + 0.5,
          'Inline actions stay wholly inside the52px stage'
        )
        assert.ok(
          box.y + box.height <= badges.y - 4,
          'Header controls leave a clear gap above flowing metadata'
        )
        for (const fraction of [0.1, 0.5, 0.9]) {
          assert.ok(
            await control.evaluate(
              (element, point) => {
                const hit = document.elementFromPoint(point.x, point.y)
                return hit === element || element.contains(hit)
              },
              { x: box.x + box.width * fraction, y: box.y + box.height / 2 }
            ),
            'Inline target left/center/right hit points reach the intended action'
          )
        }
        controlBoxes.push(box)
      }
      const manage = genericCard.getByRole('button', {
        name: `Manage ${genericMeta.name}`,
        exact: true,
      })
      const manageBox = await manage.boundingBox()
      assert.ok(
        manageBox.width >= 44 && manageBox.height >= 44,
        'Manage file keeps its44px target'
      )
      assert.ok(
        manageBox.y >= preview.y &&
          manageBox.y + manageBox.height <= preview.y + preview.height + 0.5,
        'Manage file stays inside the kind header'
      )
      assert.ok(
        await manage.evaluate((element) => {
          const box = element.getBoundingClientRect(),
            hit = document.elementFromPoint(
              box.x + box.width / 2,
              box.y + box.height / 2
            )
          return hit === element || element.contains(hit)
        }),
        'Manage file has an unobstructed center hit target'
      )
      controlBoxes.push(manageBox)
      for (const label of await genericCard
        .locator(
          '[data-file-label], button[title^="Expiration scheduled for "]'
        )
        .all()) {
        if (!(await label.isVisible())) continue
        const box = await label.boundingBox()
        assert.ok(
          box.width >= 44 && box.height >= 44,
          'Visible metadata actions keep44px targets'
        )
        assert.ok(
          box.y >= badges.y + badges.height - 0.5,
          'Metadata actions follow the badge row'
        )
        controlBoxes.push(box)
      }
      for (let left = 0; left < controlBoxes.length; left++)
        for (let right = left + 1; right < controlBoxes.length; right++) {
          const a = controlBoxes[left],
            b = controlBoxes[right]
          const overlapX =
            Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
          const overlapY =
            Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
          assert.ok(
            overlapX <= 0.5 || overlapY <= 0.5,
            'Header and metadata action targets never overlap'
          )
        }
      await page.screenshot({
        path: path.join(out, `compact-file-${width}.png`),
      })
      check(
        `Generic phone file preview is compact with readable filename at ${width}`,
        { filenameGeometry }
      )
    }
    assert.ok(
      overflowingFileMenus > 0,
      'Short-phone checks exercise a scrolling file menu'
    )
    await page.setViewportSize({ width: 1440, height: 900 })
    await goto('/dashboard/profile')
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
    }
    check('All six desktop account shortcut links work from the keyboard')
    await page.setViewportSize({ width: 390, height: 844 })
    // Demo seed has accessible packing-list.txt and a real JPEG.
    await page.goto(origin + '/z2pPQ/packing-list.txt')
    const wrap = page.getByRole('button', { name: 'Wrap lines', exact: true })
    await expect(wrap).toHaveAttribute('aria-pressed', 'true')
    await expect(page.locator('.cm-lineWrapping')).toBeVisible()
    await wrap.click()
    await expect(wrap).toHaveAttribute('aria-pressed', 'false')
    await expect(page.locator('.cm-lineWrapping')).toHaveCount(0)
    await wrap.click()
    await page.screenshot({ path: path.join(out, 'text-wrapped.png') })
    check('Plain text wraps by default and line wrapping can be toggled')
    const imageRoute = '**/api/files/z2pPQ/lisbon-rooftops-at-golden-hour.jpg'
    let release
    const gate = new Promise((resolve) => {
      release = resolve
    })
    await page.route(imageRoute, async (route) => {
      await gate
      await route.continue().catch((error) => {
        if (!/already handled|closed|canceled/i.test(error.message)) throw error
      })
    })
    // The gated image cannot finish load until the loading UI is checked.
    await page.goto(origin + '/z2pPQ/lisbon-rooftops-at-golden-hour.jpg', {
      waitUntil: 'domcontentloaded',
    })
    await expect(
      page.getByText('Loading image…', { exact: true })
    ).toBeVisible()
    const stage = page
      .locator('[aria-busy="true"]')
      .filter({ has: page.getByText('Loading image…', { exact: true }) })
    await expect(stage).toBeVisible()
    const stageBox = await stage.boundingBox()
    assert.ok(stageBox.height >= 192)
    await page.screenshot({
      path: path.join(out, 'image-pending-simulated-delay.png'),
    })
    const imageResponse = page.waitForResponse((response) =>
      response
        .url()
        .endsWith('/api/files/z2pPQ/lisbon-rooftops-at-golden-hour.jpg')
    )
    release()
    await imageResponse
    await page.unroute(imageRoute)
    await expect(page.getByText('Loading image…', { exact: true })).toHaveCount(
      0
    )
    await expect(
      page.getByRole('button', { name: 'Expand image', exact: true })
    ).toBeVisible()
    check(
      'Simulated delayed network shows real image loading feedback until bytes decode'
    )
    assert.deepEqual(errors, [])
    check('No uncaught browser errors')
  } catch (failure) {
    await page
      .screenshot({ path: path.join(out, 'failure.png') })
      .catch(() => {})
    const menu = page.getByRole('menu')
    if (await menu.count())
      console.error(
        await menu.evaluate((el) => ({
          bounds: el.getBoundingClientRect().toJSON(),
          maxHeight: getComputedStyle(el).maxHeight,
          available: getComputedStyle(el).getPropertyValue(
            '--radix-dropdown-menu-content-available-height'
          ),
          innerHeight,
          visualHeight: visualViewport?.height,
          scrollY,
        }))
      )
    throw failure
  } finally {
    await fs.writeFile(
      path.join(out, 'results.json'),
      JSON.stringify(checks, null, 2)
    )
    await context.close()
    await browser.close()
  }
}
main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
