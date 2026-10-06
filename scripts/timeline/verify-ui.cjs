/* eslint-disable @typescript-eslint/no-require-imports */
// Exercise the real server and seeded account. Only the explicit recovery check
// aborts one network request; all recordings use real, successful server responses.
const assert = require('node:assert/strict')
const { mkdir, mkdtemp, rmdir, writeFile } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const path = require('node:path')
const { checkRecordingEncoder, encodeRecording } = require('./recording.cjs')
const {
  chromium,
  expect: baseExpect,
} = require('../../docs/site/node_modules/@playwright/test')
const sharp = require('../../docs/site/node_modules/sharp')
const expect = baseExpect.configure({ timeout: 90_000 })

const origin = process.env.FLARE_TIMELINE_TEST_ORIGIN || 'http://localhost:3064'
const target = new URL(origin)
if (target.hostname !== 'localhost' || target.protocol !== 'http:')
  throw new Error('Use a disposable localhost instance matching NEXTAUTH_URL.')
const screenshots = process.env.FLARE_TIMELINE_SCREENSHOTS
const videos = process.env.FLARE_TIMELINE_VIDEOS
const results = []
function passed(message) {
  results.push(message)
  console.log(`PASS: ${message}`)
}
const evidence = {
  accountFiles: 12_000,
  browser: 'Chromium',
  timezone: 'UTC',
  samples: [],
}

async function context(browser, storageState, mobile = false, record = false) {
  const recordingDirectory =
    record && videos
      ? await mkdtemp(path.join(tmpdir(), 'flare-timeline-recording-'))
      : undefined
  const ctx = await browser.newContext({
    ...(storageState ? { storageState } : {}),
    viewport: mobile
      ? { width: 390, height: 844 }
      : { width: 1440, height: 1000 },
    colorScheme: 'dark',
    reducedMotion: 'reduce',
    timezoneId: 'UTC',
    ...(record && videos
      ? {
          recordVideo: {
            dir: recordingDirectory,
            size: mobile
              ? { width: 390, height: 844 }
              : { width: 1440, height: 1000 },
          },
        }
      : {}),
  })
  await ctx.addInitScript(() => {
    const hideDevIndicator = () => {
      if (!document.documentElement) return
      const style = document.createElement('style')
      style.textContent = 'nextjs-portal { display: none !important; }'
      document.documentElement.appendChild(style)
    }
    document.addEventListener('DOMContentLoaded', hideDevIndicator, {
      once: true,
    })
  })
  const page = await ctx.newPage()
  page.setDefaultTimeout(90_000)
  return { ctx, page }
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

async function settledBox(locator) {
  // A correct intermediate frame must not hide a later size correction.
  await locator.evaluate(
    (element) =>
      new Promise((resolve) => {
        let previous = NaN
        let stableFrames = 0
        const check = () => {
          const current = element.getBoundingClientRect().top
          stableFrames = current === previous ? stableFrames + 1 : 0
          previous = current
          if (stableFrames >= 8) resolve(null)
          else requestAnimationFrame(check)
        }
        requestAnimationFrame(check)
      })
  )
  return locator.boundingBox()
}

async function columns(page, count) {
  await expect
    .poll(() =>
      page
        .locator('[data-row] > .grid')
        .first()
        .evaluate(
          (element) =>
            getComputedStyle(element).gridTemplateColumns.trim().split(/\s+/)
              .length
        )
    )
    .toBe(count)
}

async function firstVisibleIndex(page) {
  const index = await page.evaluate(
    () =>
      [...document.querySelectorAll('[data-file-index]')].find((element) => {
        const box = element.getBoundingClientRect()
        return box.bottom > 96 && box.top < innerHeight
      })?.dataset.fileIndex
  )
  assert.notEqual(index, undefined, 'The library has a visible file anchor')
  return index
}

async function screenshot(page, name) {
  if (!screenshots) return
  if (name === 'library-date-jump' || name === 'library-mobile') {
    if (name === 'library-mobile') {
      await page.mouse.wheel(0, 360)
      await ready(page)
    }
    const rail = page.getByRole('slider', { name: 'Browse files by date' })
    await rail.evaluate((element) => element.blur())
    await rail.hover()
  }
  await page.evaluate(async () => {
    await document.fonts.ready
    await Promise.all(
      [...document.images]
        .filter((image) => {
          const box = image.getBoundingClientRect()
          return box.bottom > 0 && box.top < innerHeight
        })
        .map((image) => image.decode().catch(() => {}))
    )
  })
  await mkdir(screenshots, { recursive: true })
  // A large native scroll can leave Chromium's compositor one frame behind the
  // DOM. Capture a settled real frame, never a background-only transition.
  let bytes
  for (let attempt = 0; attempt < 4; attempt++) {
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve))
        )
    )
    bytes = await page.screenshot({ animations: 'disabled' })
    const stats = await sharp(bytes).stats()
    if (stats.channels.slice(0, 3).some(({ stdev }) => stdev > 5)) break
    if (attempt === 3)
      throw new Error(
        `The ${name} screenshot remained blank after the scroll settled.`
      )
    await page.waitForTimeout(150)
  }
  await sharp(bytes)
    .webp({ quality: 88 })
    .toFile(path.join(screenshots, `${name}.webp`))
}

