/* eslint-disable @typescript-eslint/no-require-imports */
// Controlled network-delay simulations against real seed.cjs accounts and APIs.
// Responses come from the application unchanged; only their delivery is delayed.
const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const {
  chromium,
  expect: baseExpect,
} = require('../../docs/site/node_modules/@playwright/test')
const expect = baseExpect.configure({ timeout: 30000 })
const origin = process.env.FLARE_AUDIT_TEST_ORIGIN || 'http://localhost:3071'
const url = new URL(origin)
if (
  url.protocol !== 'http:' ||
  url.hostname !== 'localhost' ||
  url.pathname !== '/' ||
  url.search ||
  url.hash ||
  url.username ||
  url.password
)
  throw new Error('Use the origin of a disposable localhost HTTP instance.')
const password = 'Audit-demo-only-2026!'

function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

async function bounded(promise, description) {
  let timer
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`Timed out: ${description}`)),
          30000
        )
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

async function json(ctx, path) {
  const response = await ctx.request.get(origin + path)
  assert.equal(response.status(), 200, `${path}: ${await response.text()}`)
  return response.json()
}

async function alexLogin(ctx) {
  const csrf = await json(ctx, '/api/auth/csrf')
  const response = await ctx.request.post(
    origin + '/api/auth/callback/credentials',
    {
      headers: { Origin: origin },
      form: {
        csrfToken: csrf.csrfToken,
        email: 'audit-demo-alex@example.test',
        password,
        json: 'true',
        callbackUrl: origin + '/dashboard',
      },
    }
  )
  assert.ok(!(await response.json()).url.includes('error='))
  assert.equal(
    (await json(ctx, '/api/auth/session')).user.id,
    'audit-demo-alex'
  )
}

async function secondTabLogin(ctx, original, ip) {
  await ctx.setExtraHTTPHeaders({ 'x-real-ip': ip, 'x-forwarded-for': ip })
  const tab = await ctx.newPage()
  tab.setDefaultTimeout(30000)
  await tab.goto(origin + '/auth/login?local=1')
  await tab
    .getByLabel('Email address', { exact: true })
    .fill('audit-demo-jamie@example.test')
  await tab.getByLabel('Password', { exact: true }).fill(password)
  await tab
    .locator('form')
    .filter({ has: tab.getByLabel('Password', { exact: true }) })
    .locator('button[type="submit"]')
    .click()
  await tab.waitForURL((next) => next.pathname === '/dashboard')
  assert.equal(
    (await json(ctx, '/api/auth/session')).user.id,
    'audit-demo-jamie'
  )
  // Headless tabs need not change document.visibilityState on bringToFront.
  // Reload only the second tab: its genuine SessionProvider startup broadcasts
  // the current session to the unchanged original document through NextAuth.
  // Its storage message uses a whole-second timestamp; wait until it can differ
  // from the preceding startup message so the browser emits a storage event.
  await tab.waitForFunction(() => {
    const message = localStorage.getItem('nextauth.message')
    const timestamp = message ? JSON.parse(message).timestamp : 0
    return Math.floor(Date.now() / 1000) > timestamp
  })
  await tab.reload()
  await expect(
    tab.getByRole('navigation', { name: 'Main navigation' })
  ).toBeVisible()
  // Use only native session notifications and visibility refresh. NextAuth's
  // redirect:false sign-in does not broadcast the replacement account; a tab
  // whose revoked session became null can therefore stay signed out. Either
  // that state or Jamie-owned panels must replace Alex before releasing work.
  await original.bringToFront()
  await expectOldAccountUnmounted(original, ip)
  await expect(original.getByRole('dialog')).toHaveCount(0)
  await expect(original.getByRole('alertdialog')).toHaveCount(0)
  return tab
}

async function expectOldAccountUnmounted(page, ip) {
  await expect
    .poll(async () => {
      const panels = page.locator('#active-sessions')
      if ((await panels.count()) === 0) return 'signed out'
      return (await panels.innerText()).includes(ip) ? 'Jamie' : 'old account'
    })
    .not.toBe('old account')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByRole('alertdialog')).toHaveCount(0)
}

async function delayNext(page, path, method, validate) {
  const ready = deferred()
  const release = deferred()
  const finished = deferred()
  let captured = false
  await page.route(origin + path, async (route) => {
    if (captured || route.request().method() !== method) return route.continue()
    captured = true
    try {
      const response = await route.fetch()
      assert.equal(
        response.status(),
        200,
        'Held response must be a real successful server response'
      )
      validate(await response.json())
      ready.resolve()
      await release.promise
      try {
        await route.fulfill({ response })
      } catch (error) {
        // Unmount cancellation can finish the browser request before release.
        // No altered or fabricated success response is supplied in that case.
        if (!/interception|closed|handled|cancel|invalid/i.test(String(error)))
          throw error
      }
      finished.resolve()
    } catch (error) {
      ready.reject(error)
      finished.reject(error)
    }
  })
  // Avoid a secondary unhandled rejection if setup fails before awaiting release.
  void finished.promise.catch(() => {})
  return {
    ready: ready.promise,
    release: release.resolve,
    finished: finished.promise,
  }
}

