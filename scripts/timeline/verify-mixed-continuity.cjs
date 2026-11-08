/* eslint-disable @typescript-eslint/no-require-imports */
// Run only with an explicit plan for eight genuine, disposable uploads. This
// reader never uploads, backdates, deletes, mocks responses, or changes roles.
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const crypto = require('node:crypto')
const { PrismaClient } = require('@prisma/client')
const {
  chromium,
  expect: baseExpect,
} = require('../../docs/site/node_modules/@playwright/test')
const expect = baseExpect.configure({ timeout: 30000 })
const sha = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex')

function validatePlan(plan) {
  const origin = new URL(plan.origin)
  assert.equal(plan.schemaVersion, 1)
  assert.equal(origin.protocol, 'http:')
  assert.ok(['localhost', '127.0.0.1'].includes(origin.hostname))
  assert.ok(origin.port)
  assert.equal(origin.origin, plan.origin)
  assert.equal(plan.ownerId, 'timeline-demo-alex')
  assert.equal(plan.originalDbTotal, 12001)
  assert.equal(plan.originalOwnerTotal, 12000)
  assert.equal(plan.expectedDbTotal, 12009)
  assert.equal(plan.expectedOwnerTotal, 12008)
  assert.equal(plan.files.length, 8)
  assert.equal(new Set(plan.files.map((file) => file.id)).size, 8)
  assert.deepEqual(
    plan.files.map((file) => file.rank).sort((a, b) => a - b),
    [4029, 4030, 4031, 4032, 7977, 7978, 7979, 7980]
  )
  assert.equal(
    plan.files.filter((file) => file.mimeType === 'text/plain').length,
    4
  )
  assert.equal(
    plan.files.filter((file) => file.mimeType === 'application/zip').length,
    4
  )
  for (const file of plan.files) {
    assert.match(file.name, /^timeline-mixed-[a-f0-9]+-[0-7]\.(txt|zip)$/)
    assert.ok(file.size > 0 && file.size < 4096)
    assert.ok(file.id && !file.id.startsWith('timeline-demo-'))
  }
  assert.match(plan.source.sha256, /^[a-f0-9]{64}$/)
  assert.ok(Number.isSafeInteger(plan.source.files) && plan.source.files > 0)
  assert.ok(plan.authStorageState && plan.originalFilesSha256)
}

async function sourceCheck(plan) {
  const raw = await fs.readFile(plan.source.inventory)
  assert.equal(sha(raw), plan.source.sha256, 'Plan source inventory changed')
  const source = JSON.parse(raw)
  assert.equal(Object.keys(source).length, plan.source.files)
  for (const [file, expected] of Object.entries(source)) {
    assert.ok(path.resolve(file).startsWith(process.cwd() + path.sep))
    assert.equal(
      sha(await fs.readFile(file)),
      expected,
      'Source changed: ' + file
    )
  }
  return { ...plan.source, allMatching: true, exceptions: [] }
}

async function verifyFixture(prisma, plan) {
  assert.equal(await prisma.file.count(), plan.expectedDbTotal)
  const files = await prisma.file.findMany({
    where: { userId: plan.ownerId },
    orderBy: [{ uploadedAt: 'desc' }, { id: 'desc' }],
  })
  assert.equal(files.length, plan.expectedOwnerTotal)
  for (const expected of plan.files) {
    const actual = files[expected.rank]
    for (const key of ['id', 'name', 'mimeType', 'size', 'urlPath'])
      assert.equal(actual[key], expected[key], 'Plan file/rank differs: ' + key)
    assert.equal(actual.uploadedAt.toISOString(), expected.uploadedAt)
  }
  const originals = await prisma.file.findMany({
    where: { id: { notIn: plan.files.map((file) => file.id) } },
    orderBy: { id: 'asc' },
  })
  assert.equal(originals.length, plan.originalDbTotal)
  assert.equal(sha(JSON.stringify(originals)), plan.originalFilesSha256)
  return { originalFiles: originals.length, originalFilesUnchanged: true }
}

