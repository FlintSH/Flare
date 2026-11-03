/* eslint-disable @typescript-eslint/no-require-imports */
// Real browser checks for the dashboard bar: its places, the Admin menu, the
// account menu, and the navigation sheet on narrow screens. Use only a
// disposable local instance with the documented alex@example.test demo
// administrator. The script creates two roles and three accounts, and removes
// them again when it finishes.
const assert = require('node:assert/strict')
const { mkdir } = require('node:fs/promises')
const path = require('node:path')
const {
  chromium,
  expect,
} = require('../../docs/site/node_modules/@playwright/test')
const sharp = require('../../docs/site/node_modules/sharp')

const origin =
  process.env.FLARE_NAVIGATION_TEST_ORIGIN || 'http://127.0.0.1:3060'
if (!['127.0.0.1', 'localhost'].includes(new URL(origin).hostname))
  throw new Error('Use a disposable local instance.')
const password =
  process.env.FLARE_NAVIGATION_PASSWORD || 'Roles-demo-only-2026!'
const screenshotDirectory = process.env.FLARE_NAVIGATION_SCREENSHOTS
const workspace = ['Files', 'Upload', 'Paste', 'Links']
const desktop = { width: 1440, height: 900 }
const results = []

function pass(check) {
  results.push(check)
  console.log(`PASS: ${check}`)
}

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
    viewport: desktop,
    colorScheme: 'dark',
    // Captures are shown scaled down in the handbook; keep them sharp.
    deviceScaleFactor: screenshotDirectory ? 2 : 1,
  })
  const page = await context.newPage()
  page.setDefaultTimeout(30000)
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(origin + '/auth/login')
  await page.getByLabel('Email address', { exact: true }).fill(email)
  await page.getByLabel('Password', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await page.waitForURL('**/dashboard', { timeout: 90000 })
  return { context, page, errors }
}

function bar(page) {
  return page.getByRole('navigation', { name: 'Main navigation' })
}

async function open(page, route) {
  await page.goto(origin + route)
  await expect(bar(page)).toBeVisible()
}

// After choosing a place, wait for its page and for the closing menu's exit
// animation: a click during that animation would reach the old menu.
async function arrive(page, route, title) {
  await page.waitForURL(`**${route}`)
  await expect(
    page.getByRole('heading', { level: 1, name: title })
  ).toBeVisible()
  await expect(page.getByRole('menu')).toHaveCount(0)
}

// Desktop captures frame the bar and any open menu; phone captures keep the
// whole screen.
async function screenshot(page, name) {
  if (!screenshotDirectory) return
  await mkdir(screenshotDirectory, { recursive: true })
  await page.addStyleTag({
    content: 'nextjs-portal { display: none !important; }',
  })
  await page.evaluate(() => document.fonts.ready)
  // Let the menu finish its entrance animation before capturing it.
  await page.waitForTimeout(400)
  const viewport = page.viewportSize()
  let clip
  if (viewport.width >= 1024) {
    const frame = await page
      .locator('header > div.relative > div')
      .boundingBox()
    const menu = page.getByRole('menu')
    const lowest = (await menu.count())
      ? await menu.boundingBox().then((box) => box.y + box.height)
      : frame.y + frame.height
    clip = {
      x: Math.max(0, frame.x - 24),
      y: 0,
      width: Math.min(viewport.width, frame.width + 48),
      height: Math.ceil(lowest + 24),
    }
  }
  await sharp(await page.screenshot({ animations: 'disabled', clip }))
    .webp({ quality: 90 })
    .toFile(path.join(screenshotDirectory, `${name}.webp`))
}

// Hints are each item's description, so the first line is the label.
async function menuItemNames(page) {
  await expect(page.getByRole('menu')).toBeVisible()
  const texts = await page
    .getByRole('menu')
    .getByRole('menuitem')
    .allInnerTexts()
  return texts.map((text) => text.split('\n')[0].trim())
}

