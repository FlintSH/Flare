/* eslint-disable @typescript-eslint/no-require-imports */
/* Explicit native geometry regression: run against an isolated rendered gallery.
   Requires docs/site's installed Playwright and a real read-only owner session.
   FLARE_GALLERY_ORIGIN, FLARE_GALLERY_STORAGE_STATE, FLARE_GALLERY_OUTPUT. */
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const { measureFilenameGeometry } = require('./filename-geometry.cjs')
const { chromium, expect } = require(
  path.resolve('docs/site/node_modules/@playwright/test')
)
const origin = process.env.FLARE_GALLERY_ORIGIN
assert(origin && /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin))
const state = path.resolve(process.env.FLARE_GALLERY_STORAGE_STATE || '')
assert(fs.statSync(state).isFile())
const out = path.resolve(process.env.FLARE_GALLERY_OUTPUT || '')
assert(
  out !== process.cwd() && !fs.existsSync(out),
  'Use a fresh artifact directory'
)
fs.mkdirSync(out, { recursive: true })
const sha = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex')
const result = {
  method:
    'Real rendered read-only gallery. Native bounding boxes, computed styles and file identities. Explicit pointer cases, complete raw filenames with owner-API identity, every-grapheme/extension/card clipping bounds, natural wrapping across pointer modes, size in the footer, fine common first-line and coarse centered headings; root32 is an explicitly local CSS text-size simulation. No layout correction, synthetic previews, mutation requests, saved settings or image masks. Normal GET/session/audit activity may persist.',
  cases: [],
  errors: [],
  forbiddenRequests: [],
  browserClosed: false,
  passed: false,
}
const cases = [
  ...[
    { width: 1440, coarse: false },
    { width: 820, coarse: true },
    { width: 390, coarse: true },
    { width: 320, coarse: true },
  ].flatMap(({ width, coarse }) =>
    [16, ...(width < 400 ? [32] : [])].flatMap((rootSize) =>
      ['dark', 'light'].map((mode) => ({ width, rootSize, mode, coarse }))
    )
  ),
  ...[1440, 320].flatMap((width) =>
    ['dark', 'light'].map((mode) => ({
      width,
      rootSize: 32,
      mode,
      coarse: false,
    }))
  ),
]
assert.equal(cases.length, 16)
assert.equal(new Set(cases.map((c) => JSON.stringify(c))).size, 16)
// Read live endpoint geometry without altering styles or application state.
async function measureRailEndpoints(page) {
  return page.evaluate(() => {
    const box = (element) => element?.getBoundingClientRect().toJSON() || null
    const rail = document.querySelector('[data-date-rail-track]')
    const cards = [...document.querySelectorAll('[data-file-card]')].map(
      (card) => ({
        index: Number(card.closest('[data-file-index]').dataset.fileIndex),
        box: box(card),
      })
    )
    const filterPanel = document.querySelector(
      '[aria-label="Find and filter files"]'
    )
    const overlaps = (a, b) =>
      a.left < b.right - 0.5 &&
      a.right > b.left + 0.5 &&
      a.top < b.bottom - 0.5 &&
      a.bottom > b.top + 0.5
    const visibility = (element) => {
      const own = getComputedStyle(element)
      let opacity = 1
      let ancestorsVisible = true
      for (let parent = element; parent; parent = parent.parentElement) {
        const style = getComputedStyle(parent)
        opacity *= Number(style.opacity)
        if (
          style.display === 'none' ||
          ['hidden', 'collapse'].includes(style.visibility)
        )
          ancestorsVisible = false
      }
      const rect = box(element)
      return {
        display: own.display,
        visibility: own.visibility,
        opacity: Number(own.opacity),
        textAlign: own.textAlign,
        lineHeight: own.lineHeight,
        effectiveOpacity: opacity,
        ancestorsVisible,
        painted:
          ancestorsVisible && opacity > 0 && rect.width > 0 && rect.height > 0,
      }
    }
    const glyphs = (element) => {
      const items = []
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
      while (walker.nextNode()) {
        const node = walker.currentNode
        for (const segment of new Intl.Segmenter(undefined, {
          granularity: 'grapheme',
        }).segment(node.textContent)) {
          if (!/\S/u.test(segment.segment)) continue
          const range = document.createRange()
          range.setStart(node, segment.index)
          range.setEnd(node, segment.index + segment.segment.length)
          items.push({
            glyph: segment.segment,
            ranges: [...range.getClientRects()]
              .filter((r) => r.width > 0 && r.height > 0)
              .map((r) => r.toJSON()),
          })
        }
      }
      return items
    }
    const track = box(rail)
    const endpoints = [
      ...rail.querySelectorAll('[data-date-rail-endpoint]'),
    ].map((endpoint) => {
      const rect = box(endpoint)
      return {
        endpoint: endpoint.dataset.dateRailEndpoint,
        text: endpoint.textContent.trim(),
        box: rect,
        computed: visibility(endpoint),
        glyphs: glyphs(endpoint),
        cardIntersections: cards
          .filter((card) => overlaps(rect, card.box))
          .map((card) => card.index),
        filterPanelIntersection:
          !!filterPanel && overlaps(rect, box(filterPanel)),
      }
    })
    return {
      track,
      trackComputed: visibility(rail),
      hovered: rail.parentElement.matches(':hover'),
      focused: document.activeElement === rail,
      valueNow: rail.getAttribute('aria-valuenow'),
      valueText: rail.getAttribute('aria-valuetext'),
      dragging: !!rail.querySelector('[data-dragging="true"]'),
      scrollY,
      viewportHeight: innerHeight,
      clientWidth: document.documentElement.clientWidth,
      bodyWidth: document.documentElement.scrollWidth,
      filterPanel: box(filterPanel),
      endpoints,
      endpointVisibilityActive: endpoints.some(
        (endpoint) => endpoint.computed.painted
      ),
    }
  })
}

