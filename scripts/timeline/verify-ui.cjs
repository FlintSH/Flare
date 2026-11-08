/* eslint-disable @typescript-eslint/no-require-imports */
// Exercise the real server and seeded account. Only the explicit recovery check
// aborts one network request; all recordings use real, successful server responses.
const assert = require('node:assert/strict')
const { execFile } = require('node:child_process')
const { mkdir, mkdtemp, rmdir, writeFile } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const path = require('node:path')
const { promisify } = require('node:util')
const { checkRecordingEncoder, encodeRecording } = require('./recording.cjs')
const {
  chromium,
  expect: baseExpect,
} = require('../../docs/site/node_modules/@playwright/test')
const sharp = require('../../docs/site/node_modules/sharp')
const expect = baseExpect.configure({ timeout: 90_000 })
const execFileAsync = promisify(execFile)

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
  archiveSelections: [],
}

async function selectionAction(page, name) {
  if (page.viewportSize().width < 640) {
    await page.getByRole('button', { name: 'Actions', exact: true }).click()
    await page.getByRole('menuitem', { name, exact: true }).click()
  } else {
    await page.getByRole('button', { name, exact: true }).click()
  }
}
async function finishSelection(page) {
  // Exercise the sticky control retained beside a deep-library selection,
  // independently of the matching Done control in the library heading.
  const bar = page.locator('div[aria-busy]').filter({
    has: page.getByRole('checkbox', {
      name: 'Select visible files',
      exact: true,
    }),
  })
  await expect(bar).toHaveCount(1)
  const done = bar.getByRole('button', {
    name: page.viewportSize().width < 640 ? 'Done selecting files' : 'Done',
    exact: true,
  })
  await expect(bar).toBeInViewport()
  await expect(done).toBeInViewport()
  await done.click()
  await expect(bar).toHaveCount(0)
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
    page
      .locator('[data-file-index] [data-file-card] a[data-file-primary]')
      .first()
  ).toBeAttached()
}

async function top(page) {
  await page.getByRole('slider', { name: 'Browse files by date' }).press('Home')
  await ready(page)
  await expect(page.locator('[data-file-index="0"]')).toBeAttached()
  await page.evaluate(() => window.scrollTo(0, 0))
}

// A card's hover veil fails the contrast check while it fades in, so an
// accessibility scan needs nothing under the pointer and no running transition.
async function clearPointer(page) {
  await page.mouse.move(0, 0)
  await page.waitForFunction(() =>
    document
      .getAnimations()
      .every(
        (animation) =>
          !(animation instanceof CSSTransition) ||
          animation.playState !== 'running'
      )
  )
}

