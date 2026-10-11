/* eslint-disable @typescript-eslint/no-require-imports */
// Real uploads, sessions, thumbnail responses, and rendered previews. No stubs.
const assert = require('node:assert/strict')
const { mkdir, readFile } = require('node:fs/promises')
const path = require('node:path')
const { PrismaClient } = require('@prisma/client')
const {
  chromium,
  expect: baseExpect,
} = require('../../docs/site/node_modules/@playwright/test')
const sharp = require('../../docs/site/node_modules/sharp')
const { cleanupThumbnailFixtures } = require('./thumbnail-cleanup.cjs')
const expect = baseExpect.configure({ timeout: 45_000 })

const origin = process.env.FLARE_TIMELINE_TEST_ORIGIN || 'http://localhost:3064'
const destination = new URL(origin)
const database = new URL(process.env.DATABASE_URL)
if (
  destination.protocol !== 'http:' ||
  destination.hostname !== 'localhost' ||
  destination.username ||
  destination.password ||
  destination.pathname !== '/' ||
  destination.search ||
  destination.hash ||
  !['postgresql:', 'postgres:'].includes(database.protocol) ||
  !['localhost', '127.0.0.1'].includes(database.hostname) ||
  database.pathname !== '/flare_timeline_test_local' ||
  database.hash ||
  [...database.searchParams].some(
    ([key, value]) => key !== 'schema' || value !== 'public'
  )
)
  throw new Error('Use the disposable local timeline database and HTTP origin.')

const prisma = new PrismaClient()
const screenshots = process.env.FLARE_TIMELINE_SCREENSHOTS
const accountIds = ['timeline-demo-alex', 'timeline-demo-other']
const prefix = 'Thumbnail check '
const fixtures = []

async function login(browser, id) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    colorScheme: 'dark',
    reducedMotion: 'reduce',
    timezoneId: 'UTC',
  })
  const page = await context.newPage()
  page.setDefaultTimeout(90_000)
  await page.goto(origin + '/auth/login?local=1')
  await page
    .getByLabel('Email address', { exact: true })
    .fill(`${id}@example.test`)
  await page
    .getByLabel('Password', { exact: true })
    .fill('Timeline-demo-only-2026!')
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await page.waitForURL('**/dashboard')
  return { context, page }
}

async function checkPreviews(page, scope, moderation = false) {
  for (const file of fixtures) {
    const image = scope.getByRole('img', { name: file.name, exact: true })
    await expect(image).toBeVisible()
    // Scrolling can remount a virtual card; resolve its image again below.
    await image.evaluate((img) =>
      img.scrollIntoView({ block: 'center', behavior: 'instant' })
    )
    await expect
      .poll(() => image.evaluate((img) => img.complete && img.naturalWidth > 0))
      .toBe(true)
    const source = await image.evaluate((img) => img.currentSrc)
    const url = new URL(source)
    const thumbnailPath = `/api/files/${file.id}/thumbnail`
    if (
      moderation ||
      file.visibility === 'PRIVATE' ||
      file.password ||
      file.mimeType === 'image/gif'
    ) {
      assert.equal(url.pathname, thumbnailPath)
    } else {
      assert.equal(url.pathname, '/_next/image')
      assert.equal(url.searchParams.get('url'), thumbnailPath)
    }
  }
  if (moderation)
    assert.equal(
      await page.evaluate(
        () =>
          performance.getEntriesByType('resource').filter((entry) => {
            const url = new URL(entry.name)
            return (
              url.pathname === '/_next/image' &&
              url.searchParams.get('url')?.includes('/thumbnail')
            )
          }).length
      ),
      0,
      'Moderation thumbnails must not pass through the headerless image optimizer'
    )
}

async function capture(page, name) {
  if (!screenshots) return
  // Hide only the development overlay; all product UI and file bytes are real.
  await page.addStyleTag({
    content: 'nextjs-portal { display: none !important; }',
  })
  const png = await page.screenshot()
  await sharp(png).webp({ quality: 85 }).toFile(path.join(screenshots, name))
}