async function sample(page, stage) {
  const value = await page.evaluate(() => ({
    mountedFiles: document.querySelectorAll('[data-file-index]').length,
    mountedRows: document.querySelectorAll('[data-row]').length,
    firstMounted: Number(
      document.querySelector('[data-file-index]')?.dataset.fileIndex
    ),
    lastMounted: Number(
      [...document.querySelectorAll('[data-file-index]')].at(-1)?.dataset
        .fileIndex
    ),
    date: document
      .querySelector('[role="slider"]')
      ?.getAttribute('aria-valuetext'),
    horizontalOverflow: document.documentElement.scrollWidth > innerWidth,
  }))
  assert.ok(
    value.mountedFiles <= 100,
    `${stage}: ${value.mountedFiles} mounted cards`
  )
  assert.equal(
    value.horizontalOverflow,
    false,
    `${stage}: no horizontal overflow`
  )
  evidence.samples.push({ stage, ...value })
  console.log(
    `CHECK: ${stage} (${value.mountedFiles} mounted cards, ${value.date})`
  )
  return value
}

async function pause(page, ms = 1000) {
  if (videos) await page.waitForTimeout(ms)
}

async function saveRecording(video, name) {
  const source = await video.path()
  await encodeRecording(source, path.join(videos, `${name}.mp4`))
  await video.delete()
  await rmdir(path.dirname(source))
}