async function verifyArchiveSelection(page) {
  const selectedNames = [
    'Alpine morning 00001.webp',
    'Pacific coast 00002.webp',
  ]
  const archiveRequests = []
  const onRequest = (request) => {
    if (
      request.method() === 'POST' &&
      new URL(request.url()).pathname === '/api/files/archive'
    ) {
      archiveRequests.push(request.postDataJSON())
    }
  }
  page.on('request', onRequest)
  try {
    await top(page)
    await page
      .getByRole('button', { name: 'Select files', exact: true })
      .click()
    for (const name of selectedNames) {
      await page
        .getByRole('checkbox', { name: `Select ${name}`, exact: true })
        .check()
    }
    // A date-rail seek releases the row retained for keyboard focus.
    await top(page)
    const selectedCards = page.locator(
      '[data-file-index="0"], [data-file-index="1"]'
    )
    for (let step = 0; step < 10; step++) {
      await page.mouse.wheel(0, 600)
      await page.waitForTimeout(200)
      if ((await selectedCards.count()) === 0) break
    }
    await ready(page)
    await expect(selectedCards).toHaveCount(0, { timeout: 15_000 })
    await expect(
      page.getByText('2 selected · up to 100', { exact: true })
    ).toBeInViewport()
    await selectionAction(page, 'Create archive')
    const dialog = page.getByRole('dialog', {
      name: 'Create archive',
      exact: true,
    })
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText('Save 2 selected files')
    await dialog.getByText('Selected files (2)', { exact: true }).click()
    const members = dialog.getByRole('list', {
      name: 'Selected archive files',
      exact: true,
    })
    await expect(members.getByRole('listitem')).toHaveCount(2)
    assert.deepEqual(
      await members.locator('li > span:first-child').allTextContents(),
      selectedNames
    )
    await expect(
      dialog.getByRole('textbox', { name: 'Archive name', exact: true })
    ).toHaveValue('Archive.zip')
    await expect(
      dialog.getByRole('combobox', { name: 'Format', exact: true })
    ).toHaveText('ZIP')
    await expect(
      dialog.getByRole('combobox', { name: 'Upload profile', exact: true })
    ).toHaveText('Private (no profile)')
    await expect(
      dialog.getByRole('button', { name: 'Create archive', exact: true })
    ).toBeEnabled()
    if (page.viewportSize().width > 1000)
      await screenshot(page, 'library-archive')
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(dialog).toBeHidden()
    await expect(
      page.getByText('0 selected · up to 100', { exact: true })
    ).toBeInViewport()
    assert.deepEqual(
      archiveRequests,
      [],
      'Opening and canceling the dialog must not create an archive'
    )
    evidence.archiveSelections.push({
      viewport: page.viewportSize(),
      selectedNames,
      submitted: false,
    })
    await finishSelection(page)
    await top(page)
    passed(
      `Create archive retains both unmounted selections at ${page.viewportSize().width}px; Cancel clears selection without creating a file`
    )
  } finally {
    page.off('request', onRequest)
  }
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

async function verifyTouchSeekContinuity(browser, storageState) {
  const ctx = await browser.newContext({
    storageState,
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 1,
    colorScheme: 'dark',
    reducedMotion: 'reduce',
    timezoneId: 'UTC',
  })
  const page = await ctx.newPage()
  const trace = {
    method:
      'Chromium390×844 coarse/touch emulation, real CDP touch drags and per-animation-frame DOM samples; not a physical phone',
    drags: [],
    requests: [],
    errors: [],
    consoleMessages: [],
  }
  evidence.touchSeeks = trace
  page.on('pageerror', (error) => trace.errors.push(error.message))
  page.on('console', (message) => {
    if (['warning', 'error'].includes(message.type()))
      trace.consoleMessages.push({ type: message.type(), text: message.text() })
  })
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (url.pathname === '/api/files') trace.requests.push(url.search)
  })
  try {
    await page.goto(origin + '/dashboard')
    await ready(page)
    assert.equal(
      await page.evaluate(() => matchMedia('(pointer: coarse)').matches),
      true
    )
    await page.evaluate(() => {
      window.__flareTouchSeek = { active: false, samples: [] }
      const sampleFrame = () => {
        const trace = window.__flareTouchSeek
        if (trace.active) {
          const header =
            document
              .querySelector('[aria-label="Main navigation"]')
              ?.closest('header')
              ?.getBoundingClientRect().bottom ?? 0
          const mounted = [...document.querySelectorAll('[data-file-index]')]
          const visible = mounted.flatMap((element) => {
            const child = element.firstElementChild,
              rect = child?.getBoundingClientRect(),
              component = child?.matches('[data-file-card]') ? child : null,
              kind = component?.dataset.fileKind,
              primaries = component
                ? [...component.querySelectorAll('a[data-file-primary]')]
                : [],
              primary = primaries.length === 1 ? primaries[0] : null,
              primaryBox = primary?.getBoundingClientRect(),
              primaryHref = primary?.getAttribute('href'),
              fileName = component
                ?.querySelector('[data-file-name]')
                ?.getAttribute('title'),
              primaryName = primary?.getAttribute('aria-label'),
              loaded =
                !!component &&
                ['image', 'generic'].includes(kind) &&
                !component.hidden &&
                component.getAttribute('aria-hidden') !== 'true' &&
                getComputedStyle(component).visibility === 'visible' &&
                !!primaryBox &&
                primaryBox.width > 0 &&
                primaryBox.height > 0 &&
                getComputedStyle(primary).visibility === 'visible' &&
                !!primaryHref?.startsWith('/') &&
                !primaryHref.startsWith('//') &&
                primary.origin === location.origin &&
                !!fileName &&
                primaryName ===
                  (kind === 'image' ? 'Open ' + fileName : fileName)
            return rect &&
              rect.height > 0 &&
              rect.bottom > Math.max(80, header) &&
              rect.top < innerHeight
              ? [
                  {
                    index: Number(element.dataset.fileIndex),
                    top: rect.top,
                    bottom: rect.bottom,
                    loaded,
                    kind: kind ?? null,
                    primaryCount: primaries.length,
                    primaryHref: primaryHref ?? null,
                    primaryName: primaryName ?? null,
                  },
                ]
              : []
          })
          trace.samples.push({
            time: performance.now(),
            scrollY,
            mounted: mounted.length,
            visible,
            busy: document
              .querySelector('[role="list"][aria-label="Your files"]')
              ?.getAttribute('aria-busy'),
            loadingStatus: [
              ...document.querySelectorAll('[role="status"]'),
            ].some((element) => element.textContent === 'Loading files'),
          })
        }
        requestAnimationFrame(sampleFrame)
      }
      requestAnimationFrame(sampleFrame)
    })
    const cdp = await ctx.newCDPSession(page)
    const touch = (type, x, y) =>
      cdp.send('Input.dispatchTouchEvent', {
        type,
        touchPoints:
          type === 'touchEnd'
            ? []
            : [{ id: 0, x, y, radiusX: 4, radiusY: 4, force: 1 }],
      })
    const rail = page.getByRole('slider', { name: 'Browse files by date' })
    // Exercise the inset boundary before another drag warms this context's cache.
    // Use native CDP touch input and real keys, without a wheel nudge or React internals.
    trace.keyboardAfterTouch = {
      method:
        'Fresh390×844 coarse context: Home, native CDP8-move thumb drag to logical row7979 (35ms per move), release, two ArrowDown/ArrowUp cycles, then Home; no wheel nudge or React internals',
      observations: [],
    }
    const settleKeyboardRow = async (action, expectedRow) => {
      await ready(page)
      await page.waitForFunction(() =>
        [...document.querySelectorAll('[data-file-index] img')].every(
          (image) => image.complete && image.naturalWidth > 0
        )
      )
      await page.waitForTimeout(300)
      const observation = {
        action,
        expectedRow,
        row: Number(await rail.getAttribute('aria-valuenow')) - 1,
        firstVisibleIndex: Number(await firstVisibleIndex(page)),
        scrollY: await page.evaluate(() => scrollY),
      }
      trace.keyboardAfterTouch.observations.push(observation)
      await persistTimelineDiagnostics()
      assert.equal(
        observation.row,
        expectedRow,
        `${action}: the date rail reports the actual leading logical row`
      )
      assert.equal(
        observation.firstVisibleIndex,
        expectedRow,
        `${action}: the destination is the first visible file`
      )
      await expect(
        page.locator(`[data-file-index="${expectedRow}"]`)
      ).toBeInViewport()
    }
    await rail.press('Home')
    await settleKeyboardRow('initial Home', 0)
    const initialHandle = await page
      .locator('[data-date-rail-handle]')
      .boundingBox()
    const initialTrack = await page
      .locator('[data-date-rail-track]')
      .boundingBox()
    assert(initialHandle && initialTrack)
    const initialX = initialHandle.x + initialHandle.width / 2
    const initialY = initialHandle.y + initialHandle.height / 2
    const destinationY =
      initialTrack.y + 22 + ((initialTrack.height - 44) * 7979) / 11999
    await touch('touchStart', initialX, initialY)
    try {
      await expect(page.locator('[data-date-rail-handle]')).toHaveAttribute(
        'data-dragging',
        'true'
      )
      for (let step = 1; step <= 8; step++) {
        await touch(
          'touchMove',
          initialX,
          initialY + ((destinationY - initialY) * step) / 8
        )
        await page.waitForTimeout(35)
      }
    } finally {
      await touch('touchEnd')
    }
    await settleKeyboardRow('touch release', 7979)
    for (let cycle = 1; cycle <= 2; cycle++) {
      await rail.press('ArrowDown')
      await settleKeyboardRow(`cycle${cycle} ArrowDown`, 7980)
      await rail.press('ArrowUp')
      await settleKeyboardRow(`cycle${cycle} ArrowUp`, 7979)
    }
    await rail.press('Home')
    await settleKeyboardRow('restored Home', 0)
    for (const oldest of [true, false]) {
      const name = oldest ? 'first' : 'return'
      const handle = await page.locator('[data-date-rail-handle]').boundingBox()
      const track = await rail.boundingBox()
      assert(handle && track)
      assert(handle.width >= 43.99 && handle.height >= 43.99)
      const x = handle.x + handle.width / 2
      const from = handle.y + handle.height / 2
      const to = oldest
        ? track.y + track.height - handle.height / 2
        : track.y + handle.height / 2
      const geometry = []
      await page.evaluate(() => {
        window.__flareTouchSeek.samples = []
        window.__flareTouchSeek.active = true
      })
      await touch('touchStart', x, from)
      try {
        for (let step = 1; step <= 20; step++) {
          await touch('touchMove', x, from + ((to - from) * step) / 20)
          await page.waitForTimeout(80)
          geometry.push(await rail.boundingBox())
          if (screenshots && [5, 15].includes(step)) {
            await mkdir(screenshots, { recursive: true })
            // Keep this actual in-flight frame, including any loading state.
            // Settled-frame retries would hide the regression being tested.
            await page.screenshot({
              path: path.join(
                screenshots,
                `library-touch-${name}-drag-${step}.png`
              ),
            })
          }
        }
        await ready(page)
        await expect(rail).toHaveAttribute(
          'aria-valuetext',
          oldest ? 'July 2018' : 'October 2026'
        )
        await expect(
          page.locator(`[data-file-index="${oldest ? 11999 : 0}"]`)
        ).toBeInViewport()
      } finally {
        await touch('touchEnd')
        const samples = await page.evaluate(() => {
          window.__flareTouchSeek.active = false
          return window.__flareTouchSeek.samples
        })
        trace.drags.push({
          name,
          steps: 20,
          pauseBetweenMovesMs: 80,
          track,
          geometry,
          samples,
        })
      }
      const samples = trace.drags.at(-1).samples
      assert(
        samples.length >= 20,
        'Sample actual rendered frames throughout the drag'
      )
      assert(
        samples.every((sample) => sample.visible.length > 0),
        `${name} touch seek always shows real cards or loading placeholders`
      )
      assert(
        samples.every(
          (sample) =>
            sample.visible.every((file) => file.loaded) ||
            (sample.busy === 'true' && sample.loadingStatus)
        ),
        'Destination placeholders retain the named Loading files busy status'
      )
      assert(
        samples.every((sample) => sample.mounted <= 100),
        'Continuous seeks keep the mounted card window bounded'
      )
      assert(
        geometry.every(
          (rect) =>
            rect &&
            Math.abs(rect.y - track.y) <= 1 &&
            Math.abs(rect.height - track.height) <= 1
        ),
        'The rail remains fixed under the finger'
      )
    }
    assert.deepEqual(trace.errors, [])
    assert.deepEqual(
      trace.consoleMessages.filter(({ text }) =>
        /flushSync|Cannot update a component|while rendering/i.test(text)
      ),
      [],
      'Event-only seeking emits no React lifecycle warnings'
    )
    passed(
      'Real coarse touch drags to oldest and back retain visible cards or loading placeholders on every sampled frame'
    )
  } finally {
    await ctx.close()
    trace.contextClosed = true
  }
}

