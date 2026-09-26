/* eslint-disable @typescript-eslint/no-require-imports */
// Real UI regression checks. Use only a disposable local instance with the
// documented alex@example.test demo administrator; this changes Everyone briefly.
const assert = require('node:assert/strict')
const { mkdir } = require('node:fs/promises')
const path = require('node:path')
const {
  chromium,
  expect,
} = require('../../docs/site/node_modules/@playwright/test')

const origin = process.env.FLARE_ROLES_TEST_ORIGIN || 'http://127.0.0.1:3060'
if (!['127.0.0.1', 'localhost'].includes(new URL(origin).hostname))
  throw new Error('Use a disposable local instance.')
const password = 'Roles-demo-only-2026!'
const screenshotDirectory = process.env.FLARE_ROLES_UI_SCREENSHOTS
const results = []

async function api(context, route, method = 'GET', data, status = 200) {
  const response = await context.request.fetch(origin + route, {
    method,
    ...(data === undefined ? {} : { data }),
    headers: { Origin: origin },
  })
  const body = await response.text()
  assert.equal(response.status(), status, `${method} ${route}: ${body}`)
  return body ? JSON.parse(body) : null
}

async function login(browser, email) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    colorScheme: 'dark',
  })
  const page = await context.newPage()
  page.setDefaultTimeout(30000)
  await page.goto(origin + '/auth/login')
  await page.getByLabel('Email address', { exact: true }).fill(email)
  await page.getByLabel('Password', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await page.waitForURL('**/dashboard', { timeout: 90000 })
  return { context, page }
}

async function screenshot(page, name) {
  if (!screenshotDirectory) return
  // Dropdowns hide the background from accessibility tools, but the real header
  // must still be painted before capturing the whole page after a reload.
  const brand = page.locator('header a[aria-label="Go to your dashboard"]')
  await expect(brand).toBeVisible()
  await expect(brand).toContainText('Flare')
  await page.waitForFunction(() => {
    const brand = document.querySelector(
      'header a[aria-label="Go to your dashboard"]'
    )
    for (let element = brand; element; element = element.parentElement) {
      const style = getComputedStyle(element)
      if (Number(style.opacity) < 0.99 || style.visibility !== 'visible')
        return false
    }
    return (
      Boolean(brand) &&
      document
        .querySelector('header')
        .getAnimations({ subtree: true })
        .every((animation) => animation.playState !== 'running')
    )
  })
  await page.evaluate(async () => {
    await document.fonts.ready
    await Promise.all(
      document
        .getAnimations()
        .filter(
          (animation) =>
            animation.effect?.getComputedTiming().iterations !== Infinity
        )
        .map((animation) => animation.finished.catch(() => {}))
    )
    await new Promise((resolve) =>
      requestAnimationFrame(() =>
        requestAnimationFrame(() => requestAnimationFrame(resolve))
      )
    )
  })
  const sharp = require('../../docs/site/node_modules/sharp')
  await mkdir(screenshotDirectory, { recursive: true })
  await sharp(await page.screenshot())
    .webp({ quality: 90 })
    .toFile(path.join(screenshotDirectory, `${name}.webp`))
}

