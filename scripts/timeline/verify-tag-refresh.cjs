/* eslint-disable @typescript-eslint/no-require-imports */
// Real disposable-server regression for retained selections and fresh tag reads.
// Only the recovery/cancellation checks inject a failed/delayed request. The
// optional screenshot is captured earlier, using real successful API responses.
const assert = require('node:assert/strict')
const { mkdir, writeFile } = require('node:fs/promises')
const path = require('node:path')
const {
  chromium,
  request,
  expect: baseExpect,
} = require('../../docs/site/node_modules/@playwright/test')
const sharp = require('../../docs/site/node_modules/sharp')
const expect = baseExpect.configure({ timeout: 30_000 })
const origin = process.env.FLARE_TIMELINE_TEST_ORIGIN || 'http://localhost:3064'
const target = new URL(origin)
if (target.hostname !== 'localhost' || target.protocol !== 'http:')
  throw new Error('Use a disposable localhost instance matching NEXTAUTH_URL.')
const screenshots = process.env.FLARE_TIMELINE_SCREENSHOTS
const ids = ['timeline-demo-file-00000', 'timeline-demo-file-00003']
const names = ['Alpine morning 00001.webp', 'Northern lights 00004.webp']
const tagId = 'timeline-demo-favorites'
const results = []
const evidence = {
  browser: 'Chromium',
  fixtureFiles: ids,
  browserMutations: [],
  browserTagCreations: [],
  membershipReads: [],
  simulatedFailures: [
    'one aborted membership GET',
    'one delayed membership GET',
  ],
  fixtureRestored: false,
}
const isMembershipRead = (req) =>
  req.method() === 'GET' && new URL(req.url()).pathname === '/api/files/tags'