async function cardHeights(
  page,
  selector = '[data-file-index] > :first-child'
) {
  return page.evaluate(
    (selector) => [
      ...new Set(
        [...document.querySelectorAll(selector)].map(
          (card) => Math.round(card.getBoundingClientRect().height * 10) / 10
        )
      ),
    ],
    selector
  )
}

// Intrinsic cards may differ; each measured row must still
// contain its tallest member and preserve actual spacing and content bounds.
async function naturalRowGeometry(page, stage) {
  const geometry = await page.evaluate(async () => {
    const rect = (element) => {
      if (!element) return null
      const r = element.getBoundingClientRect()
      return {
        x: r.x,
        y: r.y,
        right: r.right,
        bottom: r.bottom,
        width: r.width,
        height: r.height,
      }
    }
    let last = '',
      same = 0,
      frames = 0
    const stability = await new Promise((resolve) => {
      const frame = () => {
        const key = [...document.querySelectorAll('[data-row]')]
          .map((row) => {
            const r = row.getBoundingClientRect()
            return [
              row.dataset.row,
              r.y,
              r.height,
              ...[
                ...row.querySelectorAll('[data-file-index] > :first-child'),
              ].map((card) => card.getBoundingClientRect().height),
            ].join(',')
          })
          .join(';')
        same = key === last ? same + 1 : 0
        last = key
        if (++frames >= 180 || same >= 8)
          resolve({ stable: same >= 8, frames, stableFrames: same })
        else requestAnimationFrame(frame)
      }
      requestAnimationFrame(frame)
    })
    const rows = [...document.querySelectorAll('[data-row]')].map((row) => {
      const style = getComputedStyle(row),
        grid = row.querySelector(':scope > .grid')
      const content = grid || row.querySelector(':scope > h2')
      const members = [...row.querySelectorAll('[data-file-index]')].map(
        (slot) => {
          const card = slot.firstElementChild,
            loaded = card?.hasAttribute('data-file-card')
          const details = loaded
            ? card.querySelector(':scope > .border-t')
            : null
          const detailStyle = details ? getComputedStyle(details) : null
          const detailChildren = details
            ? [...details.children].filter(
                (child) => child.getBoundingClientRect().height > 0
              )
            : []
          const detailHeight = details
            ? detailChildren.reduce(
                (sum, child) => sum + child.getBoundingClientRect().height,
                0
              ) +
              Math.max(0, detailChildren.length - 1) *
                (parseFloat(detailStyle.rowGap) || 0) +
              parseFloat(detailStyle.paddingTop) +
              parseFloat(detailStyle.paddingBottom) +
              parseFloat(detailStyle.borderTopWidth) +
              parseFloat(detailStyle.borderBottomWidth)
            : null
          return {
            index: Number(slot.dataset.fileIndex),
            slot: rect(slot),
            card: rect(card),
            loaded,
            heading: rect(card?.querySelector('[data-file-heading]')),
            filename: rect(card?.querySelector('[data-file-name]')),
            preview: rect(loaded ? card.children[1] : null),
            previewLink: rect(card?.querySelector('[data-file-preview]')),
            previewRegionChildren: loaded
              ? [...card.children[1].children]
                  .map(rect)
                  .filter((r) => r && r.width > 0 && r.height > 0)
              : [],
            details: rect(details),
            detailChildren: detailChildren.map(rect),
            intrinsicDetailsHeight: detailHeight,
            activity: rect(card?.querySelector('[data-file-activity]')),
          }
        }
      )
      return {
        index: Number(row.dataset.row),
        row: rect(row),
        content: rect(content),
        paddingTop: parseFloat(style.paddingTop),
        paddingBottom: parseFloat(style.paddingBottom),
        borderTop: parseFloat(style.borderTopWidth),
        borderBottom: parseFloat(style.borderBottomWidth),
        grid: !!grid,
        members,
      }
    })
    return {
      stability,
      viewport: { width: innerWidth, height: innerHeight },
      scrollY,
      rootFont: getComputedStyle(document.documentElement).fontSize,
      listBusy: document
        .querySelector('[role="list"][aria-label="Your files"]')
        ?.getAttribute('aria-busy'),
      date: document
        .querySelector('[role="slider"]')
        ?.getAttribute('aria-valuetext'),
      rows,
    }
  })
  const entry = { stage, ...geometry }
  evidence.naturalRowGeometry ||= []
  evidence.naturalRowGeometry.push(entry)
  await persistTimelineDiagnostics()
  return geometry
}

