/* eslint-disable @typescript-eslint/no-require-imports */
/* Read-only rendered List/Gallery regression. The coordinator must bracket this
   reader with source/full-runtime and actual fixture fingerprints. It changes
   only this disposable browser context's presentation storage/selection. */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { measureFilenameGeometry } = require('./filename-geometry.cjs')
const { chromium, expect } = require(
  path.resolve('docs/site/node_modules/@playwright/test')
)
const origin = process.env.FLARE_LIBRARY_VIEWS_ORIGIN
const deepOrigin = process.env.FLARE_HILLCLIMB_DEEP_ORIGIN
const deepState = process.env.FLARE_HILLCLIMB_DEEP_AUTH
  ? path.resolve(process.env.FLARE_HILLCLIMB_DEEP_AUTH)
  : null
assert(
  Boolean(deepOrigin) === Boolean(deepState),
  'Bind both deep origin and actual Timeline auth, or report unavailable'
)
if (deepOrigin) {
  assert(/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(deepOrigin))
  assert(fs.statSync(deepState).isFile())
}
const restrictedOrigin = process.env.FLARE_LIBRARY_VIEWS_RESTRICTED_ORIGIN
for (const value of [origin, restrictedOrigin])
  assert(/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(value || ''))
const ownerState = path.resolve(
  process.env.FLARE_LIBRARY_VIEWS_STORAGE_STATE || ''
)
const restrictedState = path.resolve(
  process.env.FLARE_LIBRARY_VIEWS_RESTRICTED_STORAGE_STATE || ''
)
for (const value of [ownerState, restrictedState])
  assert(fs.statSync(value).isFile())
const denied = JSON.parse(
  process.env.FLARE_LIBRARY_VIEWS_DENIED_ACTIONS || 'null'
)
assert(
  Array.isArray(denied) &&
    denied.length > 0 &&
    denied.every((v) => typeof v === 'string')
)
const out = path.resolve(process.env.FLARE_LIBRARY_VIEWS_OUTPUT || '')
assert(
  out !== process.cwd() && !fs.existsSync(out),
  'Fresh output required; no overwrite/retry'
)
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex')
const result = {
  renderContractVersion: 'library-views-v1',
  expectedCaseCount: 12,
  cases: [],
  errors: [],
  forbiddenRequests: [],
  browserClosed: false,
  passed: false,
  method:
    'Actual native controls, owner-API identities, full-name geometry, device-local persistence, real native-touch/mouse top-toolbar view changes preserving page top, toolbar visibility and focus; 16/32/16 top recovery, selection, deep cross-tab choice plus original reload/Back, native wheel and keyboard Home/End seek continuity. Root32 is local CSS text-size simulation only. No layout corrections, masks, native zoom claim, file/API writes, login, credentials changed or action confirmation. Ordinary GET/session/audit effects require external fixture fingerprints.',
  readerSha256: sha(fs.readFileSync(__filename)),
}

async function loaded(page, view) {
  await expect(
    page.getByRole('list', { name: 'Your files', exact: true })
  ).toHaveAttribute('aria-busy', 'false', { timeout: 90000 })
  await page
    .locator(`[data-file-card][data-file-view="${view}"]`)
    .first()
    .waitFor()
  await page.evaluate(async () => {
    await document.fonts.ready
    await Promise.all(
      [...document.images]
        .filter((e) => {
          const b = e.getBoundingClientRect()
          return (
            b.width > 0 && b.height > 0 && b.bottom > 0 && b.top < innerHeight
          )
        })
        .map((e) => e.decode())
    )
  })
  await expect
    .poll(() =>
      page.evaluate(() => document.querySelectorAll('[data-file-card]').length)
    )
    .toBeGreaterThan(0)
  await page
    .evaluate(
      () =>
        new Promise((resolve) => {
          let last = '',
            same = 0,
            frames = 0
          function next() {
            const key = [...document.querySelectorAll('[data-row]')]
              .map((e) => {
                const b = e.getBoundingClientRect()
                return [b.top, b.height].join(',')
              })
              .join(';')
            same = key === last ? same + 1 : 0
            last = key
            if (++frames >= 240 || same >= 12) resolve({ stable: same >= 12 })
            else requestAnimationFrame(next)
          }
          requestAnimationFrame(next)
        })
    )
    .then((v) => assert(v.stable, 'Actual row measurements must settle'))
}

async function topViewState(page) {
  return page.evaluate(() => {
    const panel = document.querySelector('[aria-label="Find and filter files"]')
    const header = document
      .querySelector('[aria-label="Main navigation"]')
      ?.closest('header')
    const control =
      innerWidth < 640
        ? panel?.querySelector('button[aria-label^="File view: "]')
        : panel?.querySelector(
            '[role="group"][aria-label="File view"] button[aria-pressed="true"]'
          )
    return {
      scrollY,
      innerWidth,
      innerHeight,
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      header: header?.getBoundingClientRect().toJSON() ?? null,
      panel: panel?.getBoundingClientRect().toJSON() ?? null,
      control: control?.getBoundingClientRect().toJSON() ?? null,
      activeViewControl: control === document.activeElement,
    }
  })
}

