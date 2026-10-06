/* eslint-disable @typescript-eslint/no-require-imports */
// Real-server account isolation checks using only scripts/timeline/seed.cjs data.
// The final two scenarios explicitly delay delivery of unchanged real responses.
const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const { mkdir, writeFile } = require('node:fs/promises')
const path = require('node:path')
const { PrismaClient } = require('@prisma/client')
const {
  chromium,
  expect: baseExpect,
} = require('../../docs/site/node_modules/@playwright/test')
const sharp = require('../../docs/site/node_modules/sharp')
const expect = baseExpect.configure({ timeout: 30000 })
const origin = process.env.FLARE_TIMELINE_TEST_ORIGIN || 'http://localhost:3064'
const destination = new URL(origin)
const database = new URL(process.env.DATABASE_URL)
if (
  destination.protocol !== 'http:' ||
  destination.hostname !== 'localhost' ||
  destination.pathname !== '/' ||
  destination.search ||
  destination.hash ||
  destination.username ||
  destination.password ||
  !['postgresql:', 'postgres:'].includes(database.protocol) ||
  !['localhost', '127.0.0.1'].includes(database.hostname) ||
  database.pathname !== '/flare_timeline_test_local' ||
  database.hash ||
  database.searchParams.getAll('schema').length > 1 ||
  [...database.searchParams].some(
    ([key, value]) => key !== 'schema' || value !== 'public'
  )
)
  throw new Error(
    'Use a disposable localhost instance and the local flare_timeline_test_local public schema.'
  )

const accountA = 'timeline-demo-alex'
const accountB = 'timeline-demo-other'
const password = 'Timeline-demo-only-2026!'
const screenshotDirectory = process.env.FLARE_TIMELINE_SCREENSHOTS
const schemaEvidence = process.env.FLARE_TIMELINE_SCHEMA_EVIDENCE
const oldMarkers = [
  'Alpine morning',
  'Pacific coast',
  'Desert light',
  'Northern lights',
  'Blue hour',
  'Forest walk',
  'Rose dusk',
  'Quiet horizon',
  'Mountain lake',
  'Autumn hills',
  'Lunar valley',
  'Ocean air',
  'Travel journal',
  'Favorites',
]
const prisma = new PrismaClient()
const createdIds = []

async function fixtureSetup() {
  const users = await prisma.user.findMany({ select: { id: true } })
  assert.deepEqual(
    users.map(({ id }) => id).sort(),
    [accountA, accountB].sort(),
    'Only the two public timeline demonstration accounts may exist'
  )
  assert.equal(await prisma.file.count({ where: { userId: accountA } }), 12000)
  assert.equal(
    await prisma.file.count({ where: { userId: accountB } }),
    1,
    'Start from the timeline seed; the second account must contain only its original marker'
  )
  const source = await prisma.file.findUniqueOrThrow({
    where: { id: 'timeline-demo-other-account-file' },
  })
  assert.equal(source.userId, accountB)
  const run = randomUUID()
  await prisma.$transaction(async (tx) => {
    const files = Array.from({ length: 96 }, (_, index) => ({
      id: `timeline-switch-${run}-${index}`,
      userId: accountB,
      name: `Jamie workspace ${String(index + 1).padStart(3, '0')}.webp`,
      mimeType: source.mimeType,
      path: source.path,
      urlPath: `/${accountB}/switch-${run}-${index}.webp`,
      storageTarget: source.storageTarget,
      size: source.size,
      uploadedAt: new Date(Date.parse('2026-10-02T18:00:00Z') - index * 60000),
      visibility: 'PRIVATE',
      isOcrProcessed: true,
    }))
    await tx.file.createMany({ data: files })
    createdIds.push(...files.map(({ id }) => id))
    await tx.user.update({
      where: { id: accountB },
      data: { storageUsed: { increment: source.size * files.length } },
    })
  })
}

async function fixtureCleanup() {
  if (!createdIds.length) return
  await prisma.$transaction(async (tx) => {
    await tx.file.deleteMany({
      where: { id: { in: createdIds }, userId: accountB },
    })
    const sum = await tx.file.aggregate({
      where: { userId: accountB },
      _sum: { size: true },
    })
    await tx.user.update({
      where: { id: accountB },
      data: { storageUsed: sum._sum.size ?? 0 },
    })
  })
  assert.equal(await prisma.file.count({ where: { userId: accountB } }), 1)
}

