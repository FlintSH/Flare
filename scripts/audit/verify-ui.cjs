/* eslint-disable @typescript-eslint/no-require-imports */
// Exercise the real local application. Use only scripts/audit/seed.cjs fixtures.
const assert = require('node:assert/strict')
const { mkdir } = require('node:fs/promises')
const path = require('node:path')
const {
  chromium,
  expect: baseExpect,
} = require('../../docs/site/node_modules/@playwright/test')
const sharp = require('../../docs/site/node_modules/sharp')
const expect = baseExpect.configure({ timeout: 45000 })
const origin = process.env.FLARE_AUDIT_TEST_ORIGIN || 'http://localhost:3071'
if (new URL(origin).hostname !== 'localhost')
  throw new Error('Use a disposable localhost instance.')
const screenshots = process.env.FLARE_AUDIT_SCREENSHOTS
const videos = process.env.FLARE_AUDIT_VIDEOS
const password = 'Audit-demo-only-2026!'
const results = []

async function api(
  ctx,
  route,
  method = 'GET',
  data,
  expected = 200,
  headers = {}
) {
  const response = await ctx.request.fetch(origin + route, {
    method,
    ...(data === undefined ? {} : { data }),
    headers: { Origin: origin, ...headers },
  })
  assert.equal(
    response.status(),
    expected,
    `${method} ${route}: ${response.status()} ${await response.text()}`
  )
  if (response.status() === 204) return null
  return response.json()
}
async function login(ctx, user = 'alex', suppliedPassword = password) {
  const csrf = await api(ctx, '/api/auth/csrf')
  const response = await ctx.request.post(
    origin + '/api/auth/callback/credentials',
    {
      form: {
        csrfToken: csrf.csrfToken,
        email: `audit-demo-${user}@example.test`,
        password: suppliedPassword,
        json: 'true',
        callbackUrl: origin + '/dashboard',
      },
      headers: { Origin: origin },
    }
  )
  const result = await response.json()
  if (suppliedPassword === password)
    assert.ok(!result.url.includes('error='), 'Fixture sign-in failed')
  else
    assert.ok(
      result.url.includes('error='),
      'Invalid password should be rejected'
    )
}
async function context(browser, recorded = false, mobile = false) {
  const ctx = await browser.newContext({
    viewport: mobile
      ? { width: 390, height: 844 }
      : { width: 1440, height: 1050 },
    colorScheme: 'dark',
    reducedMotion: 'reduce',
    ...(recorded && videos
      ? { recordVideo: { dir: videos, size: { width: 1440, height: 1050 } } }
      : {}),
  })
  await ctx.addInitScript(() => {
    const install = () => {
      if (!document.documentElement) return
      const style = document.createElement('style')
      style.textContent = 'nextjs-portal { display: none !important; }'
      document.documentElement.appendChild(style)
    }
    if (document.documentElement) install()
    else new MutationObserver(install).observe(document, { childList: true })
  })
  return ctx
}
async function shot(page, name, locator) {
  if (!screenshots) {
    if (videos) await page.waitForTimeout(1400)
    return
  }
  await mkdir(screenshots, { recursive: true })
  await page.evaluate(() => document.fonts.ready)
  const bytes = locator
    ? await locator.screenshot({ animations: 'disabled' })
    : await page.screenshot({ animations: 'disabled' })
  await sharp(bytes)
    .webp({ quality: 88 })
    .toFile(path.join(screenshots, `${name}.webp`))
  if (videos) await page.waitForTimeout(1200)
}
async function finish(ctx, page, name) {
  const video = page.video()
  await ctx.close()
  if (videos && video) {
    await video.saveAs(path.join(videos, `${name}.webm`))
    await video.delete()
  }
}
async function noOverflow(page) {
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth
    ),
    'Horizontal document overflow'
  )
}

