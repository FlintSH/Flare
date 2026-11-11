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
const { submitSignIn } = require('../shared/passphrase-accounts.cjs')
const expect = baseExpect.configure({ timeout: 15000 })

const origin = process.env.FLARE_SECURITY_TEST_ORIGIN || 'http://localhost:3061'
const target = new URL(origin)
if (target.hostname !== 'localhost' || target.protocol !== 'http:') {
  throw new Error(
    'Use the disposable HTTP localhost security demonstration server.'
  )
}
const secret = 'public-disposable-security-demo-secret-2026-only'
// The seed gives the fixture account keys: this is its passphrase.
const passphrase = 'Security-demo-only-2026!'
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
  const securityMutations = []
  page.on('request', (request) => {
    const pathname = new URL(request.url()).pathname
    if (request.method() === 'PUT' && pathname === '/api/profile')
      mutations.push(request)
    if (
      !['GET', 'HEAD'].includes(request.method()) &&
      pathname.startsWith('/api/auth/security/')
    )
      securityMutations.push(request)
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
    async function login(email, code) {
      await context.clearCookies()
      const method = await submitSignIn(page, expect, {
        origin,
        email,
        secret: passphrase,
      })
      assert.equal(method, 'passphrase', 'The fixture account has keys')
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
      const status = await api('/api/auth/security')
      assert.equal(status.canUseRecentRecovery, false)
      assert.equal(status.canUseRecentPassphrase, false)
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

    await login(originalEmail)
    const initial = await api('/api/auth/security')
    assert.equal(
      initial.twoFactorEnabled,
      false,
      'Run scripts/security/seed.cjs before this regression check'
    )
    // The passphrase sign-in of a moment ago is the proof: no secret is sent.
    const setup = await api('/api/auth/security/totp/setup', {})
    const enrollment = await api('/api/auth/security/totp/enable', {
      challengeId: setup.challengeId,
      code: new TOTP({
        secret: setup.secret,
        digits: 6,
        period: 30,
        algorithm: 'SHA1',
      }).generate(),
    })

    await login(originalEmail, enrollment.recoveryCodes[0])
    await profile()
    // An account with keys has no password form to expire: its passphrase
    // changes by key rotation, which is signed and needs no recent sign-in
    // (scripts/e2ee/verify-ui.cjs covers it).
    const passphraseCard = page.locator('#password')
    await expect(passphraseCard).toContainText('Passphrase and recovery')
    await expect(
      passphraseCard.getByRole('button', { name: 'Change passphrase' })
    ).toBeVisible()
    await expect(passphraseCard.locator('input')).toHaveCount(0)

    const accountForm = page
      .locator('form')
      .filter({ has: page.locator('#username') })
    await accountForm
      .getByLabel('Email', { exact: true })
      .fill(replacementEmail)
    await expect(accountForm).toContainText('Your recent recovery code sign-in')
    const emailConfirmation = accountForm.locator(
      '[data-passphrase-confirmation]'
    )
    await expect(emailConfirmation).toHaveCount(0)
    await expireExistingProof()
    await accountForm
      .getByRole('button', { name: 'Save changes', exact: true })
      .click()
    await expect(accountForm.getByRole('alert').first()).toContainText(
      'Confirm your passphrase to continue.'
    )
    await expect(emailConfirmation).toBeVisible()
    await expect(
      emailConfirmation.getByLabel('Authenticator or recovery code', {
        exact: true,
      })
    ).toBeVisible()
    assert.equal(
      mutations.length,
      0,
      'Expired proof must reveal the passphrase confirmation before any email mutation'
    )
    await expect(accountForm.getByLabel('Email', { exact: true })).toHaveValue(
      replacementEmail
    )
    if (screenshotDirectory) {
      await mkdir(screenshotDirectory, { recursive: true })
      const bytes = await accountForm.screenshot({
        animations: 'disabled',
        maskColor: '#374151',
        mask: [emailConfirmation.locator('input')],
      })
      await sharp(bytes)
        .webp({ quality: 88 })
        .toFile(path.join(screenshotDirectory, 'proof-expired.webp'))
    }
    // The confirmation is a real passphrase sign-in in place. It spends the
    // recovery code, and the session it leaves is the fresh proof.
    await emailConfirmation
      .getByLabel('Passphrase', { exact: true })
      .fill(passphrase)
    await emailConfirmation
      .getByLabel('Authenticator or recovery code', { exact: true })
      .fill(enrollment.recoveryCodes[1])
    await emailConfirmation
      .getByRole('button', { name: 'Confirm passphrase', exact: true })
      .click()
    await expect(emailConfirmation).toHaveCount(0)
    assert.equal(mutations.length, 0)
    await expect(accountForm.getByLabel('Email', { exact: true })).toHaveValue(
      replacementEmail
    )
    await successfulSave(
      accountForm.getByRole('button', { name: 'Save changes', exact: true })
    )
    assert.equal(mutations.length, 1)

    await login(replacementEmail, enrollment.recoveryCodes[2])
    const optionalSecurity = await api('/api/auth/security')
    assert.equal(optionalSecurity.passkeyRequired, false)
    assert.equal(optionalSecurity.passkeysAvailable, true)
    const cdp = await context.newCDPSession(page)
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
    await profile()
    await page
      .locator('#sign-in-security')
      .getByRole('button', { name: 'Add a passkey', exact: true })
      .click()
    const dialog = page.getByRole('dialog')
    const passkeyName = 'Proof expiry demonstration key'
    await expect(dialog).toContainText('Your recent recovery code sign-in')
    const dialogConfirmation = dialog.locator('[data-passphrase-confirmation]')
    await expect(dialogConfirmation).toHaveCount(0)
    await expect(
      dialog.getByLabel('Authenticator code', { exact: true })
    ).toHaveCount(0)
    await dialog.getByLabel('Passkey name', { exact: true }).fill(passkeyName)
    await expireExistingProof()
    await dialog
      .getByRole('button', { name: 'Create passkey', exact: true })
      .click()
    await expect(dialog.getByRole('alert').first()).toContainText(
      'Confirm your passphrase to continue.'
    )
    await expect(dialogConfirmation).toBeVisible()
    await expect(
      dialogConfirmation.getByLabel('Authenticator or recovery code', {
        exact: true,
      })
    ).toBeVisible()
    assert.equal(
      securityMutations.length,
      0,
      'Expired dialog proof must restore the passphrase confirmation before any security mutation'
    )
    await expect(
      dialog.getByLabel('Passkey name', { exact: true })
    ).toHaveValue(passkeyName)
    await dialogConfirmation
      .getByLabel('Passphrase', { exact: true })
      .fill(passphrase)
    await dialogConfirmation
      .getByLabel('Authenticator or recovery code', { exact: true })
      .fill(enrollment.recoveryCodes[3])
    await dialogConfirmation
      .getByRole('button', { name: 'Confirm passphrase', exact: true })
      .click()
    await expect(dialogConfirmation).toHaveCount(0)
    assert.equal(securityMutations.length, 0)
    await expect(
      dialog.getByLabel('Passkey name', { exact: true })
    ).toHaveValue(passkeyName)
    const registrationResponses = Promise.all(
      [
        '/api/auth/security/passkeys/options',
        '/api/auth/security/passkeys/verify',
      ].map((route) =>
        page.waitForResponse(
          (response) =>
            response.request().method() === 'POST' &&
            new URL(response.url()).pathname === route
        )
      )
    )
    await dialog
      .getByRole('button', { name: 'Create passkey', exact: true })
      .click()
    for (const response of await registrationResponses) {
      assert.equal(response.status(), 200)
    }
    await expect(
      dialog.getByRole('heading', {
        name: 'Your security settings are updated',
      })
    ).toBeVisible()
    assert.equal(securityMutations.length, 2)
    await dialog
      .getByRole('button', { name: 'Sign in again', exact: true })
      .click()
    await page.waitForURL('**/auth/login*')
    await login(replacementEmail, enrollment.recoveryCodes[4])
    const savedSecurity = await api('/api/auth/security')
    assert.equal(savedSecurity.passkeyRequired, false)
    assert.ok(
      savedSecurity.passkeys.some((passkey) => passkey.name === passkeyName)
    )
    console.log(
      'PASS: controlled proof expiry reveals the passphrase confirmation in the email form and the passkey dialog before any mutation; entered values survive, each real confirmation spends a recovery code, and both retries succeed, including WebAuthn registration. An account with keys has no password form to expire.'
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