async function checkMenus(admin, member, role, file) {
  const page = member.page
  const menuButton = page.getByRole('button', {
    name: `Manage ${file.name}`,
    exact: true,
  })
  await page.reload()
  await expect(menuButton).toBeVisible()
  await expect(
    page.getByRole('button', {
      name: `Password protection for ${file.name}`,
      exact: true,
    })
  ).toHaveCount(1)
  await expect(
    page.getByRole('button', {
      name: `Manage expiration of ${file.name}`,
      exact: true,
    })
  ).toHaveCount(0)
  await menuButton.click()
  await expect(
    page.getByRole('menuitem', { name: 'Add password', exact: true })
  ).toBeVisible()
  await expect(
    page.getByRole('menuitem', { name: 'Manage expiration', exact: true })
  ).toHaveCount(0)
  await screenshot(page, 'share-only-menu')
  await page
    .getByRole('menuitem', { name: 'Add password', exact: true })
    .click()
  const passwordDialog = page.getByRole('dialog', { name: 'Protect this file' })
  await expect(passwordDialog).toBeVisible()
  await passwordDialog
    .getByLabel('Password', { exact: true })
    .fill('Public-demo-file-password')
  const passwordResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === `/api/files/${file.id}` &&
      response.request().method() === 'PATCH'
  )
  await passwordDialog
    .getByRole('button', { name: 'Add password', exact: true })
    .click()
  assert.equal((await passwordResponse).status(), 200)
  await expect(passwordDialog).toBeHidden()
  const sharedFile = (await api(member.context, '/api/files')).data.find(
    (item) => item.id === file.id
  )
  assert.equal(sharedFile.hasPassword, true)
  results.push(
    'Sharing without file editing exposes password controls in hover and menu, saves a real password, and hides expiration'
  )

  await api(admin.context, `/api/roles/${role.id}`, 'PATCH', {
    name: 'File editor review',
    permissions: ['files.read', 'files.upload', 'files.update'],
  })
  await page.reload()
  await expect(menuButton).toBeVisible()
  await expect(
    page.getByRole('button', {
      name: `Password protection for ${file.name}`,
      exact: true,
    })
  ).toHaveCount(0)
  await expect(
    page.getByRole('button', {
      name: `Manage expiration of ${file.name}`,
      exact: true,
    })
  ).toHaveCount(1)
  await menuButton.click()
  await expect(
    page.getByRole('menuitem', { name: 'Manage expiration', exact: true })
  ).toBeVisible()
  await expect(page.getByRole('menuitem', { name: /password/ })).toHaveCount(0)
  await screenshot(page, 'edit-only-menu')
  await page
    .getByRole('menuitem', { name: 'Manage expiration', exact: true })
    .click()
  const expiryDialog = page.getByRole('dialog', { name: 'Manage expiration' })
  await expect(expiryDialog).toBeVisible()
  await expect(
    expiryDialog.getByRole('button', { name: 'Delete file', exact: true })
  ).toBeDisabled()
  await expect(
    expiryDialog.getByRole('button', { name: 'Set to private', exact: true })
  ).toBeDisabled()
  const expiryResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === `/api/files/${file.id}/expiry` &&
      response.request().method() === 'DELETE'
  )
  await expiryDialog
    .getByRole('button', { name: 'Remove Expiration', exact: true })
    .click()
  assert.equal((await expiryResponse).status(), 200)
  await expect(expiryDialog).toBeHidden()
  results.push(
    'Editing without sharing exposes expiration in hover and menu, permits cancellation, disables unavailable scheduled actions, and hides passwords'
  )
}

async function checkSessionRevocation(admin, member, user) {
  const page = admin.page
  await page.goto(origin + '/dashboard/users')
  await page.getByPlaceholder('Search by name or email…').fill(user.email)
  await page
    .getByRole('button', {
      name: `Revoke sessions for ${user.name}`,
      exact: true,
    })
    .click()
  const dialog = page.getByRole('alertdialog', {
    name: `Sign out ${user.name}?`,
  })
  const confirm = dialog.getByRole('button', {
    name: 'Revoke sessions',
    exact: true,
  })
  const sessionRoute = `${origin}/api/users/${user.id}/sessions`

  // Explicit fault injection checks client recovery; these two failures are
  // browser-simulated, not evidence of real server authorization decisions.
  await page.route(
    sessionRoute,
    (route) =>
      route.fulfill({
        status: 403,
        contentType: 'text/plain',
        body: 'Permission denied',
      }),
    { times: 1 }
  )
  await confirm.click()
  await expect(
    page.getByText('Could not revoke sessions.', { exact: true })
  ).toBeVisible()
  await expect(dialog).toBeVisible()
  await expect(confirm).toBeEnabled()
  await page.route(
    sessionRoute,
    (route) =>
      route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({
          error: 'Your role no longer allows managing this account.',
        }),
      }),
    { times: 1 }
  )
  await confirm.click()
  await expect(
    page.getByText('Your role no longer allows managing this account.', {
      exact: true,
    })
  ).toBeVisible()
  await expect(dialog).toBeVisible()
  await expect(confirm).toBeEnabled()
  results.push(
    'Simulated plain-text and JSON failures retain confirmation, explain the failure, and allow retry'
  )
  // The one-shot fault routes have expired: this operation reaches Flare.
  const revoked = page.waitForResponse(
    (response) =>
      response.url() === sessionRoute &&
      response.request().method() === 'DELETE'
  )
  await confirm.click()
  const response = await revoked
  assert.equal(response.status(), 204)
  // HTTP 204 has no body; assert the UI result instead of asking Chromium to
  // read a response body or completion event that it does not expose here.
  await expect(dialog).toBeHidden()
  await expect(
    page.getByText('Sessions revoked', { exact: true })
  ).toBeVisible()
  await expect(
    page.getByText(`${user.name} will need to sign in again.`, { exact: true })
  ).toBeVisible()
  await screenshot(page, 'sessions-revoked')
  const session = await api(member.context, '/api/auth/session')
  assert(
    !session.user,
    'The revoked browser must no longer have an authenticated user'
  )
  results.push(
    'Real empty 204 revocation closes confirmation, shows success, and invalidates the affected browser session'
  )
}