function assertTopToolbar(state) {
  assert.equal(
    state.scrollY,
    0,
    'Changing the initial view or text size preserves page top'
  )
  assert(
    state.header && state.panel && state.control,
    'Actual navigation, toolbar and current view control remain mounted'
  )
  assert(
    state.panel.top >= state.header.bottom,
    'Top toolbar clears the actual fixed navigation'
  )
  for (const [name, box] of [
    ['toolbar', state.panel],
    ['view control', state.control],
  ]) {
    assert(
      box.width > 0 && box.height > 0,
      `${name} has a real visible rectangle`
    )
    assert(
      box.left >= 0 && box.right <= state.clientWidth,
      `${name} stays within the document viewport`
    )
    assert(
      box.top >= state.header.bottom && box.bottom <= state.innerHeight,
      `${name} stays fully visible below navigation`
    )
  }
}

async function choose(page, view, records) {
  const before = await topViewState(page)
  const coarse = await page.evaluate(
    () => matchMedia('(pointer: coarse)').matches
  )
  const measurement = {
    view,
    inputMethod: coarse ? 'native-touch' : 'native-mouse',
    atTopBefore: before.scrollY === 0,
    before,
    after: null,
  }
  records.push(measurement)
  const activate = (locator) => (coarse ? locator.tap() : locator.click())
  let trigger
  if (page.viewportSize().width < 640) {
    trigger = page.getByRole('button', { name: /^File view: / })
    const box = await trigger.boundingBox()
    assert(box.width >= 44 && box.height >= 44)
    await activate(trigger)
    await activate(
      page.getByRole('menuitemradio', {
        name: view === 'list' ? 'List' : 'Gallery',
        exact: true,
      })
    )
    await expect(trigger).toHaveAttribute(
      'aria-label',
      `File view: ${view === 'list' ? 'List' : 'Gallery'}`
    )
    await expect(trigger).toBeFocused()
  } else {
    trigger = page
      .getByRole('group', { name: 'File view', exact: true })
      .getByRole('button', {
        name: view === 'list' ? 'List' : 'Gallery',
        exact: true,
      })
    await activate(trigger)
    await expect(trigger).toHaveAttribute('aria-pressed', 'true')
    await expect(trigger).toBeFocused()
  }
  await loaded(page, view)
  const after = await topViewState(page)
  measurement.after = after
  await expect(trigger).toBeFocused()
  if (before.scrollY === 0) {
    assertTopToolbar(after)
    assert(
      after.activeViewControl,
      'The activated view control retains focus after rows settle'
    )
  }
  return measurement
}

async function wideMenu(page, records, key) {
  const trigger = page
    .locator('[data-file-card]')
    .first()
    .getByTitle('Manage file', { exact: true })
  await trigger.click()
  const menu = page.locator('[data-file-menu]')
  await expect(menu).toBeVisible()
  await menu.evaluate(async (el) => {
    await Promise.all(el.getAnimations().map((animation) => animation.finished))
  })
  await expect
    .poll(() => menu.evaluate((el) => el.getBoundingClientRect().width))
    .toBeGreaterThan(0)
  const raw = await menu.evaluate((el) => {
    const box = el.getBoundingClientRect(),
      body = el.querySelector('[data-file-menu-scroll]')
    return {
      box: box.toJSON(),
      viewport: { width: innerWidth, height: innerHeight },
      side: el.getAttribute('data-side'),
      scrollHeight: body.scrollHeight,
      clientHeight: body.clientHeight,
      items: [...el.querySelectorAll('[role="menuitem"]')].map((item) => {
        const r = item.getBoundingClientRect(),
          hit = document.elementFromPoint(
            r.left + r.width / 2,
            r.top + r.height / 2
          )
        return {
          text: item.textContent,
          box: r.toJSON(),
          centerHit: !!hit && (hit === item || item.contains(hit)),
        }
      }),
    }
  })
  records.push({ key, raw })
  assert(raw.items.length >= 8, 'Owner fixture exercises the full file menu')
  assert(
    raw.scrollHeight <= raw.clientHeight + 1,
    'A wide standard-text menu exposes every action without internal scrolling'
  )
  assert(raw.box.top >= 15 && raw.box.bottom <= raw.viewport.height - 15)
  assert(raw.box.left >= 15 && raw.box.right <= raw.viewport.width - 15)
  assert(
    raw.items.every(
      (item) =>
        item.centerHit &&
        item.box.top >= raw.box.top &&
        item.box.bottom <= raw.box.bottom
    ),
    'Every offered menu action is visible and unobstructed'
  )
  records.at(-1).image = await image(page, key)
  await page.keyboard.press('End')
  await expect(page.getByRole('menuitem').last()).toBeFocused()
  await page.keyboard.press('Home')
  await expect(page.getByRole('menuitem').first()).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(trigger).toBeFocused()
}