async function main() {
  assert.equal(
    await prisma.user.count({ where: { id: { notIn: accountIds } } }),
    0,
    'Refusing to use a database containing other accounts'
  )
  assert.equal(await prisma.user.count(), 2, 'Run the timeline seed first')
  assert.equal(
    await prisma.file.count({ where: { name: { startsWith: prefix } } }),
    0,
    'Remove stale thumbnail-check fixtures before retrying'
  )
  if (screenshots) await mkdir(screenshots, { recursive: true })
  const browser = await chromium.launch({ headless: true })
  let owner
  const failures = []
  try {
    owner = await login(browser, accountIds[0])
    const illustration = await readFile(
      'uploads/timeline-demo/landscape-0.webp'
    )
    const png = await sharp(illustration).resize(480).png().toBuffer()
    const { data: frame, info } = await sharp(illustration)
      .resize(480)
      .raw()
      .toBuffer({ resolveWithObject: true })
    const reflected = await sharp(illustration)
      .resize(480)
      .flop()
      .raw()
      .toBuffer()
    const gif = await sharp(Buffer.concat([frame, reflected]), {
      raw: {
        width: info.width,
        height: info.height * 2,
        channels: info.channels,
        pageHeight: info.height,
      },
    })
      .gif({ loop: 0, delay: [500, 500] })
      .toBuffer()
    for (const [label, mimeType, buffer, visibility, password] of [
      ['public.png', 'image/png', png, 'PUBLIC', null],
      ['private.png', 'image/png', png, 'PRIVATE', null],
      ['protected.png', 'image/png', png, 'PUBLIC', 'Thumbnail-demo-only!'],
      ['animation.gif', 'image/gif', gif, 'PUBLIC', null],
    ]) {
      const name = prefix + label
      const response = await owner.context.request.post(origin + '/api/files', {
        headers: { Origin: origin, 'X-Upload-Profile': 'none' },
        multipart: {
          file: { name, mimeType, buffer },
          visibility,
          expiration: 'DISABLED',
          ...(password ? { password } : {}),
        },
      })
      assert.equal(
        response.status(),
        200,
        `Upload ${name}: ${await response.text()}`
      )
      const file = await prisma.file.findFirstOrThrow({
        where: { userId: accountIds[0], name },
      })
      fixtures.push({
        id: file.id,
        name,
        mimeType,
        buffer,
        visibility,
        password,
      })
      assert.equal(file.visibility, visibility)
      assert.equal(Boolean(file.password), Boolean(password))
    }

    const anonymous = await browser.newContext()
    for (const file of fixtures) {
      const route = origin + `/api/files/${file.id}/thumbnail`
      const authorized = await owner.context.request.get(route)
      assert.equal(authorized.status(), 200)
      assert.deepEqual(await authorized.body(), file.buffer)
      const response = await anonymous.request.get(route)
      assert.equal(
        response.status(),
        file.visibility === 'PRIVATE' ? 404 : file.password ? 401 : 200
      )
      if (file.visibility === 'PRIVATE' || file.password)
        assert.equal(response.headers()['cache-control'], 'private, no-store')
    }
    await anonymous.close()
    console.log(
      'PASS: real thumbnail bytes and anonymous private/password boundaries'
    )

    await owner.page.goto(origin + '/dashboard')
    await owner.page
      .getByRole('searchbox', { name: 'Search files by name' })
      .fill(prefix)
    const library = owner.page.getByRole('list', {
      name: 'Your files',
      exact: true,
    })
    await expect(library).toHaveAttribute('aria-busy', 'false')
    await expect(library.getByRole('img')).toHaveCount(fixtures.length)
    for (const [size, viewport] of [
      ['desktop', { width: 1440, height: 1000 }],
      ['mobile', { width: 390, height: 844 }],
    ]) {
      await owner.page.setViewportSize(viewport)
      await checkPreviews(owner.page, library)
      await owner.page.evaluate(() => window.scrollTo(0, 0))
      await capture(owner.page, `thumbnail-library-${size}.webp`)
      console.log(
        `PASS: ${size} library PNG/private/protected/animated GIF previews`
      )
    }

    const moderator = await login(browser, accountIds[1])
    await moderator.page.goto(origin + '/dashboard/users')
    await moderator.page
      .getByRole('button', { name: 'View content for Alex Morgan' })
      .click()
    const dialog = moderator.page.getByRole('dialog')
    await dialog
      .getByRole('textbox', { name: 'Search this user’s files' })
      .fill(prefix)
    await expect(dialog.getByRole('img')).toHaveCount(fixtures.length)
    for (const [size, viewport] of [
      ['desktop', { width: 1440, height: 1000 }],
      ['mobile', { width: 390, height: 844 }],
    ]) {
      await moderator.page.setViewportSize(viewport)
      await checkPreviews(moderator.page, dialog, true)
      await capture(moderator.page, `thumbnail-moderation-${size}.webp`)
      console.log(
        `PASS: ${size} moderator previews load using another account's session`
      )
    }
  } catch (error) {
    failures.push(error)
  } finally {
    await cleanupThumbnailFixtures({
      browser,
      owner,
      fixtures,
      origin,
      failures,
    })
  }
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
