/* eslint-disable @typescript-eslint/no-require-imports */
// Real-server regression. Use only the disposable scripts/audit/seed.cjs fixtures.
const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const { mkdir } = require('node:fs/promises')
const path = require('node:path')
const {
  chromium,
  expect: baseExpect,
} = require('../../docs/site/node_modules/@playwright/test')
const sharp = require('../../docs/site/node_modules/sharp')

const expect = baseExpect.configure({ timeout: 30000 })
const origin = process.env.FLARE_AUDIT_TEST_ORIGIN || 'http://localhost:3071'
const destination = new URL(origin)
if (
  destination.protocol !== 'http:' ||
  destination.hostname !== 'localhost' ||
  destination.pathname !== '/' ||
  destination.search ||
  destination.hash ||
  destination.username ||
  destination.password
)
  throw new Error('Use the origin of a disposable localhost HTTP instance.')
const screenshots = process.env.FLARE_AUDIT_SCREENSHOTS
const password = 'Audit-demo-only-2026!'
const clientHeaders = (ip) => ({ 'x-real-ip': ip, 'x-forwarded-for': ip })

async function api(ctx, route, method = 'GET', expected = 200) {
  const response = await ctx.request.fetch(origin + route, {
    method,
    headers: { Origin: origin },
  })
  assert.equal(
    response.status(),
    expected,
    `${method} ${route}: ${await response.text()}`
  )
  return response.json()
}

async function initialLogin(ctx, person) {
  const csrf = await api(ctx, '/api/auth/csrf')
  const response = await ctx.request.post(
    origin + '/api/auth/callback/credentials',
    {
      headers: { Origin: origin },
      form: {
        csrfToken: csrf.csrfToken,
        email: `audit-demo-${person}@example.test`,
        password,
        json: 'true',
        callbackUrl: origin + '/dashboard',
      },
    }
  )
  assert.equal(response.status(), 200)
  assert.ok(
    !(await response.json()).url.includes('error='),
    'Fixture login failed'
  )
  const session = await api(ctx, '/api/auth/session')
  assert.equal(
    session.user?.id,
    `audit-demo-${person}`,
    'Unexpected fixture identity'
  )
}

async function currentSession(ctx, person, ip) {
  const session = await api(ctx, '/api/auth/session')
  assert.equal(session.user?.id, `audit-demo-${person}`)
  const current = (await api(ctx, '/api/profile/sessions')).sessions.filter(
    (item) => item.current
  )
  assert.equal(current.length, 1)
  assert.equal(
    current[0].ipAddress,
    ip,
    'Reserved fixture proxy address was not recorded'
  )
  return current[0].id
}

async function sameDocument(page, sentinel) {
  assert.equal(
    await page.evaluate(() => window.__flareAccountSwitchDocument),
    sentinel,
    'The document reloaded; this would not prove isolation of the shared client query cache'
  )
}

async function remotelyRevokeAndOpenLogin(
  page,
  control,
  sessionId,
  sentinel,
  destination = 'Files'
) {
  const result = await api(
    control,
    `/api/profile/sessions/${encodeURIComponent(sessionId)}`,
    'DELETE'
  )
  assert.equal(result.revokedCount, 1)
  assert.equal(
    result.signedOut,
    false,
    'The control session must survive revocation'
  )
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('link', { name: destination, exact: true })
    .click()
  await page.waitForURL((url) => url.pathname === '/auth/login')
  await expect(page.getByLabel('Email address', { exact: true })).toBeVisible()
  await sameDocument(page, sentinel)
  console.log(
    `PASS: Remote revocation redirected the real ${destination} navigation link to login without replacing the document.`
  )
}

async function loginForm(page, ctx, person, ip, sentinel) {
  await ctx.setExtraHTTPHeaders(clientHeaders(ip))
  await page
    .getByLabel('Email address', { exact: true })
    .fill(`audit-demo-${person}@example.test`)
  await page.getByLabel('Password', { exact: true }).fill(password)
  await page
    .locator('form')
    .filter({ has: page.getByLabel('Password', { exact: true }) })
    .locator('button[type="submit"]')
    .click()
  await page.waitForURL((url) => url.pathname === '/dashboard')
  await expect(
    page.getByRole('navigation', { name: 'Main navigation' })
  ).toBeVisible()
  await sameDocument(page, sentinel)
  return currentSession(ctx, person, ip)
}