function assertNaturalRows(geometry, stage) {
  const close = (a, b, message) =>
    assert.ok(Math.abs(a - b) <= 1, `${stage}: ${message} (${a} vs ${b})`)
  const inside = (a, b, message) =>
    assert.ok(
      a &&
        b &&
        a.x >= b.x - 1 &&
        a.right <= b.right + 1 &&
        a.y >= b.y - 1 &&
        a.bottom <= b.bottom + 1,
      `${stage}: ${message}`
    )
  assert.equal(
    geometry.stability.stable,
    true,
    `${stage}: measured rows settle within180RAF`
  )
  assert(geometry.rows.length > 0, `${stage}: mounted rows exist`)
  const rowIndices = geometry.rows.map((row) => row.index)
  assert.equal(
    new Set(rowIndices).size,
    rowIndices.length,
    `${stage}: unique logical rows`
  )
  assert.deepEqual(
    rowIndices,
    [...rowIndices].sort((a, b) => a - b),
    `${stage}: chronological logical row order`
  )
  const allFiles = geometry.rows.flatMap((row) =>
    row.members.map((member) => member.index)
  )
  assert.equal(
    new Set(allFiles).size,
    allFiles.length,
    `${stage}: unique mounted file indices`
  )
  assert.deepEqual(
    allFiles,
    [...allFiles].sort((a, b) => a - b),
    `${stage}: mounted file index order`
  )
  for (const [i, row] of geometry.rows.entries()) {
    assert(
      row.row.height > 0 && row.content?.height > 0,
      `${stage}: positive row and content height`
    )
    inside(row.content, row.row, 'row contains its grid or date heading')
    close(
      row.content.y,
      row.row.y + row.paddingTop + row.borderTop,
      'content starts at its measured row inset'
    )
    close(
      row.row.height,
      row.content.height +
        row.paddingTop +
        row.paddingBottom +
        row.borderTop +
        row.borderBottom,
      'row height equals intrinsic content plus actual padding/borders'
    )
    close(
      row.paddingBottom,
      16,
      'normal-text row reserves its source-defined16px gap'
    )
    if (row.grid) {
      assert(row.members.length > 0, `${stage}: file row has members`)
      close(
        row.content.bottom,
        Math.max(...row.members.map((member) => member.card.bottom)),
        'grid ends at tallest intrinsic member'
      )
      for (const member of row.members) {
        assert(member.card?.height > 0, `${stage}: positive member height`)
        inside(member.slot, row.content, 'grid contains each member slot')
        inside(
          member.card,
          member.slot,
          'member slot contains its own intrinsic card'
        )
        close(
          member.card.height,
          member.slot.height,
          'member slot ends at its own card rather than stretching to siblings'
        )
        close(
          member.card.y,
          row.content.y,
          'row member top aligns with its grid'
        )
        if (member.loaded) {
          for (const [name, region] of Object.entries({
            heading: member.heading,
            filename: member.filename,
            preview: member.preview,
            details: member.details,
            activity: member.activity,
          })) {
            assert(
              region?.height > 0 && region.width > 0,
              `${stage}: ${name} has positive native bounds`
            )
            inside(region, member.card, `${name} remains within its own card`)
          }
          inside(member.filename, member.heading, 'heading contains filename')
          inside(
            member.previewLink,
            member.preview,
            'full preview region contains its Link'
          )
          for (const regionChild of member.previewRegionChildren)
            inside(
              regionChild,
              member.preview,
              'preview region contains its Link, badges and controls'
            )
          assert(
            member.heading.bottom <= member.preview.y + 1,
            `${stage}: filename heading does not overlap preview`
          )
          close(
            member.preview.bottom,
            member.details.y,
            'preview and own details meet without a blank body'
          )
          close(
            member.details.height,
            member.intrinsicDetailsHeight,
            'details height equals actual child content, gaps and chrome'
          )
          for (const child of member.detailChildren)
            inside(child, member.details, 'detail child remains contained')
        }
      }
    }
    const next = geometry.rows[i + 1]
    if (next) {
      assert(
        next.row.y >= row.row.bottom - 1,
        `${stage}: mounted row boxes never overlap`
      )
      if (next.index === row.index + 1)
        close(
          next.row.y,
          row.row.bottom,
          'consecutive logical row wrappers are adjacent with no virtual hole'
        )
    }
  }
  const visible = geometry.rows.filter(
    (row) => row.row.bottom > 0 && row.row.y < geometry.viewport.height
  )
  for (let i = 1; i < visible.length; i++)
    assert.equal(
      visible[i].index,
      visible[i - 1].index + 1,
      `${stage}: visible rows have no missing logical row`
    )
}