async function main() {
  const browser = await chromium.launch({
    headless: true,
    args: ['--disable-gpu'],
    ...(process.env.PW_CHROMIUM_EXECUTABLE_PATH
      ? {
          executablePath: process.env.PW_CHROMIUM_EXECUTABLE_PATH,
        }
      : {}),
  })
  let admin, everyone, role, user
  let failure
  const cleanupErrors = []
  try {
    admin = await login(browser, 'alex@example.test')
    const session = await api(admin.context, '/api/auth/session')
    assert(session.user.permissions.includes('administrator'))
    everyone = (await api(admin.context, '/api/roles')).roles.find(
      (item) => item.systemKey === 'everyone'
    )
    assert(everyone, 'Everyone must exist')
    role = await api(
      admin.context,
      '/api/roles',
      'POST',
      {
        name: 'File sharing review',
        description: 'Disposable UI regression fixture.',
        color: '#8b5cf6',
        position: 20,
        permissions: ['files.read', 'files.upload', 'files.share'],
      },
      201
    )
    user = (
      await api(admin.context, '/api/users', 'POST', {
        name: 'Morgan Lee',
        email: `morgan-ui-${Date.now().toString(36)}@example.test`,
        password,
        roleIds: [role.id],
      })
    ).data
    await api(admin.context, `/api/roles/${everyone.id}`, 'PATCH', {
      permissions: [],
    })
    const member = await login(browser, user.email)
    const upload = await member.context.request.post(origin + '/api/files', {
      multipart: {
        file: {
          name: 'permission-menu.txt',
          mimeType: 'text/plain',
          buffer: Buffer.from('A disposable file for permission checks.\n'),
        },
        visibility: 'PUBLIC',
      },
    })
    assert.equal(upload.status(), 200, await upload.text())
    const file = (await api(member.context, '/api/files')).data.find(
      (item) => item.name === 'permission-menu.txt'
    )
    assert(file)
    await checkMenus(admin, member, role, file)
    await checkSessionRevocation(admin, member, user)
  } catch (error) {
    failure = error
  } finally {
    // Always restore baseline grants, even when an assertion or request fails.
    // Keep cleanup independent so one failed delete cannot prevent restoration.
    const cleanup = []
    if (admin && everyone)
      cleanup.push(() =>
        api(admin.context, `/api/roles/${everyone.id}`, 'PATCH', {
          permissions: everyone.permissions,
        })
      )
    if (admin && user)
      cleanup.push(() =>
        api(admin.context, `/api/users/${user.id}`, 'DELETE', undefined, 204)
      )
    if (admin && role)
      cleanup.push(() => api(admin.context, `/api/roles/${role.id}`, 'DELETE'))
    for (const action of cleanup) {
      try {
        await action()
      } catch (error) {
        cleanupErrors.push(error)
      }
    }
    await browser.close()
    if (cleanupErrors.length)
      throw new AggregateError(
        [...(failure ? [failure] : []), ...cleanupErrors],
        'Fixture cleanup failed; inspect the disposable instance before reuse.'
      )
  }
  if (failure) throw failure
  console.log(
    JSON.stringify(
      {
        ok: true,
        checks: results,
        ...(screenshotDirectory ? { screenshotDirectory } : {}),
      },
      null,
      2
    )
  )
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