async function boundedMenu(page, records, key, axis) {
  const trigger = page
    .locator('[data-file-card]')
    .first()
    .getByTitle('Manage file', { exact: true })
  const observation = {
    key,
    axis,
    before: null,
    open: null,
    home: null,
    end: null,
    escaped: null,
    passed: false,
  }
  records.push(observation) // Retain partial geometry if any later assertion fails.
  observation.before = await trigger.evaluate((el) => ({
    box: el.getBoundingClientRect().toJSON(),
    root: getComputedStyle(document.documentElement).fontSize,
    width: innerWidth,
    height: innerHeight,
    coarse: matchMedia('(pointer: coarse)').matches,
  }))
  if (observation.before.coarse) await trigger.tap()
  else await trigger.click()
  const menu = page.locator('[data-file-menu]')
  await expect(menu).toBeVisible()
  await menu.evaluate(async (el) => {
    await Promise.all(el.getAnimations().map((animation) => animation.finished))
  })
  observation.open = await menu.evaluate(
    (el) =>
      new Promise((resolve) => {
        let previous = '',
          stable = 0,
          frames = 0
        const samples = []
        function next() {
          const box = el.getBoundingClientRect(),
            body = el.querySelector('[data-file-menu-scroll]'),
            sample = {
              box: box.toJSON(),
              side: el.getAttribute('data-side'),
              body: body.getBoundingClientRect().toJSON(),
              scrollHeight: body.scrollHeight,
              clientHeight: body.clientHeight,
              scrollTop: body.scrollTop,
              root: getComputedStyle(document.documentElement).fontSize,
              viewport: { width: innerWidth, height: innerHeight },
              document: {
                width: document.documentElement.clientWidth,
                scrollWidth: document.documentElement.scrollWidth,
              },
              items: [...el.querySelectorAll('[role="menuitem"]')].map(
                (item) => ({
                  label: item.textContent.trim(),
                  disabled: item.hasAttribute('data-disabled'),
                  centerHit: (() => {
                    const b = item.getBoundingClientRect(),
                      hit = document.elementFromPoint(
                        b.left + b.width / 2,
                        b.top + b.height / 2
                      )
                    return !!hit && (hit === item || item.contains(hit))
                  })(),
                  box: item.getBoundingClientRect().toJSON(),
                })
              ),
            }
          samples.push(sample)
          const signature = JSON.stringify([
            box.x,
            box.y,
            box.width,
            box.height,
            sample.side,
          ])
          stable = signature === previous ? stable + 1 : 0
          previous = signature
          if (++frames >= 240 || stable >= 8)
            resolve({
              settled: stable >= 8,
              frames,
              stable,
              samples,
              raw: sample,
            })
          else requestAnimationFrame(next)
        }
        requestAnimationFrame(next)
      })
  )
  assert(observation.open.settled, 'Menu placement must actually settle')
  const raw = observation.open.raw
  assert(
    raw.box.left >= 15 &&
      raw.box.right <= raw.viewport.width - 15 &&
      raw.box.top >= 15 &&
      raw.box.bottom <= raw.viewport.height - 15,
    'The entire settled menu stays inside the existing collision clearance'
  )
  assert(
    raw.document.scrollWidth <= raw.document.width + 1,
    'Opening the menu must not add horizontal document overflow'
  )
  assert(
    (axis === 'vertical' ? ['top', 'bottom'] : ['left', 'right']).includes(
      raw.side
    ),
    'Use the room-appropriate axis while allowing real Radix collision flips'
  )
  assert(
    raw.items.length >= 8,
    'Use the actual broadly permitted owner fixture'
  )
  assert(
    raw.items.every(
      (item) =>
        item.box.left >= raw.box.left - 1 && item.box.right <= raw.box.right + 1
    ),
    'All offered actions fit the settled menu horizontally'
  )

  const previous = records.find(
    (entry) =>
      entry !== observation &&
      entry.key.split(':')[0] === key.split(':')[0] &&
      entry.open?.raw
  )
  if (previous)
    assert.deepEqual(
      raw.items.map((item) => item.label),
      previous.open.raw.items.map((item) => item.label),
      'Text size and placement retain every actual permitted action in the same order'
    )
  if (raw.viewport.width === 1440) {
    assert(
      raw.scrollHeight <= raw.clientHeight + 1,
      'A wide menu exposes all actions without internal scrolling'
    )
    assert(
      raw.items.every(
        (item) =>
          item.centerHit &&
          item.box.top >= raw.box.top &&
          item.box.bottom <= raw.box.bottom
      ),
      'Every wide-menu action remains visible and unobstructed'
    )
  }

  const enabled = menu.locator('[role="menuitem"]:not([data-disabled])')
  for (const [field, keyName, target] of [
    ['end', 'End', enabled.last()],
    ['home', 'Home', enabled.first()],
  ]) {
    await page.keyboard.press(keyName)
    await expect(target).toBeFocused()
    observation[field] = await target.evaluate((el) => {
      const box = el.getBoundingClientRect(),
        menu = el.closest('[data-file-menu]'),
        body = el.closest('[data-file-menu-scroll]'),
        clip = (body || menu).getBoundingClientRect(),
        hit = document.elementFromPoint(
          box.left + box.width / 2,
          box.top + box.height / 2
        )
      return {
        key: el.textContent.trim(),
        box: box.toJSON(),
        clip: clip.toJSON(),
        menu: menu.getBoundingClientRect().toJSON(),
        insideScrollBody: !!body,
        scrollTop: body?.scrollTop ?? null,
        focused: document.activeElement === el,
        centerHit: !!hit && (hit === el || el.contains(hit)),
      }
    })
    const focused = observation[field]
    assert(
      focused.focused && focused.centerHit,
      'Native focus reaches a real hit'
    )
    assert(
      focused.box.left >= focused.clip.left - 1 &&
        focused.box.right <= focused.clip.right + 1 &&
        focused.box.top >= focused.clip.top - 1 &&
        focused.box.bottom <= focused.clip.bottom + 1,
      'Home and End scroll the focused action fully into its actual visible area'
    )
  }
  await page.keyboard.press('Escape')
  await expect(menu).toBeHidden()
  await expect(trigger).toBeFocused()
  observation.escaped = { menuHidden: true, focusReturned: true }
  observation.passed = true
  return observation
}