async function main() {
  let browser
  try {
    browser = await chromium.launch({ headless: true })
    result.browserVersion = browser.version()
    for (const spec of cases) {
      const item = { ...spec, passed: false }
      const context = await browser.newContext({
        storageState: state,
        viewport: { width: spec.width, height: 1000 },
        hasTouch: spec.coarse,
        isMobile: spec.coarse && spec.width < 640,
        colorScheme: spec.mode,
        reducedMotion: 'reduce',
      })
      try {
        await context.route('**/*', (route) => {
          const request = route.request(),
            url = new URL(request.url())
          if (
            (['http:', 'https:'].includes(url.protocol) &&
              url.origin !== origin) ||
            (url.pathname.startsWith('/api/') &&
              !['GET', 'HEAD', 'OPTIONS'].includes(request.method()))
          ) {
            result.forbiddenRequests.push({
              method: request.method(),
              path: url.pathname,
            })
            return route.abort()
          }
          return route.continue()
        })
        const page = await context.newPage()
        page.on('pageerror', (error) =>
          result.errors.push({ ...spec, message: error.message })
        )
        await page.goto(origin + '/dashboard')
        await page
          .locator('[data-file-card]')
          .first()
          .waitFor({ timeout: 90000 })
        await page.waitForLoadState('networkidle')
        await page.evaluate(() => document.fonts.ready)
        await expect(page.locator('html')).toHaveClass(new RegExp(spec.mode))
        if (spec.rootSize !== 16)
          await page.addStyleTag({
            content: `html{font-size:${spec.rootSize}px!important}`,
          })
        await page.evaluate(async () => {
          await Promise.all(
            [...document.images]
              .filter((i) => {
                const b = i.getBoundingClientRect()
                return (
                  b.width && b.height && b.bottom > 0 && b.top < innerHeight
                )
              })
              .map((i) =>
                Promise.race([
                  i.decode().catch(() => {}),
                  new Promise((r) => setTimeout(r, 5000)),
                ])
              )
          )
          scrollTo(0, 0)
          await new Promise((r) =>
            requestAnimationFrame(() => requestAnimationFrame(r))
          )
        })
        item.geometry = await page.evaluate(() => {
          const box = (e) => e?.getBoundingClientRect().toJSON()
          const kindContent = (card) => {
            if (card.dataset.fileKind !== 'generic') return null
            const row = card.querySelector('[data-file-heading]')
            const label = card.querySelector('[data-file-type]')
            const icon = row.querySelector(':scope > svg')
            const style = getComputedStyle(label)
            const range = document.createRange()
            range.selectNodeContents(label)
            const lines = [...range.getClientRects()]
              .filter((r) => r.width && r.height)
              .map((r) => r.top)
            const lineCount = new Set(lines.map((y) => Math.round(y))).size
            const glyphs = []
            const walker = document.createTreeWalker(
              label,
              NodeFilter.SHOW_TEXT
            )
            while (walker.nextNode()) {
              const node = walker.currentNode
              let offset = 0
              for (const glyph of node.textContent) {
                const end = offset + glyph.length
                if (/\S/u.test(glyph)) {
                  range.setStart(node, offset)
                  range.setEnd(node, end)
                  glyphs.push(range.getBoundingClientRect().toJSON())
                }
                offset = end
              }
            }
            const verticalChrome = (s) =>
              [
                'paddingTop',
                'paddingBottom',
                'borderTopWidth',
                'borderBottomWidth',
              ].reduce((sum, property) => sum + parseFloat(s[property]), 0)
            const labelContentHeight =
              lineCount * parseFloat(style.lineHeight) + verticalChrome(style)
            return {
              row: box(row),
              label: box(label),
              icon: box(icon),
              text: label.textContent,
              glyphs,
              lineCount,
              labelContentHeight,
              primary: box(card.querySelector('[data-file-primary]')),
              footer: box(card.querySelector('[data-file-activity]')),
              renderContractVersion: 'filename-led-generic-v1',
            }
          }
          const rows = [...document.querySelectorAll('[data-row]')]
            .filter((r) => r.querySelector('[data-file-card]'))
            .slice(0, 4)
          return {
            actualMode: document.documentElement.className,
            coarse: matchMedia('(pointer:coarse)').matches,
            rootFont: getComputedStyle(document.documentElement).fontSize,
            bodyWidth: document.documentElement.scrollWidth,
            clientWidth: document.documentElement.clientWidth,
            rows: rows.map((row) => ({
              index: Number(row.dataset.row),
              box: box(row),
              cards: [...row.querySelectorAll('[data-file-card]')].map(
                (card) => ({
                  id: card.closest('[data-file-index]').dataset.fileIndex,
                  name: card.querySelector('[data-file-name]').title,
                  logicalName:
                    card.querySelector('[data-file-name]').textContent,
                  kind: card.dataset.fileKind,
                  box: box(card),
                  heading: box(card.querySelector('[data-file-heading]')),
                  filename: box(card.querySelector('[data-file-name]')),
                  size: box(
                    card.querySelector('[data-file-activity] > span.mr-auto')
                  ),
                  primary: box(card.querySelector('[data-file-primary]')),
                  preview: box(card.querySelector('[data-file-preview]')),
                  badges: box(
                    card.querySelector('[data-preview-badges]') ||
                      card.querySelector('[data-file-activity]')
                  ),
                  date: box(card.querySelector('[data-file-uploaded]')),
                  activity: box(card.querySelector('[data-file-activity]')),
                  labelRows: [
                    ...card.querySelectorAll('[data-file-labels]'),
                  ].map(box),
                  kindContent: kindContent(card),
                  labels: [...card.querySelectorAll('[data-file-label]')].map(
                    box
                  ),
                  menu: box(
                    card.querySelector('button[aria-label^="Manage "]')
                  ),
                })
              ),
            })),
            rail: box(document.querySelector('[data-date-rail-track]')),
            thumb: box(document.querySelector('[data-date-rail-handle]')),
            folderNavigation: (() => {
              const nav = document.querySelector(
                'nav[aria-label="File library"]'
              )
              if (!nav) return null
              return {
                box: box(nav),
                buttons: [...nav.querySelectorAll('button')].map((button) => {
                  const walker = document.createTreeWalker(
                      button,
                      NodeFilter.SHOW_TEXT
                    ),
                    textRects = []
                  while (walker.nextNode()) {
                    const range = document.createRange()
                    range.selectNodeContents(walker.currentNode)
                    textRects.push(
                      ...[...range.getClientRects()]
                        .filter((r) => r.width && r.height)
                        .map((r) => r.toJSON())
                    )
                  }
                  return {
                    text: button.textContent.trim(),
                    box: box(button),
                    textRects,
                  }
                }),
              }
            })(),
            lane: (() => {
              const e = document.querySelector(
                '[data-date-rail-track]>div:first-child'
              )
              return (
                e && {
                  box: box(e),
                  background: getComputedStyle(e).backgroundColor,
                  border: getComputedStyle(e).borderColor,
                }
              )
            })(),
          }
        })
        const ownerReply = await context.request.get(
          origin + '/api/files?limit=100'
        )
        assert.equal(
          ownerReply.status(),
          200,
          'Independent owner collection must load'
        )
        const ownerBody = await ownerReply.text(),
          ownerFiles = JSON.parse(ownerBody).data
        item.ownerApiProof = {
          route: '/api/files?limit=100',
          status: ownerReply.status(),
          responseSha256: sha(ownerBody),
          fileCount: ownerFiles.length,
        }
        item.renderContractVersion = 'full-filename-v1'
        for (const row of item.geometry.rows)
          for (const card of row.cards) {
            const element = page.locator(
              `[data-file-index="${card.id}"] [data-file-name]`
            )
            card.filenameText = await element.evaluate(measureFilenameGeometry)
            const expected = ownerFiles[Number(card.id)]
            assert.ok(
              expected,
              'Every measured row index has an independent actual owner record'
            )
            card.expectedFilenameFromOwnerApi = expected.name
            assert.equal(card.name, expected.name)
            assert.equal(card.filenameText.text, expected.name)
            assert.equal(card.filenameText.title, expected.name)
            assert.ok(
              Math.abs(card.filenameText.card.top - card.box.top) <= 1 &&
                Math.abs(card.filenameText.card.height - card.box.height) <= 1,
              'Shared filename measurement uses the same settled card layout'
            )
          }
        const g = item.geometry,
          failures = []
        const check = (ok, message) => {
          if (!ok) failures.push(message)
        }
        const inside = (a, b, tolerance = 1) =>
          a.left >= b.left - tolerance &&
          a.right <= b.right + tolerance &&
          a.top >= b.top - tolerance &&
          a.bottom <= b.bottom + tolerance
        check(
          g.coarse === spec.coarse,
          'Actual pointer mode matches explicit case'
        )
        check(g.rootFont === spec.rootSize + 'px', 'Actual root font size')
        check(g.actualMode.split(/\s+/).includes(spec.mode), 'Actual OS theme')
        check(
          g.bodyWidth <= g.clientWidth && g.clientWidth === spec.width,
          'No horizontal document overflow'
        )
        check(g.rows.length >= 2, 'Real gallery has at least two rendered rows')
        if (g.folderNavigation) {
          const nav = g.folderNavigation
          check(
            nav.buttons.length >= 3,
            'Real All files/Unfiled/Folders controls'
          )
          for (const button of nav.buttons) {
            check(
              inside(button.box, nav.box) &&
                button.textRects.every((r) => inside(r, button.box)),
              'Folder navigation control and text stay within their navigation'
            )
            check(
              button.box.height >= 44 || !spec.coarse,
              'Coarse folder control target44'
            )
          }
          for (let i = 0; i < nav.buttons.length; i++)
            for (let j = i + 1; j < nav.buttons.length; j++) {
              const a = nav.buttons[i].box,
                b = nav.buttons[j].box
              check(
                Math.min(a.right, b.right) <= Math.max(a.left, b.left) + 0.5 ||
                  Math.min(a.bottom, b.bottom) <= Math.max(a.top, b.top) + 0.5,
                'Folder navigation controls do not overlap'
              )
            }
        }

        const ids = g.rows.flatMap((r) => r.cards.map((c) => Number(c.id)))
        check(
          ids.every((id, i) => !i || id === ids[i - 1] + 1),
          'Chronological DOM order has no duplicates or holes'
        )
        for (let i = 0; i < g.rows.length; i++) {
          const row = g.rows[i],
            tallest = Math.max(...row.cards.map((c) => c.box.bottom))
          check(
            Math.abs(row.box.bottom - tallest - spec.rootSize) <= 1,
            'Measured virtual row ends with exactly the normal16px scaled gap'
          )
          if (i)
            check(
              Math.abs(row.box.top - g.rows[i - 1].box.bottom) <= 1,
              'Adjacent mounted virtual rows have no unpainted gap or overlap'
            )
        }
        for (const row of g.rows) {
          const headings = row.cards.map((c) => c.heading.top)
          check(
            Math.max(...headings) - Math.min(...headings) <= 1,
            'Common filename header edge within each row'
          )
          if (!spec.coarse) {
            const firstLines = row.cards.map((c) => c.filename.top)
            check(
              Math.max(...firstLines) - Math.min(...firstLines) <= 1,
              'Fine row filenames retain a common first-line coordinate'
            )
          }
          for (const c of row.cards) {
            const text = c.filenameText
            check(c.logicalName === c.name, 'Full logical filename retained')
            check(
              text.ariaLabel === c.name,
              'Exact full filename accessible name retained'
            )
            check(
              Number.isFinite(text.lineHeight) &&
                text.lineHeight > 0 &&
                Number.isFinite(text.fullInlineWidth),
              'Explicit actual filename font metrics'
            )
            check(
              text.first?.fits,
              'First filename grapheme is inside its own span, link and clipping ancestors'
            )
            check(
              text.lastStem?.fits,
              'Last stem grapheme is inside its own span, link and clipping ancestors'
            )
            if (text.extension)
              check(
                text.extension.text ===
                  c.expectedFilenameFromOwnerApi.match(
                    /\.[A-Za-z0-9]{1,16}$/
                  )?.[0] &&
                  text.extension.glyphs.length > 0 &&
                  text.extension.glyphs.every((g) => g.fits),
                'Every extension grapheme is inside its own span, link and clipping ancestors'
              )
            check(
              text.allGlyphsFit &&
                text.glyphs.length > 0 &&
                text.glyphs.every((glyph) => glyph.fits),
              'Every complete naturally wrapping filename grapheme remains visible'
            )
            check(
              text.css.whiteSpace === 'pre-wrap' &&
                text.css.textOverflow !== 'ellipsis',
              'Filename uses a complete natural wrapping model without ellipsis'
            )
            check(
              c.size &&
                inside(c.size, c.activity) &&
                c.size.width > 0 &&
                c.size.height > 0,
              'File size remains visible exactly in the activity footer'
            )
            check(
              inside(c.filename, c.heading) && inside(c.heading, c.box),
              'Filename/header contained'
            )
            if (spec.coarse)
              check(
                Math.abs(
                  c.filename.top +
                    c.filename.height / 2 -
                    (c.heading.top + c.heading.height / 2)
                ) <= 1,
                'Each coarse filename is centered within its naturally sized heading'
              )
            if (spec.coarse)
              check(
                c.heading.height >= 44,
                'Coarse filename headings retain a physical44px floor'
              )
            if (text.fullInlineWidth <= c.filename.width + 0.5) {
              check(
                text.lineCount === 1,
                'A complete filename that fits is not forced onto two lines'
              )
              check(
                text.glyphs.length > 0 && text.glyphs.every((g) => g.fits),
                'Every grapheme of a complete fitting filename remains visible'
              )
            }
            check(
              c.labels.length ? c.labelRows.length === 1 : !c.labelRows.length,
              'Folder/tag rows exist exactly when their labels exist'
            )
            check(
              c.box.bottom - c.activity.bottom <= (9 * spec.rootSize) / 16,
              'Card ends directly after actual activity content'
            )
            check(inside(c.menu, c.box), 'Manage action contained')
            if (spec.coarse)
              check(
                c.menu.width >= 44 &&
                  c.menu.height >= 44 &&
                  c.labels.every((l) => l.height >= 44),
                'Coarse action and label targets retain44px minimum'
              )
            if (c.kind === 'image') {
              const stage = spec.coarse && spec.width >= 640 ? 128 : 112
              check(
                Math.abs(c.preview.height - stage) <= 1,
                'Physical image stage stays compact after text enlargement'
              )
              if (spec.rootSize === 32)
                check(
                  c.badges.top >= c.preview.bottom - 1,
                  'Enlarged metadata stays outside image pixels'
                )
            } else {
              const kind = c.kindContent
              check(
                kind && kind.lineCount > 0 && kind.glyphs.length > 0,
                'Generic cards expose their actual kind label'
              )
              if (kind) {
                check(
                  Math.abs(kind.label.height - kind.labelContentHeight) <= 1 &&
                    kind.primary.height >= 44 &&
                    !c.preview,
                  'Generic type grows only for its actual text and its primary heading keeps44px without a preview stage'
                )
                check(
                  inside(kind.row, c.box) &&
                    inside(kind.primary, kind.row) &&
                    inside(kind.label, kind.footer) &&
                    inside(kind.footer, c.box) &&
                    inside(kind.icon, kind.row) &&
                    kind.glyphs.every(
                      (glyph) =>
                        glyph.width > 0 &&
                        glyph.height > 0 &&
                        inside(glyph, kind.label) &&
                        inside(glyph, kind.footer)
                    ),
                  'Every generic kind glyph stays inside its label/footer and the icon inside the filename header'
                )
              }
            }
            if (
              g.rail &&
              c.box.top < g.rail.bottom &&
              c.box.bottom > g.rail.top
            )
              check(
                c.box.right <= g.rail.left + 1,
                'Date rail44px hit lane does not overlap cards/actions'
              )
          }
        }
        if (spec.rootSize === 16 && spec.width === 820) {
          const genericRow = g.rows.find((r) =>
            r.cards.every((c) => c.kind === 'generic')
          )
          const image = g.rows
            .flatMap((r) => r.cards)
            .find((c) => c.kind === 'image')
          check(!!genericRow && !!image, 'Fixture exercises a generic-only row')
          if (genericRow && image)
            check(
              genericRow.box.height <= image.box.height - 4,
              'Generic-only virtual rows retain their shorter measured height'
            )
        }
        if (spec.rootSize === 16 && spec.width >= 820) {
          const mixed = g.rows.find(
            (r) =>
              r.cards.some((c) => c.kind === 'image') &&
              r.cards.some((c) => c.kind === 'generic' && !c.labels.length)
          )
          check(!!mixed, 'Fixture exercises a mixed row')
          if (mixed) {
            const image = mixed.cards.find((c) => c.kind === 'image')
            check(
              mixed.cards.some(
                (c) =>
                  c.kind === 'generic' &&
                  !c.labels.length &&
                  c.box.height <= image.box.height - 20
              ),
              'Generic cards genuinely shrink inside mixed rows'
            )
          }
        }
        check(
          g.thumb && g.thumb.width === 44 && g.thumb.height === 44,
          'Date thumb remains physical44px at enlarged text'
        )
        check(
          g.lane &&
            g.lane.box.width === 16 &&
            g.lane.background !== 'rgba(0, 0, 0, 0)',
          'Rail lane is visibly marked at rest'
        )
        const defaultEndpointState = await measureRailEndpoints(page)
        const filename = `${spec.coarse ? 'coarse' : 'fine'}-${spec.width}-${spec.rootSize}-${spec.mode}.png`
        const frame = await page.screenshot({
          path: path.join(out, filename),
          fullPage: false,
          animations: 'disabled',
          caret: 'hide',
        })
        item.frame = {
          file: filename,
          sha256: sha(frame),
          nativeViewport: true,
        }
        // Private insertion fragment: placed after all original geometry predicates.
        item.railEndpointProbe = {
          method:
            'Actual mouse movement, computed endpoint visibility and glyph boxes. Coarse emulation checks hidden-year CSS under the same mouse hover; it is not a physical touch interaction. One bounded native wheel is used only if the initial track is deliberately unavailable, after preserving the untouched default frame.',
          beforeHover: await measureRailEndpoints(page),
          nativeScrollSteps: [],
          nativeInputs: [],
        }
        const endpointProbe = item.railEndpointProbe
        const recordedMouseMove = async (x, y, reason) => {
          endpointProbe.nativeInputs.push({ type: 'mouse.move', x, y, reason })
          await page.mouse.move(x, y)
        }
        item.frame.endpointVisibilityActiveBeforeCapture =
          defaultEndpointState.endpointVisibilityActive
        item.frame.endpointVisibilityActiveAfterCapture =
          endpointProbe.beforeHover.endpointVisibilityActive
        endpointProbe.beforeDefaultCapture = defaultEndpointState
        item.frame.defaultStateBeforeRailInteraction = true
        const settleEndpointGeometry = () =>
          page.evaluate(
            () =>
              new Promise((resolve) => {
                let last = '',
                  same = 0,
                  frames = 0
                const frame = () => {
                  const rail = document.querySelector('[data-date-rail-track]')
                  const rect = rail.getBoundingClientRect()
                  const endpoints = [
                    ...rail.querySelectorAll('[data-date-rail-endpoint]'),
                  ].map((element) => {
                    const r = element.getBoundingClientRect(),
                      s = getComputedStyle(element)
                    return [
                      r.x,
                      r.y,
                      r.width,
                      r.height,
                      s.display,
                      s.visibility,
                      s.opacity,
                    ]
                  })
                  const key = JSON.stringify([
                    scrollY,
                    rect.x,
                    rect.y,
                    rect.width,
                    rect.height,
                    endpoints,
                  ])
                  same = key === last ? same + 1 : 0
                  last = key
                  if (++frames >= 180 || same >= 8)
                    resolve({ stable: same >= 8, frames })
                  else requestAnimationFrame(frame)
                }
                requestAnimationFrame(frame)
              })
          )
        let hoverReady = endpointProbe.beforeHover
        if (!hoverReady.trackComputed.painted || hoverReady.track.height < 44) {
          await recordedMouseMove(1, 1, 'Move outside the rail')
          endpointProbe.nativeInputs.push({
            type: 'mouse.wheel',
            deltaX: 0,
            deltaY: 320,
            reason:
              'Expose initially unavailable track after the default capture',
          })
          await page.mouse.wheel(0, 320)
          const stability = await settleEndpointGeometry()
          hoverReady = await measureRailEndpoints(page)
          endpointProbe.nativeScrollSteps.push({
            requestedDeltaY: 320,
            beforeScrollY: endpointProbe.beforeHover.scrollY,
            afterScrollY: hoverReady.scrollY,
            stability,
            geometry: hoverReady,
          })
          check(
            stability.stable,
            'Native endpoint exposure scroll geometry settles'
          )
          check(
            hoverReady.scrollY > endpointProbe.beforeHover.scrollY,
            'The bounded native endpoint exposure wheel actually scrolls'
          )
        }
        endpointProbe.beforePointerHover = hoverReady
        check(
          hoverReady.trackComputed.painted && hoverReady.track.height >= 44,
          'Actual rail is visible with its usable44px track before real hover'
        )
        if (hoverReady.trackComputed.painted && hoverReady.track.height >= 44) {
          endpointProbe.pointer = {
            x: hoverReady.track.left + hoverReady.track.width / 2,
            y: hoverReady.track.top + Math.min(hoverReady.track.height / 2, 60),
          }
          await recordedMouseMove(
            endpointProbe.pointer.x,
            endpointProbe.pointer.y,
            'Enter the actual rail'
          )
          endpointProbe.hoverStability = await settleEndpointGeometry()
          endpointProbe.afterHover = await measureRailEndpoints(page)
          const hoverFilename = `rail-hover-${spec.coarse ? 'coarse' : 'fine'}-${spec.width}-${spec.rootSize}-${spec.mode}.png`
          const hoverBytes = await page.screenshot({
            path: path.join(out, hoverFilename),
            fullPage: false,
            animations: 'disabled',
            caret: 'hide',
          })
          endpointProbe.hoverFrame = {
            file: hoverFilename,
            sha256: sha(hoverBytes),
            nativeViewport: true,
            interaction: spec.coarse
              ? 'Mouse hover under coarse-pointer emulation; endpoint CSS must stay hidden'
              : 'Real fine-pointer mouse hover',
          }
          await recordedMouseMove(1, 1, 'Move outside the rail')
          endpointProbe.leaveStability = await settleEndpointGeometry()
          endpointProbe.afterLeave = await measureRailEndpoints(page)
          check(
            endpointProbe.hoverStability.stable &&
              endpointProbe.leaveStability.stable,
            'Rail hover and leave geometry settle without corrective CSS'
          )
          check(
            endpointProbe.afterHover.hovered &&
              !endpointProbe.afterLeave.hovered,
            'Real mouse movement enters and then leaves the rail'
          )
          check(
            endpointProbe.afterHover.scrollY === hoverReady.scrollY &&
              endpointProbe.afterLeave.scrollY === hoverReady.scrollY,
            'Rail hover and leave do not move the page'
          )
          check(
            !endpointProbe.afterHover.dragging &&
              !endpointProbe.afterLeave.dragging &&
              endpointProbe.afterHover.valueNow === hoverReady.valueNow &&
              endpointProbe.afterLeave.valueNow === hoverReady.valueNow,
            'Rail hover and leave do not drag or seek a different row'
          )
          for (const phase of [
            endpointProbe.beforeHover,
            endpointProbe.beforePointerHover,
            endpointProbe.afterHover,
            endpointProbe.afterLeave,
          ]) {
            check(
              phase.endpoints.length === 2 &&
                new Set(phase.endpoints.map((endpoint) => endpoint.endpoint))
                  .size === 2 &&
                phase.endpoints.some(
                  (endpoint) => endpoint.endpoint === 'first'
                ) &&
                phase.endpoints.some(
                  (endpoint) => endpoint.endpoint === 'last'
                ),
              'Exactly two explicit first/last endpoint labels are preserved'
            )
            check(
              phase.bodyWidth <= phase.clientWidth,
              'Endpoint feedback does not cause horizontal document overflow'
            )
            if (spec.coarse)
              check(
                phase.endpoints.every(
                  (endpoint) =>
                    endpoint.computed.display === 'none' &&
                    !endpoint.computed.painted
                ),
                'Year endpoints remain hidden on coarse pointers'
              )
          }
          const hovered = endpointProbe.afterHover
          check(
            !!hovered.filterPanel,
            'Actual filter panel exists for endpoint intersection checks'
          )
          if (!spec.coarse)
            for (const endpoint of hovered.endpoints) {
              check(
                endpoint.text.length > 0 &&
                  endpoint.computed.painted &&
                  endpoint.computed.visibility === 'visible' &&
                  endpoint.computed.effectiveOpacity >= 0.999,
                'Both fine year endpoints are actually visible through every ancestor'
              )
              check(
                endpoint.box.left >= hovered.track.left - 1 &&
                  endpoint.box.right <= hovered.track.right + 1 &&
                  endpoint.box.top >= 0 &&
                  endpoint.box.bottom <= hovered.viewportHeight &&
                  endpoint.box.left >= 0 &&
                  endpoint.box.right <= hovered.clientWidth,
                'Fine endpoint boxes stay in the44px horizontal rail lane and viewport'
              )
              check(
                endpoint.glyphs.length > 0 &&
                  endpoint.glyphs.every(
                    (glyph) =>
                      glyph.ranges.length > 0 &&
                      glyph.ranges.every(
                        (rect) =>
                          inside(rect, endpoint.box) &&
                          rect.left >= hovered.track.left - 1 &&
                          rect.right <= hovered.track.right + 1
                      )
                  ),
                'Every visible endpoint glyph fits its label and the reserved44px lane'
              )
              const glyphRects = endpoint.glyphs.flatMap(
                (glyph) => glyph.ranges
              )
              check(
                endpoint.computed.textAlign === 'center' &&
                  glyphRects.length > 0 &&
                  Math.abs(
                    (Math.min(...glyphRects.map((rect) => rect.left)) +
                      Math.max(...glyphRects.map((rect) => rect.right))) /
                      2 -
                      (hovered.track.left + hovered.track.right) / 2
                  ) <= 1,
                'Visible year text is centered within its reserved rail lane'
              )
              check(
                !endpoint.cardIntersections.length &&
                  !endpoint.filterPanelIntersection,
                'Visible year feedback intersects no mounted card or filter panel'
              )
            }
        }

        item.failures = failures
        item.passed = !failures.length
      } catch (error) {
        item.failure = error.message
      } finally {
        result.cases.push(item)
        await context.close()
      }
    }
  } finally {
    await browser?.close()
    result.browserClosed = true
    result.passed =
      result.cases.length === cases.length &&
      result.cases.every((c) => c.passed) &&
      !result.errors.length &&
      !result.forbiddenRequests.length
    fs.writeFileSync(
      path.join(out, 'results.json'),
      JSON.stringify(result, null, 2) + '\n'
    )
  }
  console.log(
    JSON.stringify({
      passed: result.passed,
      cases: result.cases.length,
      failures: result.cases
        .filter((c) => !c.passed)
        .map((c) => ({
          width: c.width,
          coarse: c.coarse,
          rootSize: c.rootSize,
          mode: c.mode,
          failures: c.failures,
          failure: c.failure,
        })),
      errors: result.errors,
      browserClosed: result.browserClosed,
    })
  )
  process.exitCode = result.passed ? 0 : 1
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