async function inspectProfile(page, ip, forbiddenIp, sentinel, requests) {
  // Observe all DOM updates, not just the eventual settled state: an old-account
  // flash before the new network response is a regression too.
  await page.evaluate((forbidden) => {
    window.__flareAccountSwitchObserver?.disconnect()
    window.__flareAccountSwitchLeaks = []
    const inspect = () => {
      for (const selector of ['#active-sessions', '#login-history']) {
        if (document.querySelector(selector)?.textContent?.includes(forbidden))
          window.__flareAccountSwitchLeaks.push(selector)
      }
    }
    window.__flareAccountSwitchObserver = new MutationObserver(inspect)
    window.__flareAccountSwitchObserver.observe(document, {
      subtree: true,
      childList: true,
      characterData: true,
    })
    inspect()
  }, forbiddenIp)
  const before = requests.length
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('link', { name: 'Profile', exact: true })
    .click()
  await page.waitForURL((url) => url.pathname === '/dashboard/profile')
  await expect(page.locator('#active-sessions')).toContainText(ip)
  await expect(page.locator('#login-history')).toContainText(ip)
  await expect(page.locator('#active-sessions')).not.toContainText(forbiddenIp)
  await expect(page.locator('#login-history')).not.toContainText(forbiddenIp)
  await sameDocument(page, sentinel)
  assert.deepEqual(
    await page.evaluate(() => window.__flareAccountSwitchLeaks),
    [],
    'Previous-account activity briefly appeared while the new profile loaded'
  )
  const freshRequests = requests.slice(before)
  assert.ok(
    freshRequests.includes('/api/profile/sessions'),
    'New account must load its own sessions'
  )
  assert.ok(
    freshRequests.includes('/api/profile/login-history'),
    'New account must load its own history'
  )
}

async function main() {
  const browser = await chromium.launch({ headless: true })
  try {
    const ctx = await browser.newContext({
      viewport: { width: 1440, height: 1050 },
      colorScheme: 'dark',
      reducedMotion: 'reduce',
      extraHTTPHeaders: clientHeaders('192.0.2.10'),
    })
    const alexControl = await browser.newContext({
      extraHTTPHeaders: clientHeaders('192.0.2.11'),
    })
    const jamieControl = await browser.newContext({
      extraHTTPHeaders: clientHeaders('198.51.100.21'),
    })
    await initialLogin(ctx, 'alex')
    await initialLogin(alexControl, 'alex')
    await initialLogin(jamieControl, 'jamie')
    const alexSession = await currentSession(ctx, 'alex', '192.0.2.10')
    const page = await ctx.newPage()
    page.setDefaultTimeout(30000)
    const requests = []
    const pageErrors = []
    page.on('request', (request) =>
      requests.push(new URL(request.url()).pathname)
    )
    page.on('pageerror', (error) => pageErrors.push(error.message))
    await page.goto(origin + '/dashboard/profile')
    await expect(page.locator('#active-sessions')).toContainText('192.0.2.10')
    await expect(page.locator('#login-history')).toContainText('192.0.2.10')
    const sentinel = randomUUID()
    await page.evaluate((value) => {
      window.__flareAccountSwitchDocument = value
    }, sentinel)

    await remotelyRevokeAndOpenLogin(page, alexControl, alexSession, sentinel)
    const jamieSession = await loginForm(
      page,
      ctx,
      'jamie',
      '198.51.100.20',
      sentinel
    )
    await inspectProfile(
      page,
      '198.51.100.20',
      '192.0.2.10',
      sentinel,
      requests
    )
    assert.notEqual(jamieSession, alexSession)
    console.log(
      'PASS: Alex → remote revocation → real Jamie login in the same document; no Alex session/history rendered, including transient updates.'
    )

    await remotelyRevokeAndOpenLogin(
      page,
      jamieControl,
      jamieSession,
      sentinel,
      'Upload'
    )
    const replacement = await loginForm(
      page,
      ctx,
      'jamie',
      '198.51.100.30',
      sentinel
    )
    assert.notEqual(replacement, jamieSession)
    await inspectProfile(
      page,
      '198.51.100.30',
      '192.0.2.10',
      sentinel,
      requests
    )
    const sessions = (await api(ctx, '/api/profile/sessions')).sessions
    assert.ok(
      !sessions.some((item) => item.id === jamieSession),
      'Revoked session remained active'
    )
    const current = sessions.find((item) => item.current)
    assert.equal(current.id, replacement)
    assert.equal(current.ipAddress, '198.51.100.30')
    const currentRow = page
      .locator('#active-sessions div.rounded-xl')
      .filter({ hasText: 'This browser' })
    await expect(currentRow).toHaveCount(1)
    await expect(currentRow).toContainText('198.51.100.30')
    await expect(currentRow).not.toContainText('198.51.100.20')
    await expect(page.locator('#login-history')).toContainText('198.51.100.20')
    console.log(
      'PASS: Same-account replacement session has fresh current-browser metadata; prior Jamie login remains legitimate history.'
    )
    assert.deepEqual(pageErrors, [], 'Browser runtime errors')
    if (screenshots) {
      await mkdir(screenshots, { recursive: true })
      await page.locator('#active-sessions').scrollIntoViewIfNeeded()
      await page.evaluate(() => document.fonts.ready)
      await sharp(
        await page
          .locator('#active-sessions')
          .screenshot({ animations: 'disabled' })
      )
        .webp({ quality: 88 })
        .toFile(path.join(screenshots, 'account-switch.webp'))
    }
    console.log(
      'PASS: Same-document sentinel survived every navigation; no router or backend mocks, no session-cookie replacement, no page reload after initial entry.'
    )
  } finally {
    await browser.close()
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
