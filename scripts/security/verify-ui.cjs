/* eslint-disable @typescript-eslint/no-require-imports */
// Real browser/server checks against scripts/security/seed.cjs fixtures only.
const assert = require('node:assert/strict')
const { mkdir } = require('node:fs/promises')
const path = require('node:path')
const {
  chromium,
  expect: baseExpect,
} = require('../../docs/site/node_modules/@playwright/test')
const sharp = require('../../docs/site/node_modules/sharp')
const { TOTP } = require('otpauth')
const expect = baseExpect.configure({ timeout: 45000 })

const origin = process.env.FLARE_SECURITY_TEST_ORIGIN || 'http://localhost:3061'
if (new URL(origin).hostname !== 'localhost')
  throw new Error('Use a disposable localhost instance, matching NEXTAUTH_URL.')
const password = 'Security-demo-only-2026!'
const screenshots = process.env.FLARE_SECURITY_SCREENSHOTS
const videos = process.env.FLARE_SECURITY_VIDEOS
const results = []
let lastCounter = -1

async function context(browser, mobile = false) {
  const ctx = await browser.newContext({
    viewport: mobile
      ? { width: 390, height: 844 }
      : { width: 1440, height: 1000 },
    colorScheme: 'dark',
    reducedMotion: 'reduce',
    ...(videos
      ? { recordVideo: { dir: videos, size: { width: 1280, height: 900 } } }
      : {}),
  })
  // Installed before any application script: no secret appears in video frames.
  await ctx.addInitScript(() => {
    const install = () => {
      if (!document.documentElement) return false
      const style = document.createElement('style')
      style.textContent = `
        img[data-sensitive] { visibility: hidden !important; }
        code[data-sensitive], [data-sensitive] li { color: transparent !important; text-shadow: none !important; background: #394150 !important; border-radius: 4px; }
        input[data-sensitive] { -webkit-text-security: disc !important; }
        nextjs-portal { display: none !important; }
      `
      document.documentElement.appendChild(style)
      return true
    }
    if (!install()) {
      const observer = new MutationObserver(() => {
        if (install()) observer.disconnect()
      })
      observer.observe(document, { childList: true, subtree: true })
    }
  })
  const page = await ctx.newPage()
  page.setDefaultTimeout(45000)
  return { ctx, page }
}

async function shot(page, name, locator) {
  if (!screenshots) return
  const viewport = page.viewportSize()
  // Keep mobile width while making the complete card/dialog visible in a still.
  // Restore the real phone viewport before continuing interaction checks.
  const expand = locator && viewport.width < 640
  if (expand)
    await page.setViewportSize({ width: viewport.width, height: 1200 })
  await page.evaluate(() => document.fonts.ready)
  await mkdir(screenshots, { recursive: true })
  const bytes = locator
    ? await locator.screenshot({ animations: 'disabled' })
    : await page.screenshot({ animations: 'disabled' })
  await sharp(bytes)
    .webp({ quality: 88 })
    .toFile(path.join(screenshots, `${name}.webp`))
  if (expand) await page.setViewportSize(viewport)
  if (videos) await page.waitForTimeout(1500)
}

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
    `${method} ${route} returned ${response.status()}`
  )
  return response.json()
}