async function accessibility(page, label) {
  await page.addScriptTag({
    path: path.join(
      __dirname,
      '../../docs/site/node_modules/axe-core/axe.min.js'
    ),
  })
  // Check the bar and whatever it opened, not the page underneath.
  const violations = await page.evaluate(async () => {
    const include = [
      'nav[aria-label="Main navigation"]',
      'button[aria-label="Account menu"]',
      '[role="menu"]',
      '[role="dialog"]',
    ]
      .filter((selector) => document.querySelector(selector))
      .map((selector) => [selector])
    const result = await window.axe.run(
      { include },
      { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] } }
    )
    return result.violations
      .filter(({ impact }) => ['serious', 'critical'].includes(impact))
      .map(({ id, nodes }) => ({ id, targets: nodes.map((n) => n.target) }))
  })
  assert.deepEqual(violations, [], `${label}: serious accessibility issues`)
}

async function checkPlaces(page, { admin, direct = [] }) {
  const nav = bar(page)
  for (const name of workspace)
    await expect(nav.getByRole('link', { name, exact: true })).toBeVisible()
  await expect(
    nav.getByRole('link', { name: 'Profile', exact: true })
  ).toHaveCount(0)
  await expect(
    nav.getByRole('button', { name: 'Admin', exact: true })
  ).toHaveCount(admin ? 1 : 0)
  for (const name of direct)
    await expect(nav.getByRole('link', { name, exact: true })).toBeVisible()
  const adminLinks = await nav
    .locator(
      'a[href="/dashboard/users"], a[href="/dashboard/roles"], a[href="/dashboard/audit"], a[href="/dashboard/settings"]'
    )
    .count()
  assert.equal(adminLinks, direct.length, 'Only direct admin links show')
}