async function predeclareWheelAnchors(page, stage, delta) {
  const beforeRows = await naturalRowGeometry(page, stage + '-before-input')
  assertNaturalRows(beforeRows, stage + '-before-input')
  const focusHandle = await page.evaluateHandle(() => document.activeElement)
  const record = await page.evaluate(
    ({ stage, delta }) => {
      const navigation = document.querySelector(
        '[aria-label="Main navigation"]'
      )
      const headerBottom =
        navigation?.closest('header')?.getBoundingClientRect().bottom ?? 0
      const focus = document.activeElement
      const focusDescription = {
        tag: focus?.tagName ?? null,
        id: focus?.id ?? null,
        role: focus?.getAttribute('role') ?? null,
        label: focus?.getAttribute('aria-label') ?? null,
        fileIndex:
          focus
            ?.closest('[data-file-index]')
            ?.getAttribute('data-file-index') ?? null,
      }
      const candidates = [
        ...document.querySelectorAll('[data-file-index]'),
      ].map((slot) => {
        const r = slot.getBoundingClientRect(),
          loaded =
            slot.firstElementChild?.hasAttribute('data-file-card') === true
        const predictedY = r.y - delta,
          predictedBottom = r.bottom - delta
        return {
          index: Number(slot.dataset.fileIndex),
          row: Number(slot.closest('[data-row]').dataset.row),
          loaded,
          before: {
            x: r.x,
            y: r.y,
            right: r.right,
            bottom: r.bottom,
            width: r.width,
            height: r.height,
          },
          predictedY,
          predictedBottom,
          selected:
            loaded &&
            r.height > 0 &&
            r.width > 0 &&
            predictedBottom > headerBottom &&
            predictedY < innerHeight,
        }
      })
      const selected = candidates
        .filter((c) => c.selected)
        .sort((a, b) => a.index - b.index)
      return {
        stage,
        delta,
        viewport: { width: innerWidth, height: innerHeight, headerBottom },
        beforeScrollY: scrollY,
        beforeFocus: focusDescription,
        candidates,
        selected,
        deterministicRebaseAnchor: selected[0]
          ? { index: selected[0].index, row: selected[0].row }
          : null,
        beforeInputRecorded: true,
        afterInputRecorded: false,
      }
    },
    { stage, delta }
  )
  evidence.nativeWheelContinuity ||= []
  evidence.nativeWheelContinuity.push(record)
  await persistTimelineDiagnostics()
  assert(
    record.selected.length > 0,
    `${stage}: loaded mounted cards intersect the predicted post-wheel viewport`
  )
  return { record, focusHandle }
}