async function passwordStep(page, account) {
  await page.goto(origin + '/auth/login?local=1')
  await page
    .getByLabel('Email address', { exact: true })
    .fill(`security-demo-${account}@example.test`)
  await page.getByLabel('Password', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
}

async function dashboard(page) {
  await page.waitForURL('**/dashboard', { timeout: 90000 })
}

async function profile(page) {
  await page.goto(origin + '/dashboard/profile#sign-in-security')
  await expect(
    page
      .locator('#sign-in-security')
      .getByRole('heading', { name: 'Authenticator app' })
  ).toBeVisible()
  await page.locator('#sign-in-security').scrollIntoViewIfNeeded()
}

async function signOut(page) {
  await profile(page)
  await page.getByRole('button', { name: 'Sign Out', exact: true }).click()
  await page.waitForURL('**/auth/login*')
}

async function nextCode(secret) {
  let counter = Math.floor(Date.now() / 30000)
  if (counter <= lastCounter) {
    const delay = (lastCounter + 1) * 30000 - Date.now() + 200
    console.log('Waiting for a fresh authenticator time step…')
    await new Promise((resolve) => setTimeout(resolve, delay))
    counter = Math.floor(Date.now() / 30000)
  }
  lastCounter = counter
  return new TOTP({
    secret,
    digits: 6,
    period: 30,
    algorithm: 'SHA1',
  }).generate()
}

async function recoveryLogin(page, code) {
  await passwordStep(page, 'alex')
  await page
    .getByRole('button', { name: 'Use a recovery code', exact: true })
    .click()
  await page.getByLabel('Recovery code', { exact: true }).fill(code)
  await page
    .getByRole('button', { name: 'Verify and sign in', exact: true })
    .click()
  await dashboard(page)
}

async function saveCodes(page) {
  const dialog = page.getByRole('dialog', { name: 'Save your recovery codes' })
  await expect(dialog).toBeVisible()
  const codes = await dialog
    .getByRole('list', { name: 'Recovery codes' })
    .locator('li')
    .allTextContents()
  assert.equal(codes.length, 10)
  await expect(
    dialog.getByRole('button', { name: 'Done', exact: true })
  ).toBeDisabled()
  await shot(
    page,
    page.viewportSize().width < 640
      ? 'recovery-codes-mobile'
      : 'recovery-codes',
    dialog
  )
  const downloadEvent = page.waitForEvent('download')
  await dialog
    .getByRole('button', { name: 'Download codes', exact: true })
    .click()
  const download = await downloadEvent
  assert.equal(download.suggestedFilename(), 'flare-recovery-codes.txt')
  await download.delete()
  await dialog.getByRole('checkbox').check()
  await dialog.getByRole('button', { name: 'Done', exact: true }).click()
  return codes
}

async function reenter(page) {
  if (videos) await page.waitForTimeout(1000)
  await page.getByRole('button', { name: 'Sign in again', exact: true }).click()
  await page.waitForURL('**/auth/login*')
}

async function proof(dialog, code) {
  if (!(await dialog.getByLabel('Current password', { exact: true }).count())) {
    await expect(dialog).toContainText(
      /Your recent (passkey|recovery code|SSO) sign-in/
    )
    return
  }
  await dialog.getByLabel('Current password', { exact: true }).fill(password)
  if (code) {
    await dialog
      .getByRole('button', { name: 'Use a recovery code', exact: true })
      .click()
    await dialog.getByLabel('Recovery code', { exact: true }).fill(code)
  }
}

async function finishVideo(ctx, page, name) {
  const video = page.video()
  await ctx.close()
  if (videos) {
    await video.saveAs(path.join(videos, `${name}.webm`))
    await video.delete()
  }
}

async function testTotp(browser) {
  const { ctx, page } = await context(browser)
  await passwordStep(page, 'alex')
  await dashboard(page)
  await profile(page)
  await shot(page, 'security-overview', page.locator('#sign-in-security'))
  await api(ctx, '/api/auth/security/totp/setup', 'POST', { password }, 403, {
    Origin: 'https://untrusted.example',
  })
  await api(ctx, '/api/auth/security', 'GET', undefined, 401, {
    Authorization: 'Bearer security-demo-alex-public-disposable-upload-token',
  })
  await page
    .getByRole('button', { name: 'Set up authenticator', exact: true })
    .click()
  let dialog = page.getByRole('dialog')
  await proof(dialog)
  await dialog.getByRole('button', { name: 'Continue', exact: true }).click()
  await expect(dialog.locator('code[data-sensitive]')).toBeVisible()
  const secret = await dialog.locator('code[data-sensitive]').textContent()
  await shot(page, 'totp-setup', dialog)
  const stale = await browser.newContext({
    storageState: await ctx.storageState(),
  })
  await dialog
    .getByLabel('Authenticator code', { exact: true })
    .fill(await nextCode(secret))
  await dialog
    .getByRole('button', {
      name: 'Enable two-factor authentication',
      exact: true,
    })
    .click()
  let codes = await saveCodes(page)
  await api(stale, '/api/auth/security', 'GET', undefined, 401)
  await stale.close()
  await reenter(page)

  await passwordStep(page, 'alex')
  await expect(
    page.getByRole('heading', { name: 'Verify your identity' })
  ).toBeVisible()
  await api(ctx, '/api/files', 'GET', undefined, 401)
  await shot(page, 'totp-login')
  await page
    .getByLabel('Authenticator code', { exact: true })
    .fill(await nextCode(secret))
  await page
    .getByRole('button', { name: 'Verify and sign in', exact: true })
    .click()
  await dashboard(page)
  results.push(
    'Authenticator enrollment, code login, password-only denial, and revocation of existing sessions'
  )

  await signOut(page)
  await passwordStep(page, 'alex')
  await page
    .getByRole('button', { name: 'Use a recovery code', exact: true })
    .click()
  await shot(page, 'recovery-login')
  await page.getByLabel('Recovery code', { exact: true }).fill(codes[0])
  await page
    .getByRole('button', { name: 'Verify and sign in', exact: true })
    .click()
  await dashboard(page)
  assert.equal((await api(ctx, '/api/auth/security')).recoveryCodesRemaining, 9)
  await signOut(page)
  await passwordStep(page, 'alex')
  await page
    .getByRole('button', { name: 'Use a recovery code', exact: true })
    .click()
  await page.getByLabel('Recovery code', { exact: true }).fill(codes[0])
  await page
    .getByRole('button', { name: 'Verify and sign in', exact: true })
    .click()
  await expect(page.locator('form [role="alert"]')).toContainText(
    'Unable to verify this code'
  )
  await api(ctx, '/api/files', 'GET', undefined, 401)
  await page.getByLabel('Recovery code', { exact: true }).fill(codes[1])
  await page
    .getByRole('button', { name: 'Verify and sign in', exact: true })
    .click()
  await dashboard(page)
  results.push(
    'Single-use recovery login; a replayed code cannot create a session'
  )

  await profile(page)
  // Keep walkthrough video dimensions stable. The ordinary browser run covers
  // the same remaining actions on a phone and captures separate mobile stills.
  if (!videos) {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.locator('#sign-in-security').scrollIntoViewIfNeeded()
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth
      ),
      true
    )
    await shot(page, 'mobile-security', page.locator('#sign-in-security'))
  }
  await page
    .getByRole('button', { name: 'Replace recovery codes', exact: true })
    .click()
  dialog = page.getByRole('dialog')
  await proof(dialog, codes[2])
  await shot(page, 'recovery-repair', dialog)
  await dialog
    .getByRole('button', { name: 'Replace recovery codes', exact: true })
    .click()
  codes = await saveCodes(page)
  await reenter(page)
  await recoveryLogin(page, codes[0])
  await profile(page)
  await page.getByRole('button', { name: 'Turn off', exact: true }).click()
  dialog = page.getByRole('dialog')
  await proof(dialog, codes[1])
  await dialog
    .getByRole('button', {
      name: 'Turn off two-factor authentication',
      exact: true,
    })
    .click()
  await reenter(page)
  await passwordStep(page, 'alex')
  await dashboard(page)
  assert.equal((await api(ctx, '/api/auth/security')).twoFactorEnabled, false)
  results.push(
    `${videos ? 'Desktop' : 'Mobile'} recovery-code replacement and disabling 2FA with fresh proof`
  )
  await finishVideo(ctx, page, 'two-factor-demo')
}

