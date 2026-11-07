/* Explicit native geometry regression: run against an isolated rendered gallery.
   Requires docs/site's installed Playwright and a real read-only owner session.
   FLARE_GALLERY_ORIGIN, FLARE_GALLERY_STORAGE_STATE, FLARE_GALLERY_OUTPUT. */
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
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
    'Real rendered read-only gallery. Native bounding boxes, computed styles and file identities; root32 is an explicitly local CSS text-size simulation. No layout correction, synthetic previews, mutation requests, saved settings or image masks. Normal GET/session/audit activity may persist.',
  cases: [],
  errors: [],
  forbiddenRequests: [],
  browserClosed: false,
  passed: false,
}
const cases = [1440, 820, 390, 320].flatMap((width) =>
  [16, ...(width < 400 ? [32] : [])].flatMap((rootSize) =>
    ['dark', 'light'].map((mode) => ({ width, rootSize, mode }))
  )
)
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
        hasTouch: spec.width < 1024,
        isMobile: spec.width < 640,
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
          const rows = [...document.querySelectorAll('[data-row]')]
            .filter((r) => r.querySelector('[data-file-card]'))
            .slice(0, 4)
          return {
            actualMode: document.documentElement.className,
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
                  size: box(card.querySelector('[data-file-heading]>span')),
                  preview: box(card.querySelector('[data-file-preview]')),
                  badges: box(card.querySelector('[data-preview-badges]')),
                  date: box(
                    card.querySelector('[data-preview-badges]>span:last-child')
                  ),
                  activity: box(card.querySelector('[data-file-activity]')),
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
              button.box.height >= 44 || spec.width >= 1024,
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
          if (spec.rootSize === 16)
            check(
              Math.max(...row.cards.map((c) => c.filename.top)) -
                Math.min(...row.cards.map((c) => c.filename.top)) <=
                1,
              'First visible filename lines align within each row'
            )
          for (const c of row.cards) {
            check(c.logicalName === c.name, 'Full logical filename retained')
            check(
              inside(c.filename, c.heading) && inside(c.heading, c.box),
              'Filename/header contained'
            )
            check(
              c.box.bottom - c.activity.bottom <= (9 * spec.rootSize) / 16,
              'Card ends directly after actual activity content'
            )
            check(inside(c.menu, c.box), 'Manage action contained')
            if (spec.width < 1024)
              check(
                c.menu.width >= 44 &&
                  c.menu.height >= 44 &&
                  c.labels.every((l) => l.height >= 44),
                'Coarse action and label targets retain44px minimum'
              )
            if (c.kind === 'image') {
              const stage =
                spec.width >= 1024 ? 112 : spec.width >= 640 ? 128 : 144
              check(
                Math.abs(c.preview.height - (stage * spec.rootSize) / 16) <= 1,
                'Useful responsive image stage'
              )
              if (spec.rootSize === 32)
                check(
                  c.badges.top >= c.preview.bottom - 1,
                  'Enlarged metadata stays outside image pixels'
                )
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
        const filename = `${spec.width}-${spec.rootSize}-${spec.mode}.png`
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