async function geometry(page, view, identities) {
  const records = await page.locator('[data-file-card]').evaluateAll((cards) =>
    cards.map((card) => {
      const b = card.getBoundingClientRect(),
        name = card.querySelector('[data-file-name]'),
        primary = card.querySelector('[data-file-primary]'),
        manager = card.querySelector('button[title="Manage file"]')
      const controls = [
        primary,
        manager,
        ...card.querySelectorAll('[data-file-label]'),
      ].map((e) => ({
        rect: e.getBoundingClientRect().toJSON(),
        tag: e.tagName,
      }))
      return {
        index: Number(card.closest('[data-file-index]').dataset.fileIndex),
        view: card.dataset.fileView,
        kind: card.dataset.fileKind,
        name: name.textContent,
        decodedPrimaryPath: decodeURIComponent(new URL(primary.href).pathname),
        box: b.toJSON(),
        primaryCount: card.querySelectorAll('[data-file-primary]').length,
        controls,
        duplicatePreviewActions: card.querySelectorAll('[data-preview-actions]')
          .length,
        visibilityText: card
          .querySelector('[data-file-visibility]')
          ?.textContent.trim(),
        uploadAge: card
          .querySelector('[data-file-uploaded]')
          ?.textContent.trim(),
        labelTexts: [...card.querySelectorAll('[data-file-label]')].map((e) =>
          e.textContent.trim()
        ),
        counterTitles: [
          ...card.querySelectorAll('[title$=" views"],[title$=" downloads"]'),
        ].map((e) => e.title),
        factsLeft: card
          .querySelector('[data-file-activity]')
          ?.getBoundingClientRect().left,
      }
    })
  )
  assert(records.length > 0)
  for (const r of records) {
    assert.equal(r.view, view)
    assert.equal(r.primaryCount, 1)
    const expected = [...identities.values()].find(
      (f) => f.name === r.name && f.urlPath === r.decodedPrimaryPath
    )
    assert(
      expected,
      'Every complete name and primary URL identifies the same real owner file'
    )
    assert.equal(
      r.visibilityText,
      `${expected.visibility === 'PUBLIC' ? 'Public' : 'Private'}${expected.hasPassword ? ' · password protected' : ''}`,
      'Actual Public/Private status is retained alongside password protection'
    )
    if (view === 'list') assert.equal(r.duplicatePreviewActions, 0)
  }
  const elements = await page.locator('[data-file-card]').all()
  for (let i = 0; i < elements.length; i++) {
    const full = await elements[i]
      .locator('[data-file-name]')
      .evaluate(measureFilenameGeometry)
    assert.equal(full.text, records[i].name)
    assert.equal(full.title, records[i].name)
    assert.equal(full.ariaLabel, records[i].name)
    assert(
      full.glyphs.length > 0 && full.glyphs.every((g) => g.fits),
      'Full filename ink remains contained'
    )
    records[i].filename = full
  }
  const raw = await page.evaluate(() => ({
    innerWidth,
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    coarse: matchMedia('(pointer:coarse)').matches,
    root: getComputedStyle(document.documentElement).fontSize,
    rows: [...document.querySelectorAll('[data-row]')].map((e) => ({
      row: Number(e.dataset.row),
      box: e.getBoundingClientRect().toJSON(),
      indices: [...e.querySelectorAll('[data-file-index]')].map((v) =>
        Number(v.dataset.fileIndex)
      ),
    })),
  }))
  assert(
    raw.scrollWidth <= raw.clientWidth && raw.scrollWidth <= raw.innerWidth
  )
  if (view === 'list')
    assert(
      raw.rows.every((r) => r.indices.length <= 1),
      'Exactly one file per real List virtual row'
    )
  if (view === 'list' && raw.innerWidth >= 1024)
    assert(
      Math.max(...records.map((r) => r.factsLeft)) -
        Math.min(...records.map((r) => r.factsLeft)) <=
        1,
      'Desktop fact columns align even for empty label cells'
    )
  for (const r of records)
    for (const c of r.controls) {
      assert(
        c.rect.left >= r.box.left - 0.5 &&
          c.rect.right <= r.box.right + 0.5 &&
          c.rect.top >= r.box.top - 0.5 &&
          c.rect.bottom <= r.box.bottom + 0.5,
        'Actual controls stay within their card'
      )
      if (raw.coarse) assert(c.rect.width >= 43.99 && c.rect.height >= 43.99)
    }
  return { ...raw, cards: records }
}

