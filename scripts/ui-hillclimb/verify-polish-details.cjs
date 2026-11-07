/* eslint-disable @typescript-eslint/no-require-imports */
// Read-only local UI checks. Registration POSTs are intercepted with a simulated
// 503: a valid boundary proves only the client gate, never account creation.
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const {
  chromium,
  expect,
} = require('../../docs/site/node_modules/@playwright/test')
const target = process.env.FLARE_HILLCLIMB_ORIGIN
const auth = process.env.FLARE_HILLCLIMB_AUTH
const out = process.env.FLARE_HILLCLIMB_OUTPUT
const local = target && new URL(target)
if (
  !local ||
  !auth ||
  !out ||
  !['localhost', '127.0.0.1'].includes(local.hostname) ||
  !['http:', 'https:'].includes(local.protocol) ||
  local.username ||
  local.password ||
  local.pathname !== '/' ||
  local.search ||
  local.hash
)
  throw Error('Disposable local origin, auth and output required')
const origin = local.origin
const checks = []
const pass = (name, details = {}) => {
  checks.push({ name, passed: true, ...details })
  console.log('PASS:', name)
}
const passwords = [
  ['ASCII 7', 'a'.repeat(7), false],
  ['ASCII 8', 'a'.repeat(8), true],
  ['ASCII 72', 'a'.repeat(72), true],
  ['ASCII 73', 'a'.repeat(73), false],
  ['emoji 72 bytes', '🔒'.repeat(18), true],
  ['emoji 76 bytes', '🔒'.repeat(19), false],
  ['4 simple emoji', '🔒'.repeat(4), false],
  ['8 simple emoji', '🔒'.repeat(8), true],
  ['2 composed emoji', '👩‍💻'.repeat(2), false],
  ['3 composed emoji', '👩‍💻'.repeat(3), true],
]
async function textRects(locator, word) {
  return locator.evaluate((element, text) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
    while (walker.nextNode()) {
      const index = walker.currentNode.textContent.indexOf(text)
      if (index < 0) continue
      const range = document.createRange()
      range.setStart(walker.currentNode, index)
      range.setEnd(walker.currentNode, index + text.length)
      return [...range.getClientRects()]
        .filter((r) => r.width > 0)
        .map((r) => r.toJSON())
    }
    return []
  }, word)
}
async function inside(locator, rects) {
  const box = await locator.boundingBox()
  assert.ok(
    box &&
      rects.length &&
      rects.every(
        (r) =>
          r.left >= box.x - 1 &&
          r.right <= box.x + box.width + 1 &&
          r.top >= box.y - 1 &&
          r.bottom <= box.y + box.height + 1
      ),
    'Rendered text stays within its visible control'
  )
}
async function main() {
  await fs.mkdir(out, { recursive: true, mode: 0o700 })
  const browser = await chromium.launch({ headless: true })
  let context
  let signedOut
  let pageErrors = 0
  let complete = false
  try {
    context = await browser.newContext({
      storageState: auth,
      hasTouch: true,
      isMobile: true,
      viewport: { width: 390, height: 844 },
      reducedMotion: 'reduce',
    })
    const session = await context.request
      .get(origin + '/api/auth/session')
      .then((r) => r.json())
    assert.ok(
      /@[^@]+\.test$/.test(session.user?.email || ''),
      'Use a disposable .test account'
    )
    signedOut = await browser.newContext({
      viewport: { width: 390, height: 844 },
      reducedMotion: 'reduce',
    })
    const register = await signedOut.newPage()
    register.on('pageerror', () => pageErrors++)
    let posts = 0
    await register.route(origin + '/api/auth/register', async (route) => {
      assert.equal(route.request().method(), 'POST')
      posts++
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Simulated registration gate check.' }),
      })
    })
    for (const [label, password, valid] of passwords) {
      await register.goto(origin + '/auth/register')
      const form = register
        .locator('form')
        .filter({ has: register.locator('#confirmPassword') })
      const field = form.locator('#password')
      await form.locator('#name').fill('Example')
      await form.locator('#email').fill('client-gate@example.test')
      const help = await field.getAttribute('aria-describedby')
      assert.ok(help, 'Password requirements have an association')
      const hint = register.locator('[id="' + help + '"]')
      await expect(hint).toBeVisible()
      await expect(hint).toContainText('72')
      await expect(hint).toContainText('emoji')
      await field.fill(password)
      await form.locator('#confirmPassword').fill(password)
      await expect(hint).toBeVisible()
      assert.ok(
        (await field.inputValue()) === password,
        'The typed password is never truncated'
      )
      assert.ok(
        await field.evaluate(
          (el) =>
            el.type === 'password' &&
            getComputedStyle(el).webkitTextSecurity !== 'none'
        ),
        'Password stays concealed'
      )
      assert.equal(await field.evaluate((el) => el.checkValidity()), valid)
      if (!valid) {
        await expect(field).toHaveAttribute('aria-invalid', 'true')
        await expect(form.locator('#password-error')).toBeVisible()
        await expect(field).toHaveAttribute(
          'aria-describedby',
          /password-error/
        )
      }
      const before = posts
      const requested = register
        .waitForRequest(
          (request) => request.url() === origin + '/api/auth/register',
          { timeout: 500 }
        )
        .then(
          () => true,
          (error) => {
            if (error.name === 'TimeoutError') return false
            throw error
          }
        )
      await form.locator('#confirmPassword').press('Enter')
      if (valid)
        await expect(form.getByRole('alert')).toContainText(
          'Simulated registration gate check.'
        )
      else {
        await expect
          .poll(() => field.evaluate((el) => el.matches(':invalid')))
          .toBe(true)
        await expect(field).toBeFocused()
        await expect(form.locator('#password-error')).toBeVisible()
      }
      assert.equal(
        await requested,
        valid,
        'Observe the real request gate after native Enter'
      )
      assert.equal(
        posts - before,
        valid ? 1 : 0,
        'Native Enter honors the client gate'
      )
      pass('Registration ' + label + ' native gate', {
        acceptedByClient: valid,
        interceptedPosts: posts - before,
      })
    }
    await register.locator('#password').fill('valid-password')
    await register.locator('#confirmPassword').fill('different-password')
    const beforeMismatch = posts
    const mismatchRequest = register
      .waitForRequest(
        (request) => request.url() === origin + '/api/auth/register',
        { timeout: 500 }
      )
      .then(
        () => true,
        (error) => {
          if (error.name === 'TimeoutError') return false
          throw error
        }
      )
    const confirmationForm = register.locator('form').filter({
      has: register.locator('#confirmPassword'),
    })
    await confirmationForm.evaluate((form) => form.requestSubmit())
    // Consume the observation before any UI assertion can close its page.
    const mismatchRequested = await mismatchRequest
    const confirmationError = confirmationForm.locator('#confirmPassword-error')
    await expect(confirmationError).toHaveAttribute('role', 'alert')
    await expect(confirmationError).toBeVisible()
    await expect(confirmationError).toHaveText('Passwords do not match.')
    await expect(
      confirmationForm
        .getByRole('alert')
        .filter({ hasText: 'Simulated registration gate check.' })
    ).toBeVisible()
    assert.equal(
      await confirmationForm
        .locator('#confirmPassword')
        .evaluate((field) => field.validity.valid),
      false,
      'Mismatched confirmation remains natively invalid'
    )
    await expect(confirmationForm.locator('#confirmPassword')).toHaveAttribute(
      'aria-invalid',
      'true'
    )
    await expect(confirmationForm.locator('#confirmPassword')).toHaveAttribute(
      'aria-describedby',
      'confirmPassword-error'
    )
    await expect(confirmationForm.locator('#confirmPassword')).toBeFocused()
    assert.equal(mismatchRequested, false)
    assert.equal(posts, beforeMismatch, 'Mismatched confirmation sends no POST')
    pass('Registration confirmation mismatch sends no POST')
    await signedOut.close()
    signedOut = null

    const page = await context.newPage()
    page.on('pageerror', () => pageErrors++)
    const visit = async (route, mode, fontSize = 16) => {
      await page.goto(origin + route)
      await page.locator('#main-content').waitFor()
      await page.evaluate(
        ({ mode, fontSize }) => {
          document.documentElement.classList.remove('light', 'dark')
          document.documentElement.classList.add(mode)
          document.documentElement.style.colorScheme = mode
          document.documentElement.style.fontSize = fontSize + 'px'
        },
        { mode, fontSize }
      )
      await page.evaluate(async () => {
        await document.fonts.ready
        await new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve))
        )
      })
    }
    for (const width of [320, 390])
      for (const mode of ['light', 'dark']) {
        await page.setViewportSize({ width, height: 844 })
        for (const fontSize of [16, 32]) {
          await visit('/dashboard/settings?section=appearance', mode, fontSize)
          const section = page.getByRole('combobox', {
            name: 'Settings section',
            exact: true,
          })
          await expect(section).toContainText('Appearance')
          const fragments = await textRects(section, 'Appearance')
          assert.equal(
            fragments.length,
            1,
            'Appearance never breaks within its word'
          )
          await inside(section, fragments)
          const navigationGeometry = await section.evaluate((element) => {
            const css = getComputedStyle(element)
            const rect = element.getBoundingClientRect()
            const arrow = element.querySelector('svg').getBoundingClientRect()
            const header = document
              .querySelector('[data-dashboard-header]')
              .getBoundingClientRect()
            const heading = document.querySelector('h1').getBoundingClientRect()
            return {
              height: rect.height,
              paddingLeft: parseFloat(css.paddingLeft),
              paddingRight: parseFloat(css.paddingRight),
              arrowWidth: arrow.width,
              arrowHeight: arrow.height,
              headerBottom: header.bottom,
              headingTop: heading.top,
            }
          })
          assert.ok(navigationGeometry.height >= 44)
          assert.ok(
            navigationGeometry.paddingLeft >= 10 &&
              navigationGeometry.paddingRight >= 10
          )
          assert.ok(
            navigationGeometry.arrowWidth >= 16 &&
              navigationGeometry.arrowHeight >= 16
          )
          assert.ok(
            navigationGeometry.headingTop >=
              navigationGeometry.headerBottom + 8,
            'Enlarged heading clears the actual fixed dashboard header'
          )
          assert.ok(
            await page.evaluate(
              () =>
                document.documentElement.scrollWidth <=
                document.documentElement.clientWidth
            )
          )
          await visit('/dashboard/profile', mode, fontSize)
          const jump = page.getByRole('combobox', {
            name: 'Jump to account setting',
            exact: true,
          })
          await expect(jump).toHaveAttribute('data-placeholder', '')
          await expect(jump).toContainText('Setting')
          assert.equal(
            await jump.evaluate((el) => getComputedStyle(el).fontStyle),
            'italic'
          )
          for (let selection = 0; selection < 2; selection++) {
            await jump.click()
            const popup = page.getByRole('listbox')
            await expect(popup).toBeVisible()
            const popupGeometry = await popup.evaluate(
              (element) =>
                new Promise((resolve) => {
                  let previous = '',
                    stable = 0,
                    frames = 0
                  const sample = () => {
                    const box = element.getBoundingClientRect()
                    const key = [box.x, box.y, box.width, box.height].join(',')
                    stable = key === previous ? stable + 1 : 1
                    previous = key
                    if (++frames >= 120 || stable >= 8) {
                      const css = getComputedStyle(element)
                      const viewport = element.querySelector(
                        '[data-radix-select-viewport]'
                      )
                      const first = element.querySelector('[role="option"]')
                      resolve({
                        stable: stable >= 8,
                        frames,
                        box: box.toJSON(),
                        width: innerWidth,
                        height: innerHeight,
                        availableWidth: parseFloat(
                          css.getPropertyValue(
                            '--radix-select-content-available-width'
                          )
                        ),
                        availableHeight: parseFloat(
                          css.getPropertyValue(
                            '--radix-select-content-available-height'
                          )
                        ),
                        viewport: viewport.getBoundingClientRect().toJSON(),
                        scrollHeight: viewport.scrollHeight,
                        clientHeight: viewport.clientHeight,
                        overflowY: getComputedStyle(viewport).overflowY,
                        first: first.getBoundingClientRect().toJSON(),
                      })
                    } else requestAnimationFrame(sample)
                  }
                  requestAnimationFrame(sample)
                })
            )
            assert.ok(
              popupGeometry.stable,
              'Open Select geometry settles within120 RAF samples'
            )
            assert.ok(
              popupGeometry.box.left >= -0.5 &&
                popupGeometry.box.right <= popupGeometry.width + 0.5 &&
                popupGeometry.box.top >= -0.5 &&
                popupGeometry.box.bottom <= popupGeometry.height + 0.5,
              'The real open Select remains wholly inside the viewport'
            )
            assert.ok(
              popupGeometry.box.width <= popupGeometry.availableWidth + 1 &&
                popupGeometry.box.height <= popupGeometry.availableHeight + 1,
              'The open Select respects its actual Radix available width and height'
            )
            assert.ok(
              popupGeometry.first.top >= popupGeometry.viewport.top - 0.5 &&
                popupGeometry.first.bottom <=
                  popupGeometry.viewport.bottom + 0.5,
              'The first Identity option is reachable in the visible scroll viewport'
            )
            if (popupGeometry.scrollHeight > popupGeometry.clientHeight + 1)
              assert.ok(
                ['auto', 'scroll'].includes(popupGeometry.overflowY),
                'Overflowing Select options retain native scrolling'
              )
            await page
              .getByRole('option', { name: 'Identity', exact: true })
              .click()
            await expect(page.locator('#profile-identity')).toBeFocused()
            await expect(jump).not.toHaveAttribute('data-placeholder')
            await expect(jump).toContainText('Identity')
            assert.equal(
              await jump.evaluate((el) => getComputedStyle(el).fontStyle),
              'normal'
            )
          }
          pass(
            `Navigation words, placeholder and same-destination selection ${width}/${mode}/${fontSize}`,
            { fragments }
          )
        }
        await visit('/dashboard/urls', mode)
        const shorten = page.getByRole('button', {
          name: 'Shorten',
          exact: true,
        })
        const sort = page.getByRole('combobox', { name: /^Sort links:/ })
        await expect(
          page.getByRole('textbox', { name: 'URL to shorten', exact: true })
        ).toHaveValue('')
        await expect(shorten).toBeDisabled()
        await expect(sort).toBeEnabled()
        const styles = await Promise.all(
          [shorten, sort].map((el) =>
            el.evaluate((button) => {
              const css = getComputedStyle(button)
              return {
                disabled: button.disabled,
                borderStyle: css.borderStyle,
                fill: css.backgroundColor,
                opacity: css.opacity,
                shadow: css.boxShadow,
              }
            })
          )
        )
        assert.equal(styles[0].disabled, true)
        assert.equal(styles[1].disabled, false)
        assert.equal(styles[0].borderStyle, 'solid')
        assert.ok(styles[0].shadow.includes('inset'))
        assert.notEqual(styles[0].shadow, styles[1].shadow)
        assert.notEqual(styles[0].fill, styles[1].fill)
        assert.equal(styles[0].opacity, '1')
        pass(
          `Real inactive Shorten differs from enabled outline sort ${width}/${mode}`,
          { styles }
        )

        await visit('/dashboard', mode)
        const list = page.getByRole('list', { name: 'Your files', exact: true })
        await expect(list).toHaveAttribute('aria-busy', 'false')
        const cards = list.locator('[data-file-card]')
        await expect(cards.first().locator('[data-file-name]')).toBeVisible()
        const names = await cards
          .locator('[data-file-name]')
          .evaluateAll((elements) => elements.map((el) => el.title))
        const name = [...names].sort((a, b) => b.length - a.length)[0]
        assert.ok(
          name?.length >= 60,
          'Stage a mounted demonstration filename of at least 60 characters'
        )
        const card = cards
          .filter({ has: page.getByRole('link', { name, exact: true }) })
          .first()
        const tail = card.locator('[data-file-name-tail]')
        for (const part of await tail.locator(':scope > span').all()) {
          const text = await part.textContent()
          if (text) await inside(tail, await textRects(part, text))
        }
        const extension = await tail
          .locator(':scope > span')
          .last()
          .textContent()
        assert.ok(
          extension && name.endsWith(extension),
          'The real filename extension stays visible'
        )
        const suffix = await tail.textContent()
        assert.ok(
          suffix.length > extension.length && name.endsWith(suffix),
          'The visible tail is the real filename suffix'
        )
        const manage = card.getByRole('button', {
          name: 'Manage ' + name,
          exact: true,
        })
        await manage.click()
        const menu = page.getByRole('menu')
        const filename = menu.locator('[data-file-menu-filename]')
        assert.ok(
          (await filename.textContent()) === name,
          'The menu contains the complete native filename'
        )
        assert.ok(
          await filename.evaluate((el) => {
            const css = getComputedStyle(el)
            return (
              !!el.closest('[data-file-menu-scroll]') &&
              css.webkitLineClamp === 'none' &&
              css.textOverflow !== 'ellipsis' &&
              el.scrollHeight <= el.clientHeight + 1
            )
          }),
          'The complete filename wraps in the existing scroll body without clamping'
        )
        const scroll = menu.locator('[data-file-menu-scroll]')
        await filename.evaluate((el) => {
          const scroll = el.closest('[data-file-menu-scroll]')
          scroll.scrollTop +=
            el.getBoundingClientRect().bottom -
            scroll.getBoundingClientRect().bottom +
            4
        })
        const menuBounds = await menu.boundingBox()
        assert.ok(
          menuBounds.x >= 15 && menuBounds.x + menuBounds.width <= width - 15,
          'The complete filename menu stays inside the viewport collision margins'
        )
        const menuExtension = filename.locator('span').last()
        await expect(menuExtension).toHaveText(extension)
        const extensionRects = await textRects(menuExtension, extension)
        assert.equal(
          extensionRects.length,
          1,
          'The full menu extension stays on one line'
        )
        await inside(scroll, extensionRects)

        const items = menu.getByRole('menuitem')
        await page.keyboard.press('End')
        await expect(items.last()).toBeFocused()
        await page.keyboard.press('Home')
        await expect(items.first()).toBeFocused()
        await page.keyboard.press('Escape')
        await expect(manage).toBeFocused()
        pass(
          `Coarse filename tail, extension, complete menu and keyboard ${width}/${mode}`,
          { filenameLength: name.length }
        )
      }
    assert.equal(pageErrors, 0, 'No uncaught browser errors')
    complete = true
  } finally {
    try {
      await fs.writeFile(
        path.join(out, 'results.json'),
        JSON.stringify(
          {
            checks,
            complete,
            pageErrors,
            limits: [
              'Registration responses are simulated 503s; no account is created. Invalid cases observe no request for 500ms.',
              'Chromium client-only checks; no physical touch or assistive-technology claim.',
            ],
          },
          null,
          2
        ),
        { mode: 0o600 }
      )
    } finally {
      await signedOut?.close()
      await context?.close()
      await browser.close()
    }
  }
}
main().catch((error) => {
  let message = error.message
  for (const [, password] of passwords)
    message = message.split(password).join('[test password]')
  console.error(
    message.replace(/valid-password|different-password/g, '[test password]')
  )
  process.exitCode = 1
})