// Reverse-wheel rows newly entering the viewport may have intrinsic heights
// different from their estimates. Declare the effective-content-viewport
// reference before input; account for changes independently of the retained
// offscreen file.
function checkReverseDeclaration(before, anchor, delta) {
  const ledger = before.preInputLedger
  assert.ok(
    ledger?.captured,
    'Read-only public measurement ledger is available'
  )
  assert.equal(ledger.delta, delta)
  assert.equal(ledger.anchor, anchor)
  assert.equal(ledger.nativeY, before.scrollY)
  assert.ok(
    Math.abs(ledger.offset - ledger.nativeY) <= 1,
    'Baseline logical/native offsets agree'
  )
  assert.ok(
    ledger.anchorEntry?.unclamped,
    'Anchor start alignment is not clamped'
  )
  assert.ok(
    Math.abs(ledger.anchorEntry.start - ledger.nativeY - before.y) <= 1,
    'Public document-start ledger matches actual anchor DOM'
  )
  assert.ok(
    ledger.reference?.unclamped,
    'Predeclared viewport reference is not alignment-clamped'
  )
  assert.ok(
    ledger.reference.projectedY >= ledger.padding &&
      ledger.reference.projectedY < ledger.viewportHeight,
    'Reference is the first full row in the predicted effective content viewport'
  )
  assert.ok(
    ledger.reference.global <= anchor,
    'Reverse prefix ends at the retained anchor'
  )
  assert.equal(
    ledger.prefix.length,
    anchor - ledger.reference.global,
    'Every intervening row is predeclared'
  )
  for (let i = 0; i < ledger.prefix.length; i++) {
    const row = ledger.prefix[i]
    assert.equal(row.global, ledger.reference.global + i)
    assert.ok(
      row.unclamped && row.nextUnclamped && row.size > 0,
      'Each pre-input row size comes from unclamped public start offsets'
    )
  }
  return ledger
}

function accountReverseGeometry(before, after, ledger) {
  const byRow = new Map(after.rowGeometry.map((row) => [row.global, row]))
  const reference = byRow.get(ledger.reference.global)
  assert.ok(
    reference?.loaded,
    'The predeclared reference is the real loaded row'
  )
  assert.ok(
    reference.bottom > ledger.headerBottom &&
      reference.y < ledger.viewportHeight,
    'Reference intersects the content viewport'
  )
  const table = ledger.prefix.map((estimate) => {
    const actual = byRow.get(estimate.global)
    assert.ok(
      actual?.loaded,
      'Every predeclared prefix row is actually mounted and loaded'
    )
    assert.equal(
      actual.members,
      1,
      'This seam contract is the real one-column ungrouped layout'
    )
    assert.ok(
      Math.abs(actual.gridHeight - actual.maxCardHeight) <= 1,
      'Row grid ends at its tallest intrinsic card'
    )
    assert.ok(
      Math.abs(actual.height - actual.gridHeight - actual.paddingBottom) <= 1,
      'Row wrapper equals intrinsic content plus actual gap'
    )
    assert.ok(
      Math.abs(actual.paddingBottom - 16) <= 1,
      'Actual normal-text row gap remains16px'
    )
    return {
      global: estimate.global,
      estimatedHeight: estimate.size,
      actualHeight: actual.height,
      delta: actual.height - estimate.size,
      actual,
    }
  })
  // Derive the expected shift solely from the pre-input estimate/actual DOM
  // table. The observed focused-file error is never an input to this sum.
  const intrinsicShift = table.reduce((sum, row) => sum + row.delta, 0)
  const actualPrefixHeight = table.reduce(
    (sum, row) => sum + row.actualHeight,
    0
  )
  for (let i = 0; i < table.length; i++) {
    const next =
      i + 1 < table.length ? table[i + 1].actual : byRow.get(ledger.anchor)
    assert.ok(next, 'No missing row before the retained focus')
    assert.ok(
      Math.abs(next.y - table[i].actual.bottom) <= 1,
      'Actual prefix wrappers are adjacent with no hole or overlap'
    )
  }
  assert.ok(
    Math.abs(after.y - reference.y - actualPrefixHeight) <= 1,
    'Actual DOM prefix independently reconstructs the focused-file top'
  )
  for (const sample of after.stabilitySamples) {
    const rows = new Map(sample.rowGeometry.map((row) => [row.global, row]))
    assert.ok(
      Math.abs(rows.get(ledger.reference.global)?.y - reference.y) <= 1,
      'Reference stays stable through late measurement'
    )
    for (const row of table)
      assert.ok(
        Math.abs(rows.get(row.global)?.height - row.actualHeight) <= 1,
        'Each actual prefix height stays stable'
      )
  }
  return {
    reference: ledger.reference,
    actualReference: reference,
    prefix: table,
    intrinsicShift,
    expectedAfterY: before.y - ledger.delta + intrinsicShift,
    signedRawError: after.y - before.y + ledger.delta,
    viewportReferenceError: Math.abs(reference.y - ledger.reference.projectedY),
    rebaseResidual: Math.abs(
      after.y - (before.y - ledger.delta + intrinsicShift)
    ),
    beforeInputLedgerDeclared: true,
  }
}

