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
  results.push({ check, passed: true, ...details })
  console.log('PASS:', check)
}

async function verifyWorkspaceRecoveryAndColumns(browser, page) {
  const missingPaths = [
    '/dashboard/no-such-route',
    '/dashboard/no-such-route/nested',
    '/dashboard/no-such-route.txt',
  ]
  for (const size of [
    { width: 1440, height: 900 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(size)
    const columns = []
    for (const [route, title] of [
      ['/dashboard/upload', 'Upload files'],
      ['/dashboard/paste', 'Create a paste'],
      ['/dashboard/urls', 'Short links'],
    ]) {
      await page.goto(origin + route)
      const heading = page.getByRole('heading', { name: title, exact: true })
      await expect(heading).toBeVisible()
      await expect(
        page.locator('#main-content header').getByText('Workspace', {
          exact: true,
        })
      ).toBeVisible()
      const geometry = await heading.evaluate((element) => {
        const header = element.closest('header')
        const panel = header.nextElementSibling
        const h = header.getBoundingClientRect()
        const p = panel.getBoundingClientRect()
        const renderedRoot = document.documentElement.getBoundingClientRect()
        const renderedBody = document.body.getBoundingClientRect()
        return {
          headerLeft: h.left,
          headerRight: h.right,
          panelLeft: p.left,
          panelRight: p.right,
          panelWidth: p.width,
          renderedRoot: renderedRoot.toJSON(),
          renderedBody: renderedBody.toJSON(),
          layoutCenter: renderedRoot.x + renderedRoot.width / 2,
          viewportWidth: innerWidth,
          layoutWidth: document.documentElement.clientWidth,
          rootFontSize: parseFloat(
            getComputedStyle(document.documentElement).fontSize
          ),
          bodyWidth: document.documentElement.scrollWidth,
        }
      })
      assert.ok(Math.abs(geometry.headerLeft - geometry.panelLeft) <= 1)
      assert.ok(Math.abs(geometry.headerRight - geometry.panelRight) <= 1)
      assert.ok(
        Math.abs(
          (geometry.panelLeft + geometry.panelRight) / 2 - geometry.layoutCenter
        ) <= 1,
        'Page heading and panel share the centered workspace column'
      )
      assert.ok(geometry.panelWidth <= 56 * geometry.rootFontSize + 1)
      assert.ok(geometry.bodyWidth <= geometry.layoutWidth)
      columns.push({ route, ...geometry })
    }
    pass(`Workspace form headings and panels align at ${size.width}`, {
      columns,
    })

    const responses = []
    for (const route of missingPaths) {
      const response = await page.goto(origin + route)
      assert.equal(response.status(), 404, 'The actual document is HTTP404')
      const get = await page.context().request.get(origin + route, {
        maxRedirects: 0,
        headers: { Accept: 'text/html' },
      })
      const head = await page.context().request.head(origin + route, {
        maxRedirects: 0,
        headers: { Accept: 'text/html' },
      })
      assert.equal(get.status(), 404, 'A direct authenticated GET is HTTP404')
      assert.equal(head.status(), 404, 'A direct authenticated HEAD is HTTP404')
      assert.equal((await head.body()).length, 0, 'HEAD has no response body')
      assert.match(
        await get.text(),
        /<meta\b[^>]*name="robots"[^>]*content="[^"]*noindex/,
        'The direct GET retains noindex metadata'
      )
      await expect(
        page.getByRole('heading', { name: 'Page not found', exact: true })
      ).toBeVisible()
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
        'content',
        /noindex/
      )
      const navigation = page.getByRole('navigation', {
        name: 'Main navigation',
        exact: true,
      })
      await expect(navigation).toBeVisible()
      await expect(
        page.getByRole('button', { name: 'Account menu', exact: true })
      ).toBeVisible()
      const recovery = page.getByRole('link', {
        name: 'Go to your files',
        exact: true,
      })
      await expect(recovery).toHaveAttribute('href', '/dashboard')
      const bounds = await recovery.boundingBox()
      assert.ok(bounds.height >= 44 && bounds.width >= 44)
      assert.ok(
        !(await page.locator('#main-content').textContent()).includes(
          'no-such-route'
        ),
        'Recovery does not reflect the requested path'
      )
      responses.push({
        route,
        status: response.status(),
        getStatus: get.status(),
        headStatus: head.status(),
        noindex: true,
      })
    }
    if (size.width < 640) {
      await page.getByRole('button', { name: 'Open navigation' }).click()
      for (const name of ['Files', 'Upload', 'Paste', 'Links'])
        await expect(
          page.getByRole('dialog').getByRole('link', { name, exact: true })
        ).toBeVisible()
      await page.keyboard.press('Escape')
    }
    await page.screenshot({
      path: path.join(output, `workspace-not-found-${size.width}.png`),
    })
    await page
      .getByRole('link', { name: 'Go to your files', exact: true })
      .click()
    await page.waitForURL(origin + '/dashboard')
    await expect(
      page
        .locator('[data-file-index] [data-file-card] a[data-file-primary]')
        .first()
    ).toBeVisible()
    pass(
      `Missing workspace pages retain navigation and recovery at ${size.width}`,
      { responses }
    )
  }

  const signedOut = await browser.newContext()
  try {
    const responses = []
    for (const route of missingPaths)
      for (const method of ['GET', 'HEAD']) {
        const response = await signedOut.request.fetch(origin + route, {
          method,
          maxRedirects: 0,
        })
        assert.ok([303, 307].includes(response.status()))
        assert.equal(
          new URL(response.headers().location, origin).pathname,
          '/auth/login'
        )
        responses.push({
          route,
          method,
          status: response.status(),
          destination: '/auth/login',
        })
      }
    pass(
      'Signed-out missing workspace addresses require sign-in, including a dot suffix',
      { responses }
    )
  } finally {
    await signedOut.close()
  }
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
    await verifyWorkspaceRecoveryAndColumns(browser, page)
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
      const list = page.getByRole('list', { name: 'Your files', exact: true })
      await expect(list).toHaveAttribute('aria-busy', 'false')
      const first = list.locator('[data-file-index="0"] [data-file-preview]')
      await expect(first).toBeVisible()
      // Sample the loaded index0 geometry, not an intermediate skeleton commit.
      // Readiness never scrolls or requires an in-viewport result: the original
      // viewport,112px stage and filename-header assertions below still decide.
      const readiness = await page.evaluate(
        () =>
          new Promise((resolve) => {
            let previous = '',
              stable = 0,
              frames = 0
            const sample = () => {
              const list = document.querySelector(
                '[role="list"][aria-label="Your files"]'
              )
              const first = list?.querySelector(
                '[data-file-index="0"] [data-file-preview]'
              )
              const heading = first
                ?.closest('[data-file-card]')
                ?.querySelector('[data-file-heading]')
              const row = first?.closest('[data-row]')
              const box = first?.getBoundingClientRect(),
                h = heading?.getBoundingClientRect(),
                r = row?.getBoundingClientRect()
              const ready =
                list?.getAttribute('aria-busy') === 'false' &&
                box?.width > 0 &&
                box?.height > 0 &&
                h &&
                r
              const key = ready
                ? [
                    box.x,
                    box.y,
                    box.width,
                    box.height,
                    h.x,
                    h.y,
                    h.width,
                    h.height,
                    r.y,
                    r.height,
                    scrollY,
                    innerWidth,
                    innerHeight,
                  ].join(',')
                : ''
              stable = key && key === previous ? stable + 1 : key ? 1 : 0
              previous = key
              if (++frames >= 180 || stable >= 8)
                resolve({
                  stable: stable >= 8,
                  frames,
                  consecutiveStableSamples: stable,
                  preview: box?.toJSON(),
                  heading: h?.toJSON(),
                  row: r?.toJSON(),
                  scrollY,
                })
              else requestAnimationFrame(sample)
            }
            requestAnimationFrame(sample)
          })
      )
      assert.ok(
        readiness.stable,
        'Loaded index0 preview and heading settle within180 RAF samples'
      )
      const box = await first.boundingBox()
      assert.ok(
        box.y < size.height,
        `First file starts in viewport at ${size.width}`
      )
      assert.equal(
        await page.evaluate(() => matchMedia('(pointer: coarse)').matches),
        false,
        'This smoke scenario measures the fine-pointer gallery'
      )
      assert.ok(
        Math.abs(box.height - 112) <= 1 && box.width >= 200,
        'Fine-pointer image stages stay112px high with readable width'
      )
      const card = first.locator('xpath=ancestor::*[@data-file-card][1]')
      const heading = await card.locator('[data-file-heading]').boundingBox()
      const filename = await card.locator('[data-file-name]').boundingBox()
      assert.ok(
        filename.y >= heading.y &&
          filename.y + filename.height <= heading.y + heading.height + 0.5 &&
          heading.y + heading.height <= box.y + 0.5,
        'The filename heading precedes the preview inside its card'
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
      page.getByRole('combobox', { name: 'Profile section' })
    ).toContainText('Account')
    await pick('[aria-label="Jump to account setting"]', 'Appearance')
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
      await pick('[aria-label="Jump to account setting"]', label)
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
    pass('All six account shortcuts move focus consistently')

    const accountHistoryTabs = []
    const accountHistoryFocus = async (id, mobile, releaseLoading) => {
      const target = page.locator('#' + id)
      await expect(target).toBeFocused()
      if (id === 'account-start')
        await expect
          .poll(() => page.evaluate(() => scrollY))
          .toBeLessThanOrEqual(1)
      else {
        const box = await target.boundingBox()
        assert.ok(
          box && box.y >= 0 && box.y < page.viewportSize().height - 44,
          'History reveals the focused account destination'
        )
      }
      // Capture the actual sequential target at keydown, before native Tab.
      // A loading card has no controls; a GET completing between two remote
      // evaluations must not turn that legitimate native outcome into a race.
      const probe = await target.evaluateHandle((element) => {
        const state = {}
        const onKeyDown = (event) => {
          if (event.key !== 'Tab' || event.shiftKey) return
          document.removeEventListener('keydown', onKeyDown, true)
          const selector =
            'a[href],button,input,select,textarea,summary,[role="combobox"]'
          const usable = (node) => {
            const rect = node.getBoundingClientRect()
            const style = getComputedStyle(node)
            return (
              !node.matches(':disabled') &&
              node.tabIndex >= 0 &&
              !node.closest('[hidden],[inert]') &&
              rect.width > 0 &&
              rect.height > 0 &&
              style.display !== 'none' &&
              style.visibility !== 'hidden'
            )
          }
          const controls = [...element.querySelectorAll(selector)].filter(
            usable
          )
          const all = [...document.querySelectorAll(selector)].filter(usable)
          state.at = performance.timeOrigin + performance.now()
          state.focusedTarget = document.activeElement === element
          state.usableControlCount = controls.length
          state.positiveTabIndexCount = all.filter(
            (node) => node.tabIndex > 0
          ).length
          state.loading = [...element.querySelectorAll('[role="status"]')].some(
            (node) => node.textContent.trim().startsWith('Loading')
          )
          state.expected = all.find(
            (node) =>
              element.compareDocumentPosition(node) &
              Node.DOCUMENT_POSITION_FOLLOWING
          )
          state.expectedInside = element.contains(state.expected)
        }
        document.addEventListener('keydown', onKeyDown, true)
        state.cleanup = () =>
          document.removeEventListener('keydown', onKeyDown, true)
        return state
      })
      try {
        await page.keyboard.press('Tab')
        const sample = await probe.evaluate((state) => {
          const safe = (element) =>
            element
              ? {
                  id: element.id || null,
                  tag: element.tagName,
                  role: element.getAttribute('role'),
                  type: element.getAttribute('type'),
                }
              : null
          return {
            at: state.at,
            focusedTarget: state.focusedTarget,
            usableControlCount: state.usableControlCount,
            positiveTabIndexCount: state.positiveTabIndexCount,
            loading: state.loading,
            expected: safe(state.expected),
            expectedInside: state.expectedInside,
            actualAfterTab: safe(document.activeElement),
          }
        })
        accountHistoryTabs.push({ id, mobile, ...sample })
        assert.equal(
          sample.focusedTarget,
          true,
          'History target still focused at Tab'
        )
        assert.equal(
          sample.positiveTabIndexCount,
          0,
          'Native Tab follows document order'
        )
        assert.ok(sample.expected, 'There is a real next available control')
        const expected = await probe.getProperty('expected')
        if (sample.usableControlCount > 0) {
          // Keep the fast ready-card contract; never wait for controls before Tab.
          await expect
            .poll(() =>
              target.evaluate(
                (element) =>
                  element.contains(document.activeElement) &&
                  document.activeElement !== element &&
                  document.activeElement.matches(
                    'a[href],button,input,select,textarea,summary,[role="combobox"]'
                  )
              )
            )
            .toBe(true)
          assert.equal(sample.expectedInside, true)
        } else {
          assert.equal(
            sample.loading,
            true,
            'Only a loading card may have no controls'
          )
          assert.equal(sample.expectedInside, false)
        }
        await expect
          .poll(() =>
            expected.evaluate((element) => document.activeElement === element)
          )
          .toBe(true)
        if (releaseLoading) releaseLoading()
        if (sample.usableControlCount === 0) {
          await expect
            .poll(() =>
              target.evaluate(
                (element) =>
                  [
                    ...element.querySelectorAll(
                      'a[href],button,input,select,textarea,summary,[role="combobox"]'
                    ),
                  ].filter((node) => {
                    const rect = node.getBoundingClientRect()
                    const style = getComputedStyle(node)
                    return (
                      !node.matches(':disabled') &&
                      node.tabIndex >= 0 &&
                      !node.closest('[hidden],[inert]') &&
                      rect.width > 0 &&
                      rect.height > 0 &&
                      style.display !== 'none' &&
                      style.visibility !== 'hidden'
                    )
                  }).length
              )
            )
            .toBeGreaterThan(0)
          await expect(target.getByRole('alert')).toHaveCount(0)
        }
        await page.evaluate(
          () =>
            new Promise((resolve) =>
              requestAnimationFrame(() => requestAnimationFrame(resolve))
            )
        )
        await page.waitForTimeout(100)
        assert.equal(
          await expected.evaluate(
            (element) => document.activeElement === element
          ),
          true,
          'History frames and controls finishing loading must not steal focus after Tab'
        )
        accountHistoryTabs.at(-1).focusRetainedAfterLoadingAndFrames = true
      } finally {
        await probe.evaluate((state) => state.cleanup())
        await probe.dispose()
      }
      if (id === 'account-start') {
        if (mobile)
          await expect(
            page.getByRole('button', { name: 'Change avatar', exact: true })
          ).toBeFocused()
        else
          await expect(
            page
              .getByRole('navigation', { name: 'Account shortcuts' })
              .getByRole('link', { name: 'Identity', exact: true })
          ).toBeFocused()
      }
    }
    for (const mobile of [true, false]) {
      await page.setViewportSize(
        mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 }
      )
      await goto('/dashboard/profile?section=account')
      const visit = async (name) => {
        if (mobile) await pick('[aria-label="Jump to account setting"]', name)
        else
          await page
            .getByRole('navigation', { name: 'Account shortcuts' })
            .getByRole('link', { name, exact: true })
            .click()
      }
      await visit('Sign-in security')
      await expect(page.locator('#sign-in-security')).toBeFocused()
      await visit('Active sessions')
      await expect(page.locator('#active-sessions')).toBeFocused()
      await page.goBack()
      await expect
        .poll(() => new URL(page.url()).hash)
        .toBe('#sign-in-security')
      await accountHistoryFocus('sign-in-security', mobile)
      await page.goBack()
      await expect.poll(() => new URL(page.url()).hash).toBe('')
      await accountHistoryFocus('account-start', mobile)
      if (mobile)
        await expect(
          page.getByRole('combobox', { name: 'Jump to account setting' })
        ).toContainText('Setting')
      await page.goForward()
      await expect
        .poll(() => new URL(page.url()).hash)
        .toBe('#sign-in-security')
      await accountHistoryFocus('sign-in-security', mobile)
      await page.goForward()
      await expect.poll(() => new URL(page.url()).hash).toBe('#active-sessions')
      await accountHistoryFocus('active-sessions', mobile)
    }
    const accountLoadingResponses = []
    for (const mobile of [true, false]) {
      await page.setViewportSize(
        mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 }
      )
      let release
      const gate = new Promise((resolve) => {
        release = resolve
      })
      const held = []
      const endpoint = origin + '/api/auth/security'
      const holdSecurity = async (route) => {
        assert.equal(route.request().method(), 'GET')
        const sample = { mobile, requestedAt: Date.now() }
        accountLoadingResponses.push(sample)
        const upstream = await route.fetch()
        sample.serverRespondedAt = Date.now()
        sample.status = upstream.status()
        assert.equal(
          sample.status,
          200,
          'Held security response comes from the real server'
        )
        await gate
        await route.fulfill({ response: upstream })
        sample.deliveredAt = Date.now()
      }
      const handler = (route) => {
        const response = holdSecurity(route)
        held.push(response)
        return response
      }
      await context.route(endpoint, handler)
      try {
        await goto('/dashboard/profile?section=account')
        await expect(
          page.getByText('Loading your security settings…', { exact: true })
        ).toBeVisible()
        await expect
          .poll(
            () =>
              accountLoadingResponses.filter(
                (sample) => sample.mobile === mobile && sample.status === 200
              ).length
          )
          .toBeGreaterThan(0)
        for (const name of ['Sign-in security', 'Active sessions']) {
          if (mobile) await pick('[aria-label="Jump to account setting"]', name)
          else
            await page
              .getByRole('navigation', { name: 'Account shortcuts' })
              .getByRole('link', { name, exact: true })
              .click()
        }
        await page.goBack()
        await expect
          .poll(() => new URL(page.url()).hash)
          .toBe('#sign-in-security')
        const before = accountHistoryTabs.length
        await accountHistoryFocus('sign-in-security', mobile, () => {
          for (const sample of accountLoadingResponses.filter(
            (sample) => sample.mobile === mobile
          ))
            sample.releasedAt = Date.now()
          release()
        })
        assert.equal(
          accountHistoryTabs[before].usableControlCount,
          0,
          'The held real response deterministically exercises the loading path'
        )
        await Promise.all(held)
      } finally {
        release()
        await Promise.allSettled(held)
        await context.unroute(endpoint, handler)
      }
    }
    pass(
      'Account Back and Forward restore focus; Tab enters available controls without later focus theft on phone and desktop',
      {
        tabs: accountHistoryTabs,
        realHeldSecurityResponses: accountLoadingResponses,
      }
    )
    await page.setViewportSize({ width: 390, height: 844 })

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
    await expect(page.getByLabel('Applied filters')).toContainText(
      'Sign-in (auth.login)'
    )
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
          .getByLabel('Files to upload', { exact: true })
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
      await phone.waitForLoadState('networkidle')
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
      const toggledTrack = await toggle.boundingBox()
      assert.ok(
        Math.abs(toggledTrack.y - track.y) < 1,
        'Unsaved notice does not move the touch target'
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
          if (mode === 'paste') {
            const editor = phone.locator('#content')
            await expect(editor).toBeVisible()
            const editorBounds = await editor.boundingBox()
            assert.ok(
              editorBounds.height >= 300,
              `Paste editor retains its 300px minimum at ${width}px`
            )
            assert.ok(
              await editor.evaluate(
                (element) =>
                  parseFloat(getComputedStyle(element).fontSize) >= 16
              ),
              'Coarse editor text remains at least 16px'
            )
            await editor.fill('A line of paste content\n'.repeat(30))
            assert.ok(
              await editor.evaluate(
                (element) => element.scrollHeight > element.clientHeight
              ),
              'Long content scrolls within the roomy editor'
            )
            await editor.fill('Disposable validation check')
          } else
            await phone
              .getByLabel('Files to upload', { exact: true })
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
        for (const height of [568, 740, 844]) {
          await phone.setViewportSize({ width, height })
          await phone.goto(origin + '/dashboard')
          await phone.getByRole('button', { name: /^Filters/ }).click()
          const dateTrigger = phone.getByRole('button', {
            name: /^Date and grouping(?:$|:)/,
          })
          const visibleDateLabel = dateTrigger.locator('span').last()
          await expect(visibleDateLabel).toBeVisible()
          assert.equal(await visibleDateLabel.innerText(), 'Date and grouping')
          assert.ok(
            await visibleDateLabel.evaluate(
              (element) =>
                element.clientWidth > 0 &&
                element.scrollWidth <= element.clientWidth
            ),
            'Compact Date trigger label is complete'
          )
          await dateTrigger.tap()
          const datePopover = phone
            .getByRole('dialog')
            .filter({ has: phone.locator('.flare-calendar') })
          await expect(datePopover).toBeVisible()
          const calendar = datePopover.locator('.flare-calendar')
          const grouping = datePopover.getByRole('combobox', {
            name: 'Group files by upload date',
          })
          // Exercise the longest month instead of depending on today's layout.
          for (let month = 0; month < 12; month++) {
            if ((await calendar.locator('tbody tr').count()) === 6) break
            const caption = calendar.locator('.flare-calendar-caption-label')
            const previous = await caption.textContent()
            await calendar.locator('button[name="next-month"]').tap()
            await expect(caption).not.toHaveText(previous)
          }
          await expect(calendar.locator('tbody tr')).toHaveCount(6)
          const lastWeek = calendar.locator('tbody tr').last()
          const lastDay = lastWeek
            .locator('button[name="day"]:not([disabled]):not(.day-outside)')
            .last()
          const assertLastWeek = async (phase) => {
            if (height >= 740) {
              await expect
                .poll(() =>
                  calendar.evaluate(
                    (element) => element.scrollHeight - element.clientHeight
                  )
                )
                .toBeLessThanOrEqual(1)
            } else {
              // A short viewport can scroll its calendar, but not its footers.
              await lastDay.scrollIntoViewIfNeeded()
            }
            const [calendarBounds, weekBounds, footerBounds] =
              await Promise.all([
                calendar.boundingBox(),
                lastWeek.boundingBox(),
                grouping.evaluate((element) =>
                  element.parentElement.getBoundingClientRect().toJSON()
                ),
              ])
            assert.ok(
              weekBounds.y >= calendarBounds.y - 1 &&
                weekBounds.y + weekBounds.height <=
                  calendarBounds.y + calendarBounds.height + 1 &&
                weekBounds.y + weekBounds.height <= footerBounds.y + 1,
              `Last calendar week is fully above Group files ${phase} at ${width}×${height}`
            )
          }
          await expect
            .poll(async () => {
              const rect = await datePopover.boundingBox()
              return Math.max(16 - rect.y, rect.y + rect.height - (height - 16))
            })
            .toBeLessThanOrEqual(1)
          await assertLastWeek('before selection')
          await lastDay.tap()
          await expect(lastDay).toHaveAttribute('aria-selected', 'true')
          await expect(dateTrigger).toHaveAccessibleName(
            `Date and grouping: ${await visibleDateLabel.innerText()}`
          )
          await expect
            .poll(() => new URL(phone.url()).searchParams.get('dateFrom'))
            .not.toBe(null)
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
          await assertLastWeek('after selection')
          await clearDate.tap()
          await expect(clearDate).toHaveCount(0)
          await expect
            .poll(() => new URL(phone.url()).searchParams.get('dateFrom'))
            .toBe(null)
          await assertLastWeek('after clearing')
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
            `Phone full six-week calendar, last-week day selection and bounded footers at ${width}×${height}`
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