async function api(ctx, endpoint) {
  const response = await ctx.request.get(origin + endpoint)
  assert.equal(response.status(), 200, `${endpoint}: ${await response.text()}`)
  return response.json()
}

async function apiLogin(ctx, id) {
  const csrf = await api(ctx, '/api/auth/csrf')
  const response = await ctx.request.post(
    origin + '/api/auth/callback/credentials',
    {
      headers: { Origin: origin },
      form: {
        csrfToken: csrf.csrfToken,
        email: `${id}@example.test`,
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
  assert.equal((await api(ctx, '/api/auth/session')).user.id, id)
}

async function ready(page) {
  await expect(
    page.getByRole('list', { name: 'Your files', exact: true })
  ).toHaveAttribute('aria-busy', 'false')
  await expect(
    page.locator('[data-file-index] a[aria-label^="Open "]').first()
  ).toBeAttached()
}

async function nativeSecondTabLogin(ctx, original, id) {
  const tab = await ctx.newPage()
  await tab.goto(origin + '/auth/login?local=1')
  await tab
    .getByLabel('Email address', { exact: true })
    .fill(`${id}@example.test`)
  await tab.getByLabel('Password', { exact: true }).fill(password)
  await tab
    .locator('form')
    .filter({ has: tab.getByLabel('Password', { exact: true }) })
    .locator('button[type="submit"]')
    .click()
  await tab.waitForURL((url) => url.pathname === '/dashboard')
  const session = await api(ctx, '/api/auth/session')
  assert.equal(session.user.id, id)
  // redirect:false login does not broadcast. A real second-tab reload starts
  // SessionProvider again; its native storage message refreshes the first tab.
  // Wait for its whole-second timestamp to differ from the preceding message.
  await tab.waitForFunction(() => {
    const message = localStorage.getItem('nextauth.message')
    return (
      Math.floor(Date.now() / 1000) >
      (message ? JSON.parse(message).timestamp : 0)
    )
  })
  await tab.reload()
  await ready(tab)
  await original.bringToFront()
  return { tab, sessionId: session.user.sessionId }
}

async function observeIsolation(page) {
  await page.evaluate((markers) => {
    window.__timelineLeaks = []
    window.__timelineSawJamie = false
    const inspect = () => {
      const avatar = document.querySelector(
        'a[aria-label="Open your profile and preferences"]'
      )
      if (avatar?.textContent?.trim() === 'JR') window.__timelineSawJamie = true
      if (!window.__timelineSawJamie) return
      const text = document.body.textContent || ''
      for (const marker of markers)
        if (text.includes(marker) && !window.__timelineLeaks.includes(marker))
          window.__timelineLeaks.push(marker)
    }
    window.__timelineObserver = new MutationObserver(inspect)
    window.__timelineObserver.observe(document, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
    })
  }, oldMarkers)
}

async function noAlex(page, sentinel) {
  assert.equal(
    await page.evaluate(() => window.__timelineDocument),
    sentinel,
    'Original document reloaded; that would discard the cache under test'
  )
  assert.deepEqual(
    await page.evaluate(() => window.__timelineLeaks),
    [],
    'Alex metadata appeared after the native session identity switched to Jamie'
  )
  const text = await page.locator('body').innerText()
  for (const marker of oldMarkers)
    assert.ok(!text.includes(marker), `Old metadata remains: ${marker}`)
}

async function jamieReady(page, state) {
  await expect(
    page.locator('a[aria-label="Open your profile and preferences"]')
  ).toHaveText('JR')
  await noAlex(page, state.sentinel)
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await ready(page)
  await expect(
    page.getByRole('button', { name: 'Select files', exact: true })
  ).toBeVisible()
  await expect(page.locator('[data-file-index="0"]')).toContainText(
    'Jamie workspace 001.webp'
  )
  await expect
    .poll(() =>
      state.reads.some(
        (read) => read.path === '/api/files/timeline' && read.total === 97
      )
    )
    .toBe(true)
  await expect
    .poll(() =>
      state.reads.some((read) => read.path === '/api/files' && read.jamie)
    )
    .toBe(true)
  await noAlex(page, state.sentinel)
}

async function openBulkDialog(page, owner = 'Alex') {
  const names =
    owner === 'Alex'
      ? ['Alpine morning 00001.webp', 'Pacific coast 00002.webp']
      : ['Jamie workspace 001.webp']
  await page.getByRole('button', { name: 'Select files', exact: true }).click()
  for (const name of names)
    await page
      .getByRole('checkbox', { name: `Select ${name}`, exact: true })
      .check()
  if (owner === 'Alex') {
    await page
      .getByRole('slider', { name: 'Browse files by date' })
      .press('End')
    await ready(page)
    await expect(
      page.locator('[data-file-index="0"], [data-file-index="1"]')
    ).toHaveCount(0)
  }
  await page
    .getByRole('button', { name: 'Create archive', exact: true })
    .click()
  const dialog = page.getByRole('dialog', {
    name: 'Create archive',
    exact: true,
  })
  await expect(dialog).toBeVisible()
  await dialog
    .getByText(`Selected files (${names.length})`, { exact: true })
    .click()
  for (const name of names) await expect(dialog).toContainText(name)
}

function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

async function bounded(promise, description) {
  let timer
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`Timed out: ${description}`)),
          30000
        )
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

