/* eslint-disable @typescript-eslint/no-require-imports */
// Exercise the real local application. Use only scripts/invites/seed.cjs fixtures.
const assert = require('node:assert/strict')
const { mkdir } = require('node:fs/promises')
const path = require('node:path')
const {
  chromium,
  expect: baseExpect,
} = require('../../docs/site/node_modules/@playwright/test')
const sharp = require('../../docs/site/node_modules/sharp')
const expect = baseExpect.configure({ timeout: 45000 })
const origin = process.env.FLARE_INVITES_TEST_ORIGIN || 'http://localhost:3073'
if (new URL(origin).hostname !== 'localhost')
  throw new Error('Use a disposable localhost instance.')
const screenshots = process.env.FLARE_INVITES_SCREENSHOTS
const videos = process.env.FLARE_INVITES_VIDEOS
const password = 'Invite-demo-only-2026!'
const results = []
let address = 10

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
  return response.json().catch(() => null)
}
async function login(ctx, user) {
  const csrf = await api(ctx, '/api/auth/csrf')
  const response = await ctx.request.post(
    origin + '/api/auth/callback/credentials',
    {
      form: {
        csrfToken: csrf.csrfToken,
        email: `invite-demo-${user}@example.test`,
        password,
        json: 'true',
        callbackUrl: origin + '/dashboard',
      },
      headers: { Origin: origin },
    }
  )
  const result = await response.json()
  assert.ok(!result.url.includes('error='), 'Fixture sign-in failed')
}
async function context(browser, { recorded = false, mobile = false } = {}) {
  const ctx = await browser.newContext({
    viewport: mobile
      ? { width: 390, height: 844 }
      : { width: 1440, height: 1000 },
    colorScheme: 'dark',
    reducedMotion: 'reduce',
    permissions: ['clipboard-read', 'clipboard-write'],
    // Registration is rate-limited per client address. These reserved
    // documentation addresses only separate fixture visitors on localhost.
    extraHTTPHeaders: { 'X-Forwarded-For': `198.51.100.${address++}` },
    ...(recorded && videos
      ? { recordVideo: { dir: videos, size: { width: 1440, height: 1000 } } }
      : {}),
  })
  await ctx.addInitScript(
    ({ conceal }) => {
      const install = () => {
        if (!document.documentElement) return
        const style = document.createElement('style')
        // Captures blur the one-time invite token; every other control is real.
        style.textContent = `nextjs-portal { display: none !important; }${
          conceal
            ? ' #created-invite-link { color: transparent !important; text-shadow: 0 0 7px hsl(var(--foreground)) !important; }'
            : ''
        }`
        document.documentElement.appendChild(style)
      }
      if (document.documentElement) install()
      else new MutationObserver(install).observe(document, { childList: true })
    },
    { conceal: Boolean(screenshots || videos) }
  )
  return ctx
}
async function shot(page, name, locator) {
  if (!screenshots) {
    if (videos) await page.waitForTimeout(1300)
    return
  }
  await mkdir(screenshots, { recursive: true })
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(250)
  const bytes = locator
    ? await locator.screenshot({ animations: 'disabled' })
    : await page.screenshot({ animations: 'disabled' })
  await sharp(bytes)
    .webp({ quality: 88 })
    .toFile(path.join(screenshots, `${name}.webp`))
}
async function pause(page, milliseconds = 1400) {
  if (videos) await page.waitForTimeout(milliseconds)
}
// Recordings type visibly so viewers can follow; verification runs stay fast.
async function type(locator, text) {
  if (videos) await locator.pressSequentially(text, { delay: 45 })
  else await locator.fill(text)
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
async function choose(page, label, option) {
  await page.getByLabel(label, { exact: true }).click()
  await page.getByRole('option', { name: option, exact: true }).click()
}
async function register(page, link, name, email) {
  await page.goto(link)
  await expect(
    page.getByRole('heading', { name: 'You’re invited' })
  ).toBeVisible()
  await type(page.getByLabel('Username'), name)
  await type(page.getByLabel('Email address'), email)
  await type(page.getByLabel('Password', { exact: true }), password)
  await type(page.getByLabel('Confirm password'), password)
  await pause(page, 900)
  await page.getByRole('button', { name: 'Create account' }).click()
  await page.waitForURL('**/dashboard', { timeout: 45000 })
}

async function adminFlow(browser) {
  const admin = await context(browser, { recorded: true })
  await login(admin, 'alex')
  const page = await admin.newPage()
  page.setDefaultTimeout(45000)

  // Settings → Access: let every account invite people.
  await page.goto(origin + '/dashboard/settings?section=access#invites')
  const card = page.locator('#invites')
  await expect(card).toContainText('Let everyone create invites')
  await card.scrollIntoViewIfNeeded()
  await pause(page)
  const everyone = card.getByRole('switch', {
    name: 'Let everyone create invites',
  })
  await expect(everyone).not.toBeChecked()
  await everyone.click()
  await expect(
    page.getByText('You have unsaved instance settings')
  ).toBeVisible()
  await pause(page)
  await page.getByRole('button', { name: 'Save settings' }).click()
  await expect(
    page.getByText('Your instance settings are saved.', { exact: true })
  ).toBeVisible()
  await expect(everyone).toBeChecked()
  await pause(page, 600)
  await shot(page, 'settings-invites', card)
  const policy = await api(admin, '/api/settings/invites')
  assert.deepEqual(policy, {
    everyoneCanInvite: true,
    limits: { activeInvites: 5, usesPerInvite: 1, lifetimeDays: 30 },
  })

  // Users → Invites: create a role-granting invite and copy its link.
  await page.goto(origin + '/dashboard/users')
  await page.getByRole('tab', { name: 'Invites' }).click()
  await expect(page).toHaveURL(/tab=invites/)
  await expect(page.getByText('No invites yet')).toBeVisible()
  await pause(page)
  await page.getByRole('button', { name: 'Create invite' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText('Create an invite link')
  await type(dialog.getByLabel('Note (optional)'), 'For Sam Rivera')
  await choose(page, 'Expires after', '7 days')
  const adminRole = dialog.getByRole('checkbox', { name: 'Admin' })
  await adminRole.check()
  await expect(dialog.getByRole('alert')).toContainText(
    'becomes a full administrator'
  )
  await pause(page, 2200)
  await adminRole.uncheck()
  await expect(dialog.getByRole('alert')).toHaveCount(0)
  await dialog.getByRole('checkbox', { name: 'Moderator' }).check()
  await pause(page)
  await shot(page, 'create-invite', dialog)
  await dialog.getByRole('button', { name: 'Create invite link' }).click()
  await expect(dialog).toContainText('Your invite link is ready')
  const link = await dialog.getByLabel('Invite link').inputValue()
  assert.match(
    link,
    new RegExp(
      `^${origin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/auth/register\\?invite=[A-Za-z0-9_-]{43}$`
    )
  )
  await pause(page)
  await dialog.getByRole('button', { name: 'Copy link' }).click()
  await expect(dialog.getByRole('button', { name: 'Copied' })).toBeVisible()
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), link)
  await expect(dialog).toContainText('Single use')
  await expect(dialog).toContainText('Grants Moderator')
  await shot(page, 'invite-ready', dialog)
  await pause(page)
  await dialog.getByRole('button', { name: 'Done' }).click()
  const row = page.getByRole('listitem').filter({ hasText: 'For Sam Rivera' })
  await expect(row).toContainText('Active')
  await expect(row).toContainText('0 of 1 use')
  await expect(row).toContainText('Moderator')
  await pause(page, 2500)
  await finish(admin, page, 'admin-invite')
  results.push({ check: 'admin creates a role-granting invite', ok: true })
  return link
}

async function joinFlow(browser, link) {
  const visitor = await context(browser, { recorded: true })
  const page = await visitor.newPage()
  page.setDefaultTimeout(45000)
  await page.goto(link)
  await expect(
    page.getByRole('heading', { name: 'You’re invited' })
  ).toBeVisible()
  await expect(page.getByText('Alex Morgan invited you to join')).toBeVisible()
  await expect(page.getByText('You’ll join with these roles:')).toBeVisible()
  await expect(page.locator('form')).toContainText('Moderator')
  await shot(page, 'register-invite')
  await pause(page)
  await register(page, link, 'Sam Rivera', 'sam@invite-demo.example')
  await expect(page.getByRole('link', { name: 'Users' })).toBeVisible()
  await pause(page, 2500)
  await finish(visitor, page, 'join-with-invite')

  // The single-use link is now spent, and a closed instance says so clearly.
  const late = await context(browser)
  const latePage = await late.newPage()
  await latePage.goto(link)
  await expect(
    latePage.getByRole('heading', { name: 'Invite unavailable' })
  ).toBeVisible()
  await expect(
    latePage.getByText('This invite link has already been used.')
  ).toBeVisible()
  await shot(latePage, 'invite-used')
  await late.close()
  // Closed registration still hides the ordinary sign-up page.
  const anonymous = await context(browser)
  const closed = await anonymous.newPage()
  await closed.goto(origin + '/auth/register')
  await expect(
    closed.getByRole('heading', { name: 'Page not found' })
  ).toBeVisible()
  await expect(closed.getByLabel('Username')).toHaveCount(0)
  await api(
    anonymous,
    '/api/auth/register',
    'POST',
    { name: 'No Invite', email: 'none@invite-demo.example', password },
    404
  )
  await anonymous.close()
  results.push({ check: 'invitee joins and the link is spent', ok: true })
}

async function memberFlow(browser) {
  const member = await context(browser, { recorded: true })
  await login(member, 'jamie')
  const page = await member.newPage()
  page.setDefaultTimeout(45000)
  await page.goto(origin + '/dashboard/profile?section=invites')
  await expect(page.getByRole('heading', { name: 'Invites' })).toBeVisible()
  const limits = page.getByTestId('invite-limits')
  await expect(limits).toContainText('up to 5 active invites')
  await expect(limits).toContainText('works once')
  await pause(page)
  await page.getByRole('button', { name: 'Create invite' }).click()
  const dialog = page.getByRole('dialog')
  await type(dialog.getByLabel('Note (optional)'), 'For Priya')
  await page.getByLabel('Uses', { exact: true }).click()
  await expect(page.getByRole('option')).toHaveText(['1 person'])
  await page.keyboard.press('Escape')
  await page.getByLabel('Expires after', { exact: true }).click()
  await expect(page.getByRole('option', { name: 'Never' })).toHaveCount(0)
  await expect(page.getByRole('option', { name: '90 days' })).toHaveCount(0)
  await page.getByRole('option', { name: '1 day', exact: true }).click()
  await expect(dialog.getByText('Roles for new accounts')).toHaveCount(0)
  await pause(page)
  await dialog.getByRole('button', { name: 'Create invite link' }).click()
  await expect(dialog).toContainText('Your invite link is ready')
  const link = await dialog.getByLabel('Invite link').inputValue()
  await dialog.getByRole('button', { name: 'Copy link' }).click()
  await expect(dialog.getByRole('button', { name: 'Copied' })).toBeVisible()
  await pause(page)
  await dialog.getByRole('button', { name: 'Done' }).click()
  await expect(
    page.getByRole('listitem').filter({ hasText: 'For Priya' })
  ).toContainText('Active')
  await pause(page, 2500)
  await finish(member, page, 'member-invites')

  // Members cannot exceed the instance limits, even through the API.
  const direct = await context(browser)
  await login(direct, 'jamie')
  await api(
    direct,
    '/api/invites',
    'POST',
    { maxUses: null, expiresInHours: 24 },
    400
  )
  await api(
    direct,
    '/api/invites',
    'POST',
    { maxUses: 1, expiresInHours: null },
    400
  )
  for (const note of ['Book club', 'Old roommate', 'Studio friend'])
    await api(
      direct,
      '/api/invites',
      'POST',
      { note, maxUses: 1, expiresInHours: 168 },
      201
    )
  await api(direct, '/api/invites?scope=all', 'GET', undefined, 403)
  await direct.close()
  results.push({ check: 'members invite within limits', ok: true })
  return link
}

async function profileViews(browser) {
  const desktop = await context(browser)
  await login(desktop, 'jamie')
  const page = await desktop.newPage()
  await page.goto(origin + '/dashboard/profile?section=invites')
  const list = page.getByRole('list', { name: 'Invites' })
  await expect(list.getByRole('listitem')).toHaveCount(4)
  await shot(page, 'profile-invites')
  await desktop.close()

  const mobile = await context(browser, { mobile: true })
  await login(mobile, 'jamie')
  const phone = await mobile.newPage()
  await phone.goto(origin + '/dashboard/profile?section=invites')
  await expect(
    phone.getByRole('list', { name: 'Invites' }).getByRole('listitem')
  ).toHaveCount(4)
  await noOverflow(phone)
  await shot(phone, 'profile-invites-mobile')
  await phone.getByRole('button', { name: 'Create invite' }).click()
  await expect(phone.getByRole('dialog')).toContainText('Create an invite link')
  await noOverflow(phone)
  await mobile.close()
  results.push({ check: 'profile invites fit desktop and phone', ok: true })
}

async function mobileJoin(browser, link) {
  const mobile = await context(browser, { mobile: true })
  const page = await mobile.newPage()
  await page.goto(link)
  await expect(page.getByText('Jamie Rivera invited you to join')).toBeVisible()
  await noOverflow(page)
  await shot(page, 'register-invite-mobile')
  await register(page, link, 'Priya Shah', 'priya@invite-demo.example')
  await mobile.close()
  results.push({ check: 'phone registration with a member invite', ok: true })
}

async function managementViews(browser) {
  const admin = await context(browser)
  await login(admin, 'alex')
  const page = await admin.newPage()
  page.setDefaultTimeout(45000)

  // Revoke one of Jamie's invites from the administrator's list.
  await page.goto(origin + '/dashboard/users?tab=invites')
  const revocable = page
    .getByRole('listitem')
    .filter({ hasText: 'Old roommate' })
  await expect(revocable).toContainText('Created by Jamie Rivera')
  await expect(
    revocable.getByRole('button', { name: /^Copy link/ })
  ).toHaveCount(0)
  await revocable.getByRole('button', { name: 'Revoke Old roommate' }).click()
  const confirm = page.getByRole('alertdialog')
  await expect(confirm).toContainText('stops working immediately')
  await shot(page, 'revoke-invite', confirm)
  await confirm.getByRole('button', { name: 'Revoke invite' }).click()
  await expect(page.getByText('Invite revoked', { exact: true })).toBeVisible()

  // Turning the Settings switch off pauses member links without deleting them.
  await api(
    admin,
    '/api/settings/invites',
    'PUT',
    { everyoneCanInvite: false },
    200
  )
  await page.goto(origin + '/dashboard/users?tab=invites')
  await choose(page, 'Show', 'All invites')
  const paused = page.getByRole('listitem').filter({ hasText: 'Book club' })
  await expect(paused).toContainText('Paused')
  await expect(
    page.getByRole('listitem').filter({ hasText: 'For Sam Rivera' })
  ).toContainText('Used up')
  await expect(
    page.getByRole('listitem').filter({ hasText: 'Old roommate' })
  ).toContainText('Revoked')
  await shot(page, 'users-invites')
  const pausedInvite = (
    await api(admin, '/api/invites?scope=all&status=active')
  ).invites.find((invite) => invite.note === 'Book club')
  assert.equal(pausedInvite.status, 'paused')
  assert.equal(pausedInvite.token, null)
  await api(
    admin,
    '/api/settings/invites',
    'PUT',
    { everyoneCanInvite: true },
    200
  )

  // Accounts show who invited them.
  await page.getByRole('tab', { name: 'Accounts' }).click()
  await expect(page).not.toHaveURL(/tab=invites/)
  const sam = page.getByRole('row').filter({ hasText: 'Sam Rivera' })
  await expect(sam).toContainText('Invited by Alex Morgan')
  await expect(sam).toContainText('Moderator')
  await shot(page, 'users-invited-by', page.getByRole('table'))

  // The permissions are ordinary role grants.
  await page.goto(origin + '/dashboard/roles')
  await page
    .getByRole('button', { name: /Everyone/ })
    .first()
    .click()
  await page.getByPlaceholder('Find a permission…').fill('invite')
  await expect(page.getByText('Create invites', { exact: true })).toBeVisible()
  await expect(
    page.getByText('Manage all invites', { exact: true })
  ).toBeVisible()
  await shot(page, 'roles-invitations')

  // Audit history records creation, redemption, and revocation.
  await page.goto(origin + '/dashboard/audit')
  await page.getByLabel('Category', { exact: true }).selectOption('invites')
  await page.getByRole('button', { name: 'Apply filters', exact: true }).click()
  const events = page.getByRole('region', { name: 'Audit events' })
  await expect(events).toHaveAttribute('aria-busy', 'false')
  await expect(events).toContainText('invite.redeem')
  await shot(page, 'audit-invites')
  const audit = await api(admin, '/api/audit?category=invites&limit=100')
  const serialized = JSON.stringify(audit.events)
  assert.ok(!/[A-Za-z0-9_-]{43}/.test(serialized.replace(/"id":"[^"]+"/g, '')))
  await admin.close()
  results.push({
    check: 'administrator review, revoke, pause, trace',
    ok: true,
  })
}

async function main() {
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.PW_CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: process.env.PW_CHROMIUM_EXECUTABLE_PATH }
      : {}),
  })
  try {
    const link = await adminFlow(browser)
    await joinFlow(browser, link)
    const memberLink = await memberFlow(browser)
    await profileViews(browser)
    await mobileJoin(browser, memberLink)
    await managementViews(browser)
  } finally {
    await browser.close()
  }
  console.log(JSON.stringify({ origin, results }, null, 2))
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