async function sessionFlow(browser) {
  const admin = await context(browser, true)
  const second = await context(browser)
  const third = await context(browser)
  const member = await context(browser)
  const failure = await context(browser)
  await login(failure, 'alex', 'incorrect-public-demo-password')
  for (const ctx of [admin, second, third]) await login(ctx)
  await login(member, 'jamie')
  const initial = await api(admin, '/api/profile/sessions')
  assert.ok(initial.sessions.length >= 3)
  assert.equal(initial.sessions.filter((s) => s.current).length, 1)
  assert.ok(
    initial.sessions.every((s) => !('sessionVersion' in s) && !('userId' in s))
  )
  const secondaryId = (
    await api(second, '/api/profile/sessions')
  ).sessions.find((s) => s.current).id
  await api(
    member,
    `/api/profile/sessions/${secondaryId}`,
    'DELETE',
    undefined,
    404
  )
  await api(
    admin,
    `/api/profile/sessions/${secondaryId}`,
    'DELETE',
    undefined,
    403,
    { Origin: 'https://untrusted.example' }
  )
  await api(admin, '/api/profile/sessions', 'GET', undefined, 401, {
    Authorization: 'Bearer audit-demo-alex-public-disposable-upload-token',
  })
  const failures = await api(
    admin,
    '/api/profile/login-history?outcome=failure'
  )
  assert.ok(failures.attempts.length >= 1)
  assert.ok(failures.attempts.every((a) => a.outcome === 'failure'))
  const page = await admin.newPage()
  page.setDefaultTimeout(45000)
  await page.goto(origin + '/dashboard/profile#active-sessions')
  await expect(page.locator('#active-sessions')).toContainText('This browser')
  await page.locator('#active-sessions').scrollIntoViewIfNeeded()
  await shot(page, 'sessions-desktop', page.locator('#active-sessions'))
  await page.locator('#login-history').scrollIntoViewIfNeeded()
  await expect(page.locator('#login-history')).toContainText('Failed')
  await shot(page, 'login-history', page.locator('#login-history'))
  if (screenshots || !videos) {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.locator('#active-sessions').scrollIntoViewIfNeeded()
    await noOverflow(page)
    await shot(page, 'sessions-mobile', page.locator('#active-sessions'))
    await page.setViewportSize({ width: 1440, height: 1050 })
  }
  await page.locator('#active-sessions').scrollIntoViewIfNeeded()
  const rows = page
    .locator('#active-sessions')
    .getByRole('button', { name: 'Revoke session', exact: true })
  const currentOrder = (await api(admin, '/api/profile/sessions')).sessions
  const targetIndex = currentOrder.findIndex((s) => s.id === secondaryId)
  await rows.nth(targetIndex).click()
  await expect(page.getByRole('alertdialog')).toContainText('next request')
  await shot(page, 'revoke-session', page.getByRole('alertdialog'))
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: 'Revoke session', exact: true })
    .click()
  await expect(page.getByRole('alertdialog')).not.toBeVisible()
  await api(second, '/api/profile/sessions', 'GET', undefined, 401)
  assert.ok(
    (await api(admin, '/api/profile/sessions')).sessions.some((s) => s.current)
  )
  await page
    .getByRole('button', { name: 'Revoke all sessions', exact: true })
    .click()
  await expect(page.getByRole('alertdialog')).toContainText(
    'including this one'
  )
  await shot(page, 'revoke-all', page.getByRole('alertdialog'))
  await page
    .getByRole('button', { name: 'Revoke all and sign out', exact: true })
    .click()
  await page.waitForURL('**/auth/login*')
  await expect(page.getByLabel('Email address', { exact: true })).toBeVisible()
  if (videos) await page.waitForTimeout(1600)
  await api(third, '/api/profile/sessions', 'GET', undefined, 401)
  await api(admin, '/api/profile/sessions', 'GET', undefined, 401)
  results.push(
    'Real sign-ins, failed login history, cross-account/CSRF/bearer rejection, single revocation, revoke-all and sign-out, desktop/mobile session UI'
  )
  await finish(admin, page, 'session-management')
  for (const ctx of [second, third, member, failure]) await ctx.close()
}