async function scenario(browser, name) {
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 1050 },
    colorScheme: 'dark',
    extraHTTPHeaders: {
      'x-real-ip': '192.0.2.40',
      'x-forwarded-for': '192.0.2.40',
    },
  })
  let held
  try {
    await alexLogin(ctx)
    const page = await ctx.newPage()
    page.setDefaultTimeout(30000)
    const errors = []
    const forbidden = []
    page.on('pageerror', (error) => errors.push(error.message))
    page.on('response', async (response) => {
      if (new URL(response.url()).pathname !== '/api/auth/session') return
      try {
        const session = await response.json()
        console.log(
          `Native original-tab session (${name}): ${session.user?.id ?? 'signed out'}`
        )
      } catch {
        // An unmounted tab may cancel the request before its response is read.
      }
    })
    // Any unexpected continuation is a failing observation, never a mocked
    // success. Block it before it can mutate the newly signed-in account.
    await page.route('**/api/auth/**', async (route) => {
      const request = route.request()
      const path = new URL(request.url()).pathname
      if (
        request.method() !== 'GET' &&
        (path === '/api/auth/signout' || path.startsWith('/api/auth/security/'))
      ) {
        forbidden.push(`${request.method()} ${path}`)
        return route.abort('blockedbyclient')
      }
      return route.continue()
    })
    await page.goto(origin + '/dashboard/profile')
    await expect(page.locator('#active-sessions')).toContainText('192.0.2.40')
    await expect(
      page.getByRole('button', { name: 'Set up authenticator', exact: true })
    ).toBeVisible()
    const sentinel = randomUUID()
    await page.evaluate((value) => {
      window.__flareDelayedActionDocument = value
    }, sentinel)
    if (name === 'revocation') {
      const current = (await json(ctx, '/api/profile/sessions')).sessions.find(
        (item) => item.current
      )
      held = await delayNext(
        page,
        `/api/profile/sessions/${current.id}`,
        'DELETE',
        (body) => {
          assert.equal(body.signedOut, true)
          assert.equal(body.revokedCount, 1)
        }
      )
      const currentRow = page
        .locator('#active-sessions div.rounded-xl')
        .filter({ hasText: 'This browser' })
      await currentRow
        .getByRole('button', { name: 'Revoke session', exact: true })
        .click()
      await page
        .getByRole('alertdialog')
        .getByRole('button', { name: 'Revoke and sign out', exact: true })
        .click()
    } else {
      await page
        .getByRole('button', { name: 'Set up authenticator', exact: true })
        .click()
      const dialog = page.getByRole('dialog', {
        name: 'Set up your authenticator',
        exact: true,
      })
      await expect(
        dialog.getByLabel('Current password', { exact: true })
      ).toBeEnabled()
      await dialog
        .getByLabel('Current password', { exact: true })
        .fill(password)
      held = await delayNext(page, '/api/auth/security', 'GET', (body) => {
        assert.equal((body.data ?? body).hasPassword, true)
        assert.equal((body.data ?? body).twoFactorEnabled, false)
      })
      await dialog.locator('button[type="submit"]').click()
    }
    await bounded(held.ready, 'waiting for the real response to be held')
    if (name === 'revocation') {
      const rejected = await ctx.request.get(origin + '/api/profile/sessions')
      assert.equal(
        rejected.status(),
        401,
        'Current Alex session must already be revoked on the real server'
      )
    }
    const ip = name === 'revocation' ? '198.51.100.40' : '198.51.100.50'
    const tab = await secondTabLogin(ctx, page, ip)
    assert.equal(
      await page.evaluate(() => window.__flareDelayedActionDocument),
      sentinel
    )
    held.release()
    await bounded(held.finished, 'releasing the delayed response')
    // Observe a bounded quiet interval for a late sign-out, toast or follow-up.
    await page.waitForTimeout(1000)
    assert.deepEqual(
      forbidden,
      [],
      'Old-account async work attempted a new-account mutation or sign-out'
    )
    assert.equal(
      (await json(ctx, '/api/auth/session')).user.id,
      'audit-demo-jamie'
    )
    const current = (await json(ctx, '/api/profile/sessions')).sessions.find(
      (item) => item.current
    )
    assert.equal(current.ipAddress, ip)
    await expectOldAccountUnmounted(page, ip)
    // Verify the new account in its actual UI as well as the shared-cookie API.
    // The original document is never reloaded to force session synchronization.
    await tab.bringToFront()
    await tab.getByRole('link', { name: 'Profile', exact: true }).click()
    await tab.waitForURL((next) => next.pathname === '/dashboard/profile')
    await expect(tab.locator('#active-sessions')).toContainText(ip)
    await expect(
      page.getByText('Session revoked', { exact: true })
    ).toHaveCount(0)
    await expect(
      page.getByText('Unable to revoke session', { exact: true })
    ).toHaveCount(0)
    await expect(page.getByRole('dialog')).toHaveCount(0)
    assert.deepEqual(errors, [], 'Browser runtime errors')
    assert.equal(new URL(page.url()).pathname, '/dashboard/profile')
    console.log(
      `PASS: CONTROLLED NETWORK DELAY (${name}): unchanged real Alex response held across real Jamie sign-in in a second tab; Alex's private panels/dialog unmounted in the original document, Jamie remains authenticated in the API and second-tab Profile, no old continuation, mutation, sign-out or stale dialog/toast.`
    )
    console.log(
      'Session synchronization: only the second tab was reloaded after Jamie sign-in to trigger its native NextAuth startup broadcast; the original document and shared query provider were retained.'
    )
    await tab.close()
  } finally {
    held?.release()
    await ctx.close()
  }
}

async function main() {
  const browser = await chromium.launch({ headless: true })
  try {
    await scenario(browser, 'revocation')
    await scenario(browser, 'security-proof')
  } finally {
    await browser.close()
  }
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
