/* eslint-disable @typescript-eslint/no-require-imports */
// Local, read-only Upload/Paste checks. Files/text stay unsubmitted. Profile
// loading/503 cases are explicitly client interceptions, not server failures.
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const crypto = require('node:crypto')
const {
  chromium,
  expect,
} = require('../../docs/site/node_modules/@playwright/test')
const root = process.cwd()
const auth = process.env.FLARE_HILLCLIMB_AUTH
const out = process.env.FLARE_HILLCLIMB_OUTPUT
const sha = (x) => crypto.createHash('sha256').update(x).digest('hex')
function localOrigin(raw) {
  const u = raw && new URL(raw)
  assert(
    u &&
      ['localhost', '127.0.0.1'].includes(u.hostname) &&
      ['http:', 'https:'].includes(u.protocol) &&
      !u.username &&
      !u.password &&
      u.pathname === '/' &&
      !u.search &&
      !u.hash,
    'Disposable local origin required'
  )
  return u.origin
}
const origin = localOrigin(process.env.FLARE_HILLCLIMB_ORIGIN)
assert(auth && out, 'Existing disposable auth and fresh output required')
assert(
  path.resolve(out).startsWith(path.join(root, '.agent-artifacts') + path.sep),
  'Output must stay in this task artifact tree'
)
const restrictedRaw = process.env.FLARE_HILLCLIMB_RESTRICTED_ORIGIN
const restrictedAuth = process.env.FLARE_HILLCLIMB_RESTRICTED_AUTH
assert(
  !!restrictedRaw === !!restrictedAuth,
  'Bind both restricted fixture inputs or neither'
)
const restrictedOrigin = restrictedRaw ? localOrigin(restrictedRaw) : null
const password = 'local-summary-test-only'
const result = {
  complete: false,
  checks: [],
  screenshots: [],
  gaps: [],
  pageErrors: [],
  traffic: {
    requests: 0,
    blocked: [],
    failedRequests: [],
    httpErrors: [],
    consoleErrors: [],
    webSockets: 0,
  },
  contextsClosed: 0,
  browserClosed: false,
  expectedChecks: restrictedOrigin ? 32 : 28,
  expectedFrames: restrictedOrigin ? 40 : 36,
  waitingObservations: [],
  geometryObservations: [],
  focusObservations: [],
  diagnostic: { caseKey: null, stage: 'preflight', semanticLocator: null },
  method:
    'Native local unsubmitted Upload/Paste; profile-read interception is separately labeled',
  limits: [
    'External frozen-source/runtime/all-service/config/fixture wrapper required; this reader does not invent those proofs.',
    'Headless Chromium; root32 is CSS text-size simulation, not physical hardware, OS zoom or AT.',
    'No upload, paste creation, profile save, login or other API write is forwarded.',
    'Global waiting state is checked only if already genuinely present; this reader never mutates an application store to create it.',
  ],
}
let browser, context, currentPage, releaseHeld
// Diagnostic labels are fixed public control semantics, never field values,
// response bodies, profile names, query strings or raw Playwright error text.
function stage(name, semanticLocator = null) {
  result.diagnostic.stage = name
  result.diagnostic.semanticLocator = semanticLocator
}
function failureFacts(error) {
  let urlPathname = null
  try {
    const url = new URL(currentPage.url())
    if ([origin, restrictedOrigin].includes(url.origin))
      urlPathname = url.pathname
  } catch {}
  return {
    name: error.name,
    timeout: error.name === 'TimeoutError',
    messageSha256: sha(String(error.message)),
    caseKey: result.diagnostic.caseKey,
    stage: result.diagnostic.stage,
    semanticLocator: result.diagnostic.semanticLocator,
    urlPathname,
  }
}
const save = () =>
  fs.writeFile(
    path.join(out, 'results.json'),
    JSON.stringify(result, null, 2) + '\n',
    { mode: 0o600 }
  )
