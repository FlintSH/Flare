/* eslint-disable @typescript-eslint/no-require-imports */
// Exercise the real local application. Use only scripts/file-requests/seed.cjs fixtures.
const assert = require('node:assert/strict')
const { randomBytes } = require('node:crypto')
const { mkdir } = require('node:fs/promises')
const path = require('node:path')
const {
  chromium,
  expect: baseExpect,
} = require('../../docs/site/node_modules/@playwright/test')
const sharp = require('../../docs/site/node_modules/sharp')
const expect = baseExpect.configure({ timeout: 45000 })
const origin =
  process.env.FLARE_FILE_REQUESTS_TEST_ORIGIN || 'http://localhost:3075'
if (new URL(origin).hostname !== 'localhost')
  throw new Error('Use a disposable localhost instance.')
const screenshots = process.env.FLARE_FILE_REQUESTS_SCREENSHOTS
const videos = process.env.FLARE_FILE_REQUESTS_VIDEOS
const password = 'Request-demo-only-2026!'
const results = []
let address = 10

async function api(ctx, route, method = 'GET', data, expected = 200) {
  const response = await ctx.request.fetch(origin + route, {
    method,
    ...(data === undefined ? {} : { data }),
    headers: { Origin: origin },
  })
  assert.equal(
    response.status(),
    expected,
    `${method} ${route}: ${response.status()} ${await response.text()}`
  )
  return response.json().catch(() => null)
}
async function login(ctx, user) {
  const csrf = await api(ctx, '/api/auth/csrf')
  const response = await ctx.request.post(
    origin + '/api/auth/callback/credentials',
    {
      form: {
        csrfToken: csrf.csrfToken,
        email: `request-demo-${user}@example.test`,
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
  const size = mobile
    ? { width: 390, height: 844 }
    : { width: 1440, height: 1000 }
  const ctx = await browser.newContext({
    viewport: size,
    ...(mobile ? { isMobile: true, hasTouch: true } : {}),
    colorScheme: 'dark',
    reducedMotion: 'reduce',
    permissions: ['clipboard-read', 'clipboard-write'],
    // Rate limits are per client address. These reserved documentation
    // addresses only separate fixture visitors on localhost.
    extraHTTPHeaders: { 'X-Forwarded-For': `198.51.100.${address++}` },
    ...(recorded && videos ? { recordVideo: { dir: videos, size } } : {}),
  })
  await ctx.addInitScript(
    ({ conceal }) => {
      const install = () => {
        if (!document.documentElement) return
        const style = document.createElement('style')
        // Captures blur request links; every other control is real.
        style.textContent = `nextjs-portal { display: none !important; }${
          conceal
            ? ' #created-request-link, #request-link { color: transparent !important; text-shadow: 0 0 7px hsl(var(--foreground)) !important; }'
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

/** Real files with matching contents, so type validation accepts them. */
async function fixtures() {
  const logo = await sharp({
    create: {
      width: 640,
      height: 400,
      channels: 3,
      background: { r: 249, g: 115, b: 22 },
    },
  })
    .png()
    .toBuffer()
  const pdf = Buffer.from(
    '%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n'
  )
  // 12 MB is sent as three parts.
  const archive = Buffer.concat([
    Buffer.from([0x50, 0x4b, 0x03, 0x04]),
    randomBytes(12 * 1024 * 1024 - 4),
  ])
  return {
    logo: { name: 'acme-logo.png', mimeType: 'image/png', buffer: logo },
    guide: {
      name: 'brand-guide.pdf',
      mimeType: 'application/pdf',
      buffer: pdf,
    },
    fonts: {
      name: 'acme-fonts.zip',
      mimeType: 'application/zip',
      buffer: archive,
    },
  }
}

async function ownerCreates(browser) {
  const owner = await context(browser, { recorded: true })
  await login(owner, 'alex')
  const page = await owner.newPage()
  page.setDefaultTimeout(45000)
  await page.goto(origin + '/dashboard/requests')
  await expect(
    page.getByRole('heading', { name: 'File requests', exact: true })
  ).toBeVisible()
  await expect(page.getByText('No file requests yet')).toBeVisible()
  await pause(page)
  await shot(page, 'requests-empty')
  await page.getByRole('button', { name: 'New request' }).first().click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText('New file request')
  await type(
    dialog.getByLabel('What are you asking for?'),
    'Brand assets for the Acme launch'
  )
  await type(
    dialog.getByLabel('Message for senders (optional)'),
    'Logos, fonts, and the latest brand guide. Zip folders are fine.'
  )
  await choose(page, 'Upload profile', 'Client deliveries')
  await expect(dialog).toContainText('Received files arrive private')
  await expect(dialog).toContainText('Random filenames · 1 tag')
  await choose(page, 'Save to', 'Acme rebrand')
  await choose(page, 'Closes after', '30 days')
  await pause(page, 900)
  await shot(page, 'create-request', dialog)
  await dialog.getByRole('button', { name: 'Create request link' }).click()
  await expect(dialog).toContainText('Your request link is ready')
  const link = await dialog.getByLabel('Request link').inputValue()
  assert.match(link, /^http:\/\/localhost:\d+\/r\/[A-Za-z0-9_-]{24}$/)
  await dialog.getByRole('button', { name: 'Copy link' }).click()
  await expect(dialog.getByRole('button', { name: 'Copied' })).toBeVisible()
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), link)
  await pause(page)
  await shot(page, 'request-link', dialog)
  await dialog.getByRole('button', { name: 'Done' }).click()
  const row = page.getByRole('list', { name: 'File requests' }).locator('li')
  await expect(row).toHaveCount(1)
  await expect(row).toContainText('Open')
  await expect(row).toContainText('Saves to Acme rebrand')
  await pause(page)
  await finish(owner, page, 'create-request')
  results.push({
    check: 'owner creates a request and copies its link',
    ok: true,
  })
  return link
}

async function senderSends(browser, link, files) {
  const sender = await context(browser, { recorded: true })
  const page = await sender.newPage()
  page.setDefaultTimeout(60000)
  const errors = []
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  await page.goto(link)
  await expect(
    page.getByRole('heading', { name: 'Brand assets for the Acme launch' })
  ).toBeVisible()
  await expect(page.getByText('From Alex Morgan')).toBeVisible()
  await expect(page.getByText('Up to 2 GB per file')).toBeVisible()
  await pause(page)
  await shot(page, 'send-page')
  await type(page.getByLabel('Your name (optional)'), 'Sam Lee')
  await page
    .locator('input[type="file"]')
    .setInputFiles([files.logo, files.guide, files.fonts])
  const list = page.getByRole('list', { name: 'Files to send' })
  await expect(list.locator('li')).toHaveCount(3)
  await type(
    page.getByLabel('Note (optional)'),
    'Everything from the agency. The fonts are licensed for web use.'
  )
  await expect(page.getByRole('button', { name: 'Send 3 files' })).toBeEnabled()
  await pause(page, 900)
  await shot(page, 'send-ready')
  await page.getByRole('button', { name: 'Send 3 files' }).click()
  // The large file reports progress while its parts upload.
  await expect(page.getByText('Files sent', { exact: true })).toBeVisible({
    timeout: 120000,
  })
  await expect(page.getByRole('status')).toContainText(
    '3 files (12 MB) went to Alex Morgan.'
  )
  await pause(page)
  await shot(page, 'send-done')
  // The recorder trails a busy page; hold the result so the clip ends on it.
  await pause(page, 3000)
  assert.deepEqual(errors, [])
  await finish(sender, page, 'send-files')
  results.push({ check: 'sender sends three files, one in parts', ok: true })
}

async function ownerReviews(browser) {
  const owner = await context(browser, { recorded: true })
  await login(owner, 'alex')
  const page = await owner.newPage()
  page.setDefaultTimeout(45000)
  await page.goto(origin + '/dashboard/requests')
  const row = page.getByRole('list', { name: 'File requests' }).locator('li')
  await expect(row).toContainText('New files')
  await expect(row).toContainText('3 files')
  await pause(page)
  await shot(page, 'requests-list')
  await row
    .getByRole('link', { name: 'Brand assets for the Acme launch' })
    .click()
  await expect(page).toHaveURL(/\/dashboard\/requests\?id=/)
  const received = page.getByRole('list', { name: 'Received files' })
  await expect(received).toContainText('Sam Lee')
  await expect(received).toContainText('The fonts are licensed for web use.')
  for (const name of ['acme-logo.png', 'brand-guide.pdf', 'acme-fonts.zip'])
    await expect(received.getByRole('link', { name })).toBeVisible()
  await pause(page)
  await shot(page, 'request-detail')
  // Received files are ordinary private files in the chosen folder.
  const files = await api(owner, '/api/files?limit=10')
  assert.equal(files.data.length, 3)
  assert.ok(files.data.every((file) => file.visibility === 'PRIVATE'))
  assert.ok(
    files.data.every((file) => file.tags.some((tag) => tag.name === 'Clients'))
  )
  await page.goto(origin + '/dashboard/requests')
  await expect(row).toHaveCount(1)
  await expect(row).toContainText('3 files')
  await expect(row).not.toContainText('New files')
  await pause(page, 2500)
  await finish(owner, page, 'review-files')
  results.push({
    check: 'owner reviews private files grouped by sender',
    ok: true,
  })
}

async function lifecycle(browser, link, files) {
  const owner = await context(browser)
  await login(owner, 'alex')
  const page = await owner.newPage()
  page.setDefaultTimeout(45000)
  // Close: the sender sees why the link stopped working.
  await page.goto(origin + '/dashboard/requests')
  const row = page.getByRole('list', { name: 'File requests' }).locator('li')
  await row.getByRole('button', { name: /^Manage / }).click()
  await page.getByRole('menuitem', { name: 'Close request' }).click()
  await expect(row).toContainText('Closed')
  const visitor = await context(browser)
  const guest = await visitor.newPage()
  await guest.goto(link)
  await expect(
    guest.getByRole('heading', { name: 'This request is closed' })
  ).toBeVisible()
  await shot(guest, 'send-closed')
  await row.getByRole('button', { name: /^Manage / }).click()
  await page.getByRole('menuitem', { name: 'Reopen request' }).click()
  await expect(row).toContainText('Open')

  // Replace the link: the old one is invalid, the new one works.
  await row.getByRole('button', { name: /^Manage / }).click()
  await page.getByRole('menuitem', { name: 'Replace link' }).click()
  await page.getByRole('button', { name: 'Replace link' }).click()
  await expect(page.getByText('New link ready', { exact: true })).toBeVisible()
  await guest.goto(link)
  await expect(
    guest.getByRole('heading', { name: 'This link isn’t valid' })
  ).toBeVisible()

  // A one-file request turns full after its file arrives.
  const { request } = await api(
    owner,
    '/api/file-requests',
    'POST',
    { title: 'Signed contract', maxFiles: 1, senderName: 'required' },
    201
  )
  await guest.goto(`${origin}/r/${request.token}`)
  await guest
    .locator('input[type="file"]')
    .setInputFiles([files.guide, files.logo])
  await expect(
    guest.getByText('This request accepts 1 more file. Remove 1 to send.')
  ).toBeVisible()
  await guest.getByRole('button', { name: `Remove ${files.logo.name}` }).click()
  const send = guest.getByRole('button', { name: 'Send 1 file' })
  await expect(send).toBeDisabled()
  await guest.getByLabel('Your name (required)').fill('Jordan Park')
  await send.click()
  await expect(guest.getByText('Files sent', { exact: true })).toBeVisible({
    timeout: 60000,
  })
  await expect(
    guest.getByRole('button', { name: 'Send more files' })
  ).toHaveCount(0)
  await guest.reload()
  await expect(
    guest.getByRole('heading', { name: 'This request is full' })
  ).toBeVisible()
  await visitor.close()
  await owner.close()
  results.push({
    check: 'close, reopen, replace link, and file limits',
    ok: true,
  })
}

async function recovery(browser, files) {
  const owner = await context(browser)
  await login(owner, 'alex')
  const { request } = await api(
    owner,
    '/api/file-requests',
    'POST',
    { title: 'One video', maxFiles: 1 },
    201
  )
  const visitor = await context(browser)
  const page = await visitor.newPage()
  page.setDefaultTimeout(60000)
  // Every part fails, as on a dropped connection, until the route is lifted.
  await page.route(/\/parts\/\d+$/, (route) => route.abort('failed'))
  await page.goto(`${origin}/r/${request.token}`)
  await page.locator('input[type="file"]').setInputFiles([files.fonts])
  await page.getByRole('button', { name: 'Send 1 file' }).click()
  const list = page.getByRole('list', { name: 'Files to send' })
  await expect(list).toContainText('The connection dropped.')
  // The page cancelled the failed file, so the only slot is free again.
  await expect
    .poll(async () => {
      const view = await api(owner, '/api/file-requests')
      return view.requests.find((entry) => entry.id === request.id).status
    })
    .toBe('open')
  await page.unroute(/\/parts\/\d+$/)
  await page.getByRole('button', { name: 'Send 1 file' }).click()
  await expect(page.getByText('Files sent', { exact: true })).toBeVisible()
  await visitor.close()
  await owner.close()
  results.push({ check: 'a failed file gives its room back', ok: true })
}

async function access(browser) {
  const member = await context(browser)
  await login(member, 'jamie')
  const page = await member.newPage()
  page.setDefaultTimeout(45000)
  await page.goto(origin + '/dashboard')
  await expect(
    page.getByRole('link', { name: 'Profile' }).first()
  ).toBeVisible()
  await expect(page.getByRole('link', { name: 'Requests' })).toHaveCount(0)
  await page.goto(origin + '/dashboard/requests')
  await expect(page).toHaveURL(/\/dashboard\/profile/)
  await api(member, '/api/file-requests', 'GET', undefined, 403)
  await page.goto(origin + '/dashboard/upload')
  await expect(
    page.getByRole('heading', { name: 'Upload files', exact: true })
  ).toBeVisible()
  await expect(page.getByRole('link', { name: 'Request files' })).toHaveCount(0)

  const admin = await context(browser)
  await login(admin, 'alex')
  const settings = await admin.newPage()
  settings.setDefaultTimeout(45000)
  await settings.goto(
    origin + '/dashboard/settings?section=general#file-requests'
  )
  const card = settings.locator('#file-requests')
  const everyone = card.getByRole('switch', {
    name: 'Let everyone request files',
  })
  await expect(everyone).not.toBeChecked()
  await everyone.click()
  await settings.getByRole('button', { name: 'Save settings' }).click()
  await expect(
    settings.getByText('Your instance settings are saved.', { exact: true })
  ).toBeVisible()
  await expect(everyone).toBeChecked()
  await shot(settings, 'settings-file-requests', card)
  assert.deepEqual(await api(admin, '/api/settings/file-requests'), {
    everyoneCanRequestFiles: true,
  })

  // Roles load per request, so the member gets Requests right away.
  await page.goto(origin + '/dashboard/upload')
  await page.getByRole('link', { name: 'Request files' }).click()
  await expect(page).toHaveURL(/\/dashboard\/requests$/)
  await expect(
    page.getByRole('link', { name: 'Requests' }).first()
  ).toBeVisible()
  await api(member, '/api/file-requests', 'GET')
  await everyone.click()
  await settings.getByRole('button', { name: 'Save settings' }).click()
  await expect(everyone).not.toBeChecked()
  await admin.close()
  await member.close()
  results.push({ check: 'only permitted accounts request files', ok: true })
}

async function phone(browser, files) {
  const owner = await context(browser)
  await login(owner, 'alex')
  const { request } = await api(
    owner,
    '/api/file-requests',
    'POST',
    {
      title: 'Photos from Saturday',
      message: 'Add as many as you like.',
      senderName: 'optional',
    },
    201
  )
  const mobile = await context(browser, { mobile: true })
  const page = await mobile.newPage()
  page.setDefaultTimeout(60000)
  await page.goto(`${origin}/r/${request.token}`)
  await expect(
    page.getByRole('heading', { name: 'Photos from Saturday' })
  ).toBeVisible()
  await noOverflow(page)
  await shot(page, 'send-page-phone')
  await page.locator('input[type="file"]').setInputFiles([files.logo])
  await page.getByRole('button', { name: 'Send 1 file' }).click()
  await expect(page.getByText('Files sent', { exact: true })).toBeVisible()
  await noOverflow(page)
  await page.getByRole('button', { name: 'Send more files' }).click()
  await expect(page.getByRole('button', { name: 'Send files' })).toBeDisabled()

  const ownerPhone = await context(browser, { mobile: true })
  await login(ownerPhone, 'alex')
  const list = await ownerPhone.newPage()
  await list.goto(origin + '/dashboard/requests')
  await expect(
    list.getByRole('list', { name: 'File requests' }).locator('li')
  ).toHaveCount(4)
  await noOverflow(list)
  await shot(list, 'requests-list-phone')
  await ownerPhone.close()
  await mobile.close()
  await owner.close()
  results.push({ check: 'phone senders and owners', ok: true })
}

async function main() {
  const browser = await chromium.launch()
  try {
    const files = await fixtures()
    const link = await ownerCreates(browser)
    await senderSends(browser, link, files)
    await ownerReviews(browser)
    await lifecycle(browser, link, files)
    await recovery(browser, files)
    await access(browser)
    await phone(browser, files)
  } finally {
    await browser.close()
  }
  console.log(JSON.stringify({ origin, results }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
