/* eslint-disable @typescript-eslint/no-require-imports */
// Controlled-time regression against the real disposable demonstration server.
// Only the public fixture JWT's authTime is changed; HTTP responses are real.
const assert = require('node:assert/strict')
const { mkdir } = require('node:fs/promises')
const path = require('node:path')
const { encode, decode } = require('next-auth/jwt')
const { TOTP } = require('otpauth')
const {
  chromium,
  expect: baseExpect,
} = require('../../docs/site/node_modules/@playwright/test')
const sharp = require('../../docs/site/node_modules/sharp')
const expect = baseExpect.configure({ timeout: 15000 })

const origin = process.env.FLARE_SECURITY_TEST_ORIGIN || 'http://localhost:3061'
const target = new URL(origin)
if (target.hostname !== 'localhost' || target.protocol !== 'http:') {
  throw new Error(
    'Use the disposable HTTP localhost security demonstration server.'
  )
}
const secret = 'public-disposable-security-demo-secret-2026-only'
const originalPassword = 'Security-demo-only-2026!'
const replacementPassword = 'Security-demo-expiry-only-2026!'
const originalEmail = 'security-demo-alex@example.test'
const replacementEmail = 'security-demo-alex-expiry@example.test'
const screenshotDirectory = process.env.FLARE_SECURITY_SCREENSHOTS