async function holdAlexResponse(page, endpoint) {
  const ready = deferred(),
    release = deferred(),
    finished = deferred()
  let captured = false
  await page.route(
    (url) => url.pathname === endpoint,
    async (route) => {
      if (captured || route.request().method() !== 'GET')
        return route.continue()
      captured = true
      try {
        const response = await route.fetch()
        assert.equal(response.status(), 200)
        const body = await response.json()
        if (endpoint.endsWith('/timeline')) assert.equal(body.data.total, 12000)
        else {
          assert.ok(body.data.length > 0)
          assert.ok(
            body.data.every((file) =>
              oldMarkers.some((marker) => file.name.startsWith(marker))
            )
          )
        }
        ready.resolve()
        await release.promise
        try {
          await route.fulfill({ response })
        } catch (error) {
          if (
            !/interception|closed|handled|cancel|invalid/i.test(String(error))
          )
            throw error
        }
        finished.resolve()
      } catch (error) {
        ready.reject(error)
        finished.reject(error)
      }
    }
  )
  void finished.promise.catch(() => {})
  return {
    ready: ready.promise,
    release: release.resolve,
    finished: finished.promise,
  }
}

async function newScenario(browser) {
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    colorScheme: 'dark',
    reducedMotion: 'reduce',
    timezoneId: 'UTC',
  })
  await apiLogin(ctx, accountA)
  const page = await ctx.newPage()
  page.setDefaultTimeout(30000)
  const state = { sentinel: randomUUID(), reads: [], sessions: [], errors: [] }
  page.on('pageerror', (error) => state.errors.push(error.message))
  page.on('response', async (response) => {
    const endpoint = new URL(response.url()).pathname
    if (
      !['/api/auth/session', '/api/files', '/api/files/timeline'].includes(
        endpoint
      ) ||
      response.status() !== 200
    )
      return
    try {
      const body = await response.json()
      if (endpoint === '/api/auth/session')
        state.sessions.push(body.user?.sessionId ?? null)
      else
        state.reads.push({
          path: endpoint,
          total: body.data?.total,
          jamie:
            Array.isArray(body.data) &&
            body.data.some((file) => file.name.startsWith('Jamie workspace')),
        })
    } catch {
      /* Unmount can cancel a request before the observer reads it. */
    }
  })
  await page.goto(origin + '/dashboard')
  await ready(page)
  await expect(page.locator('[data-file-index="0"]')).toContainText(
    'Alpine morning 00001.webp'
  )
  await page.evaluate((sentinel) => {
    window.__timelineDocument = sentinel
  }, state.sentinel)
  await observeIsolation(page)
  return { ctx, page, state }
}