async function main() {
  if (videos) {
    await checkRecordingEncoder()
    await mkdir(videos, { recursive: true })
  }
  const browser = await chromium.launch({ headless: true })
  let page
  try {
    const login = await context(browser)
    page = login.page
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
    const storageState = await login.ctx.storageState()
    await login.ctx.close()

    const desktop = await context(browser, storageState, false, true)
    page = desktop.page
    const errors = []
    const fileRequests = []
    page.on('pageerror', (error) => errors.push(error.message))
    page.on('request', (request) => {
      const url = new URL(request.url())
      if (url.pathname === '/api/files') fileRequests.push(url.search)
    })
    await page.goto(origin + '/dashboard')
    await ready(page)
    await expect(
      page.getByText('12,000 files', { exact: true }).first()
    ).toBeVisible()
    await sample(page, 'desktop-newest')
    await screenshot(page, 'library-desktop')
    await pause(page, 1800)
    const rail = page.getByRole('slider', { name: 'Browse files by date' })
    await page.mouse.move(800, 700)
    await page.mouse.wheel(0, 1100)
    await ready(page)
    await pause(page, 1200)
    const railBox = await rail.boundingBox()
    await page.mouse.move(railBox.x + railBox.width / 2, railBox.y + 18)
    await page.mouse.down()
    await page.mouse.move(
      railBox.x + railBox.width / 2,
      railBox.y + railBox.height * 0.55,
      { steps: 20 }
    )
    await page.mouse.up()
    await ready(page)
    await sample(page, 'desktop-pointer-scrub')
    await pause(page, 1500)
    const beforeJump = fileRequests.length
    await rail.press('End')
    await expect(page.locator('[data-file-index="11999"]')).toBeAttached()
    await ready(page)
    await expect(rail).toHaveAttribute('aria-valuetext', 'July 2018')
    await sample(page, 'desktop-oldest-jump')
    evidence.deepJumpFileRequests = fileRequests.length - beforeJump
    assert.ok(
      evidence.deepJumpFileRequests <= 6,
      'A date jump must not fetch intervening pages'
    )
    await screenshot(page, 'library-date-jump')
    await pause(page, 2200)
    passed(
      'Date rail jumps directly from newest files to July 2018; mounted cards and requests stay bounded'
    )

    await top(page)
    await pause(page)
    await page
      .getByRole('button', { name: 'Select files', exact: true })
      .click()
    await page
      .getByRole('checkbox', { name: 'Select visible files', exact: true })
      .check()
    const selected = await page.getByText(/^\d+ \/ 100 selected$/).textContent()
    assert.match(selected, /^[1-9]\d* \/ 100 selected$/)
    const retainedSelection = await page
      .locator('[data-file-index] input[type="checkbox"]:checked')
      .first()
      .evaluate((element) => ({
        index: element.closest('[data-file-index]').dataset.fileIndex,
        label: element.getAttribute('aria-label'),
      }))
    for (let step = 0; step < 4; step++) {
      await page.mouse.wheel(0, 600)
      await page.waitForTimeout(200)
    }
    await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(2300)
    await ready(page)
    await expect(
      page.locator(`[data-file-index="${retainedSelection.index}"]`)
    ).toHaveCount(0)
    await expect(page.getByText(selected, { exact: true })).toBeInViewport()
    await screenshot(page, 'library-selection')
    await pause(page, 2000)
    await top(page)
    await expect(
      page.getByRole('checkbox', {
        name: retainedSelection.label,
        exact: true,
      })
    ).toBeChecked()
    await pause(page, 800)
    await page.getByRole('button', { name: 'Done', exact: true }).click()
    passed(
      'Selecting visible cards survives scrolling and unmounting; Done clears selection'
    )

    await top(page)
    await page
      .getByRole('searchbox', { name: 'Search files by name' })
      .fill('Northern lights')
    await expect(
      page.getByText('1,000 files', { exact: true }).first()
    ).toBeVisible()
    await ready(page)
    const names = await page
      .locator('[data-file-index] a[aria-label^="Open "]')
      .allTextContents()
    assert.ok(names.length > 0)
    await expect(
      page.locator('[data-file-index] a[aria-label^="Open "]').first()
    ).toHaveAttribute('aria-label', /Northern lights/)
    await pause(page, 2200)
    await page
      .getByRole('button', { name: 'Clear file search', exact: true })
      .click()
    await expect(
      page.getByText('12,000 files', { exact: true }).first()
    ).toBeVisible()
    await ready(page)
    await expect(
      page.getByRole('link', {
        name: 'Open Alpine morning 00001.webp',
        exact: true,
      })
    ).toBeVisible()
    await pause(page, 1500)
    passed(
      'Searching all account files resets position and returns the correct total'
    )

    const video = page.video()
    await desktop.ctx.close()
    if (videos) {
      await saveRecording(video, 'timeline-scroll')
    }

    const phone = await context(browser, storageState, true)
    page = phone.page
    await page.goto(origin + '/dashboard')
    await ready(page)
    await sample(page, 'mobile-newest')
    const phoneMenu = page.getByRole('button', {
      name: 'Manage Alpine morning 00001.webp',
      exact: true,
    })
    await phoneMenu.scrollIntoViewIfNeeded()
    const phoneMenuBox = await phoneMenu.boundingBox()
    const dateRailBox = await page
      .getByRole('slider', { name: 'Browse files by date' })
      .boundingBox()
    assert.ok(
      phoneMenuBox.x + phoneMenuBox.width <= dateRailBox.x,
      'Date rail leaves mobile card menus clear'
    )
    await phoneMenu.click({
      position: { x: phoneMenuBox.width - 3, y: phoneMenuBox.height / 2 },
    })
    await expect(page.getByRole('menu')).toBeVisible()
    await page.keyboard.press('Escape')
    await top(page)
    await page.getByRole('slider', { name: 'Browse files by date' }).focus()
    await screenshot(page, 'library-mobile')
    await page
      .getByRole('slider', { name: 'Browse files by date' })
      .press('End')
    await expect(page.locator('[data-file-index="11999"]')).toBeAttached()
    await ready(page)
    await sample(page, 'mobile-oldest-jump')
    const phoneAnchor = await firstVisibleIndex(page)
    await page.setViewportSize({ width: 1440, height: 1000 })
    await columns(page, 4)
    await expect(
      page.getByRole('slider', { name: 'Browse files by date' })
    ).toHaveAttribute('aria-valuetext', 'July 2018')
    await ready(page)
    await expect(
      page.locator(`[data-file-index="${phoneAnchor}"]`)
    ).toBeInViewport()
    await sample(page, 'resized-desktop-oldest')
    const desktopAnchor = await firstVisibleIndex(page)
    await page.setViewportSize({ width: 390, height: 844 })
    await columns(page, 1)
    await expect(
      page.getByRole('slider', { name: 'Browse files by date' })
    ).toHaveAttribute('aria-valuetext', 'July 2018')
    await ready(page)
    await expect(
      page.locator(`[data-file-index="${desktopAnchor}"]`)
    ).toBeInViewport()
    await sample(page, 'resized-mobile-oldest')
    for (let attempt = 0; attempt < 2; attempt++) {
      await top(page)
      await page
        .getByRole('slider', { name: 'Browse files by date' })
        .press('End')
      await expect(page.locator('[data-file-index="11999"]')).toBeAttached()
      await ready(page)
    }
    await top(page)
    await expect(
      page.getByRole('slider', { name: 'Browse files by date' })
    ).toHaveAttribute('aria-valuetext', 'October 2026')
    const phoneRail = page.getByRole('slider', { name: 'Browse files by date' })
    const phoneRailBox = await phoneRail.boundingBox()
    await page.mouse.click(
      phoneRailBox.x + phoneRailBox.width / 2,
      phoneRailBox.y + 14 + (phoneRailBox.height - 28) * (7970 / 11999)
    )
    await expect(page.locator('[data-file-index="7970"]')).toBeAttached()
    await ready(page)
    const beforeBoundary = Number(await phoneRail.getAttribute('aria-valuenow'))
    await page.mouse.move(180, 500)
    await page.mouse.wheel(0, 6500)
    // wheel() returns before Chromium consumes the event. Waiting for a changed
    // rank verifies actual native movement rather than the prior painted frame.
    await expect
      .poll(async () => Number(await phoneRail.getAttribute('aria-valuenow')))
      .toBeGreaterThan(7980)
    await expect
      .poll(async () =>
        Number(
          await page.locator('[data-row]').first().getAttribute('data-index')
        )
      )
      .toBeLessThan(7000)
    await ready(page)
    const boundary = await sample(page, 'mobile-native-window-boundary')
    const afterBoundary = Number(await phoneRail.getAttribute('aria-valuenow'))
    assert.ok(
      beforeBoundary < 7980 &&
        afterBoundary > 7980 &&
        afterBoundary < 8010 &&
        boundary.firstMounted >= 7975 &&
        boundary.lastMounted < 8020,
      'Native scrolling crosses the sliding window without losing its account position'
    )
    await top(page)
    await page.mouse.click(
      phoneRailBox.x + phoneRailBox.width / 2,
      phoneRailBox.y + 14 + (phoneRailBox.height - 28) * (7979 / 11999)
    )
    const seamAnchor = page.locator('[data-file-index="7979"]')
    await expect(seamAnchor).toBeAttached()
    await ready(page)
    const beforeSeam = await settledBox(seamAnchor)
    await page.mouse.move(180, 500)
    await page.mouse.wheel(0, 900)
    await expect
      .poll(async () => Number(await phoneRail.getAttribute('aria-valuenow')))
      .toBeGreaterThan(7980)
    await expect
      .poll(async () =>
        Number(
          await page.locator('[data-row="7979"]').getAttribute('data-index')
        )
      )
      .toBeLessThan(7000)
    await ready(page)
    const afterSeam = await settledBox(seamAnchor)
    evidence.nativeSeamPixelError = Math.abs(afterSeam.y - beforeSeam.y + 900)
    assert.ok(
      evidence.nativeSeamPixelError <= 5,
      `Native window transition preserves the within-card position (${evidence.nativeSeamPixelError}px error)`
    )
    console.log(
      `CHECK: forward seam (${evidence.nativeSeamPixelError}px error)`
    )
    await phoneRail.press('End')
    await expect(page.locator('[data-file-index="11999"]')).toBeAttached()
    await ready(page)
    await page.mouse.click(
      phoneRailBox.x + phoneRailBox.width / 2,
      phoneRailBox.y + 14 + (phoneRailBox.height - 28) * (4022 / 11999)
    )
    const reverseAnchor = page.locator('[data-file-index="4022"]')
    await expect(reverseAnchor).toBeAttached()
    await ready(page)
    const beforeReverse = await settledBox(reverseAnchor)
    await page.mouse.move(180, 500)
    await page.mouse.wheel(0, -1200)
    await expect
      .poll(async () => Number(await phoneRail.getAttribute('aria-valuenow')))
      .toBeLessThanOrEqual(4020)
    await expect
      .poll(async () =>
        Number(
          await page.locator('[data-row="4022"]').getAttribute('data-index')
        )
      )
      .toBeGreaterThan(1000)
    await ready(page)
    const afterReverse = await settledBox(reverseAnchor)
    evidence.reverseSeamPixelError = Math.abs(
      afterReverse.y - beforeReverse.y - 1200
    )
    assert.ok(
      evidence.reverseSeamPixelError <= 5,
      `Reverse window transition preserves the within-card position (${evidence.reverseSeamPixelError}px error)`
    )
    console.log(
      `CHECK: reverse seam (${evidence.reverseSeamPixelError}px error)`
    )
    passed(
      'Native scrolling across the virtual window preserves the file and its pixel position in both directions'
    )
    await phone.ctx.close()
    passed(
      '390px mobile library and date jump fit the viewport; desktop/mobile resizing preserves the historical month and Home returns to newest'
    )

    const details = await context(browser, storageState)
    page = details.page
    page.on('pageerror', (error) => errors.push(error.message))
    await page.goto(origin + '/dashboard')
    await ready(page)
    await page
      .getByRole('button', { name: 'Select files', exact: true })
      .click()
    await page
      .getByRole('checkbox', { name: 'Select visible files', exact: true })
      .check()
    const archiveSelection = await page
      .locator('[data-file-index] input[type="checkbox"]:checked')
      .evaluateAll((elements) =>
        elements.map((element) => element.getAttribute('aria-label').slice(7))
      )
    await page
      .getByRole('slider', { name: 'Browse files by date' })
      .press('End')
    await ready(page)
    await page
      .getByRole('button', { name: 'Create archive', exact: true })
      .click()
    const archiveDialog = page.getByRole('dialog', { name: 'Create archive' })
    await archiveDialog
      .getByText(`Selected files (${archiveSelection.length})`, { exact: true })
      .click()
    const archiveFiles = archiveDialog.getByRole('list', {
      name: 'Selected archive files',
    })
    await expect(archiveFiles.locator('li')).toHaveCount(
      archiveSelection.length
    )
    for (const name of archiveSelection)
      await expect(archiveFiles).toContainText(name)
    await archiveDialog
      .getByRole('button', { name: 'Cancel', exact: true })
      .click()
    await expect(
      page.getByText('0 / 100 selected', { exact: true })
    ).toBeVisible()
    await page.getByRole('button', { name: 'Done', exact: true }).click()
    passed('Create archive retains every selected file after its card unmounts')

    await top(page)
    await page
      .getByRole('button', { name: 'Select files', exact: true })
      .click()
    await page
      .getByRole('checkbox', {
        name: 'Select Alpine morning 00001.webp',
        exact: true,
      })
      .check()
    // A real API client changes membership while the browser retains its selection.
    const removed = await details.ctx.request.patch(
      origin + '/api/files/tags',
      {
        headers: { Origin: origin },
        data: {
          fileIds: ['timeline-demo-file-00000'],
          tagId: 'timeline-demo-favorites',
          action: 'remove',
        },
      }
    )
    assert.equal(removed.status(), 200)
    await page
      .getByRole('button', { name: 'Refresh files', exact: true })
      .click()
    await ready(page)
    await expect(
      page
        .locator('[data-file-index="0"]')
        .getByRole('button', {
          name: 'Show files tagged Favorites',
          exact: true,
        })
    ).toHaveCount(0)
    await page
      .getByRole('slider', { name: 'Browse files by date' })
      .press('End')
    await ready(page)
    await expect(page.locator('[data-file-index="0"]')).toHaveCount(0)
    await page.getByRole('button', { name: 'Edit tags', exact: true }).click()
    const tagDialog = page.getByRole('dialog', {
      name: 'Edit tags',
      exact: true,
    })
    const favorite = tagDialog.getByRole('checkbox', {
      name: 'Favorites',
      exact: true,
    })
    await expect(favorite).toHaveAttribute('aria-checked', 'false')
    await screenshot(page, 'library-refreshed-tags')
    const tagRequest = page.waitForRequest(
      (request) =>
        new URL(request.url()).pathname === '/api/files/tags' &&
        request.method() === 'PATCH'
    )
    await favorite.click()
    assert.equal((await tagRequest).postDataJSON().action, 'add')
    await expect(favorite).toHaveAttribute('aria-checked', 'true')
    const current = await details.ctx.request.get(
      origin + '/api/files?ids=timeline-demo-file-00000&limit=100'
    )
    assert.equal(current.status(), 200)
    assert.ok(
      (await current.json()).data[0].tags.some(
        (tag) => tag.id === 'timeline-demo-favorites'
      )
    )
    await tagDialog.getByRole('button', { name: 'Done', exact: true }).click()
    await page.getByRole('button', { name: 'Done', exact: true }).click()
    passed(
      'Bulk tags refresh offscreen selections after a real external removal and submit add for the unchecked tag'
    )
    await top(page)
    await page
      .getByRole('link', {
        name: 'Open Alpine morning 00001.webp',
        exact: true,
      })
      .click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await expect(page.getByRole('dialog').getByRole('img')).toBeVisible()
    await screenshot(page, 'library-image-viewer')
    await page.keyboard.press('ArrowRight')
    await expect(page.getByRole('dialog')).toContainText(
      'Pacific coast 00002.webp'
    )
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).not.toBeVisible()
    passed(
      'Image preview opens from the virtual grid, navigates to the next image, and closes normally'
    )

    await page.getByRole('button', { name: 'Upload date', exact: true }).click()
    await page
      .getByRole('combobox', { name: 'Group files by upload date' })
      .click()
    await page.getByRole('option', { name: 'By month', exact: true }).click()
    await page.keyboard.press('Escape')
    await ready(page)
    await expect(
      page.getByRole('heading', { name: 'October 2026 4' })
    ).toBeVisible()
    await page
      .getByRole('combobox', { name: 'Sort files', exact: true })
      .click()
    await page
      .getByRole('option', { name: 'Largest first', exact: true })
      .click()
    await ready(page)
    await expect(
      page.getByRole('slider', { name: 'Browse files by date' })
    ).toHaveCount(0)
    await sample(page, 'largest-sort')
    await page
      .getByRole('button', { name: 'Reset filters', exact: true })
      .click()
    await ready(page)
    await page
      .getByRole('button', { name: 'Open folder Travel journal', exact: true })
      .first()
      .click()
    await expect(
      page.getByText('1,714 files', { exact: true }).first()
    ).toBeVisible()
    await ready(page)
    await page.getByRole('button', { name: 'All files', exact: true }).click()
    await expect(
      page.getByText('12,000 files', { exact: true }).first()
    ).toBeVisible()
    await ready(page)
    await page
      .getByRole('searchbox', { name: 'Search files by name' })
      .fill('No matching timeline demo file')
    await expect(
      page.getByRole('heading', {
        name: 'No files match your search',
        exact: true,
      })
    ).toBeVisible()
    await expect(
      page.getByRole('button', { name: 'Select files', exact: true })
    ).toBeDisabled()
    await page
      .getByRole('button', { name: 'Clear file search', exact: true })
      .click()
    await ready(page)
    passed(
      'Month grouping, alternate sort without the date rail, folder filtering, empty results, and reset work against the real account'
    )

    await page.goto(origin + '/dashboard?page=250')
    await expect(page.locator('[data-file-index="5976"]')).toBeAttached()
    await ready(page)
    await sample(page, 'legacy-page-250')
    await top(page)
    await page
      .getByRole('combobox', { name: 'Sort files', exact: true })
      .click()
    await page
      .getByRole('option', { name: 'Oldest first', exact: true })
      .click()
    await ready(page)
    await expect(
      page.getByRole('slider', { name: 'Browse files by date' })
    ).toHaveAttribute('aria-valuetext', 'July 2018')
    await page.getByRole('button', { name: 'Upload date', exact: true }).click()
    await page
      .getByRole('combobox', { name: 'Group files by upload date' })
      .click()
    await page.getByRole('option', { name: 'By week', exact: true }).click()
    await page.keyboard.press('Escape')
    await ready(page)
    await expect(page.locator('[data-row] h2').first()).toContainText('Week of')
    await page
      .getByRole('button', { name: 'Reset filters', exact: true })
      .click()
    await ready(page)
    await page
      .getByRole('button', { name: 'Select files', exact: true })
      .click()
    await page
      .getByRole('checkbox', { name: 'Select visible files', exact: true })
      .check()
    await page
      .getByRole('searchbox', { name: 'Search files by name' })
      .fill('Northern lights')
    await expect(
      page.getByText('0 / 100 selected', { exact: true })
    ).toBeVisible()
    await page.getByRole('button', { name: 'Done', exact: true }).click()
    await page
      .getByRole('button', { name: 'Clear file search', exact: true })
      .click()
    await ready(page)
    passed(
      'Old page links restore the corresponding file; oldest/week order works and changing filters clears selection'
    )

    let failedOnce = false
    await page.route('**/api/files?**', async (route) => {
      const url = new URL(route.request().url())
      if (
        !failedOnce &&
        url.searchParams.get('dateFrom')?.startsWith('2018-07')
      ) {
        failedOnce = true
        await route.abort('failed')
      } else await route.continue()
    })
    await page
      .getByRole('slider', { name: 'Browse files by date' })
      .press('End')
    await expect(
      page.getByText('Couldn’t load these files.', { exact: true })
    ).toBeVisible()
    await page.getByRole('button', { name: 'Retry', exact: true }).click()
    await ready(page)
    await expect(
      page.locator('[data-file-index="11999"] a[aria-label^="Open "]')
    ).toBeAttached()
    await page.unroute('**/api/files?**')
    assert.equal(failedOnce, true)
    passed(
      'An intentionally aborted historical request exposes Retry; Retry loads the real files without losing position'
    )
    await page
      .getByRole('link', { name: 'Ocean air 12000.webp', exact: true })
      .click()
    await page.waitForURL('**/timeline-demo-alex/timeline-demo-file-11999.webp')
    await page.goBack()
    await ready(page)
    await expect(
      page.getByRole('slider', { name: 'Browse files by date' })
    ).toHaveAttribute('aria-valuetext', 'July 2018')
    passed(
      'Opening a historical filename and using Back restores the same part of the library'
    )
    await top(page)
    await page.setViewportSize({ width: 1280, height: 900 })
    const desktopMenu = page.getByRole('button', {
      name: 'Manage Northern lights 00004.webp',
      exact: true,
    })
    await desktopMenu.scrollIntoViewIfNeeded()
    const desktopMenuBox = await desktopMenu.boundingBox()
    const desktopRailBox = await page
      .getByRole('slider', { name: 'Browse files by date' })
      .boundingBox()
    assert.ok(
      desktopMenuBox.x + desktopMenuBox.width <= desktopRailBox.x,
      'Date rail leaves rightmost desktop card menus clear'
    )
    await desktopMenu.click({
      position: { x: desktopMenuBox.width - 3, y: desktopMenuBox.height / 2 },
    })
    await expect(page.getByRole('menu')).toBeVisible()
    await page.keyboard.press('Escape')
    await top(page)
    await page.addScriptTag({
      path: path.join(
        __dirname,
        '../../docs/site/node_modules/axe-core/axe.min.js'
      ),
    })
    await page.getByRole('slider', { name: 'Browse files by date' }).focus()
    const accessibility = await page.evaluate(async () => {
      const result = await window.axe.run(document, {
        runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] },
      })
      return result.violations.map(({ id, impact, nodes }) => ({
        id,
        impact,
        targets: nodes.map(({ target }) => target),
      }))
    })
    evidence.accessibility = { desktop: accessibility }
    assert.deepEqual(
      accessibility.filter(({ impact }) =>
        ['serious', 'critical'].includes(impact)
      ),
      [],
      'No serious or critical accessibility violations'
    )
    await page.setViewportSize({ width: 390, height: 844 })
    await ready(page)
    await page.getByRole('slider', { name: 'Browse files by date' }).focus()
    const mobileAccessibility = await page.evaluate(async () => {
      const result = await window.axe.run(document, {
        runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] },
      })
      return result.violations.map(({ id, impact, nodes }) => ({
        id,
        impact,
        targets: nodes.map(({ target }) => target),
      }))
    })
    evidence.accessibility.mobile = mobileAccessibility
    assert.deepEqual(
      mobileAccessibility.filter(({ impact }) =>
        ['serious', 'critical'].includes(impact)
      ),
      [],
      'No serious or critical mobile accessibility violations with the date rail focused'
    )
    await details.ctx.close()

    if (videos) {
      const mobileDemo = await context(browser, storageState, true, true)
      page = mobileDemo.page
      await page.goto(origin + '/dashboard')
      await ready(page)
      const demoRail = page.getByRole('slider', {
        name: 'Browse files by date',
      })
      await demoRail.hover()
      await pause(page, 3000)
      await page.mouse.move(180, 650)
      await page.mouse.wheel(0, 900)
      await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(800)
      await ready(page)
      await demoRail.hover()
      await pause(page, 3000)
      await demoRail.press('End')
      await expect(page.locator('[data-file-index="11999"]')).toBeAttached()
      await ready(page)
      await demoRail.evaluate((element) => element.blur())
      await demoRail.hover()
      await pause(page, 4000)
      await top(page)
      await demoRail.evaluate((element) => element.blur())
      await demoRail.hover()
      await pause(page, 3000)
      const mobileVideo = page.video()
      await mobileDemo.ctx.close()
      await saveRecording(mobileVideo, 'timeline-mobile')
    }
    assert.deepEqual(errors, [], 'No browser JavaScript errors')
    if (process.env.FLARE_TIMELINE_RESULTS) {
      await writeFile(
        process.env.FLARE_TIMELINE_RESULTS,
        JSON.stringify({ results, ...evidence }, null, 2) + '\n'
      )
    }
    console.log(JSON.stringify(evidence, null, 2))
  } catch (error) {
    if (page && !page.isClosed()) {
      console.error(
        'Browser failure state:',
        await page
          .evaluate(() => ({
            url: location.pathname + location.search,
            scrollY,
            date: document
              .querySelector('[role="slider"]')
              ?.getAttribute('aria-valuetext'),
            railPosition: document
              .querySelector('[role="slider"]')
              ?.getAttribute('aria-valuenow'),
            listHeight: document.querySelector(
              '[role="list"][aria-label="Your files"]'
            )?.style.height,
            indices: [...document.querySelectorAll('[data-file-index]')].map(
              (element) => element.dataset.fileIndex
            ),
          }))
          .catch(() => null)
      )
      await page
        .screenshot({ path: '/tmp/flare-timeline-browser-failure.png' })
        .catch(() => {})
    }
    throw error
  } finally {
    await browser.close()
  }
}
main().catch((error) => {
  console.error(error.stack)
  process.exitCode = 1
})