async function startTrace(page) {
  await page.evaluate(() => {
    const trace = { active: true, samples: [] }
    window.__libraryViewTrace = trace
    function sample() {
      if (!trace.active) return
      const nav =
        document
          .querySelector('[aria-label="Main navigation"]')
          ?.closest('header')
          ?.getBoundingClientRect().bottom || 0
      const fold = Math.max(96, nav + 16)
      const rows = [
        ...document.querySelectorAll(
          '[role="list"][aria-label="Your files"] [data-row]'
        ),
      ]
        .map((e) => {
          const b = e.getBoundingClientRect()
          return {
            row: Number(e.dataset.row),
            top: b.top,
            bottom: b.bottom,
            height: b.height,
            files: [...e.querySelectorAll('[data-file-index]')].map((v) => ({
              index: Number(v.dataset.fileIndex),
              loaded: !!v.querySelector(
                '[data-file-card] a[data-file-primary]'
              ),
              actualSkeleton: !!v.querySelector('[data-file-skeleton]'),
            })),
            heading: !!e.querySelector('h2'),
          }
        })
        .filter((r) => r.bottom > fold && r.top < innerHeight)
        .sort((a, b) => a.top - b.top)
      trace.samples.push({
        t: performance.now(),
        scrollY,
        fold,
        mounted: document.querySelectorAll('[data-file-index]').length,
        rows,
      })
      requestAnimationFrame(sample)
    }
    requestAnimationFrame(sample)
  })
}
async function endTrace(page) {
  const samples = await page.evaluate(() => {
    window.__libraryViewTrace.active = false
    return window.__libraryViewTrace.samples
  })
  assert(samples.length > 0)
  for (const s of samples) {
    assert(s.mounted <= 100)
    assert(s.rows.length > 0, 'Every sampled visible frame contains rows')
    for (const r of s.rows)
      assert(
        r.heading ||
          (r.files.length &&
            r.files.every((v) => v.loaded || v.actualSkeleton)),
        'Every visible file is real content or actual FileCardSkeleton'
      )
    for (let i = 1; i < s.rows.length; i++)
      assert(
        Math.abs(s.rows[i].top - s.rows[i - 1].bottom) <= 1,
        'Consecutive visible row bounds remain contiguous'
      )
  }
  return samples
}
async function image(page, name) {
  const privacy = await page.evaluate(() => {
    const visible = (e) => {
      const b = e.getBoundingClientRect(),
        s = getComputedStyle(e)
      return (
        b.width > 0 &&
        b.height > 0 &&
        b.bottom > 0 &&
        b.top < innerHeight &&
        s.display !== 'none' &&
        s.visibility !== 'hidden'
      )
    }
    const fields = [...document.querySelectorAll('input,textarea')].filter(
      visible
    )
    return {
      visibleFieldTypes: fields.map((e) => e.type || e.tagName),
      unprotectedSensitiveCount: fields.filter(
        (e) =>
          e.value &&
          /password|token|secret|recovery|totp|otp|api.?key/i.test(
            [e.name, e.id, e.getAttribute('aria-label')].join(' ')
          ) &&
          e.type !== 'password'
      ).length,
      secretSurfaceCount: [
        ...document.querySelectorAll(
          '[data-recovery-codes],[data-created-token],[data-secret],svg[aria-label*="QR" i],canvas'
        ),
      ].filter(visible).length,
    }
  })
  assert.equal(privacy.unprotectedSensitiveCount, 0)
  assert.equal(privacy.secretSurfaceCount, 0)
  const file = path.join(out, name + '.png')
  await page.screenshot({
    path: file,
    fullPage: false,
    animations: 'disabled',
    caret: 'hide',
  })
  return { file, sha256: sha(fs.readFileSync(file)), privacy }
}