async function checkAdministrator(page) {
  await open(page, '/dashboard')
  await checkPlaces(page, { admin: true })
  pass(
    'Administrators see Files, Upload, Paste, Links and one Admin menu; Profile is not in the bar'
  )

  const trigger = bar(page).getByRole('button', { name: 'Admin', exact: true })
  await trigger.click()
  await expect(page.getByRole('menu')).toBeVisible()
  assert.deepEqual(await menuItemNames(page), [
    'Users',
    'Roles',
    'Audit log',
    'Settings',
  ])
  await expect(
    page.getByRole('menuitem', { name: 'Users', exact: true })
  ).toHaveAccessibleDescription('Accounts and invite links')
  await accessibility(page, 'Admin menu open')
  await screenshot(page, 'admin-menu')
  pass(
    'The Admin menu lists Users, Roles, Audit log and Settings; each hint is the item’s description'
  )

  // The menu is not modal: one click on another place goes straight there.
  await bar(page).getByRole('link', { name: 'Links', exact: true }).click()
  await arrive(page, '/dashboard/urls', 'Short links')
  await expect(page.getByRole('menu')).toHaveCount(0)
  pass('With the Admin menu open, one click on Links opens Links')

  const account = page.getByRole('button', { name: 'Account menu' })
  await account.click()
  assert.deepEqual(await menuItemNames(page), ['Profile', 'Sign out'])
  await expect(page.getByRole('menu')).toHaveAccessibleName(
    /alex@example\.test/
  )
  await accessibility(page, 'Account menu open')
  await screenshot(page, 'account-menu')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('menu')).toHaveCount(0)
  await expect(account).toBeFocused()
  pass(
    'The avatar opens an account menu with the account, Profile and Sign out'
  )

  await trigger.click()
  await page.getByRole('menuitem', { name: 'Roles', exact: true }).click()
  await arrive(page, '/dashboard/roles', 'Roles')
  await expect(trigger).toHaveAttribute('aria-current', 'true')
  // A mouse choice doesn't hand focus back to the button (no stray ring).
  await expect(trigger).not.toBeFocused()
  await trigger.click()
  await expect(
    page.getByRole('menuitem', { name: 'Roles', exact: true })
  ).toHaveAttribute('aria-current', 'page')
  await page.keyboard.press('Escape')
  await expect(
    bar(page).locator('a[aria-current="page"]'),
    'No place in the bar is current on Roles'
  ).toHaveCount(0)
  pass(
    'On Roles, the Admin button is marked current, Roles is the page, and a mouse choice leaves no focus ring'
  )

  // Keyboard: open with Enter, move with the arrow keys, close with Escape.
  // The closing menu stays mounted for its exit animation; wait it out.
  await expect(page.getByRole('menu')).toHaveCount(0)
  await expect(trigger).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(
    page.getByRole('menuitem', { name: 'Users', exact: true })
  ).toBeFocused()
  await page.keyboard.press('ArrowDown', { delay: 80 })
  await expect(
    page.getByRole('menuitem', { name: 'Roles', exact: true })
  ).toBeFocused()
  await page.keyboard.press('End', { delay: 80 })
  await expect(
    page.getByRole('menuitem', { name: 'Settings', exact: true })
  ).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('menu')).toHaveCount(0)
  await expect(trigger).toBeFocused()
  await trigger.focus()
  await page.keyboard.press('Enter')
  await expect(
    page.getByRole('menuitem', { name: 'Users', exact: true })
  ).toBeFocused()
  await page.keyboard.press('ArrowUp', { delay: 80 })
  await expect(
    page.getByRole('menuitem', { name: 'Settings', exact: true })
  ).toBeFocused()
  await page.keyboard.press('Enter')
  await page.waitForURL('**/dashboard/settings')
  pass(
    'The Admin menu opens with Enter, moves with arrow keys, returns focus on Escape, and follows Enter'
  )

  // Five places need 900 px beside the brand.
  await page.setViewportSize({ width: 899, height: 1024 })
  await open(page, '/dashboard')
  await expect(
    page.getByRole('button', { name: 'Open navigation', exact: true })
  ).toBeVisible()
  await expect(
    bar(page).getByRole('link', { name: 'Files', exact: true })
  ).toBeHidden()
  await page.setViewportSize({ width: 900, height: 900 })
  await expect(
    bar(page).getByRole('button', { name: 'Admin', exact: true })
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Open navigation', exact: true })
  ).toBeHidden()
  pass('Administrators get the full bar from 900 px and the sheet below it')

  await page.setViewportSize({ width: 390, height: 844 })
  await open(page, '/dashboard')
  await page.getByRole('button', { name: 'Open navigation' }).click()
  const sheet = page.getByRole('dialog', { name: 'Navigation' })
  await expect(sheet).toBeVisible()
  for (const name of [...workspace, 'Users', 'Roles', 'Audit log', 'Settings'])
    await expect(sheet.getByRole('link', { name, exact: true })).toBeVisible()
  await expect(
    sheet.getByRole('heading', { name: 'Admin', exact: true })
  ).toBeVisible()
  await expect(
    sheet.getByRole('heading', { name: 'Account', exact: true })
  ).toBeVisible()
  await expect(
    sheet.getByRole('link', { name: 'Profile', exact: true })
  ).toBeVisible()
  await expect(
    sheet.getByRole('button', { name: 'Sign out', exact: true })
  ).toBeVisible()
  await expect(
    sheet.getByRole('link', { name: 'Files', exact: true })
  ).toHaveAttribute('aria-current', 'page')
  await accessibility(page, 'Navigation sheet open')
  await screenshot(page, 'mobile-sheet')
  await sheet.getByRole('link', { name: 'Audit log', exact: true }).click()
  await page.waitForURL('**/dashboard/audit')
  await expect(sheet).toBeHidden()
  pass(
    'On a phone, the sheet groups admin pages under Admin, adds Profile and Sign out under Account, and closes after choosing a page'
  )
  await page.setViewportSize(desktop)
}

async function checkModerator(page) {
  await open(page, '/dashboard/users')
  await checkPlaces(page, { admin: true })
  const trigger = bar(page).getByRole('button', { name: 'Admin', exact: true })
  await expect(trigger).toHaveAttribute('aria-current', 'true')
  await trigger.click()
  assert.deepEqual(await menuItemNames(page), ['Users', 'Audit log'])
  await expect(
    page.getByRole('menuitem', { name: 'Users', exact: true })
  ).toHaveAccessibleDescription('Accounts on this instance')
  await screenshot(page, 'moderator-menu')
  await page.keyboard.press('Escape')
  pass('An account with users.read and audit.read gets an Admin menu of two')
}

async function checkReviewer(page) {
  await open(page, '/dashboard/audit')
  await checkPlaces(page, { admin: false, direct: ['Audit log'] })
  await expect(
    bar(page).getByRole('link', { name: 'Audit log', exact: true })
  ).toHaveAttribute('aria-current', 'page')
  await screenshot(page, 'single-admin-page')
  pass('A single administration page sits in the bar as an ordinary link')
}