async function main() {
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    colorScheme: 'dark',
    reducedMotion: 'reduce',
  })
  const page = await context.newPage()
  const mutations = []
  page.on('request', (request) => {
    if (
      request.method() === 'PUT' &&
      new URL(request.url()).pathname === '/api/profile'
    )
      mutations.push(request)
  })
  try {
    async function api(route, body) {
      const response = await context.request.fetch(origin + route, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { Origin: origin },
        ...(body === undefined ? {} : { data: body }),
      })
      assert.equal(
        response.status(),
        200,
        `Unexpected response from ${route}; seed the disposable fixtures before running this check.`
      )
      return response.json()
    }
    async function login(email, password, code) {
      await context.clearCookies()
      await page.goto(origin + '/auth/login?local=1')
      await page.getByLabel('Email address', { exact: true }).fill(email)
      await page.getByLabel('Password', { exact: true }).fill(password)
      await page.getByRole('button', { name: 'Sign in', exact: true }).click()
      if (code) {
        await page
          .getByRole('button', { name: 'Use a recovery code', exact: true })
          .click()
        await page.getByLabel('Recovery code', { exact: true }).fill(code)
        await page
          .getByRole('button', { name: 'Verify and sign in', exact: true })
          .click()
      }
      await page.waitForURL('**/dashboard')
    }
    async function profile() {
      await page.goto(origin + '/dashboard/profile')
      await expect(
        page
          .locator('#sign-in-security')
          .getByRole('heading', { name: 'Authenticator app', exact: true })
      ).toBeVisible()
    }
    async function expireExistingProof() {
      const cookie = (await context.cookies(origin)).find(
        (value) => value.name === 'next-auth.session-token'
      )
      assert.ok(cookie, 'Expected the localhost session cookie')
      const token = await decode({ token: cookie.value, secret })
      assert.equal(
        token?.id,
        'security-demo-alex',
        'Only the public demonstration account may be used'
      )
      assert.equal(
        token.authMethod,
        'recovery',
        'Begin with a real recovery-code login'
      )
      const value = await encode({
        token: { ...token, authTime: Date.now() - 301000 },
        secret,
      })
      await context.addCookies([{ ...cookie, value }])
      // This request verifies real server expiry without changing the mounted UI cache.
      assert.equal(
        (await api('/api/auth/security')).canUseRecentRecovery,
        false
      )
    }
    async function successfulSave(button) {
      const response = page.waitForResponse(
        (value) =>
          value.request().method() === 'PUT' &&
          new URL(value.url()).pathname === '/api/profile'
      )
      await button.click()
      assert.equal((await response).status(), 200)
      await page.waitForURL('**/auth/login*')
    }

    await login(originalEmail, originalPassword)
    const initial = await api('/api/auth/security')
    assert.equal(
      initial.twoFactorEnabled,
      false,
      'Run scripts/security/seed.cjs before this regression check'
    )
    const setup = await api('/api/auth/security/totp/setup', {
      password: originalPassword,
    })
    const enrollment = await api('/api/auth/security/totp/enable', {
      challengeId: setup.challengeId,
      code: new TOTP({
        secret: setup.secret,
        digits: 6,
        period: 30,
        algorithm: 'SHA1',
      }).generate(),
    })

    await login(originalEmail, originalPassword, enrollment.recoveryCodes[0])
    await profile()
    const passwordForm = page.locator('#password form')
    await expect(passwordForm).toContainText(
      'Your recent recovery code sign-in'
    )
    await expect(
      passwordForm.getByLabel('Authenticator or recovery code', { exact: true })
    ).toHaveCount(0)
    await passwordForm
      .getByLabel('Current Password', { exact: true })
      .fill(originalPassword)
    await passwordForm
      .getByLabel('New Password', { exact: true })
      .fill(replacementPassword)
    await passwordForm
      .getByLabel('Confirm New Password', { exact: true })
      .fill(replacementPassword)
    await expireExistingProof()
    await passwordForm
      .getByRole('button', { name: 'Update Password', exact: true })
      .click()
    await expect(passwordForm.getByRole('alert')).toContainText(
      'Enter an authenticator or recovery code to continue.'
    )
    await expect(
      passwordForm.getByLabel('Authenticator or recovery code', { exact: true })
    ).toBeVisible()
    assert.equal(
      mutations.length,
      0,
      'Expired proof must reveal the code field before any password mutation'
    )
    await expect(
      passwordForm.getByLabel('New Password', { exact: true })
    ).toHaveValue(replacementPassword)
    if (screenshotDirectory) {
      await mkdir(screenshotDirectory, { recursive: true })
      const bytes = await page.locator('#password').screenshot({
        animations: 'disabled',
        maskColor: '#374151',
        mask: [passwordForm.locator('input[type="password"]')],
      })
      await sharp(bytes)
        .webp({ quality: 88 })
        .toFile(path.join(screenshotDirectory, 'proof-expired.webp'))
    }
    await passwordForm
      .getByLabel('Authenticator or recovery code', { exact: true })
      .fill(enrollment.recoveryCodes[1])
    await successfulSave(
      passwordForm.getByRole('button', { name: 'Update Password', exact: true })
    )
    assert.equal(mutations.length, 1)

    await login(originalEmail, replacementPassword, enrollment.recoveryCodes[2])
    await profile()
    const accountForm = page
      .locator('form')
      .filter({ has: page.locator('#username') })
    await accountForm
      .getByLabel('Email', { exact: true })
      .fill(replacementEmail)
    await expect(accountForm).toContainText('Your recent recovery code sign-in')
    await expect(
      accountForm.getByLabel('Current password', { exact: true })
    ).toHaveCount(0)
    await expireExistingProof()
    await accountForm
      .getByRole('button', { name: 'Save Changes', exact: true })
      .click()
    await expect(accountForm.getByRole('alert')).toContainText(
      'Enter your current password to continue.'
    )
    await expect(
      accountForm.getByLabel('Current password', { exact: true })
    ).toBeVisible()
    await expect(
      accountForm.getByLabel('Authenticator or recovery code', { exact: true })
    ).toBeVisible()
    assert.equal(
      mutations.length,
      1,
      'Expired proof must reveal email proof fields before any email mutation'
    )
    await expect(accountForm.getByLabel('Email', { exact: true })).toHaveValue(
      replacementEmail
    )
    await accountForm
      .getByLabel('Current password', { exact: true })
      .fill(replacementPassword)
    await accountForm
      .getByLabel('Authenticator or recovery code', { exact: true })
      .fill(enrollment.recoveryCodes[3])
    await successfulSave(
      accountForm.getByRole('button', { name: 'Save Changes', exact: true })
    )
    assert.equal(mutations.length, 2)
    console.log(
      'PASS: controlled proof expiry reveals password/email proof fields before any PUT; entered changes survive and both real retries succeed.'
    )
  } finally {
    await context.close()
    await browser.close()
  }
}
main().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