async function main() {
  fs.mkdirSync(out, { recursive: true })
  let browser, ownerAccountId, mainError
  try {
    browser = await chromium.launch({ headless: true })
    result.chromiumVersion = browser.version()
    for (const mode of ['dark', 'light'])
      for (const spec of [
        { width: 1440, height: 1000, coarse: false },
        { width: 820, height: 1180, coarse: true },
        { width: 390, height: 844, coarse: true },
        { width: 320, height: 844, coarse: true },
      ]) {
        const context = await browser.newContext({
          storageState: ownerState,
          viewport: { width: spec.width, height: spec.height },
          deviceScaleFactor: 1,
          colorScheme: mode,
          hasTouch: spec.coarse,
          isMobile: spec.coarse,
          serviceWorkers: 'block',
        })
        const item = { mode, ...spec, kind: 'owner', passed: false }
        let caseError
        try {
          const names = new Map()
          const pending = []
          await context.route('**/*', (route) => {
            const q = route.request(),
              u = new URL(q.url())
            if (!['GET', 'HEAD'].includes(q.method()) || u.origin !== origin) {
              result.forbiddenRequests.push({
                method: q.method(),
                sameOrigin: u.origin === origin,
              })
              return route.abort()
            }
            return route.continue()
          })
          await context.routeWebSocket('**/*', (socket) => {
            result.forbiddenRequests.push({ webSocket: true })
            socket.close()
          })
          await context.addInitScript((expectedOrigin) => {
            if (location.origin !== expectedOrigin) return
            if (
              !sessionStorage.getItem('flare-library-view-verifier-initialized')
            ) {
              for (const key of Object.keys(localStorage))
                if (key.startsWith('flare:library-view:'))
                  localStorage.removeItem(key)
              sessionStorage.setItem(
                'flare-library-view-verifier-initialized',
                '1'
              )
            }
          }, origin)
          context.on('page', (page) => {
            page.on('pageerror', (e) =>
              result.errors.push({
                name: e.name,
                messageSha256: sha(e.message),
              })
            )
            page.on('response', (response) => {
              const u = new URL(response.url())
              if (
                u.origin === origin &&
                response.status() === 200 &&
                ['/api/files', '/api/files/timeline'].includes(u.pathname)
              )
                pending.push(
                  response.json().then((body) => {
                    const value = body.data ?? body
                    if (u.pathname === '/api/files') {
                      assert(Array.isArray(value))
                      for (const f of value) names.set(f.id, f)
                    }
                  })
                )
            })
          })
          const page = await context.newPage()
          await page.mouse.move(1, 1)
          await page.goto(origin + '/dashboard', {
            waitUntil: 'domcontentloaded',
          })
          await loaded(page, 'gallery')
          await Promise.all(pending)
          await expect(page.locator('html')).toHaveClass(
            new RegExp('(?:^|\\s)' + mode + '(?:\\s|$)')
          )
          const id = await page.evaluate(async () => {
            const r = await fetch('/api/auth/session')
            const s = await r.json()
            return s.user?.id
          })
          assert(typeof id === 'string')
          ownerAccountId ??= id
          assert.equal(id, ownerAccountId)
          item.defaultGallery = await geometry(page, 'gallery', names)
          item.defaultTop = await topViewState(page)
          assertTopToolbar(item.defaultTop)
          item.wideMenus = []
          if (spec.width === 1440)
            await wideMenu(page, item.wideMenus, `${mode}-1440-gallery-menu`)
          item.topViewToggles = []
          await page
            .getByRole('button', { name: 'Select files', exact: true })
            .click()
          const first = page.locator('[data-file-card]').first(),
            name = await first.locator('[data-file-name]').textContent()
          await first
            .getByRole('checkbox', { name: `Select ${name}`, exact: true })
            .check()
          await startTrace(page)
          await choose(page, 'list', item.topViewToggles)
          assert(
            item.topViewToggles.at(-1).atTopBefore,
            'The first real toggle starts at the page top'
          )
          item.liveToggleFrames = await endTrace(page)
          await expect(
            page.getByRole('checkbox', { name: `Select ${name}`, exact: true })
          ).toBeChecked()
          const primary = page
            .locator('[data-file-card]')
            .first()
            .locator('[data-file-primary]')
          await primary.focus()
          await page.keyboard.press('Tab')
          await expect(
            page
              .locator('[data-file-card]')
              .first()
              .getByTitle('Manage file', { exact: true })
          ).toBeFocused()
          item.listSelected = await geometry(page, 'list', names)
          await choose(page, 'gallery', item.topViewToggles)
          assert(item.topViewToggles.at(-1).atTopBefore)
          await expect(
            page.getByRole('checkbox', { name: `Select ${name}`, exact: true })
          ).toBeChecked()
          await page
            .getByRole('region', { name: 'Find and filter files' })
            .getByRole('button', { name: 'Done selecting files', exact: true })
            .click()
          await choose(page, 'list', item.topViewToggles)
          assert(item.topViewToggles.at(-1).atTopBefore)
          item.textPhases = []
          for (const size of [16, 32, 16]) {
            await page.evaluate((v) => {
              document.documentElement.style.fontSize = v + 'px'
            }, size)
            await loaded(page, 'list')
            await Promise.all(pending)
            const raw = await geometry(page, 'list', names)
            assert.equal(raw.root, size + 'px')
            const phase = { size, raw, topView: await topViewState(page) }
            item.textPhases.push(phase)
            assertTopToolbar(phase.topView)
            phase.image = await image(
              page,
              `${mode}-${spec.width}-list-${size}-${item.textPhases.length - 1}`
            )
          }
          if (spec.width === 1440)
            await wideMenu(page, item.wideMenus, `${mode}-1440-list-menu`)
          // Additive to the original glyph/selection/top-view and wide checks.
          // Keep the same owner contexts and12-case boundary.
          item.menuBounds = []
          item.menuViewToggles = []
          for (const menuView of ['gallery', 'list']) {
            await choose(page, menuView, item.menuViewToggles)
            for (const [phase, size] of [16, 32, 16].entries()) {
              await page.evaluate((value) => {
                document.documentElement.style.fontSize = value + 'px'
              }, size)
              await loaded(page, menuView)
              await boundedMenu(
                page,
                item.menuBounds,
                `${menuView}:${mode}:${spec.width}:${size}:${phase}`,
                spec.width === 1440 || (spec.width === 820 && size === 16)
                  ? 'horizontal'
                  : 'vertical'
              )
            }
          }
          item.passed = true
        } catch (e) {
          caseError = e
          item.failure = { name: e.name, messageSha256: sha(String(e.message)) }
        } finally {
          try {
            await context.close()
            item.contextClosed = true
          } catch (e) {
            item.contextClosed = false
            item.contextCloseError = {
              name: e.name,
              messageSha256: sha(String(e.message)),
            }
            caseError ??= e
          }
          result.cases.push(item)
        }
        if (caseError) throw caseError
      }
    if (!deepOrigin)
      result.deepUnavailable =
        'Actual Timeline origin/auth not bound; Main coverage is not deep coverage'
    if (deepOrigin)
      for (const [mode, spec] of [
        ['dark', { width: 390, height: 844, coarse: true }],
        ['light', { width: 1440, height: 1000, coarse: false }],
      ]) {
        const context = await browser.newContext({
          storageState: deepState,
          viewport: { width: spec.width, height: spec.height },
          deviceScaleFactor: 1,
          colorScheme: mode,
          hasTouch: spec.coarse,
          isMobile: spec.coarse,
          serviceWorkers: 'block',
        })
        const item = { mode, ...spec, kind: 'deep-history', passed: false }
        let caseError
        try {
          let total = 0
          const pending = []
          await context.route('**/*', (route) => {
            const q = route.request(),
              u = new URL(q.url())
            if (
              !['GET', 'HEAD'].includes(q.method()) ||
              u.origin !== deepOrigin
            ) {
              result.forbiddenRequests.push({
                method: q.method(),
                sameOrigin: u.origin === deepOrigin,
              })
              return route.abort()
            }
            return route.continue()
          })
          await context.routeWebSocket('**/*', (socket) => {
            result.forbiddenRequests.push({ webSocket: true })
            socket.close()
          })
          await context.addInitScript((expectedOrigin) => {
            if (location.origin !== expectedOrigin) return
            if (
              !sessionStorage.getItem('flare-library-view-verifier-initialized')
            ) {
              for (const key of Object.keys(localStorage))
                if (key.startsWith('flare:library-view:'))
                  localStorage.removeItem(key)
              sessionStorage.setItem(
                'flare-library-view-verifier-initialized',
                '1'
              )
            }
          }, deepOrigin)
          context.on('page', (p) => {
            p.on('pageerror', (e) =>
              result.errors.push({
                name: e.name,
                messageSha256: sha(e.message),
              })
            )
            p.on('response', (r) => {
              const u = new URL(r.url())
              if (
                u.origin === deepOrigin &&
                u.pathname === '/api/files/timeline' &&
                r.status() === 200
              )
                pending.push(
                  r.json().then((v) => {
                    total = (v.data ?? v).total
                  })
                )
            })
          })
          const page = await context.newPage()
          await page.mouse.move(1, 1)
          await page.goto(deepOrigin + '/dashboard', {
            waitUntil: 'domcontentloaded',
          })
          await loaded(page, 'gallery')
          await Promise.all(pending)
          assert.equal(
            total,
            12000,
            'Timeline must return exactly12000 owned files, excluding the foreign fixture file'
          )
          await page.goto(deepOrigin + '/dashboard?page=201&limit=48', {
            waitUntil: 'domcontentloaded',
          })
          await loaded(page, 'gallery')
          await Promise.all(pending)
          const before = await page.evaluate(() => {
            const nav =
              document
                .querySelector('[aria-label="Main navigation"]')
                ?.closest('header')
                ?.getBoundingClientRect().bottom || 0
            return [...document.querySelectorAll('[data-file-index]')].find(
              (e) => e.getBoundingClientRect().bottom > Math.max(96, nav + 16)
            )?.dataset.fileIndex
          })
          const rank = Number(before)
          assert(rank >= 9500, 'Actual legacy deep rank, not a top-only proxy')
          const identity = await page
            .locator(`[data-file-index="${rank}"] [data-file-name]`)
            .textContent()
          const settings = await context.newPage()
          await settings.goto(deepOrigin + '/dashboard', {
            waitUntil: 'domcontentloaded',
          })
          await loaded(settings, 'gallery')
          item.secondTabTopViewToggles = []
          await choose(settings, 'list', item.secondTabTopViewToggles)
          await settings.close()
          await expect(
            page.locator('[data-file-card]').first()
          ).toHaveAttribute('data-file-view', 'gallery')
          await page.reload({ waitUntil: 'domcontentloaded' })
          await loaded(page, 'list')
          await Promise.all(pending)
          const anchor = page.locator(
            `[data-file-index="${rank}"] [data-file-name]`
          )
          await expect(anchor).toHaveText(identity)
          await expect(anchor).toBeInViewport()
          await page.goto(deepOrigin + '/dashboard/upload', {
            waitUntil: 'domcontentloaded',
          })
          await page.goBack({ waitUntil: 'domcontentloaded' })
          await loaded(page, 'list')
          await expect(
            page.locator(`[data-file-index="${rank}"] [data-file-name]`)
          ).toHaveText(identity)
          await expect(
            page.locator(`[data-file-index="${rank}"]`)
          ).toBeInViewport()
          item.deepRank = {
            rank,
            name: identity,
            otherTabDidNotChangeOpenPage: true,
            reloadAppliedSavedList: true,
            backRestoredSameFile: true,
          }
          await startTrace(page)
          await page.mouse.wheel(0, 900)
          await loaded(page, 'list')
          await page.mouse.wheel(0, -900)
          await loaded(page, 'list')
          const rail = page.getByRole('slider', {
            name: 'Browse files by date',
            exact: true,
          })
          await rail.focus()
          await page.keyboard.press('Home')
          await loaded(page, 'list')
          await expect(page.locator('[data-file-index="0"]')).toBeInViewport()
          await page.keyboard.press('End')
          await loaded(page, 'list')
          await expect(
            page.locator(`[data-file-index="${total - 1}"]`)
          ).toBeInViewport()
          item.deepNativeFrames = await endTrace(page)
          item.total = total
          item.finalImage = await image(page, `${mode}-${spec.width}-deep-list`)
          item.passed = true
        } catch (e) {
          caseError = e
          item.failure = { name: e.name, messageSha256: sha(String(e.message)) }
        } finally {
          try {
            await context.close()
            item.contextClosed = true
          } catch (e) {
            item.contextClosed = false
            item.contextCloseError = {
              name: e.name,
              messageSha256: sha(String(e.message)),
            }
            caseError ??= e
          }
          result.cases.push(item)
        }
        if (caseError) throw caseError
      }
    for (const mode of ['dark', 'light']) {
      const context = await browser.newContext({
        storageState: restrictedState,
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 1,
        colorScheme: mode,
        hasTouch: true,
        isMobile: true,
        serviceWorkers: 'block',
      })
      const item = { mode, kind: 'restricted', passed: false }
      let caseError
      try {
        await context.route('**/*', (route) => {
          const q = route.request(),
            u = new URL(q.url())
          if (
            !['GET', 'HEAD'].includes(q.method()) ||
            u.origin !== restrictedOrigin
          ) {
            result.forbiddenRequests.push({
              method: q.method(),
              sameOrigin: u.origin === restrictedOrigin,
            })
            return route.abort()
          }
          return route.continue()
        })
        await context.routeWebSocket('**/*', (socket) => {
          result.forbiddenRequests.push({ webSocket: true })
          socket.close()
        })
        context.on('page', (page) => {
          page.on('pageerror', (error) => {
            const documentUrl = new URL(page.url())
            result.errors.push({
              context: 'restricted',
              mode,
              stage: 'pageerror',
              documentPathname: documentUrl.pathname,
              expectedOriginMatched: documentUrl.origin === restrictedOrigin,
              name: error.name,
              messageSha256: sha(error.message),
              stackSha256: sha(String(error.stack ?? '')),
            })
          })
        })
        await context.addInitScript(
          ({ id, expectedOrigin }) => {
            if (location.origin !== expectedOrigin) return
            for (const key of Object.keys(localStorage))
              if (key.startsWith('flare:library-view:'))
                localStorage.removeItem(key)
            localStorage.setItem(
              'flare:library-view:' + encodeURIComponent(id),
              'list'
            )
          },
          { id: ownerAccountId, expectedOrigin: restrictedOrigin }
        )
        const page = await context.newPage()
        await page.goto(restrictedOrigin + '/dashboard', {
          waitUntil: 'domcontentloaded',
        })
        await loaded(page, 'gallery')
        const id = await page.evaluate(async () => {
          const r = await fetch('/api/auth/session')
          const s = await r.json()
          return s.user?.id
        })
        assert(
          typeof id === 'string' && id !== ownerAccountId,
          'Different actual account fixture required'
        )
        item.otherActualAccountPreferenceIgnored = true
        item.topViewToggles = []
        await choose(page, 'list', item.topViewToggles)
        await page
          .locator('[data-file-card]')
          .first()
          .getByTitle('Manage file', { exact: true })
          .click()
        await expect(
          page.getByRole('menuitem', { name: 'Download file', exact: true })
        ).toBeVisible()
        for (const label of denied)
          assert.equal(
            await page
              .getByRole('menuitem', { name: label, exact: true })
              .count(),
            0,
            'Denied action stays absent in List'
          )
        item.deniedActionsAbsent = denied
        item.visibleMenuLabels = await page
          .getByRole('menuitem')
          .allTextContents()
        await page.keyboard.press('Escape')
        item.passed = true
      } catch (e) {
        caseError = e
        item.failure = { name: e.name, messageSha256: sha(String(e.message)) }
      } finally {
        try {
          await context.close()
          item.contextClosed = true
        } catch (e) {
          item.contextClosed = false
          item.contextCloseError = {
            name: e.name,
            messageSha256: sha(String(e.message)),
          }
          caseError ??= e
        }
        result.cases.push(item)
      }
      if (caseError) throw caseError
    }
    assert(
      deepOrigin,
      'Full coverage requires actual Timeline deep origin/auth'
    )
    assert.equal(result.cases.length, 12)
    assert(result.cases.every((v) => v.passed && v.contextClosed))
    assert.deepEqual(result.errors, [])
    assert.deepEqual(result.forbiddenRequests, [])
    result.passed = true
  } catch (e) {
    mainError = e
    result.failure = { name: e.name, messageSha256: sha(String(e.message)) }
  } finally {
    if (browser) {
      try {
        await browser.close()
        result.browserClosed = true
      } catch (e) {
        result.browserCloseError = {
          name: e.name,
          messageSha256: sha(String(e.message)),
        }
        mainError ??= e
      }
    }
    result.passed = result.passed && !mainError && result.browserClosed
    fs.writeFileSync(
      path.join(out, 'results.json'),
      JSON.stringify(result, null, 2) + '\n'
    )
  }
  if (mainError) throw mainError
}
main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