async function primary(browser) {
  const { ctx, page, state } = await newScenario(browser)
  try {
    if (schemaEvidence) {
      const ids = 'timeline-demo-file-00000,timeline-demo-file-11999'
      const cases = []
      for (const query of [
        `sortBy=largest&ids=${ids}`,
        `sortBy=newest&groupBy=month&ids=${ids}`,
      ])
        cases.push({
          query,
          body: await api(ctx, `/api/files/timeline?${query}`),
        })
      await writeFile(schemaEvidence, JSON.stringify({ cases }, null, 2) + '\n')
    }
    await openBulkDialog(page)
    const first = await nativeSecondTabLogin(ctx, page, accountB)
    await jamieReady(page, state)
    console.log(
      'PASS: Native cross-tab Alex → Jamie clears retained cards, offscreen cache, selection and open archive dialog without replacing the original document; no transient Alex metadata.'
    )
    const rail = page.getByRole('slider', { name: 'Browse files by date' })
    await rail.press('End')
    await ready(page)
    await expect(page.locator('[data-file-index="96"]')).toContainText(
      'Other account isolation marker.webp'
    )
    await noAlex(page, state.sentinel)
    await rail.press('Home')
    await ready(page)
    await expect(page.locator('[data-file-index="0"]')).toContainText(
      'Jamie workspace 001.webp'
    )
    await noAlex(page, state.sentinel)
    console.log(
      'PASS: Jamie End/Home navigation fetches a separate page and cannot resurrect Alex cards or old history rank.'
    )
    if (screenshotDirectory) {
      await mkdir(screenshotDirectory, { recursive: true })
      await page.evaluate(() => window.scrollTo(0, 0))
      await sharp(await page.screenshot())
        .webp({ quality: 84 })
        .toFile(path.join(screenshotDirectory, 'library-account-switch.webp'))
    }
    await openBulkDialog(page, 'Jamie')
    const before = state.reads.length
    const replacement = await nativeSecondTabLogin(ctx, page, accountB)
    assert.notEqual(replacement.sessionId, first.sessionId)
    await expect
      .poll(() => state.sessions.includes(replacement.sessionId))
      .toBe(true)
    await jamieReady(page, state)
    assert.ok(
      state.reads
        .slice(before)
        .some(
          (read) => read.path === '/api/files/timeline' && read.total === 97
        ),
      'Replacement session must fetch its own timeline'
    )
    console.log(
      'PASS: Same-account replacement session clears its previous selection/dialog and fetches fresh library data.'
    )
    await replacement.tab.bringToFront()
    await replacement.tab
      .getByRole('link', { name: 'Profile', exact: true })
      .click()
    await replacement.tab
      .getByRole('button', { name: 'Sign Out', exact: true })
      .click()
    await expect(
      page.getByText('Sign in to view your files.', { exact: true })
    ).toBeVisible()
    await expect(page.locator('[data-file-index]')).toHaveCount(0)
    await expect(page.getByRole('dialog')).toHaveCount(0)
    assert.ok(
      !(await page.locator('body').innerText()).includes('Jamie workspace')
    )
    assert.equal(
      await page.evaluate(() => window.__timelineDocument),
      state.sentinel
    )
    assert.deepEqual(state.errors, [])
    console.log(
      'PASS: Real second-tab Sign Out clears private library content in the unchanged original document.'
    )
  } finally {
    await ctx.close()
  }
}

async function delayed(browser, endpoint) {
  const { ctx, page, state } = await newScenario(browser)
  let held
  try {
    held = await holdAlexResponse(page, endpoint)
    if (endpoint.endsWith('/timeline'))
      await page
        .getByRole('button', { name: 'Refresh files', exact: true })
        .click()
    else
      await page
        .getByRole('slider', { name: 'Browse files by date' })
        .press('End')
    await bounded(held.ready, 'capturing a real Alex response')
    await nativeSecondTabLogin(ctx, page, accountB)
    await jamieReady(page, state)
    held.release()
    await bounded(held.finished, 'releasing the old response')
    await page.waitForTimeout(700)
    await jamieReady(page, state)
    assert.deepEqual(state.errors, [])
    console.log(
      `PASS: CONTROLLED DELIVERY DELAY ${endpoint}: unchanged real Alex response released after native Jamie switch cannot repopulate the library.`
    )
  } finally {
    held?.release()
    await ctx.close()
  }
}

async function main() {
  let browser
  try {
    await fixtureSetup()
    browser = await chromium.launch({ headless: true })
    await primary(browser)
    await delayed(browser, '/api/files/timeline')
    await delayed(browser, '/api/files')
  } finally {
    await browser?.close()
    await fixtureCleanup()
    await prisma.$disconnect()
  }
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