async function main() {
  const planFile = process.env.FLARE_TIMELINE_MIXED_PLAN
  const output = process.env.FLARE_TIMELINE_MIXED_OUTPUT
  assert.ok(
    planFile && output,
    'Explicit fixture plan and output directory required'
  )
  const plan = JSON.parse(await fs.readFile(planFile))
  validatePlan(plan)
  const database = new URL(process.env.DATABASE_URL)
  assert.equal(database.hostname, '127.0.0.1')
  assert.equal(database.port, '5457')
  assert.equal(database.pathname, '/flare_timeline_test_local')
  const prisma = new PrismaClient()
  const evidence = {
    origin: plan.origin,
    sourceBefore: await sourceCheck(plan),
    expectedOwnerTotal: plan.expectedOwnerTotal,
    fixtureIds: plan.files.map(({ id, rank }) => ({ id, rank })),
    method:
      'Real390px fine/coarse Chromium in both OS modes; native thumb seeks, per-RAF DOM coverage, native900/-1200 wheel, actual API bucket regrouping. No mocked responses or physical-device claim.',
    cases: [],
    passed: false,
    browserClosed: false,
  }
  await fs.mkdir(output, { recursive: true })
  const save = () =>
    fs.writeFile(
      path.join(output, 'results.json'),
      JSON.stringify(evidence, null, 2) + '\n'
    )
  let browser
  try {
    evidence.fixtureBefore = await verifyFixture(prisma, plan)
    browser = await chromium.launch({ headless: true })
    evidence.browserVersion = browser.version()
    for (const mode of ['dark', 'light'])
      for (const coarse of [false, true]) {
        const current = {
          mode,
          coarse,
          drags: [],
          seams: [],
          grouped: [],
          requests: [],
          errors: [],
          httpErrors: [],
          passed: false,
        }
        evidence.cases.push(current)
        const context = await browser.newContext({
          storageState: plan.authStorageState,
          viewport: { width: 390, height: 844 },
          screen: { width: 390, height: 844 },
          hasTouch: coarse,
          isMobile: coarse,
          colorScheme: mode,
          reducedMotion: 'reduce',
          timezoneId: 'UTC',
        })
        const page = await context.newPage()
        const rail = page.getByRole('slider', { name: 'Browse files by date' })
        let active
        page.on('pageerror', (error) => current.errors.push(error.message))
        page.on('request', (request) => {
          const url = new URL(request.url())
          if (['/api/files', '/api/files/timeline'].includes(url.pathname)) {
            current.requests.push({ path: url.pathname, query: url.search })
            if (url.pathname === '/api/files') {
              const limit = Number(url.searchParams.get('limit') || 24)
              if (!(limit > 0 && limit <= 100))
                current.errors.push(
                  'File request exceeded its bounded page size'
                )
            }
          }
        })
        page.on('response', (response) => {
          if (response.status() >= 400)
            current.httpErrors.push({
              path: new URL(response.url()).pathname,
              status: response.status(),
            })
        })
        const ready = async () => {
          await expect(
            page.getByRole('list', { name: 'Your files', exact: true })
          ).toHaveAttribute('aria-busy', 'false')
          await page.waitForFunction(() =>
            [...document.querySelectorAll('[data-file-index] img')].every(
              (image) => image.complete && image.naturalWidth > 0
            )
          )
          await page.evaluate(() => document.fonts.ready)
          await page.waitForTimeout(150)
        }
        // Fixtures are independently checked against their owner/rank records.
        // Generic primaries expose the full filename rather than an Open prefix.
        const fixturePrimary = async (card, expected) => {
          const component = card.locator('[data-file-card]')
          await expect(component).toHaveCount(1)
          await expect(component).toHaveAttribute('data-file-kind', 'generic')
          const heading = component.locator('[data-file-name]')
          await expect(heading).toHaveCount(1)
          await expect(heading).toHaveAttribute('title', expected.name)
          await expect(heading).toHaveText(expected.name)
          const primary = component.locator('a[data-file-primary]')
          await expect(primary).toHaveCount(1)
          await expect(primary).toHaveAccessibleName(expected.name)
          await expect(primary).toHaveAttribute('href', expected.urlPath)
          await expect(primary).toBeVisible()
          return primary
        }
        const snapshot = (index, delta) =>
          page.evaluate(
            ({ index, delta }) => {
              const card = document.querySelector(
                `[data-file-index="${index}"]`
              )
              const row = card?.closest('[data-row]')
              const rowGeometry = [
                ...document.querySelectorAll('[data-row]'),
              ].map((element) => {
                const box = element.getBoundingClientRect(),
                  grid = element.querySelector(':scope > .grid'),
                  members = [...element.querySelectorAll('[data-file-index]')]
                return {
                  global: Number(element.dataset.row),
                  local: Number(element.dataset.index),
                  y: box.y,
                  bottom: box.bottom,
                  height: box.height,
                  paddingBottom: parseFloat(
                    getComputedStyle(element).paddingBottom
                  ),
                  gridHeight: grid?.getBoundingClientRect().height ?? null,
                  maxCardHeight: Math.max(
                    0,
                    ...members.map(
                      (member) =>
                        member.firstElementChild?.getBoundingClientRect()
                          .height ?? 0
                    )
                  ),
                  members: members.length,
                  loaded:
                    members.length > 0 &&
                    members.every((member) =>
                      member.querySelector('[data-file-card]')
                    ),
                }
              })
              let preInputLedger
              if (Number.isFinite(delta)) {
                const list = document.querySelector(
                    '[role="list"][aria-label="Your files"]'
                  ),
                  key =
                    list &&
                    Object.keys(list).find((key) =>
                      key.startsWith('__reactFiber$')
                    )
                let fiber = key ? list[key] : null,
                  v = null
                for (
                  let depth = 0;
                  fiber && depth < 40 && !v;
                  depth++, fiber = fiber.return
                ) {
                  let hook = fiber.memoizedState
                  for (let i = 0; hook && i < 100; i++, hook = hook.next) {
                    const value = hook.memoizedState
                    for (const candidate of [
                      value,
                      value?.current,
                      ...(Array.isArray(value) ? value : []),
                    ])
                      if (
                        candidate &&
                        typeof candidate === 'object' &&
                        typeof candidate.getOffsetForIndex === 'function' &&
                        candidate.options
                      ) {
                        v = candidate
                        break
                      }
                    if (v) break
                  }
                }
                if (v && row) {
                  const local = Number(row.dataset.index),
                    padding = v.options.scrollPaddingStart,
                    maxScroll =
                      document.documentElement.scrollHeight - innerHeight,
                    windowStart = Number(row.dataset.row) - local,
                    predictedOffset = scrollY + delta
                  const startOf = (i) => {
                    const result = v.getOffsetForIndex(i, 'start')
                    return result
                      ? {
                          offset: result[0],
                          align: result[1],
                          start: result[0] + padding,
                          unclamped:
                            result[1] === 'start' &&
                            result[0] > 0 &&
                            result[0] < maxScroll,
                        }
                      : null
                  }
                  const entries = []
                  for (
                    let i = Math.max(0, local - 64);
                    i <= Math.min(v.options.count - 2, local + 64);
                    i++
                  ) {
                    const here = startOf(i),
                      next = startOf(i + 1)
                    if (here && next)
                      entries.push({
                        local: i,
                        global: Number(v.options.getItemKey(i)),
                        start: here.start,
                        size: next.start - here.start,
                        unclamped: here.unclamped,
                        nextUnclamped: next.unclamped,
                      })
                  }
                  const found = entries.find(
                      (entry) =>
                        entry.unclamped &&
                        entry.start >= predictedOffset + padding
                    ),
                    reference = found
                      ? { ...found, projectedY: found.start - predictedOffset }
                      : null
                  preInputLedger = {
                    captured: true,
                    method:
                      'Read-only installed public getOffsetForIndex/start alignment; numeric React-fiber discovery only, no cache/style/scroll mutation',
                    anchor: index,
                    delta,
                    nativeY: scrollY,
                    offset: v.scrollOffset,
                    windowStart,
                    padding,
                    predictedOffset,
                    viewportHeight: innerHeight,
                    headerBottom:
                      document
                        .querySelector('[aria-label="Main navigation"]')
                        ?.closest('header')
                        ?.getBoundingClientRect().bottom ?? 0,
                    anchorEntry: startOf(local),
                    reference,
                    prefix: reference
                      ? entries.filter(
                          (entry) =>
                            entry.global >= reference.global &&
                            entry.global < index
                        )
                      : [],
                    entries,
                  }
                } else
                  preInputLedger = {
                    captured: false,
                    error: 'No read-only instance/anchor row available',
                  }
              }
              return {
                index,
                y: card?.getBoundingClientRect().y,
                height: card?.getBoundingClientRect().height,
                name: card
                  ?.querySelector('[data-file-card] a[data-file-primary]')
                  ?.getAttribute('aria-label'),
                globalRow: Number(row?.dataset.row),
                localRow: Number(row?.dataset.index),
                windowStart:
                  Number(row?.dataset.row) - Number(row?.dataset.index),
                mounted: document.querySelectorAll('[data-file-index]').length,
                focused: !!card?.contains(document.activeElement),
                scrollY,
                rowGeometry,
                preInputLedger,
              }
            },
            { index, delta }
          )
        const settled = async (index, delta) => {
          const samples = []
          for (let count = 0; count < 4; count++) {
            samples.push(await snapshot(index, count === 3 ? delta : undefined))
            await page.waitForTimeout(100)
          }
          assert.ok(
            samples.every(
              (s) => Number.isFinite(s.y) && Math.abs(s.y - samples[0].y) <= 1
            ),
            'Anchor remains stable through late row measurements'
          )
          return { ...samples.at(-1), stabilitySamples: samples }
        }
        const cdp = coarse ? await context.newCDPSession(page) : null
        const touch = (type, x, y) =>
          cdp.send('Input.dispatchTouchEvent', {
            type,
            touchPoints:
              type === 'touchEnd'
                ? []
                : [{ id: 0, x, y, radiusX: 4, radiusY: 4, force: 1 }],
          })
        const seek = async (target, label) => {
          const maximum = Number(await rail.getAttribute('aria-valuemax')) - 1
          assert.ok(target >= 0 && target <= maximum)
          let handle = await page
            .locator('[data-date-rail-handle]')
            .boundingBox()
          if (!coarse) {
            await page.mouse.move(
              handle.x + handle.width / 2,
              handle.y + handle.height / 2
            )
            await page.evaluate(
              () => new Promise((r) => requestAnimationFrame(r))
            )
            handle = await page.locator('[data-date-rail-handle]').boundingBox()
          }
          const track = await rail.boundingBox()
          const x = handle.x + handle.width / 2,
            from = handle.y + handle.height / 2
          const to =
            track.y +
            handle.height / 2 +
            ((track.height - handle.height) * target) / maximum
          const requestStart = current.requests.length
          const trace = {
            label,
            target,
            maximum,
            track,
            geometry: [],
            samples: [],
            adjustments: 0,
          }
          active = trace
          await page.evaluate(() => {
            window.__mixedTrace.samples = []
            window.__mixedTrace.active = true
          })
          if (coarse) await touch('touchStart', x, from)
          else await page.mouse.down()
          try {
            await expect(
              page.locator('[data-date-rail-handle]')
            ).toHaveAttribute('data-dragging', 'true')
            for (let step = 1; step <= 20; step++) {
              const y = from + ((to - from) * step) / 20
              if (coarse) await touch('touchMove', x, y)
              else await page.mouse.move(x, y)
              await page.waitForTimeout(80)
              trace.geometry.push(await rail.boundingBox())
            }
          } finally {
            if (coarse) await touch('touchEnd')
            else await page.mouse.up()
            await ready()
            trace.samples = await page.evaluate(() => {
              window.__mixedTrace.active = false
              return window.__mixedTrace.samples
            })
            trace.landed = Number(await rail.getAttribute('aria-valuenow')) - 1
            trace.requests = current.requests.slice(requestStart)
            current.drags.push(trace)
            await save()
          }
          assert.ok(
            Math.abs(trace.landed - target) < 30,
            'Native thumb seek lands within30 rows'
          )
          assert.ok(
            trace.geometry.every(
              (b) =>
                b &&
                Math.abs(b.y - track.y) <= 1 &&
                Math.abs(b.height - track.height) <= 1
            ),
            'Measured track stays fixed during drag'
          )
          assert.ok(
            trace.samples.length > 0 &&
              trace.samples.every(
                (s) =>
                  s.visible.length > 0 &&
                  s.maxAdjacentGap <= 1 &&
                  s.mounted <= 100
              ),
            'Every drag frame retains real cards/skeletons and contiguous row bounds'
          )
          assert.ok(
            trace.samples.every((s) =>
              s.visible.every((v) => v.loaded || v.skeleton)
            ),
            'Every visible placeholder is the actual FileCardSkeleton'
          )
          assert.ok(
            trace.requests.filter((r) => r.path === '/api/files').length <= 52,
            'Drag file reads stay bounded by fixed20step path, not collection size'
          )
          for (let attempt = 0; attempt < 30; attempt++) {
            const row = Number(await rail.getAttribute('aria-valuenow')) - 1
            if (row === target) return trace
            assert.ok(Math.abs(row - target) < 30)
            await rail.press(row < target ? 'ArrowDown' : 'ArrowUp')
            trace.adjustments++
            await ready()
          }
          throw Error(
            'Native seek could not reach exact row with bounded adjustment'
          )
        }
        try {
          const response = await page.goto(plan.origin + '/dashboard')
          assert.equal(response.status(), 200)
          await ready()
          const media = await page.evaluate(() => ({
            coarse: matchMedia('(pointer:coarse)').matches,
            width: innerWidth,
            mode: document.documentElement.className,
          }))
          assert.equal(media.coarse, coarse)
          assert.equal(media.width, 390)
          assert.ok(
            media.mode.split(/\s+/).includes(mode),
            'Actual page follows the requested OS mode'
          )
          await expect(rail).toHaveAttribute(
            'aria-valuemax',
            String(plan.expectedOwnerTotal)
          )
          await page.evaluate(() => {
            window.__mixedTrace = { active: false, samples: [] }
            const frame = () => {
              const trace = window.__mixedTrace
              if (trace.active) {
                const top = Math.max(
                  80,
                  document
                    .querySelector('[aria-label="Main navigation"]')
                    ?.closest('header')
                    ?.getBoundingClientRect().bottom || 0
                )
                const rows = [...document.querySelectorAll('[data-row]')]
                  .map((el) => ({
                    index: Number(el.dataset.row),
                    top: el.getBoundingClientRect().top,
                    bottom: el.getBoundingClientRect().bottom,
                  }))
                  .sort((a, b) => a.index - b.index)
                let maxAdjacentGap = 0
                for (let i = 1; i < rows.length; i++)
                  if (rows[i].index === rows[i - 1].index + 1)
                    maxAdjacentGap = Math.max(
                      maxAdjacentGap,
                      Math.abs(rows[i].top - rows[i - 1].bottom)
                    )
                const mounted = [
                  ...document.querySelectorAll('[data-file-index]'),
                ]
                const visible = mounted.flatMap((el) => {
                  const child = el.firstElementChild,
                    b = child?.getBoundingClientRect(),
                    component = child?.matches('[data-file-card]')
                      ? child
                      : null,
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
                  return b &&
                    b.height > 0 &&
                    b.bottom > top &&
                    b.top < innerHeight
                    ? [
                        {
                          index: Number(el.dataset.fileIndex),
                          top: b.top,
                          bottom: b.bottom,
                          loaded,
                          kind: kind ?? null,
                          primaryCount: primaries.length,
                          primaryHref: primaryHref ?? null,
                          primaryName: primaryName ?? null,
                          skeleton:
                            !!child?.matches('[aria-hidden="true"]') &&
                            !!child.querySelector('.animate-pulse'),
                        },
                      ]
                    : []
                })
                trace.samples.push({
                  time: performance.now(),
                  scrollY,
                  mounted: mounted.length,
                  visible,
                  maxAdjacentGap,
                })
              }
              requestAnimationFrame(frame)
            }
            requestAnimationFrame(frame)
          })
          for (const [direction, anchor, delta] of [
            ['forward', 7979, 900],
            ['reverse', plan.expectedOwnerTotal - 8000 + 22, -1200],
          ]) {
            await rail.press(direction === 'forward' ? 'Home' : 'End')
            await ready()
            await seek(anchor, direction)
            const expected = plan.files.find((f) => f.rank === anchor)
            assert.ok(
              expected,
              'Native-wheel anchor is an actual mixed fixture'
            )
            const card = page.locator(`[data-file-index="${anchor}"]`)
            const primary = await fixturePrimary(card, expected)
            await primary.focus()
            await expect(primary).toBeFocused()
            const before = await settled(
              anchor,
              direction === 'reverse' ? delta : undefined
            )
            const declaration =
              direction === 'reverse' ? before.preInputLedger : null
            if (direction === 'reverse') {
              current.preInputLedgers ||= []
              current.preInputLedgers.push(declaration ?? null)
              await save()
              checkReverseDeclaration(before, anchor, delta)
            }
            assert.equal(
              before.windowStart,
              direction === 'forward' ? 0 : plan.expectedOwnerTotal - 8000
            )
            const requestStart = current.requests.length
            await page.screenshot({
              path: path.join(
                output,
                `${mode}-${coarse ? 'coarse' : 'fine'}-${direction}-before.png`
              ),
            })
            await page.mouse.move(170, 500)
            await page.mouse.wheel(0, delta)
            await expect
              .poll(async () => (await snapshot(anchor)).windowStart)
              .not.toBe(before.windowStart)
            await ready()
            const after = await settled(anchor)
            await fixturePrimary(card, expected)
            assert.equal(before.name, expected.name)
            assert.equal(after.name, expected.name)
            const seam = {
              direction,
              fileId: expected.id,
              fileName: expected.name,
              nativeWheelDelta: delta,
              before,
              after,
              requests: current.requests.slice(requestStart),
              pixelError: Math.abs(after.y - before.y + delta),
            }
            current.seams.push(seam)
            if (declaration)
              seam.intrinsicGeometry = accountReverseGeometry(
                before,
                after,
                declaration
              )
            await page.screenshot({
              path: path.join(
                output,
                `${mode}-${coarse ? 'coarse' : 'fine'}-${direction}-after.png`
              ),
            })
            await save()
            assert.equal(
              after.name,
              before.name,
              'Same real file remains mounted'
            )
            assert.ok(
              after.focused,
              'Focused generic card remains mounted across native window transition'
            )
            assert.notEqual(after.windowStart, before.windowStart)
            if (direction === 'forward') {
              assert.ok(
                seam.pixelError <= 5,
                'Native wheel displacement is preserved within5px'
              )
            } else {
              assert.ok(
                seam.intrinsicGeometry.viewportReferenceError <= 5,
                'Predeclared viewport reference is preserved within5px'
              )
              assert.ok(
                seam.intrinsicGeometry.rebaseResidual <= 5,
                'Native rebase residual after independent intrinsic geometry is within5px'
              )
            }
            assert.ok(after.mounted <= 100)
            assert.ok(
              seam.requests.filter((r) => r.path === '/api/files').length <= 8
            )
          }
          await rail.press('Home')
          await ready()
          await page.getByRole('button', { name: /^Filters/ }).click()
          await page
            .getByRole('button', { name: /^Date and grouping(?:$|:)/ })
            .click()
          await page
            .getByRole('combobox', { name: 'Group files by upload date' })
            .click()
          await page
            .getByRole('option', { name: 'By month', exact: true })
            .click()
          await page.keyboard.press('Escape')
          await ready()
          const reply = await context.request.get(
            plan.origin + '/api/files/timeline?groupBy=month&timezone=UTC'
          )
          assert.equal(reply.status(), 200)
          const body = await reply.json(),
            timeline = body.data || body
          assert.equal(timeline.total, plan.expectedOwnerTotal)
          assert.equal(timeline.groupBy, 'month')
          current.monthTimeline = timeline
          const expectedRows = timeline.total + timeline.buckets.length
          await expect(rail).toHaveAttribute(
            'aria-valuemax',
            String(expectedRows)
          )
          for (const rank of [4030, 7979]) {
            const file = plan.files.find((f) => f.rank === rank)
            const bucketIndex = timeline.buckets.findIndex(
              (b) => rank >= b.offset && rank < b.offset + b.count
            )
            assert.ok(bucketIndex >= 0)
            const bucket = timeline.buckets[bucketIndex]
            const headingRow = bucket.offset + bucketIndex
            const targetRow = rank + bucketIndex + 1
            await seek(headingRow, 'month-heading-' + rank)
            const heading = page.locator(`[data-row="${headingRow}"] h2`)
            await expect(heading).toBeVisible()
            const label = new Intl.DateTimeFormat('en-US', {
              month: 'long',
              year: 'numeric',
              timeZone: 'UTC',
            }).format(new Date(bucket.from))
            await expect(heading).toContainText(label)
            await seek(targetRow, 'month-file-' + rank)
            const card = page.locator(`[data-file-index="${rank}"]`)
            await fixturePrimary(card, file)
            assert.equal(
              await card.evaluate((el) =>
                Number(el.closest('[data-row]').dataset.row)
              ),
              targetRow
            )
            current.grouped.push({
              fileId: file.id,
              fileIndex: rank,
              headingRow,
              targetRow,
              bucket,
              rowFormula:
                'fileIndex + number of preceding/inclusive bucket headings, one column',
            })
          }
          await rail.press('Home')
          await ready()
          await page
            .getByRole('button', { name: /^Date and grouping(?:$|:)/ })
            .click()
          await page
            .getByRole('combobox', { name: 'Group files by upload date' })
            .click()
          await page
            .getByRole('option', { name: 'No grouping', exact: true })
            .click()
          await page.keyboard.press('Escape')
          await ready()
          await expect(rail).toHaveAttribute(
            'aria-valuemax',
            String(plan.expectedOwnerTotal)
          )
          await seek(4030, 'none-return')
          await fixturePrimary(
            page.locator('[data-file-index="4030"]'),
            plan.files.find((f) => f.rank === 4030)
          )
          assert.deepEqual(current.errors, [])
          assert.deepEqual(current.httpErrors, [])
          current.passed = true
          console.log(
            `PASS: ${mode}/${coarse ? 'coarse' : 'fine'} mixed seams and actual Month/None return`
          )
        } catch (error) {
          current.failure = error.stack
          current.activePhase = active?.label
          await page
            .screenshot({
              path: path.join(
                output,
                `${mode}-${coarse ? 'coarse' : 'fine'}-failure.png`
              ),
            })
            .catch(() => {})
        } finally {
          await context.close()
          await save()
        }
      }
    evidence.fixtureAfter = await verifyFixture(prisma, plan)
    evidence.sourceAfter = await sourceCheck(plan)
    evidence.passed =
      evidence.cases.length === 4 && evidence.cases.every((c) => c.passed)
  } finally {
    await browser?.close()
    await prisma.$disconnect()
    evidence.browserClosed = true
    await save()
  }
  assert.ok(
    evidence.passed,
    'Mixed continuity regression failed; every actual case is retained'
  )
}

module.exports = { validatePlan, sourceCheck, verifyFixture }
if (require.main === module)
  main().catch((error) => {
    console.error(error.stack)
    process.exitCode = 1
  })