function passed(message) {
  results.push(message)
  console.log(`PASS: ${message}`)
}
async function ready(page) {
  await expect(
    page.getByRole('list', { name: 'Your files', exact: true })
  ).toHaveAttribute('aria-busy', 'false')
  await expect(
    page.locator('[data-file-index] a[aria-label^="Open "]').first()
  ).toBeAttached()
}
async function top(page) {
  await page.getByRole('slider', { name: 'Browse files by date' }).press('Home')
  await ready(page)
  await expect(page.locator('[data-file-index="0"]')).toBeAttached()
  await page.evaluate(() => window.scrollTo(0, 0))
}
async function selectFiles(page, selectedNames = names) {
  await top(page)
  const start = page.getByRole('button', { name: 'Select files', exact: true })
  if (await start.count()) await start.click()
  for (const name of selectedNames) {
    await page
      .getByRole('checkbox', { name: `Select ${name}`, exact: true })
      .check()
  }
  await expect(
    page.getByText(`${selectedNames.length} / 100 selected`, { exact: true })
  ).toBeVisible()
}
async function refresh(page) {
  const response = page.waitForResponse(
    (res) => new URL(res.url()).pathname === '/api/files/timeline' && res.ok()
  )
  await page.getByRole('button', { name: 'Refresh files', exact: true }).click()
  await response
  await ready(page)
}
async function openTags(page) {
  await page.getByRole('button', { name: 'Edit tags', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  return dialog
}
async function closeTags(page) {
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Done', exact: true })
    .click()
  await expect(page.getByRole('dialog')).toBeHidden()
}
async function favorite(dialog, state) {
  const checkbox = dialog.getByRole('checkbox', { name: /^Favorites/ })
  await expect(checkbox).toHaveAttribute('aria-checked', state)
  await expect(checkbox).toBeEnabled()
  return checkbox
}
async function checkAdd(page, dialog, fileIds) {
  const response = page.waitForResponse(
    (res) =>
      res.request().method() === 'PATCH' &&
      new URL(res.url()).pathname === '/api/files/tags'
  )
  await dialog.getByRole('checkbox', { name: /^Favorites/ }).click()
  const res = await response
  assert.equal(res.status(), 200)
  assert.deepEqual(res.request().postDataJSON(), {
    fileIds: [...fileIds].sort(),
    tagId,
    action: 'add',
  })
  await favorite(dialog, 'true')
}
async function screenshot(page) {
  if (!screenshots) return
  await page.evaluate(async () => {
    await document.fonts.ready
    await Promise.all(
      [...document.images].map((image) => image.decode().catch(() => {}))
    )
  })
  await mkdir(screenshots, { recursive: true })
  await sharp(await page.screenshot({ animations: 'disabled' }))
    .webp({ quality: 88 })
    .toFile(path.join(screenshots, 'library-tags.webp'))
}

async function main() {
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    colorScheme: 'dark',
    reducedMotion: 'reduce',
    timezoneId: 'UTC',
  })
  const page = await context.newPage()
  page.setDefaultTimeout(30_000)
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('request', (req) => {
    if (isMembershipRead(req)) {
      evidence.membershipReads.push(
        new URL(req.url()).searchParams.get('fileIds').split(',')
      )
    } else if (
      req.method() === 'PATCH' &&
      new URL(req.url()).pathname === '/api/files/tags'
    ) {
      evidence.browserMutations.push(req.postDataJSON())
    } else if (
      req.method() === 'POST' &&
      new URL(req.url()).pathname === '/api/tags'
    ) {
      evidence.browserTagCreations.push(req.postDataJSON())
    }
  })
  let secondClient
  let fixtureVerified = false
  let releaseDelayedRequest = () => {}
  const memberships = async () => {
    const res = await secondClient.get('/api/files/tags', {
      params: { fileIds: ids.join(',') },
    })
    assert.equal(res.status(), 200, 'Fresh membership endpoint succeeds')
    assert.equal(res.headers()['cache-control'], 'private, no-store')
    return (await res.json()).data.files
  }
  const setFavorite = async (fileIds, action) => {
    const res = await secondClient.patch('/api/files/tags', {
      data: { fileIds, tagId, action },
    })
    assert.equal(
      res.status(),
      200,
      'Second authenticated client changes fixture membership'
    )
  }
  try {
    await page.goto(origin + '/auth/login?local=1')
    await page
      .getByLabel('Email address', { exact: true })
      .fill('timeline-demo-alex@example.test')
    await page
      .getByLabel('Password', { exact: true })
      .fill('Timeline-demo-only-2026!')
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()
    await page.waitForURL('**/dashboard')
    await ready(page)
    secondClient = await request.newContext({
      baseURL: origin,
      storageState: await context.storageState(),
      extraHTTPHeaders: { Origin: origin },
    })
    const before = await memberships()
    assert.deepEqual(
      before.map((file) => file.id),
      ids
    )
    assert(
      before.every((file) => file.tags.some((tag) => tag.id === tagId)),
      'Both known fixture associations must exist before this test can mutate them'
    )
    fixtureVerified = true
    // Execute the handbook's browser example against real owned fixture IDs.
    const example = await page.evaluate(async ([fileId, otherFileId]) => {
      const query = new URLSearchParams({
        fileIds: [fileId, otherFileId].join(','),
      })
      const response = await fetch(`/api/files/tags?${query}`, {
        credentials: 'same-origin',
        cache: 'no-store',
      })
      const result = await response.json()
      if (!response.ok)
        throw new Error(result.error || 'Could not read file tags')
      return result.data.files
    }, ids)
    assert.deepEqual(example, before)
    passed(
      'The handbook browser example returns current owned memberships with no-store caching'
    )

    await page
      .getByRole('button', { name: 'Select files', exact: true })
      .click()
    await page
      .getByRole('checkbox', { name: `Select ${names[0]}`, exact: true })
      .check()
    await expect(
      page.getByText('1 / 100 selected', { exact: true })
    ).toBeVisible()
    await setFavorite([ids[0]], 'remove')
    await refresh(page)
    await expect(
      page.getByText('1 / 100 selected', { exact: true })
    ).toBeVisible()
    let dialog = await openTags(page)
    await favorite(dialog, 'false')
    await expect(
      dialog.getByRole('textbox', { name: 'Find or create a tag', exact: true })
    ).toBeFocused()
    evidence.focusAfterMembershipRead = await page.evaluate(() => ({
      tag: document.activeElement?.tagName,
      label: document.activeElement?.getAttribute('aria-label'),
      text: document.activeElement?.textContent?.trim(),
    }))
    await screenshot(page)
    await checkAdd(page, dialog, [ids[0]])
    assert((await memberships())[0].tags.some((tag) => tag.id === tagId))
    await closeTags(page)
    passed(
      'Refresh retains selection while Edit tags reads fresh membership and sends add for an externally removed tag'
    )

    await selectFiles(page, [names[0]])
    await page
      .getByRole('slider', { name: 'Browse files by date' })
      .press('End')
    await ready(page)
    await expect(page.locator('[data-file-index="0"]')).toHaveCount(0)
    await setFavorite([ids[0]], 'remove')
    dialog = await openTags(page)
    await favorite(dialog, 'false')
    await checkAdd(page, dialog, [ids[0]])
    await expect(page.locator('[data-file-index="0"]')).toHaveCount(0)
    await closeTags(page)
    await expect(
      page.getByText('0 / 100 selected', { exact: true })
    ).toBeInViewport()
    passed(
      'An unmounted selected file receives the same fresh membership read and correct add action'
    )

    await page.getByRole('button', { name: 'Done', exact: true }).click()
    await top(page)
    await page
      .getByRole('button', { name: 'Select files', exact: true })
      .click()
    for (const name of names) {
      await page
        .getByRole('checkbox', { name: `Select ${name}`, exact: true })
        .check()
    }
    await setFavorite([ids[1]], 'remove')
    await refresh(page)
    dialog = await openTags(page)
    await favorite(dialog, 'mixed')
    await expect(dialog.getByText('1 of 2', { exact: true })).toBeVisible()
    await checkAdd(page, dialog, ids)
    assert(
      (await memberships()).every((file) =>
        file.tags.some((tag) => tag.id === tagId)
      )
    )
    await closeTags(page)
    passed(
      'Two retained selections show fresh mixed membership and add the tag to both files'
    )

    await selectFiles(page)
    // Explicit simulation: fail just the membership read, not the tag catalog.
    const routePattern = '**/api/files/tags?*'
    let abortNext = true
    const failOnce = async (route) => {
      if (abortNext && isMembershipRead(route.request())) {
        abortNext = false
        await route.abort('failed')
      } else await route.continue()
    }
    await page.route(routePattern, failOnce)
    const patchesBeforeFailure = evidence.browserMutations.length
    dialog = await openTags(page)
    await expect(
      dialog.getByRole('button', {
        name: 'Retry loading file tags',
        exact: true,
      })
    ).toBeVisible()
    await expect(
      dialog.getByRole('textbox', { name: 'Find or create a tag', exact: true })
    ).toBeEnabled()
    await expect(dialog.getByRole('checkbox')).toHaveCount(0)
    const failedSearch = dialog.getByRole('textbox', {
      name: 'Find or create a tag',
      exact: true,
    })
    await expect(failedSearch).toBeFocused()
    await failedSearch.fill('Uncreated recovery test tag')
    await failedSearch.press('Enter')
    await expect(dialog.getByRole('button', { name: /^Create / })).toHaveCount(
      0
    )
    assert.equal(evidence.browserMutations.length, patchesBeforeFailure)
    await failedSearch.fill('Favorites')
    await page.unroute(routePattern, failOnce)
    await dialog
      .getByRole('button', { name: 'Retry loading file tags', exact: true })
      .click()
    await favorite(dialog, 'true')
    await expect(
      dialog.getByRole('textbox', { name: 'Find or create a tag', exact: true })
    ).toBeEnabled()
    await closeTags(page)
    passed(
      'A simulated failed membership read allows searching, blocks creation and tag edits, and recovers through Retry'
    )

    await selectFiles(page)
    // Explicit simulation: hold one read until the user closes its dialog.
    const delayed = new Promise((resolve) => {
      releaseDelayedRequest = resolve
    })
    let capturedRequest
    const delayOnce = async (route) => {
      capturedRequest = route.request()
      await delayed
      await route.continue().catch(() => {}) // Closing aborts this held request.
    }
    await page.route(routePattern, delayOnce)
    dialog = await openTags(page)
    await expect(
      dialog.getByRole('status').filter({ hasText: 'Loading file tags…' })
    ).toBeVisible()
    await expect(
      dialog.getByRole('textbox', { name: 'Find or create a tag', exact: true })
    ).toBeEnabled()
    await expect(dialog.getByRole('checkbox')).toHaveCount(0)
    const loadingSearch = dialog.getByRole('textbox', {
      name: 'Find or create a tag',
      exact: true,
    })
    await expect(loadingSearch).toBeFocused()
    await loadingSearch.fill('Uncreated loading test tag')
    await loadingSearch.press('Enter')
    await expect(dialog.getByRole('button', { name: /^Create / })).toHaveCount(
      0
    )
    assert.equal(evidence.browserMutations.length, patchesBeforeFailure)
    await expect.poll(() => !!capturedRequest).toBe(true)
    const aborted = page.waitForEvent('requestfailed', {
      predicate: isMembershipRead,
    })
    await closeTags(page)
    releaseDelayedRequest()
    const canceled = await aborted
    assert.match(canceled.failure().errorText, /ABORTED/)
    await page.unroute(routePattern, delayOnce)
    await selectFiles(page)
    dialog = await openTags(page)
    await favorite(dialog, 'true')
    await closeTags(page)
    passed(
      'Closing a loading dialog aborts its read; reopening loads a fresh successful snapshot'
    )

    assert.equal(
      evidence.browserMutations.length,
      3,
      'Only the three deliberate checkbox actions mutate tags'
    )
    assert(
      evidence.membershipReads.every(
        (fileIds) =>
          fileIds.length <= 100 && fileIds.every((id) => ids.includes(id))
      )
    )
    assert.deepEqual(
      evidence.browserTagCreations,
      [],
      'Typing and pressing Enter during loading or failure must not create tags'
    )
    assert.deepEqual(errors, [], 'No browser JavaScript errors')
  } finally {
    releaseDelayedRequest()
    await page.unrouteAll({ behavior: 'ignoreErrors' })
    try {
      if (fixtureVerified) {
        await setFavorite(ids, 'add')
        const restored = await memberships()
        assert(
          restored.every((file) => file.tags.some((tag) => tag.id === tagId))
        )
        evidence.fixtureRestored = true
        passed('Both preexisting fixture tag associations were restored')
      }
    } finally {
      if (secondClient) await secondClient.dispose()
      await context.close()
      await browser.close()
      if (process.env.FLARE_TIMELINE_RESULTS) {
        await writeFile(
          process.env.FLARE_TIMELINE_RESULTS,
          JSON.stringify({ results, evidence }, null, 2) + '\n'
        )
      }
    }
  }
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