async function frame(page, name) {
  stage('native-frame', 'unmasked viewport PNG')
  const file = path.join(out, name + '.png')
  assert(
    !result.screenshots.some((x) => x.file === file),
    'Unique screenshot path required'
  )
  await page.screenshot({ path: file, fullPage: false, scale: 'css' })
  const bytes = await fs.readFile(file)
  const r = {
    file,
    sha256: sha(bytes),
    bytes: bytes.length,
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
  }
  result.screenshots.push(r)
  return r
}
async function geometry(page, action, key) {
  const collect = () =>
    action.evaluate(async (button) => {
      await document.fonts.ready
      const ids = (button.getAttribute('aria-describedby') || '')
        .split(/\s+/)
        .filter(Boolean)
      const summaries = ids
        .map((id) => document.getElementById(id))
        .filter((el) => el?.getAttribute('aria-live') === 'polite')
      if (summaries.length !== 1)
        throw Error('Exactly one associated live summary required')
      const summary = summaries[0]
      const measure = (el) => {
        const b = el.getBoundingClientRect(),
          clip = { left: 0, right: innerWidth, top: 0, bottom: innerHeight }
        for (let a = el.parentElement; a; a = a.parentElement) {
          if (a === document.body || a === document.documentElement) continue
          const s = getComputedStyle(a),
            r = a.getBoundingClientRect()
          if (/(auto|scroll|hidden|clip)/.test(s.overflowX)) {
            clip.left = Math.max(clip.left, r.left + a.clientLeft)
            clip.right = Math.min(
              clip.right,
              r.left + a.clientLeft + a.clientWidth
            )
          }
          if (/(auto|scroll|hidden|clip)/.test(s.overflowY)) {
            clip.top = Math.max(clip.top, r.top + a.clientTop)
            clip.bottom = Math.min(
              clip.bottom,
              r.top + a.clientTop + a.clientHeight
            )
          }
        }
        const range = document.createRange()
        range.selectNodeContents(el)
        const rects = [...range.getClientRects()]
          .filter((r) => r.width && r.height)
          .map((r) => r.toJSON())
        return {
          box: b.toJSON(),
          clip,
          rects,
          horizontalOverflow: el.scrollWidth > el.clientWidth + 1,
          contained:
            b.left >= clip.left - 1 &&
            b.right <= clip.right + 1 &&
            b.top >= clip.top - 1 &&
            b.bottom <= clip.bottom + 1,
        }
      }
      let stable = 0,
        previous = ''
      for (let i = 0; i < 180; i++) {
        await new Promise(requestAnimationFrame)
        const value = JSON.stringify([
          measure(button).box,
          measure(summary).box,
          document.documentElement.scrollHeight,
          scrollY,
        ])
        stable = value === previous ? stable + 1 : 0
        previous = value
        if (stable >= 8) break
      }
      const a = measure(button),
        s = measure(summary),
        style = getComputedStyle(summary),
        bar = document.querySelector('[data-upload-submit-bar]')
      const hits = []
      for (const y of [0.15, 0.5, 0.85])
        for (const x of [0.15, 0.5, 0.85]) {
          const px = a.box.left + a.box.width * x,
            py = a.box.top + a.box.height * y,
            hit = document.elementFromPoint(px, py)
          hits.push({
            x: px,
            y: py,
            hit: !!hit && (hit === button || button.contains(hit)),
          })
        }
      const header = document.querySelector('[data-dashboard-header]'),
        headerBottom = header ? header.getBoundingClientRect().bottom : 0,
        safeTop = Math.max(0, Math.min(innerHeight, headerBottom)),
        union = {
          top: Math.min(a.box.top, s.box.top),
          bottom: Math.max(a.box.bottom, s.box.bottom),
        }
      union.height = union.bottom - union.top
      const summaryHits = s.rects.flatMap((r) =>
        [0.15, 0.5, 0.85].map((x) => {
          const px = r.left + r.width * x,
            py = r.top + r.height / 2,
            hit = document.elementFromPoint(px, py)
          return {
            x: px,
            y: py,
            hit: !!hit && (hit === summary || summary.contains(hit)),
          }
        })
      )
      return {
        safeViewport: {
          top: safeTop,
          bottom: innerHeight,
          height: innerHeight - safeTop,
        },
        header: header ? header.getBoundingClientRect().toJSON() : null,
        scroll: {
          y: scrollY,
          maximum: Math.max(
            0,
            document.documentElement.scrollHeight - innerHeight
          ),
        },
        union,
        groupFitsSafeViewport: union.height <= innerHeight - safeTop + 1,
        summaryHits,
        action: a,
        nativeDisabled: button.disabled,
        summary: s,
        hits,
        stableRafs: stable,
        ids,
        summaryId: summary.id,
        summaryText: summary.textContent,
        fontSize: parseFloat(style.fontSize),
        rootSize: parseFloat(
          getComputedStyle(document.documentElement).fontSize
        ),
        color: style.color,
        foreground: getComputedStyle(document.body).color,
        pageOverflow:
          document.documentElement.scrollWidth >
          document.documentElement.clientWidth + 1,
        bar: bar ? measure(bar) : null,
        spacerMatches:
          !bar ||
          [...document.querySelectorAll('div[aria-hidden="true"][style]')].some(
            (el) =>
              Math.abs(
                el.getBoundingClientRect().height -
                  (Math.ceil(bar.getBoundingClientRect().height) + 32)
              ) <= 1
          ),
      }
    })
  const initial = await collect()
  result.geometryObservations.push({
    caseKey: result.diagnostic.caseKey,
    key,
    phase: 'before-ordinary-group-scroll',
    data: initial,
  })
  await save()
  assert(initial.stableRafs >= 8, 'Action/summary/spacer did not settle')
  let wheel = null
  // The preceding summary is part of the target. Centering only the button
  // can scroll it above the viewport. Use normal document scrolling, never
  // style/DOM corrections; an over-tall group remains an explicit failure.
  if (!initial.bar && initial.groupFitsSafeViewport) {
    const desiredTop =
        initial.safeViewport.top +
        (initial.safeViewport.height - initial.union.height) / 2,
      deltaY = initial.union.top - desiredTop
    wheel = {
      method: 'Native page.mouse.wheel at document gutter',
      deltaY,
      pointerX: 1,
      pointerY: initial.safeViewport.top + initial.safeViewport.height / 2,
    }
    await page.mouse.move(wheel.pointerX, wheel.pointerY)
    if (deltaY) await page.mouse.wheel(0, deltaY)
  }
  const data = await collect()
  const predicates = {
    settled: data.stableRafs >= 8,
    groupFitsSafeViewport: data.groupFitsSafeViewport,
    actionContained: data.action.contained,
    summaryContained: data.summary.contained,
    summaryNoHorizontalOverflow: !data.summary.horizontalOverflow,
    noPageOverflow: !data.pageOverflow,
    completeSummaryLines:
      !!data.summary.rects.length &&
      data.summary.rects.every(
        (r) =>
          r.left >= data.summary.clip.left - 1 &&
          r.right <= data.summary.clip.right + 1 &&
          r.top >= data.summary.clip.top - 1 &&
          r.bottom <= data.summary.clip.bottom + 1
      ),
    nativeAction44: data.action.box.height >= 44 && data.action.box.width >= 44,
    enabledActionHits: data.nativeDisabled || data.hits.every((p) => p.hit),
    semanticForeground:
      Math.abs(data.fontSize / data.rootSize - 0.875) < 0.01 &&
      data.color === data.foreground,
    floatingBarSpacer: data.spacerMatches && (!data.bar || data.bar.contained),
    belowNavigation:
      data.action.box.top >= data.safeViewport.top - 1 &&
      data.summary.rects.every((r) => r.top >= data.safeViewport.top - 1),
    summaryInkHits:
      !!data.summaryHits.length && data.summaryHits.every((p) => p.hit),
  }
  // Persist the complete raw measurements and each condition before any
  // geometry assertion, including when this sample is the first failure.
  result.geometryObservations.push({
    caseKey: result.diagnostic.caseKey,
    key,
    phase: 'after-ordinary-group-scroll',
    wheel,
    data,
    predicates,
  })
  await save()
  assert(predicates.settled, 'Action/summary/spacer did not settle')
  assert(
    predicates.groupFitsSafeViewport,
    'Complete action and summary must fit the navigation-safe viewport'
  )
  assert(
    data.action.contained &&
      data.summary.contained &&
      !data.summary.horizontalOverflow &&
      !data.pageOverflow,
    'Full action and summary stay within effective clipping/window bounds'
  )
  assert(
    data.summary.rects.length &&
      data.summary.rects.every(
        (r) =>
          r.left >= data.summary.clip.left - 1 &&
          r.right <= data.summary.clip.right + 1 &&
          r.top >= data.summary.clip.top - 1 &&
          r.bottom <= data.summary.clip.bottom + 1
      ),
    'Every complete summary line stays visible'
  )
  assert(
    data.action.box.height >= 44 &&
      data.action.box.width >= 44 &&
      (data.nativeDisabled || data.hits.every((p) => p.hit)),
    'Native action has 44px targets and nine unobstructed hits'
  )
  assert(
    Math.abs(data.fontSize / data.rootSize - 0.875) < 0.01 &&
      data.color === data.foreground,
    'Summary uses semantic text-sm foreground'
  )
  assert(
    data.spacerMatches && (!data.bar || data.bar.contained),
    'Measured floating-bar spacer includes current typography'
  )
  assert(
    predicates.belowNavigation,
    'Complete action and summary ink stay below actual fixed navigation'
  )
  assert(
    predicates.summaryInkHits,
    'Every summary line has three unobstructed native hit points'
  )
  return { key, ...data }
}
async function focusProfileClearOfBar(page) {
  stage(
    'queued-profile-native-focus',
    '#upload-profile / normal scroll and native focus'
  )
  const profile = page.locator('#upload-profile')
  await profile.scrollIntoViewIfNeeded()
  await profile.focus()
  const data = await profile.evaluate(async (el) => {
    let stable = 0,
      previous = ''
    for (let i = 0; i < 180; i++) {
      await new Promise(requestAnimationFrame)
      const value = JSON.stringify([
        el.getBoundingClientRect().toJSON(),
        scrollY,
        document
          .querySelector('[data-upload-submit-bar]')
          ?.getBoundingClientRect()
          .toJSON(),
      ])
      stable = value === previous ? stable + 1 : 0
      previous = value
      if (stable >= 8) break
    }
    const box = el.getBoundingClientRect().toJSON(),
      header = document
        .querySelector('[data-dashboard-bar]')
        ?.closest('header'),
      bar = document.querySelector('[data-upload-submit-bar]'),
      free = {
        top: Math.max(0, header?.getBoundingClientRect().bottom ?? 0),
        bottom: Math.min(
          innerHeight,
          bar?.getBoundingClientRect().top ?? innerHeight
        ),
        left: 0,
        right: innerWidth,
      },
      glyphs = [],
      glyphPaint = [],
      paintedGlyphs = [],
      walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
    while (walker.nextNode()) {
      const node = walker.currentNode
      let offset = 0
      for (const char of node.textContent) {
        const start = offset
        offset += char.length
        if (!char.trim()) continue
        const range = document.createRange()
        range.setStart(node, start)
        range.setEnd(node, offset)
        const clip = {
            left: 0,
            right: innerWidth,
            top: 0,
            bottom: innerHeight,
          },
          overflowAncestors = []
        for (let a = node.parentElement; a; a = a.parentElement) {
          // Root clipping uses the viewport, not a scrolled HTML bounds.top.
          if (a === document.body || a === document.documentElement) continue
          const style = getComputedStyle(a),
            r = a.getBoundingClientRect()
          if (/(auto|scroll|hidden|clip)/.test(style.overflowX)) {
            clip.left = Math.max(clip.left, r.left + a.clientLeft)
            clip.right = Math.min(
              clip.right,
              r.left + a.clientLeft + a.clientWidth
            )
          }
          if (/(auto|scroll|hidden|clip)/.test(style.overflowY)) {
            clip.top = Math.max(clip.top, r.top + a.clientTop)
            clip.bottom = Math.min(
              clip.bottom,
              r.top + a.clientTop + a.clientHeight
            )
          }
          if (
            /(auto|scroll|hidden|clip)/.test(
              style.overflowX + ' ' + style.overflowY
            )
          )
            overflowAncestors.push({
              tag: a.tagName,
              box: r.toJSON(),
              overflowX: style.overflowX,
              overflowY: style.overflowY,
              lineClamp: style.getPropertyValue('-webkit-line-clamp'),
            })
        }
        for (const r of [...range.getClientRects()].filter(
          (r) => r.width && r.height
        )) {
          const raw = r.toJSON(),
            left = Math.max(r.left, clip.left),
            right = Math.min(r.right, clip.right),
            top = Math.max(r.top, clip.top),
            bottom = Math.min(r.bottom, clip.bottom),
            painted =
              right > left && bottom > top
                ? {
                    left,
                    right,
                    top,
                    bottom,
                    width: right - left,
                    height: bottom - top,
                  }
                : null,
            clipped =
              !painted ||
              left !== r.left ||
              right !== r.right ||
              top !== r.top ||
              bottom !== r.bottom
          glyphs.push(raw)
          glyphPaint.push({
            raw,
            clip: { ...clip },
            painted,
            hidden: !painted,
            clipped,
            overflowAncestors,
          })
          if (painted) paintedGlyphs.push(painted)
        }
      }
    }
    const hits = []
    for (const y of [0.15, 0.5, 0.85])
      for (const x of [0.15, 0.5, 0.85]) {
        const px = box.left + box.width * x,
          py = box.top + box.height * y,
          hit = document.elementFromPoint(px, py)
        hits.push({
          x: px,
          y: py,
          hit: !!hit && (hit === el || el.contains(hit)),
        })
      }
    const within = (r) =>
      r.top >= free.top - 1 &&
      r.bottom <= free.bottom + 1 &&
      r.left >= free.left - 1 &&
      r.right <= free.right + 1
    return {
      coarse: matchMedia('(pointer: coarse)').matches,
      focused: document.activeElement === el,
      box,
      free,
      stableRafs: stable,
      scrollY,
      glyphs,
      glyphPaint,
      paintedGlyphs,
      glyphRectCount: glyphs.length,
      hiddenGlyphRectCount: glyphPaint.filter((g) => g.hidden).length,
      clippedGlyphRectCount: glyphPaint.filter((g) => g.clipped).length,
      partiallyClippedGlyphRectCount: glyphPaint.filter(
        (g) => g.clipped && !g.hidden
      ).length,
      fullProfileNameVisibilityClaimed: false,
      hits,
      bar: bar?.getBoundingClientRect().toJSON() ?? null,
      padding: {
        top: getComputedStyle(document.documentElement).scrollPaddingTop,
        bottom: getComputedStyle(document.documentElement).scrollPaddingBottom,
      },
      fullBoxFree: within(box),
      fullInkFree:
        !!paintedGlyphs.length &&
        paintedGlyphs.every(
          (r) =>
            within(r) &&
            r.top >= box.top - 1 &&
            r.bottom <= box.bottom + 1 &&
            r.left >= box.left - 1 &&
            r.right <= box.right + 1
        ),
    }
  })
  result.focusObservations.push({
    caseKey: result.diagnostic.caseKey,
    method:
      'Standard scrollIntoViewIfNeeded and native HTMLElement.focus via Playwright; no wheel, CSS, layout or focus substitute',
    data,
  })
  await save()
  assert(data.stableRafs >= 8, 'Focused profile and upload bar must settle')
  assert(data.bar, 'Queued Upload must expose its actual floating batch bar')
  await expect(profile).toBeFocused()
  assert(data.focused, 'Actual profile selector retains native focus')
  assert(
    data.fullBoxFree && data.fullInkFree,
    'Focused profile control and every painted label intersection stay clear of navigation and upload bar'
  )
  assert(
    data.box.width >= (data.coarse ? 44 : 24) &&
      data.box.height >= (data.coarse ? 44 : 24) &&
      data.hits.every((p) => p.hit),
    'Focused profile meets its actual input-mode target minimum and nine unobstructed native hits'
  )
}
async function summaryFor(action) {
  const id = await action.evaluate((el) =>
    (el.getAttribute('aria-describedby') || '')
      .split(/\s+/)
      .find(
        (id) =>
          document.getElementById(id)?.getAttribute('aria-live') === 'polite'
      )
  )
  assert(id, 'Action summary association required')
  return action.page().locator('[id=' + JSON.stringify(id) + ']')
}
function defaults(account, profile = {}) {
  return {
    visibility: 'PUBLIC',
    expiration: 'DISABLED',
    expiryAction: 'DELETE',
    randomizeFileUrls: false,
    ...account,
    ...profile,
  }
}
async function facts(summary, effective, canShare, manual = {}) {
  const visibility =
    !canShare || (manual.visibility || effective.visibility) === 'PRIVATE'
      ? 'Private'
      : 'Public (anyone with the link)'
  await expect(summary).toContainText(visibility)
  await expect(summary).toContainText(
    effective.randomizeFileUrls ? 'random filenames' : 'original filenames'
  )
  if (
    manual.noExpiry ||
    (effective.expiration === 'DISABLED' && !manual.absolute)
  )
    await expect(summary).toContainText('no expiry')
  else {
    await expect(summary).toContainText(
      (manual.action || effective.expiryAction) === 'SET_PRIVATE'
        ? 'then make private'
        : 'then permanently delete'
    )
    if (!manual.absolute)
      await expect(summary).toContainText(
        { HOUR: '1 hour', DAY: '1 day', WEEK: '1 week', MONTH: '1 month' }[
          effective.expiration
        ]
      )
    else await expect(summary).toContainText(String(new Date().getFullYear()))
  }
  if (manual.password)
    await expect(summary).toContainText(
      manual.invalid ? 'password needs attention' : 'password protected'
    )
}
async function select(page, trigger, label) {
  const publicLabels = [
    'Account settings only',
    'Private (only me)',
    'Public (anyone with the link)',
    'From upload profile',
  ]
  const semanticLabel =
    label instanceof RegExp
      ? 'Account default'
      : publicLabels.includes(label)
        ? label
        : 'actual owned profile option (name omitted)'
  stage('native-select', trigger + ' / ' + semanticLabel)
  await page.locator(trigger).click()
  const option = page.getByRole('option', { name: label, exact: true })
  await expect(option).toHaveCount(1)
  await option.click()
}
async function setup(
  base,
  state,
  width,
  mode,
  font = 16,
  simulation = 'actual'
) {
  context = await browser.newContext({
    storageState: state,
    viewport: {
      width,
      height:
        width === 1440
          ? 1000
          : width === 820
            ? 1180
            : width === 320 && font === 32
              ? 568
              : 844,
    },
    deviceScaleFactor: 1,
    hasTouch: width <= 820,
    isMobile: width <= 390,
    colorScheme: mode,
    serviceWorkers: 'block',
  })
  const simulated = new Set()
  let profileReads = 0
  const firstProfiles = new Promise((resolve, reject) =>
    context.on('response', (r) => {
      if (
        new URL(r.url()).pathname === '/api/upload-profiles' &&
        r.status() === 200
      )
        r.json().then(resolve, reject)
    })
  )
  firstProfiles.catch(() => {})
  const readProfiles = async () => {
    let timer
    try {
      return await Promise.race([
        firstProfiles,
        new Promise((_, reject) => {
          timer = setTimeout(
            () =>
              reject(
                new Error(
                  'Actual profiles response unavailable within 15 seconds'
                )
              ),
            15000
          )
        }),
      ])
    } finally {
      clearTimeout(timer)
    }
  }
  let held, openHeld
  if (simulation === 'loading')
    held = new Promise((resolve) => {
      openHeld = resolve
      releaseHeld = resolve
    })
  await context.route('**/*', async (route) => {
    const req = route.request(),
      u = new URL(req.url())
    result.traffic.requests++
    if (u.origin !== base || !['GET', 'HEAD'].includes(req.method())) {
      result.traffic.blocked.push({
        method: req.method(),
        pathname: u.origin === base ? u.pathname : '[external]',
      })
      return route.abort('blockedbyclient')
    }
    if (u.pathname === '/api/upload-profiles') profileReads++
    if (u.pathname === '/api/upload-profiles' && simulation === 'error') {
      simulated.add(req)
      return route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Simulated profile read failure.' }),
      })
    }
    if (u.pathname === '/api/upload-profiles' && held) await held
    return route.continue()
  })
  await context.routeWebSocket('**/*', (ws) => {
    result.traffic.webSockets++
    ws.close()
  })
  currentPage = await context.newPage()
  currentPage.on('pageerror', (e) =>
    result.pageErrors.push({ name: e.name, messageSha256: sha(e.message) })
  )
  currentPage.on('console', (m) => {
    if (m.type() === 'error') {
      const url = m.location().url
      result.traffic.consoleErrors.push({
        messageSha256: sha(m.text()),
        client503:
          simulation === 'error' &&
          url.startsWith(base + '/api/upload-profiles') &&
          /Failed to load resource.*503/.test(m.text()),
      })
    }
  })
  currentPage.on('response', (r) => {
    if (r.status() >= 400)
      result.traffic.httpErrors.push({
        status: r.status(),
        pathname: new URL(r.url()).pathname,
        client503: simulated.has(r.request()) && r.status() === 503,
      })
  })
  currentPage.on('requestfailed', (req) => {
    const h = req.headers(),
      u = new URL(req.url()),
      error = req.failure()?.errorText
    const record = {
      method: req.method(),
      pathname: u.origin === base ? u.pathname : '[external]',
      resourceType: req.resourceType(),
      navigation: req.isNavigationRequest(),
      error,
      rscOne: h.rsc === '1',
      prefetchOne: h['next-router-prefetch'] === '1',
      rscPresent: 'rsc' in h,
      prefetchPresent: 'next-router-prefetch' in h,
    }
    record.standardPrefetchAbort =
      u.origin === base &&
      u.pathname.startsWith('/dashboard') &&
      record.method === 'GET' &&
      record.resourceType === 'fetch' &&
      !record.navigation &&
      error === 'net::ERR_ABORTED' &&
      record.rscOne &&
      record.prefetchOne
    result.traffic.failedRequests.push(record)
  })
  await currentPage.emulateMedia({ colorScheme: mode })
  return {
    page: currentPage,
    firstProfiles: readProfiles,
    profileReadCount: () => profileReads,
    release: openHeld,
    font,
  }
}
async function open(kind, cfg) {
  result.diagnostic.caseKey = [
    kind,
    cfg.width,
    cfg.mode,
    cfg.font,
    cfg.simulation || 'actual',
    cfg.origin === restrictedOrigin ? 'restricted' : 'owner',
  ].join('-')
  stage('open-route', kind === 'upload' ? 'Upload page' : 'Paste page')
  const s = await setup(
    cfg.origin,
    cfg.auth,
    cfg.width,
    cfg.mode,
    cfg.font,
    cfg.simulation
  )
  await s.page.goto(
    cfg.origin + '/dashboard/' + (kind === 'upload' ? 'upload' : 'paste'),
    { waitUntil: 'domcontentloaded' }
  )
  assert.equal(
    new URL(s.page.url()).pathname,
    '/dashboard/' + (kind === 'upload' ? 'upload' : 'paste'),
    'No login or route fallback'
  )
  stage('read-session', 'GET /api/auth/session')
  const identity = await s.page.evaluate(async () => {
    const r = await fetch('/api/auth/session')
    const d = await r.json()
    return { status: r.status, user: d.user }
  })
  assert(
    identity.status === 200 && /@[^@]+\.test$/.test(identity.user?.email || ''),
    'Disposable .test owner required; never log in'
  )
  if (cfg.font === 32)
    await s.page.evaluate(() => {
      document.documentElement.style.fontSize = '32px'
    })
  const action =
    kind === 'upload'
      ? s.page.locator('[data-upload-primary]')
      : s.page.getByRole('button', { name: 'Create paste', exact: true })
  return { ...s, action, identity }
}
async function draft(kind, page) {
  stage(
    'local-draft',
    kind === 'upload'
      ? 'native Files to upload input'
      : 'Content and Filename inputs'
  )
  if (kind === 'upload')
    await page.locator('input[type="file"]').setInputFiles({
      name: 'summary-check.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('Disposable local queue; never uploaded.'),
    })
  else {
    await page.locator('#content').fill('Read-only local action summary check.')
    await page.locator('#filename').fill('summary-check.txt')
  }
}
async function close() {
  releaseHeld?.()
  releaseHeld = null
  await context?.close()
  context = null
  currentPage = null
  result.contextsClosed++
}
async function ordinary(kind, cfg) {
  const key = [kind, cfg.width, cfg.mode, cfg.font].join('-'),
    { page, action, firstProfiles, profileReadCount } = await open(kind, cfg)
  stage('read-profiles', 'actual GET /api/upload-profiles response')
  const body = await firstProfiles(),
    data = body.data
  assert(
    data &&
      data.effective &&
      data.accountOptions &&
      data.profiles?.length &&
      data.canShare === true,
    'Owner fixture needs readable defaults and an actual named profile; reader never creates one'
  )
  const named = data.profiles[0],
    summary = await summaryFor(action),
    measured = []
  const proof = {
    responseSha256: sha(JSON.stringify(body)),
    profileCount: data.profiles.length,
    defaultIdSha256: data.defaultProfileId ? sha(data.defaultProfileId) : null,
    selectedIdSha256: sha(named.id),
    rawResponseSaved: false,
  }
  stage('default-summary', 'associated complete account-default summary')
  await facts(summary, data.effective, data.canShare)
  stage('inline-geometry', 'initial disabled primary and associated summary')
  measured.push(await geometry(page, action, 'inline'))
  await expect(action).toBeDisabled()
  await draft(kind, page)
  if (kind === 'upload') {
    const waiting =
      (await page
        .getByText('Another upload is running.', { exact: false })
        .count()) > 0
    result.waitingObservations.push({ key, observed: waiting })
    if (waiting) {
      await expect(action).toBeDisabled()
      const descriptions = (
        await action.getAttribute('aria-describedby')
      ).split(/\s+/)
      assert(
        descriptions.some((id) => id.endsWith('-waiting')) &&
          descriptions.some((id) => id.endsWith('-summary')),
        'Real waiting reason and full summary remain associated'
      )
      throw Error(
        'Actual global waiting branch verified, but enabled owner matrix needs an idle fixture; no activity will be changed'
      )
    }
  }
  await expect(action).toBeEnabled()
  if (kind === 'upload') await focusProfileClearOfBar(page)
  await select(page, '#upload-profile', 'Account settings only')
  await facts(summary, defaults(data.accountOptions), data.canShare)
  await select(page, '#upload-profile', named.name)
  const effective = defaults(data.accountOptions, named.options)
  await facts(summary, effective, data.canShare)
  await select(page, '#upload-profile', /^Account default/)
  await facts(summary, data.effective, data.canShare)
  await select(page, '#upload-profile', named.name)
  const options = page
    .locator('details')
    .filter({ has: page.locator('#' + kind + '-visibility') })
  stage(
    'open-options',
    kind === 'upload'
      ? 'Upload options disclosure'
      : 'Sharing options disclosure'
  )
  await options.locator('summary').click()
  await select(page, '#' + kind + '-visibility', 'Private (only me)')
  const field = page.locator('#' + kind + '-password')
  stage(
    'invalid-password',
    '#' + kind + '-password / concealed invalid local value'
  )
  await field.fill('short')
  await facts(summary, effective, true, {
    visibility: 'PRIVATE',
    password: true,
    invalid: true,
  })
  await expect(action).toBeDisabled()
  stage(
    'closed-password-guidance',
    'Review password button outside closed options'
  )
  await options.locator('summary').click()
  await expect(
    page.getByRole('button', { name: 'Review password', exact: true })
  ).toBeVisible()
  await page
    .getByRole('button', { name: 'Review password', exact: true })
    .click()
  stage(
    'recover-password',
    '#' + kind + '-password / focused and natively concealed'
  )
  await expect(field).toBeFocused()
  await field.fill(password)
  assert(
    await field.evaluate((el) => el.type === 'password'),
    'Password remains natively concealed'
  )
  await facts(summary, effective, true, {
    visibility: 'PRIVATE',
    password: true,
  })
  await select(
    page,
    '#' + kind + '-visibility',
    'Public (anyone with the link)'
  )
  await facts(summary, effective, true, {
    visibility: 'PUBLIC',
    password: true,
  })
  await select(page, '#' + kind + '-visibility', 'Private (only me)')
  if (kind === 'upload') {
    for (const [label, actionId] of [
      ['Delete file', 'DELETE'],
      ['Set to private', 'SET_PRIVATE'],
    ]) {
      stage('expiry-open', '#upload-expiration / File expiration')
      await page.locator('#upload-expiration').click()
      const dialog = page.getByRole('dialog', { name: 'Set file expiration' })
      stage('expiry-action', 'dialog Set file expiration / ' + label)
      await dialog.getByRole('button', { name: label, exact: true }).click()
      stage('expiry-preset', 'dialog Set file expiration / button 1 hour')
      await dialog.getByRole('button', { name: '1 hour', exact: true }).click()
      stage(
        'expiry-confirm',
        'dialog Set file expiration / button Set expiration'
      )
      await dialog
        .getByRole('button', { name: 'Set expiration', exact: true })
        .click()
      stage(
        'expiry-summary',
        'complete associated absolute-expiry summary / ' + actionId
      )
      await facts(summary, effective, true, {
        visibility: 'PRIVATE',
        password: true,
        absolute: true,
        action: actionId,
      })
    }
    stage('expiry-none', 'button No expiration / complete no-expiry summary')
    await page
      .getByRole('button', { name: 'No expiration', exact: true })
      .click()
    await facts(summary, effective, true, {
      visibility: 'PRIVATE',
      password: true,
      noExpiry: true,
    })
    await expect(summary).not.toContainText('then ')
    stage('expiry-inherit', 'button Use profile expiration')
    await page
      .getByRole('button', { name: 'Use profile expiration', exact: true })
      .click()
  }
  stage(
    'restore-local-choices',
    'clear concealed password and inherit profile visibility'
  )
  await field.fill('')
  await select(page, '#' + kind + '-visibility', 'From upload profile')
  await options.locator('summary').click()
  await facts(summary, effective, data.canShare)
  stage(
    'restored-geometry',
    'enabled native primary and complete associated summary'
  )
  measured.push(await geometry(page, action, 'local-draft-restored'))
  await frame(page, key + '-action')
  if (cfg.font === 32) {
    await page.evaluate(() => {
      document.documentElement.style.fontSize = ''
    })
    stage('text-size-recovered', 'primary / summary / measured Upload spacer')
    measured.push(await geometry(page, action, 'text-size-recovered'))
    await frame(page, key + '-recovered')
  }
  assert.equal(
    profileReadCount(),
    1,
    'One actual profile query feeds both ordinary views'
  )
  result.checks.push({
    name: key,
    passed: true,
    profileReads: profileReadCount(),
    ownerApi: proof,
    sourceMethod:
      'Actual authorized GET plus native selectors/inputs; no submitted operation',
    rootTextSizeSimulation: cfg.font === 32,
    measured,
  })
  await close()
  await save()
}
async function intercepted(kind, simulation) {
  const key = kind + '-client-' + simulation,
    s = await open(kind, {
      origin,
      auth,
      width: 390,
      mode: 'light',
      font: 16,
      simulation,
    }),
    summary = await summaryFor(s.action)
  stage(
    'client-read-' + simulation,
    'associated unknown-settings summary; explicit client interception'
  )
  if (simulation === 'loading') {
    await expect(summary).toHaveText('Loading saved upload settings…')
    await expect(summary).not.toContainText(/Public|no expiry/)
    await draft(kind, s.page)
    await geometry(s.page, s.action, key)
    await frame(s.page, key)
    s.release()
    releaseHeld = null
    await s.firstProfiles()
    await expect(summary).not.toHaveText('Loading saved upload settings…')
  } else {
    await expect(summary).toContainText(
      'effective settings could not be previewed'
    )
    await expect(summary).not.toContainText(/Public|no expiry/)
    await draft(kind, s.page)
    await geometry(s.page, s.action, key)
    await frame(s.page, key)
  }
  result.checks.push({
    name: key,
    passed: true,
    clientInterception: true,
    realServerFailureClaimed: false,
  })
  await close()
  await save()
}
async function restricted(kind, mode) {
  const key = kind + '-restricted-' + mode
  result.diagnostic.caseKey = key
  stage(
    'restricted-permission',
    kind === 'paste'
      ? 'actual denied Paste redirect to Profile'
      : 'actual private Upload summary'
  )
  if (kind === 'paste') {
    const s = await setup(restrictedOrigin, restrictedAuth, 390, mode)
    // Read the actual session on an allowed page before attempting the denied
    // route. The existing page-access policy redirects denied pages to Profile.
    await s.page.goto(restrictedOrigin + '/dashboard/profile', {
      waitUntil: 'domcontentloaded',
    })
    const identity = await s.page.evaluate(async () => {
      const response = await fetch('/api/auth/session')
      const data = await response.json()
      return { status: response.status, user: data.user }
    })
    assert(
      identity.status === 200 &&
        /@[^@]+\.test$/.test(identity.user?.email || ''),
      'Actual disposable restricted session required'
    )
    const permissions = identity.user.permissions || []
    assert(
      !permissions.includes('administrator') &&
        !permissions.includes('uploadProfiles.manage') &&
        !permissions.includes('pastes.create'),
      'This bound fixture must actually lack Paste and profile access'
    )
    await s.page.goto(restrictedOrigin + '/dashboard/paste', {
      waitUntil: 'domcontentloaded',
    })
    await expect(s.page).toHaveURL(restrictedOrigin + '/dashboard/profile')
    await expect(
      s.page.getByRole('heading', { name: 'Profile', level: 1, exact: true })
    ).toBeVisible()
    await expect(
      s.page.getByRole('button', { name: 'Create paste', exact: true })
    ).toHaveCount(0)
    await expect(
      s.page.locator(
        '#content, #filename, #upload-profile, p[aria-live="polite"][id$="-summary"]'
      )
    ).toHaveCount(0)
    assert.equal(
      s.profileReadCount(),
      0,
      'Denied Paste does not request upload profiles'
    )
    result.checks.push({
      name: key,
      passed: true,
      actualRestrictedSession: true,
      kind: 'paste-permission-denied',
      denial:
        'Actual existing redirect to Profile; no Paste form or action summary',
      sessionAllowsPaste: false,
      sessionAllowsProfileRead: false,
      profileReads: 0,
      limitedPasteSummaryExercised: false,
    })
    result.gaps.push(
      'Limited-role Paste summary not exercised: the actual restricted fixture lacks pastes.create (' +
        mode +
        ').'
    )
    await frame(s.page, key)
    await close()
    await save()
    return
  }
  const s = await open(kind, {
    origin: restrictedOrigin,
    auth: restrictedAuth,
    width: 390,
    mode,
    font: 16,
  })
  const permissions = s.identity.user.permissions || []
  assert(
    !permissions.includes('administrator') &&
      !permissions.includes('uploadProfiles.manage') &&
      !permissions.includes('files.share'),
    'Actual private-upload limited-role fixture required'
  )
  const summary = await summaryFor(s.action)
  await expect(s.page.locator('#upload-profile')).toHaveCount(0)
  assert.equal(s.profileReadCount(), 0, 'Limited role makes no profile request')
  await expect(summary).toContainText(
    'full settings are unavailable for this role'
  )
  await expect(summary).toContainText('Private')
  await expect(summary).not.toContainText(/Public|no expiry/)
  await draft(kind, s.page)
  const measured = await geometry(s.page, s.action, key)
  result.checks.push({
    name: key,
    passed: true,
    actualRestrictedSession: true,
    kind: 'private-upload-limited-summary',
    profileReads: s.profileReadCount(),
    measured,
  })
  await frame(s.page, key)
  await close()
  await save()
}
async function main() {
  assert((await fs.stat(auth)).isFile(), 'Existing auth file required')
  try {
    await fs.access(out)
    throw Error('Fresh output required; never overwrite')
  } catch (e) {
    if (e.code !== 'ENOENT') throw e
  }
  await fs.mkdir(out, { mode: 0o700 })
  let error
  try {
    browser = await chromium.launch({ headless: true })
    for (const kind of ['upload', 'paste'])
      for (const mode of ['light', 'dark'])
        for (const width of [320, 390, 820, 1440])
          await ordinary(kind, { origin, auth, width, mode, font: 16 })
    for (const kind of ['upload', 'paste'])
      for (const mode of ['light', 'dark'])
        for (const width of [320, 390])
          await ordinary(kind, { origin, auth, width, mode, font: 32 })
    for (const kind of ['upload', 'paste'])
      for (const simulation of ['loading', 'error'])
        await intercepted(kind, simulation)
    if (restrictedOrigin)
      for (const kind of ['upload', 'paste'])
        for (const mode of ['light', 'dark']) await restricted(kind, mode)
    else
      result.gaps.push(
        'Restricted3333 session not bound; no restricted-role browser pass claimed.'
      )
    if (!result.waitingObservations.some((x) => x.observed))
      result.gaps.push(
        'No already-active global upload observed or created; no waiting-hint native pass claimed.'
      )
    result.gaps.push(
      'Missing-profile and account/session-switch cases remain in focused model/query tests; no removed profile is fabricated in this reader.'
    )
    stage(
      'final-validation',
      'exact checks/frame counts, closure and unchanged traffic assertions'
    )
    assert.equal(result.checks.length, result.expectedChecks)
    assert.equal(result.screenshots.length, result.expectedFrames)
    assert.equal(
      new Set(result.screenshots.map((x) => x.file)).size,
      result.expectedFrames
    )
    assert.equal(result.pageErrors.length, 0)
    assert.equal(result.traffic.blocked.length, 0)
    assert.equal(result.traffic.webSockets, 0)
    assert.equal(
      result.traffic.failedRequests.filter((x) => !x.standardPrefetchAbort)
        .length,
      0,
      'No unexpected failed requests; exact standard prefetch aborts retained separately'
    )
    assert(
      result.traffic.httpErrors.every((x) => x.client503) &&
        result.traffic.consoleErrors.every((x) => x.client503),
      'Only explicitly client-intercepted503 failures may be expected'
    )
    result.complete = true
  } catch (e) {
    error = e
    result.error = failureFacts(e)
    if (currentPage)
      try {
        await frame(currentPage, 'failure')
      } catch {}
  } finally {
    if (context)
      try {
        await close()
      } catch (e) {
        result.closeError = failureFacts(e)
        error ||= e
      }
    if (browser)
      try {
        await browser.close()
        result.browserClosed = true
      } catch (e) {
        result.closeError = failureFacts(e)
        error ||= e
      }
    result.rawFailedRequestCount = result.traffic.failedRequests.length
    result.standardPrefetchAbortCount = result.traffic.failedRequests.filter(
      (x) => x.standardPrefetchAbort
    ).length
    result.unexpectedFailedRequestCount = result.traffic.failedRequests.filter(
      (x) => !x.standardPrefetchAbort
    ).length
    for (const f of result.screenshots)
      assert.equal(
        sha(await fs.readFile(f.file)),
        f.sha256,
        'Native frame hash changed'
      )
    result.passed = result.complete && !error && result.browserClosed
    await save()
  }
  if (error) throw error
  console.log(
    JSON.stringify({
      complete: result.complete,
      checks: result.checks.length,
      browserClosed: result.browserClosed,
      rawFailedRequests: result.rawFailedRequestCount,
      standardPrefetchAborts: result.standardPrefetchAbortCount,
      unexpectedFailedRequests: result.unexpectedFailedRequestCount,
    })
  )
}
main().catch((e) => {
  console.error(
    JSON.stringify({
      passed: false,
      ...(result.error || failureFacts(e)),
    })
  )
  process.exitCode = 1
})