async function persistTimelineDiagnostics() {
  const directory = process.env.FLARE_TIMELINE_RESULTS
    ? path.dirname(process.env.FLARE_TIMELINE_RESULTS)
    : screenshots
  if (!directory) return
  await mkdir(directory, { recursive: true })
  await writeFile(
    path.join(directory, 'timeline-diagnostics.json'),
    JSON.stringify({ completedChecks: results, ...evidence }, null, 2) + '\n'
  )
}

async function measureWheelAnchorsAfter(page, declaration) {
  const { record, focusHandle } = declaration
  const afterRows = await naturalRowGeometry(
    page,
    record.stage + '-after-input'
  )
  record.afterRowsStage = record.stage + '-after-input'
  record.afterScrollY = afterRows.scrollY
  record.after = record.selected.map((anchor) => {
    const member = afterRows.rows
      .flatMap((row) => row.members)
      .find((member) => member.index === anchor.index)
    return {
      index: anchor.index,
      row: anchor.row,
      before: anchor.before,
      mounted: !!member,
      actual: member?.slot ?? null,
      pixelError: member
        ? Math.abs(member.slot.y - anchor.before.y + record.delta)
        : null,
    }
  })
  record.focusIdentityUnchanged = await page.evaluate(
    (before) => document.activeElement === before,
    focusHandle
  )
  record.afterFocus = await page.evaluate(() => {
    const focus = document.activeElement
    return {
      tag: focus?.tagName ?? null,
      id: focus?.id ?? null,
      role: focus?.getAttribute('role') ?? null,
      label: focus?.getAttribute('aria-label') ?? null,
      fileIndex:
        focus?.closest('[data-file-index]')?.getAttribute('data-file-index') ??
        null,
    }
  })
  record.afterInputRecorded = true
  await persistTimelineDiagnostics()
  await focusHandle.dispose()
  assertNaturalRows(afterRows, record.stage + '-after-input')
  assert.equal(
    record.focusIdentityUnchanged,
    true,
    `${record.stage}: native wheel leaves actual focus unchanged`
  )
  for (const anchor of record.after) {
    assert.equal(
      anchor.mounted,
      true,
      `${record.stage}: predeclared predicted-visible file${anchor.index} stays mounted`
    )
    assert(
      anchor.pixelError <= 5,
      `${record.stage}: file${anchor.index} preserves its predicted native position (${anchor.pixelError}px error)`
    )
  }
  record.maxPixelError = Math.max(
    ...record.after.map((anchor) => anchor.pixelError)
  )
  await persistTimelineDiagnostics()
  return record.maxPixelError
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
  // Cards with and without tags or a folder.
  value.cardHeights = await cardHeights(page)
  assert.ok(
    value.mountedFiles <= 100,
    `${stage}: ${value.mountedFiles} mounted cards`
  )
  value.naturalRows = await naturalRowGeometry(page, stage)
  assertNaturalRows(value.naturalRows, stage)
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

async function verifyNamedReads(ctx) {
  const started = new Date().toISOString()
  const created = []
  const ownedId = 'timeline-demo-file-00000'
  const foreignId = 'timeline-demo-other-account-file'
  try {
    for (const scope of ['files:read', 'files:upload']) {
      const response = await ctx.request.post(origin + '/api/integrations', {
        headers: { Origin: origin },
        data: {
          action: 'create-token',
          name: `Timeline browser verification ${scope}`,
          scopes: [scope],
        },
      })
      assert.equal(response.status(), 200, 'Create disposable named token')
      created.push(await response.json())
    }
    const [reader, uploader] = created
    for (const endpoint of ['/api/files', '/api/files/timeline']) {
      const url = new URL(endpoint, origin)
      url.searchParams.set('ids', `${ownedId},${foreignId}`)
      if (endpoint === '/api/files') url.searchParams.set('limit', '100')
      else url.searchParams.set('timezone', 'UTC')
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${reader.secret}` },
      })
      assert.equal(response.status, 200, 'Named read scope permits metadata')
      const result = await response.json()
      if (endpoint === '/api/files')
        assert.deepEqual(
          result.data.map((file) => file.id),
          [ownedId]
        )
      else assert.equal(result.data.total, 1)
      const denied = await fetch(url, {
        headers: { Authorization: `Bearer ${uploader.secret}` },
      })
      assert.equal(denied.status, 401, 'Upload-only scope cannot read metadata')
    }
    const { stdout } = await execFileAsync(
      process.execPath,
      ['examples/integrations.mjs', 'files', ownedId, foreignId],
      { env: { ...process.env, FLARE_URL: origin, FLARE_TOKEN: reader.secret } }
    )
    assert.deepEqual(
      JSON.parse(stdout).data.map((file) => file.id),
      [ownedId]
    )
    const audit = await ctx.request.get(
      origin +
        '/api/audit?' +
        new URLSearchParams({ action: 'http.get', from: started, limit: '100' })
    )
    assert.equal(audit.status(), 200)
    const { events } = await audit.json()
    for (const route of ['/api/files', '/api/files/timeline']) {
      assert.ok(
        events.some(
          (event) =>
            event.route === route &&
            event.actorId === 'timeline-demo-alex' &&
            event.details.tokenId === reader.token.id &&
            event.outcome === 'success'
        ),
        `Named read is attributed to its owner and token at ${route}`
      )
      assert.ok(
        events.some(
          (event) =>
            event.route === route &&
            event.actorId === null &&
            event.outcome === 'denied'
        ),
        `Rejected read scope is audited at ${route}`
      )
    }
    assert.ok(!JSON.stringify(events).includes(reader.secret))
    assert.ok(!JSON.stringify(events).includes(uploader.secret))
    passed(
      'Named-token selected-ID reads and the example client enforce ownership/scope and audit the owner/token without credentials'
    )
  } finally {
    for (const entry of created) {
      const response = await ctx.request.post(origin + '/api/integrations', {
        headers: { Origin: origin },
        data: { action: 'revoke-token', id: entry.token.id },
      })
      assert.equal(response.status(), 200, 'Revoke disposable named token')
    }
  }
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
    const selected = await page
      .getByText(/^\d+ selected · up to 100$/)
      .textContent()
    assert.match(selected, /^[1-9]\d* selected · up to 100$/)
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
    await finishSelection(page)
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
    const searchCards = page.locator('[data-file-index] [data-file-card]')
    const names = await searchCards
      .locator('[data-file-name]')
      .allTextContents()
    assert.ok(names.length > 0)
    assert.ok(
      names.every((name) => name.includes('Northern lights')),
      'Every mounted result exposes its complete matching filename'
    )
    await expect(
      searchCards.locator('a[data-file-primary]').first()
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
    // Check the middle of history: near the bottom, native scroll clamping
    // could conceal a lost width-only anchor while still showing the oldest.
    const wideRail = page.getByRole('slider', { name: 'Browse files by date' })
    const wideRailBox = await wideRail.boundingBox()
    await page.mouse.click(
      wideRailBox.x + wideRailBox.width / 2,
      wideRailBox.y + wideRailBox.height / 2
    )
    await expect(page.locator('[data-file-index="6000"]')).toBeAttached()
    await ready(page)
    const monthBeforeResize = await wideRail.getAttribute('aria-valuetext')
    const wideAnchor = await firstVisibleIndex(page)
    const libraryList = page.getByRole('list', {
      name: 'Your files',
      exact: true,
    })
    const widthBeforeResize = (await libraryList.boundingBox()).width
    await page.setViewportSize({ width: 1320, height: 1000 })
    await columns(page, 4)
    await expect
      .poll(async () =>
        Math.abs((await libraryList.boundingBox()).width - widthBeforeResize)
      )
      .toBeGreaterThan(1)
    await ready(page)
    await expect(
      page.locator(`[data-file-index="${wideAnchor}"]`)
    ).toBeInViewport()
    await expect(
      page.getByRole('slider', { name: 'Browse files by date' })
    ).toHaveAttribute('aria-valuetext', monthBeforeResize)
    await sample(page, 'resized-same-columns-middle')
    await wideRail.press('End')
    await expect(page.locator('[data-file-index="11999"]')).toBeAttached()
    await expect(wideRail).toHaveAttribute('aria-valuetext', 'July 2018')
    await ready(page)
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
    // The rail clears the library header at the top, then follows the viewport.
    // Read its current bounds for each seek after scrolling.
    const clickPhoneRailRow = async (index) => {
      // Native Home/top scrolling can reposition the rail after loaded rows are
      // ready. Measure its settled position before computing pointer coordinates.
      const box = await settledBox(phoneRail)
      await page.mouse.click(
        box.x + box.width / 2,
        box.y + 22 + (box.height - 44) * (index / 11999)
      )
    }
    await clickPhoneRailRow(7970)
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
    await clickPhoneRailRow(7979)
    const seamAnchor = page.locator('[data-file-index="7979"]')
    await expect(seamAnchor).toBeAttached()
    await ready(page)
    await settledBox(seamAnchor)
    const forwardWheel = await predeclareWheelAnchors(
      page,
      'native-forward-seam',
      900
    )
    await page.mouse.move(180, 500)
    await page.mouse.wheel(0, 900)
    await expect
      .poll(async () => Number(await phoneRail.getAttribute('aria-valuenow')))
      .toBeGreaterThan(7980)
    await expect
      .poll(async () =>
        Number(
          await page
            .locator(
              `[data-row="${forwardWheel.record.deterministicRebaseAnchor.row}"]`
            )
            .getAttribute('data-index')
        )
      )
      .toBeLessThan(7000)
    await ready(page)
    evidence.nativeSeamPixelError = await measureWheelAnchorsAfter(
      page,
      forwardWheel
    )
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
    await clickPhoneRailRow(4022)
    const reverseAnchor = page.locator('[data-file-index="4022"]')
    await expect(reverseAnchor).toBeAttached()
    await ready(page)
    await settledBox(reverseAnchor)
    const reverseWheel = await predeclareWheelAnchors(
      page,
      'native-reverse-seam',
      -1200
    )
    await page.mouse.move(180, 500)
    await page.mouse.wheel(0, -1200)
    await expect
      .poll(async () => Number(await phoneRail.getAttribute('aria-valuenow')))
      .toBeLessThanOrEqual(4020)
    await expect
      .poll(async () =>
        Number(
          await page
            .locator(
              `[data-row="${reverseWheel.record.deterministicRebaseAnchor.row}"]`
            )
            .getAttribute('data-index')
        )
      )
      .toBeGreaterThan(1000)
    await ready(page)
    evidence.reverseSeamPixelError = await measureWheelAnchorsAfter(
      page,
      reverseWheel
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

    await verifyTouchSeekContinuity(browser, storageState)

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
    await selectionAction(page, 'Create archive')
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
      page.getByText('0 selected · up to 100', { exact: true })
    ).toBeVisible()
    await finishSelection(page)
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
      page.locator('[data-file-index="0"]').getByRole('button', {
        name: 'Show files tagged Favorites',
        exact: true,
      })
    ).toHaveCount(0)
    await page
      .getByRole('slider', { name: 'Browse files by date' })
      .press('End')
    await ready(page)
    await expect(page.locator('[data-file-index="0"]')).toHaveCount(0)
    await selectionAction(page, 'Edit tags')
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
    await finishSelection(page)
    passed(
      'Bulk tags refresh offscreen selections after a real external removal and submit add for the unchecked tag'
    )
    await verifyNamedReads(details.ctx)
    await top(page)
    const primaryPreview = page.getByRole('link', {
      name: 'Open Alpine morning 00001.webp',
      exact: true,
    })
    const previewBounds = await primaryPreview.boundingBox()
    const previewPoint = {
      x: previewBounds.width / 2,
      y: previewBounds.height / 4,
    }
    // The compact shortcut row occupies the center. Exercise the real primary
    // link at an uncovered point, including its hit target after hover reveals it.
    await primaryPreview.hover({ position: previewPoint })
    assert.ok(
      await primaryPreview.evaluate((element, point) => {
        const box = element.getBoundingClientRect()
        const hit = document.elementFromPoint(box.x + point.x, box.y + point.y)
        return hit === element || element.contains(hit)
      }, previewPoint),
      'The measured preview point must receive primary-link pointer events'
    )
    await primaryPreview.click({ position: previewPoint })
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

    await verifyArchiveSelection(page)

    await page
      .getByRole('button', { name: 'Date and grouping', exact: true })
      .click()
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
    const folderDisclosure = page
      .getByRole('navigation', { name: 'File library', exact: true })
      .getByRole('button', { name: /^Folders \d+$/ })
    await expect(folderDisclosure).toHaveAttribute('aria-expanded', 'false')
    await folderDisclosure.click()
    await expect(folderDisclosure).toHaveAttribute('aria-expanded', 'true')
    const folderDirectory = page.getByRole('region', {
      name: 'Folders',
      exact: true,
    })
    assert.equal(
      await folderDirectory.evaluate(
        (element) => element.scrollHeight > element.clientHeight
      ),
      false,
      'The single-folder fixture has no internal overflow'
    )
    const directoryBox = await folderDirectory.boundingBox()
    await page.mouse.move(
      directoryBox.x + directoryBox.width / 2,
      directoryBox.y + directoryBox.height / 2
    )
    await page.mouse.wheel(0, 500)
    await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(200)
    passed(
      'A non-overflowing folder directory chains wheel scrolling into the file library'
    )
    await page
      .getByRole('region', { name: 'Folders', exact: true })
      .getByRole('button', { name: 'Open folder Travel journal', exact: true })
      .click()
    await expect(
      page.getByText('1,714 files', { exact: true }).first()
    ).toBeVisible()
    await ready(page)
    // Cards inside a folder do not repeat the folder being viewed.
    await expect(
      page.locator('[data-file-index]').getByRole('button', {
        name: 'Open folder Travel journal',
        exact: true,
      })
    ).toHaveCount(0)
    await sample(page, 'folder-travel-journal')
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
    await page
      .getByRole('button', { name: 'Date and grouping', exact: true })
      .click()
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
      page.getByText('0 selected · up to 100', { exact: true })
    ).toBeVisible()
    await finishSelection(page)
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
    // The failed rows keep their loading placeholders until Retry.
    const placeholders = await cardHeights(
      page,
      '[data-file-index] > [aria-hidden="true"]'
    )
    assert.equal(
      placeholders.length,
      1,
      `Loading placeholders share one height (${placeholders.join(', ')})`
    )
    await page.getByRole('button', { name: 'Retry', exact: true }).click()
    await ready(page)
    await expect(
      page.locator('[data-file-index="11999"] a[aria-label^="Open "]')
    ).toBeAttached()
    const retryGeometry = await naturalRowGeometry(
      page,
      'historical-retry-loaded'
    )
    assertNaturalRows(retryGeometry, 'historical-retry-loaded')
    assert.equal(
      retryGeometry.date,
      'July 2018',
      'Retry retains the exact historical month'
    )
    const retryTarget = await page
      .locator('[data-file-index="11999"]')
      .boundingBox()
    assert.ok(
      retryTarget &&
        retryTarget.height > 0 &&
        retryTarget.y < retryGeometry.viewport.height &&
        retryTarget.y + retryTarget.height > 0,
      'Retry retains the actual oldest target in the viewport after intrinsic row remeasurement'
    )
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
    await clearPointer(page)
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
    await verifyArchiveSelection(page)
    await clearPointer(page)
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
    await persistTimelineDiagnostics()
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
      try {
        const directory =
          screenshots ||
          (await mkdtemp(
            path.join(tmpdir(), 'flare-timeline-browser-failure-')
          ))
        await mkdir(directory, { recursive: true })
        const frame = path.join(directory, 'timeline-browser-failure.png')
        await page.screenshot({ path: frame })
        await writeFile(
          path.join(directory, 'timeline-browser-failure.json'),
          JSON.stringify(
            {
              error: { message: error.message, stack: error.stack },
              completedChecks: results,
              ...evidence,
            },
            null,
            2
          ) + '\n'
        )
        console.error('Browser failure artifacts:', directory)
      } catch (artifactError) {
        console.error(
          'Could not save browser failure artifacts:',
          artifactError.message
        )
      }
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