async function testPasskeys(browser) {
  const { ctx, page } = await context(browser)
  const cdp = await ctx.newCDPSession(page)
  await cdp.send('WebAuthn.enable')
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  })
  await passwordStep(page, 'jamie')
  await dashboard(page)
  await profile(page)
  await page.getByRole('button', { name: 'Add a passkey', exact: true }).click()
  let dialog = page.getByRole('dialog')
  await dialog
    .getByLabel('Passkey name', { exact: true })
    .fill('Personal laptop')
  await proof(dialog)
  await shot(page, 'passkey-create', dialog)
  await dialog
    .getByRole('button', { name: 'Create passkey', exact: true })
    .click()
  await expect(
    page.getByRole('heading', { name: 'Your security settings are updated' })
  ).toBeVisible()
  await reenter(page)
  await shot(page, 'passkey-login')
  const assertionRequest = page.waitForRequest(
    (req) => new URL(req.url()).pathname === '/api/auth/callback/passkey'
  )
  await page
    .getByRole('button', { name: 'Sign in with a passkey', exact: true })
    .click()
  const signedRequest = await assertionRequest
  await dashboard(page)
  const replayContext = await browser.newContext({
    storageState: await ctx.storageState(),
  })
  const replay = await replayContext.request.post(
    origin + '/api/auth/callback/passkey',
    {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Origin: origin,
      },
      data: signedRequest.postData(),
    }
  )
  assert.match((await replay.json()).url, /error=/)
  await replayContext.close()
  await profile(page)
  assert.equal((await api(ctx, '/api/auth/security')).passkeys.length, 1)
  await shot(page, 'passkey-added', page.locator('#sign-in-security'))
  await page
    .getByRole('button', { name: 'Rename Personal laptop', exact: true })
    .click()
  dialog = page.getByRole('dialog')
  await expect(dialog).toContainText('Your recent passkey sign-in')
  await dialog
    .getByLabel('Passkey name', { exact: true })
    .fill('My laptop passkey')
  await dialog.getByRole('button', { name: 'Save name', exact: true }).click()
  await expect(
    page.getByRole('button', { name: 'Remove My laptop passkey', exact: true })
  ).toBeVisible()
  if (videos) await page.waitForTimeout(1000)
  await page
    .getByRole('button', { name: 'Remove My laptop passkey', exact: true })
    .click()
  dialog = page.getByRole('dialog')
  if (videos) await page.waitForTimeout(1000)
  await dialog
    .getByRole('button', { name: 'Remove passkey', exact: true })
    .click()
  await reenter(page)
  // The virtual device retains the credential; server removal must reject it.
  await page
    .getByRole('button', { name: 'Sign in with a passkey', exact: true })
    .click()
  await expect(page.locator('form [role="alert"]')).toContainText(
    'Unable to sign in with this passkey'
  )
  await api(ctx, '/api/files', 'GET', undefined, 401)
  if (videos) await page.waitForTimeout(1500)
  results.push(
    'Real WebAuthn registration and passwordless login using Chromium virtual authenticator; replay and removed credential rejected; rename and removal verified'
  )
  await finishVideo(ctx, page, 'passkey-demo')
}

async function main() {
  const browser = await chromium.launch({
    headless: true,
    slowMo: videos ? 120 : 0,
  })
  try {
    await testTotp(browser)
    await testPasskeys(browser)
    for (const result of results) console.log(`PASS: ${result}`)
  } finally {
    await browser.close()
  }
}
main().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