async function upload(ctx, name, body, mimeType = 'text/plain') {
  const response = await ctx.request.post(origin + '/api/files', {
    headers: { Origin: origin },
    multipart: { file: { name, mimeType, buffer: Buffer.from(body) } },
  })
  assert.equal(response.status(), 200, await response.text())
  const data = await response.json()
  const file = data.data || data
  return { ...file, id: new URL(file.downloadUrl).pathname.split('/')[3] }
}
async function auditFlow(browser) {
  const admin = await context(browser, true)
  const member = await context(browser)
  const visitor = await context(browser)
  await login(admin)
  await login(member, 'jamie')
  await api(visitor, '/api/audit', 'GET', undefined, 401)
  await api(member, '/api/audit', 'GET', undefined, 403)
  await api(visitor, '/api/audit', 'GET', undefined, 401, {
    Authorization: 'Bearer audit-demo-alex-public-disposable-upload-token',
  })
  const report = await upload(
    member,
    'quarterly-report.txt',
    'Public demonstration report. No private data.'
  )
  assert.ok(report.id, JSON.stringify(report))
  await api(member, `/api/files/${report.id}`, 'PATCH', {
    visibility: 'PRIVATE',
  })
  const denied = await visitor.request.get(
    origin + `/api/files/${report.id}/download`
  )
  assert.ok([401, 403, 404].includes(denied.status()))
  await api(member, `/api/files/${report.id}`, 'PATCH', {
    visibility: 'PUBLIC',
  })
  const downloaded = await member.request.get(
    origin + `/api/files/${report.id}/download`
  )
  assert.equal(downloaded.status(), 200)
  assert.match(await downloaded.text(), /Public demonstration/)
  await api(member, `/api/files/${report.id}/ocr`, 'GET', undefined, 400)
  const image = await sharp(
    Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="250"><rect width="100%" height="100%" fill="white"/><text x="50" y="135" font-size="60" fill="black">Public audit demo receipt</text></svg>'
    )
  )
    .png()
    .toBuffer()
  const receipt = await upload(member, 'receipt.png', image, 'image/png')
  const ocr = await api(member, `/api/files/${receipt.id}/ocr`)
  assert.equal(
    ocr.success,
    true,
    'Real OCR should complete for the demonstration receipt'
  )
  const ocrEvents = (
    await api(admin, `/api/audit?targetId=${receipt.id}&category=ocr`)
  ).events
  assert.ok(ocrEvents.some((event) => event.action === 'ocr.completed'))
  assert.ok(!JSON.stringify(ocrEvents).includes('Public audit demo receipt'))
  const role = await api(
    admin,
    '/api/roles',
    'POST',
    {
      name: 'Audit reviewers',
      description: 'Can investigate instance activity',
      color: '#6366f1',
      position: 10,
      permissions: ['audit.read'],
    },
    201
  )
  await api(admin, '/api/users', 'PUT', {
    id: 'audit-demo-casey',
    roleIds: [role.id],
  })
  await api(admin, '/api/settings', 'PATCH', {
    settings: {
      general: {
        registrations: {
          enabled: false,
          disabledMessage: 'Registration is managed by the administrator.',
        },
      },
    },
  })
  await api(admin, '/api/audit?page=0', 'GET', undefined, 400)
  await api(admin, '/api/audit?outcome=unknown', 'GET', undefined, 400)
  await api(
    admin,
    '/api/audit?category=files&category=roles',
    'GET',
    undefined,
    400
  )
  await api(member, `/api/files/${report.id}`, 'DELETE')
  const events = (
    await api(admin, `/api/audit?targetId=${report.id}&limit=100`)
  ).events
  for (const action of [
    'file.create',
    'file.update',
    'file.download',
    'file.delete',
  ])
    assert.ok(
      events.some((e) => e.action === action),
      `Missing ${action}`
    )
  assert.ok(
    events
      .filter((e) => e.action === 'file.delete')
      .every(
        (e) =>
          e.targetName === 'quarterly-report.txt' &&
          e.actorId === 'audit-demo-jamie'
      )
  )
  assert.ok(events.some((e) => e.outcome === 'denied'))
  const changes = (await api(admin, '/api/audit?category=settings')).events
  assert.ok(
    changes.some((e) =>
      e.details.settingsKeys?.includes('settings.general.registrations.enabled')
    )
  )
  const serialized = JSON.stringify(
    (await api(admin, '/api/audit?limit=100')).events
  )
  assert.ok(
    !serialized.includes(password) &&
      !serialized.includes('uploadToken') &&
      !serialized.includes('Public demonstration report')
  )
  const page = await admin.newPage()
  page.setDefaultTimeout(45000)
  await page.goto(origin + '/dashboard/audit')
  await expect(
    page.getByRole('heading', { name: 'Audit log', exact: true })
  ).toBeVisible()
  await expect(
    page.getByRole('region', { name: 'Audit events' })
  ).toHaveAttribute('aria-busy', 'false')
  await shot(page, 'audit-desktop')
  await page
    .getByLabel('Search activity', { exact: true })
    .fill('quarterly-report.txt')
  await page.getByRole('button', { name: 'Apply filters', exact: true }).click()
  await expect(
    page.getByRole('region', { name: 'Audit events' })
  ).toHaveAttribute('aria-busy', 'false')
  await expect(
    page.getByRole('region', { name: 'Audit events' })
  ).toContainText('quarterly-report.txt')
  await shot(page, 'audit-filtered')
  const deleted = page
    .locator('section[aria-label="Audit events"] details')
    .filter({ has: page.locator('summary', { hasText: 'file delete' }) })
    .first()
  await deleted.locator('summary').click()
  await expect(deleted).toContainText('Recorded details')
  await deleted.scrollIntoViewIfNeeded()
  await shot(page, 'audit-details', deleted)
  await page.getByRole('button', { name: 'Clear filters', exact: true }).click()
  await page.getByLabel('Outcome', { exact: true }).selectOption('denied')
  await page.getByRole('button', { name: 'Apply filters', exact: true }).click()
  await expect(
    page.getByRole('region', { name: 'Audit events' })
  ).toHaveAttribute('aria-busy', 'false')
  await expect(
    page.getByRole('region', { name: 'Audit events' })
  ).toContainText(/denied/i)
  if (videos) await page.waitForTimeout(1400)
  await page
    .getByLabel('Search activity', { exact: true })
    .fill('missing-demo-filename')
  await page.getByRole('button', { name: 'Apply filters', exact: true }).click()
  await expect(
    page.getByText('No activity matches these filters', { exact: true })
  ).toBeVisible()
  if (videos) await page.waitForTimeout(1400)
  await page.getByRole('button', { name: 'Clear filters', exact: true }).click()
  await expect(
    page.getByRole('region', { name: 'Audit events' })
  ).toHaveAttribute('aria-busy', 'false')
  if (screenshots || !videos) {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.evaluate(() => scrollTo(0, 0))
    await noOverflow(page)
    await shot(page, 'audit-mobile')
  } else {
    await page.evaluate(() => scrollTo(0, 0))
    await page.waitForTimeout(1400)
  }
  results.push(
    'Actual upload/share/download/denied/OCR-invalid/delete activity, role assignment/settings, snapshot preservation and secret exclusion, admin/bearer boundaries, filters/details/empty state on desktop/mobile'
  )
  await finish(admin, page, 'audit-investigation')
  await member.close()
  await visitor.close()
}
async function main() {
  const browser = await chromium.launch({
    headless: true,
    slowMo: videos ? 100 : 0,
  })
  try {
    await sessionFlow(browser)
    await auditFlow(browser)
    for (const result of results) console.log(`PASS: ${result}`)
  } finally {
    await browser.close()
  }
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