async function checkMember(member, email) {
  const { page } = member
  await open(page, '/dashboard')
  await checkPlaces(page, { admin: false })
  await screenshot(page, 'member-bar')
  pass('Members without administration permissions see only their own places')

  await page.setViewportSize({ width: 768, height: 1024 })
  await open(page, '/dashboard')
  await expect(
    bar(page).getByRole('link', { name: 'Files', exact: true })
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Open navigation', exact: true })
  ).toHaveCount(0)
  await page.setViewportSize({ width: 767, height: 1024 })
  await expect(
    page.getByRole('button', { name: 'Open navigation', exact: true })
  ).toBeVisible()
  pass('Four places fit in the bar from 768 px')
  await page.setViewportSize(desktop)

  const account = page.getByRole('button', { name: 'Account menu' })
  await account.click()
  const menu = page.getByRole('menu')
  await expect(menu).toContainText('Navigation Member')
  await expect(menu).toContainText(email)
  assert.deepEqual(await menuItemNames(page), ['Profile', 'Sign out'])
  await page.getByRole('menuitem', { name: 'Profile', exact: true }).click()
  await arrive(page, '/dashboard/profile', 'Profile')
  await expect(account).toHaveAttribute('aria-current', 'true')
  pass(
    'The account menu names its account, opens Profile, and marks itself current there'
  )

  await account.click()
  await page.getByRole('menuitem', { name: 'Sign out', exact: true }).click()
  // The local form, which never redirects to an SSO provider.
  await page.waitForURL(
    (url) =>
      url.pathname === '/auth/login' && url.searchParams.get('local') === '1'
  )
  const session = await api(member.context, '/api/auth/session')
  assert.equal(session?.user, undefined, 'Signed out')
  pass('Sign out in the account menu ends the session')
}

async function main() {
  const browser = await chromium.launch({
    headless: true,
    args: ['--disable-gpu'],
    ...(process.env.PW_CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: process.env.PW_CHROMIUM_EXECUTABLE_PATH }
      : {}),
  })
  const stamp = Date.now().toString(36)
  const roles = []
  const users = []
  const sessions = []
  let admin
  let failure
  const cleanupErrors = []
  try {
    admin = await login(browser, 'alex@example.test')
    sessions.push(admin)
    const session = await api(admin.context, '/api/auth/session')
    assert(session.user.permissions.includes('administrator'))
    const role = async (name, permissions, position) => {
      const created = await api(
        admin.context,
        '/api/roles',
        'POST',
        {
          name: `${name} ${stamp}`,
          description: 'Disposable navigation fixture.',
          color: '#0ea5e9',
          position,
          permissions,
        },
        201
      )
      roles.push(created)
      return created
    }
    const user = async (name, roleIds) => {
      const created = (
        await api(admin.context, '/api/users', 'POST', {
          name,
          email: `navigation-${name.split(' ')[1].toLowerCase()}-${stamp}@example.test`,
          password,
          roleIds,
        })
      ).data
      users.push(created)
      return created
    }
    const moderatorRole = await role(
      'Navigation moderators',
      ['users.read', 'audit.read'],
      21
    )
    const reviewerRole = await role('Navigation reviewers', ['audit.read'], 20)
    const moderator = await user('Navigation Moderator', [moderatorRole.id])
    const reviewer = await user('Navigation Reviewer', [reviewerRole.id])
    const member = await user('Navigation Member', [])

    await checkAdministrator(admin.page)
    const moderatorSession = await login(browser, moderator.email)
    sessions.push(moderatorSession)
    await checkModerator(moderatorSession.page)
    const reviewerSession = await login(browser, reviewer.email)
    sessions.push(reviewerSession)
    await checkReviewer(reviewerSession.page)
    const memberSession = await login(browser, member.email)
    sessions.push(memberSession)
    await checkMember(memberSession, member.email)

    for (const { errors } of sessions)
      assert.deepEqual(errors, [], 'Browser runtime errors')
    pass('No browser runtime errors')
  } catch (error) {
    failure = error
  } finally {
    // Keep cleanup steps independent so one failure cannot strand the rest.
    for (const user of users)
      try {
        await api(
          admin.context,
          `/api/users/${user.id}`,
          'DELETE',
          undefined,
          204
        )
      } catch (error) {
        cleanupErrors.push(error)
      }
    for (const role of roles)
      try {
        await api(admin.context, `/api/roles/${role.id}`, 'DELETE')
      } catch (error) {
        cleanupErrors.push(error)
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
