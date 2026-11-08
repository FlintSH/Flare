/* eslint-disable @typescript-eslint/no-require-imports */
// Read-only touch and keyboard checks against the disposable hillclimb demo.
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const { measureFilenameGeometry } = require('./filename-geometry.cjs')
const {
  chromium,
  expect,
} = require('../../docs/site/node_modules/@playwright/test')
const origin = process.env.FLARE_HILLCLIMB_ORIGIN
const auth = process.env.FLARE_HILLCLIMB_AUTH
const out = process.env.FLARE_HILLCLIMB_OUTPUT
if (
  !origin ||
  !auth ||
  !out ||
  !['localhost', '127.0.0.1'].includes(new URL(origin).hostname)
)
  throw Error('Disposable local origin, auth and output required')
const checks = []
const check = (name, details = {}) => {
  checks.push({ name, passed: true, ...details })
  console.log('PASS:', name)
}

async function completeFilenameVisible(filename) {
  const measured = await filename.evaluate(measureFilenameGeometry)
  return measured.text === measured.title && measured.allGlyphsFit
}

async function galleryKeyboard(page, card, nextCard) {
  const preview = card.locator('[data-file-primary]').first()
  const name = await card.locator('[data-file-name]').getAttribute('title')
  await expect(card.locator('[data-file-name]')).toHaveAccessibleName(name)
  const manage = card.getByRole('button', {
    name: 'Manage ' + name,
    exact: true,
  })
  const filters = card.locator(
    'button[aria-label^="Open folder"]:enabled, button[aria-label^="Show files tagged"]:enabled'
  )
  const stops = await card.evaluate((element) =>
    [...element.querySelectorAll('a[href], button, input')]
      .filter((el) => el.tabIndex >= 0 && !el.disabled)
      .map((el) => el.getAttribute('aria-label'))
  )
  assert.deepEqual(
    stops,
    [
      await preview.getAttribute('aria-label'),
      'Manage ' + name,
      ...(await filters.evaluateAll((elements) =>
        elements.map((el) => el.getAttribute('aria-label'))
      )),
    ],
    'Only the primary link, Manage file and metadata filters are sequential card stops'
  )
  await preview.focus()
  await preview.press('Enter')
  const closeViewer = page.getByRole('button', {
    name: 'Close image viewer',
    exact: true,
  })
  await expect(closeViewer).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(preview).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(manage).toBeFocused()
  await manage.press('Enter')
  await expect(page.locator('[data-file-menu-filename]')).toHaveText(name)
  for (const label of ['Open file', 'Download file'])
    await expect(
      page.getByRole('menuitem', { name: label, exact: true })
    ).toBeEnabled()
  const items = page.getByRole('menuitem')
  await page.keyboard.press('End')
  await expect(items.last()).toBeFocused()
  await page.keyboard.press('Home')
  await expect(items.first()).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(manage).toBeFocused()
  for (const filter of await filters.all()) {
    await page.keyboard.press('Tab')
    await expect(filter).toBeFocused()
  }
  await page.keyboard.press('Tab')
  await expect(nextCard.locator('[data-file-primary]').first()).toBeFocused()
  return { sequentialStops: stops.length, primaryName: name }
}

async function mixedGrid(page) {
  const types = new Set(),
    measured = []
  for (let attempt = 0; attempt < 8; attempt++) {
    const list = page.getByRole('list', { name: 'Your files', exact: true })
    await expect(list).toHaveAttribute('aria-busy', 'false')
    await expect(list.locator('[data-file-primary]').first()).toBeVisible()
    // This measures loaded-card geometry. Loading placeholders are covered
    // separately; never omit an unready row or treat a skeleton as a file.
    await expect
      .poll(() =>
        list
          .locator('[data-file-index]')
          .evaluateAll(
            (elements) =>
              elements.length > 0 &&
              elements.every((element) =>
                element.querySelector('[data-file-card] [data-file-primary]')
              )
          )
      )
      .toBe(true)
    await page.evaluate(() => document.fonts.ready)
    const rows = await page.locator('[data-row]').evaluateAll((elements) =>
      elements.map((row) => ({
        index: Number(row.dataset.row),
        top: row.getBoundingClientRect().top,
        bottom: row.getBoundingClientRect().bottom,
        cards: [...row.querySelectorAll('[data-file-index]')].map((el) => ({
          image:
            el.querySelector('[data-file-kind]')?.dataset.fileKind === 'image',
          top: el.getBoundingClientRect().top,
          bottom: el.getBoundingClientRect().bottom,
          height: el.getBoundingClientRect().height,
          outerHeight: el
            .querySelector('[data-file-card]')
            .getBoundingClientRect().height,
          previewHeight: el
            .querySelector('[data-file-primary]')
            .getBoundingClientRect().height,
          activityBottom: el
            .querySelector('[data-file-activity]')
            .getBoundingClientRect().bottom,
          headingTop: el
            .querySelector('[data-file-heading]')
            .getBoundingClientRect().top,
          nameTop: el.querySelector('[data-file-name]').getBoundingClientRect()
            .top,
          sizeInFooter: (() => {
            const size = el
                .querySelector('[data-file-activity] > span.mr-auto')
                .getBoundingClientRect(),
              footer = el
                .querySelector('[data-file-activity]')
                .getBoundingClientRect()
            return (
              size.width > 0 &&
              size.height > 0 &&
              size.top >= footer.top - 1 &&
              size.bottom <= footer.bottom + 1
            )
          })(),
          labels: el.querySelectorAll('[data-file-label]').length,
          expiration: !!el.querySelector('[data-flare-wrap]'),
        })),
      }))
    )
    for (const row of rows) {
      for (const card of row.cards) {
        assert.ok(
          card.image
            ? Math.abs(card.previewHeight - 112) <= 1
            : card.previewHeight >= 44,
          'Fine-pointer image stages stay112px; generic filename primary targets stay at least44px'
        )
        assert.ok(
          Math.abs(card.height - card.outerHeight) <= 1,
          'Every card fills its own intrinsic list item'
        )
        assert.ok(
          Math.abs(card.top - row.cards[0].top) <= 1 &&
            Math.abs(card.headingTop - row.cards[0].headingTop) <= 1 &&
            Math.abs(card.nameTop - row.cards[0].nameTop) <= 1 &&
            card.sizeInFooter,
          'Mixed cards share filename-header coordinates and keep size visible inside their own footer'
        )
        assert.ok(
          Math.abs(card.activityBottom - (card.bottom - 5)) <= 1,
          'Activity ends at each intrinsic card bottom without a blank body'
        )
        types.add(card.image ? 'image' : 'generic')
      }
      assert.ok(
        Math.abs(
          row.bottom - Math.max(...row.cards.map((card) => card.bottom)) - 16
        ) <= 1,
        'Each mixed row ends exactly16px after its tallest real card'
      )
      const image = row.cards.find((card) => card.image)
      const generic = row.cards.find(
        (card) => !card.image && !card.labels && !card.expiration
      )
      if (image && generic)
        assert.ok(
          generic.height <= image.height - 20,
          'An ordinary generic card remains genuinely shorter within a mixed row'
        )
    }
    for (let i = 1; i < rows.length; i++)
      if (rows[i].index === rows[i - 1].index + 1)
        assert.ok(
          Math.abs(rows[i].top - rows[i - 1].bottom) <= 1,
          'Consecutive mixed rows use measured heights with no extra holes or overlap'
        )
    measured.push(...rows)
    if (types.size === 2) break
    await page.mouse.wheel(0, 900)
    await page.waitForTimeout(350)
  }
  assert.equal(
    types.size,
    2,
    'The real fixture must exercise image and generic cards'
  )
  return { kinds: [...types], rows: measured }
}

async function genericDensity(page, phone) {
  await page.goto(
    origin +
      '/dashboard?types=' +
      encodeURIComponent(
        'text/plain,text/markdown,application/pdf,application/zip'
      )
  )
  await page.waitForLoadState('networkidle')
  const cards = page.locator('[data-file-index]')
  await expect(cards.nth(1)).toBeVisible()
  const rows = await page.locator('[data-row]').evaluateAll((elements) =>
    elements.map((row) => ({
      index: Number(row.dataset.row),
      top: row.getBoundingClientRect().top,
      bottom: row.getBoundingClientRect().bottom,
      cards: [...row.querySelectorAll('[data-file-card]')].map((card) => ({
        kind: card.dataset.fileKind,
        height: card.getBoundingClientRect().height,
        previewHeight: card
          .querySelector('[data-file-primary]')
          .getBoundingClientRect().height,
        expiration: !!card.querySelector('[data-flare-wrap]'),
        labels: card.querySelectorAll('[data-file-label]').length,
        stops: [...card.querySelectorAll('a[href],button,input')].filter(
          (el) => el.tabIndex >= 0 && !el.disabled
        ).length,
        name: card.querySelector('[data-file-name]').getAttribute('title'),
      })),
    }))
  )
  assert.ok(
    rows.length >= 2,
    'Actual multiple generic-only rows were exercised'
  )
  for (const row of rows)
    for (const card of row.cards) {
      assert.equal(card.kind, 'generic')
      assert.ok(
        card.previewHeight >= 44,
        'Generic primary filename keeps a44px target'
      )
      assert.ok(
        card.stops >= 2 && card.stops <= 4,
        'Generic cards keep primary/menu and at most two metadata filter stops'
      )
      if (!card.expiration && (!phone || !card.labels))
        assert.ok(
          card.height <= (phone ? 175 : 195),
          'Ordinary generic-only rows stay within their175px touch/195px mouse height budgets'
        )
    }
  for (let i = 1; i < rows.length; i++)
    if (rows[i].index === rows[i - 1].index + 1)
      assert.ok(
        Math.abs(rows[i].top - rows[i - 1].bottom) <= 1,
        'Generic-only rows have no leftover estimated space'
      )
  return { rows }
}

async function enlargedLibrary(page, mode, width) {
  await page.setViewportSize({ width, height: 844 })
  await page.goto(origin + '/dashboard')
  await page.waitForLoadState('networkidle')
  const ownerReply = await page.request.get(origin + '/api/files?limit=100')
  assert.equal(ownerReply.status(), 200)
  const ownerFiles = (await ownerReply.json()).data
  const slider = page.getByRole('slider', { name: 'Browse files by date' })
  const measurements = []
  for (const size of [16, 32, 16]) {
    await page.evaluate((size) => {
      document.documentElement.style.fontSize = size + 'px'
    }, size)
    await page.waitForTimeout(250)
    const fontChangeFrames = await page.evaluate(async () => {
      const frames = []
      for (let sample = 0; sample < 8; sample++) {
        await new Promise(requestAnimationFrame)
        const rows = [...document.querySelectorAll('[data-row]')]
        frames.push(
          rows
            .slice(1)
            .flatMap((row, index) =>
              Number(row.dataset.row) === Number(rows[index].dataset.row) + 1
                ? [
                    row.getBoundingClientRect().top -
                      rows[index].getBoundingClientRect().bottom,
                  ]
                : []
            )
        )
      }
      return frames
    })
    assert.ok(
      fontChangeFrames.every(
        (gaps) => gaps.length >= 2 && gaps.every((gap) => Math.abs(gap) <= 1)
      ),
      'Settled text changes keep every consecutive mounted row aligned before any keyboard seek'
    )
    await page.locator('[data-file-index]').first().scrollIntoViewIfNeeded()
    await slider.press('Home')
    await page.waitForTimeout(250)
    const sample = await page.evaluate(() => {
      const rect = (element) => {
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
      const fullText = (element) => {
        const outer = rect(element),
          ranges = []
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
        let text
        while ((text = walker.nextNode())) {
          if (!text.textContent.trim()) continue
          const range = document.createRange()
          range.selectNodeContents(text)
          ranges.push(
            ...[...range.getClientRects()]
              .filter((r) => r.width && r.height)
              .map((r) => ({
                x: r.x,
                y: r.y,
                right: r.right,
                bottom: r.bottom,
              }))
          )
        }
        const clipping = []
        for (
          let parent = element;
          parent && !parent.matches('[data-file-index]');
          parent = parent.parentElement
        ) {
          const style = getComputedStyle(parent)
          if (
            ['hidden', 'clip'].includes(style.overflowX) ||
            ['hidden', 'clip'].includes(style.overflowY)
          )
            clipping.push(rect(parent))
        }
        return {
          text: element.textContent.trim(),
          outer,
          ranges,
          fits:
            ranges.every(
              (r) =>
                r.x >= outer.x - 1 &&
                r.right <= outer.right + 1 &&
                r.y >= outer.y - 1 &&
                r.bottom <= outer.bottom + 1
            ) &&
            clipping.every((box) =>
              ranges.every(
                (r) =>
                  r.x >= box.x - 1 &&
                  r.right <= box.right + 1 &&
                  r.y >= box.y - 1 &&
                  r.bottom <= box.bottom + 1
              )
            ) &&
            element.scrollWidth <= element.clientWidth + 1,
        }
      }
      const rows = [...document.querySelectorAll('[data-row]')]
        .map((e) => ({
          index: Number(e.dataset.row),
          box: rect(e),
          cards: [...e.querySelectorAll('[data-file-index]')].map(rect),
        }))
        .sort((a, b) => a.index - b.index)
      const track = rect(document.querySelector('[data-date-rail-track]'))
      const cards = [...document.querySelectorAll('[data-file-index]')]
      const search = document.querySelector('input[type="search"]')
      const searchStyle = getComputedStyle(search)
      const canvas = document.createElement('canvas').getContext('2d')
      canvas.font = `${searchStyle.fontStyle} ${searchStyle.fontWeight} ${searchStyle.fontSize} ${searchStyle.fontFamily}`
      const placeholder = {
        text: search.placeholder,
        width: canvas.measureText(search.placeholder).width,
        available:
          search.clientWidth -
          parseFloat(searchStyle.paddingLeft) -
          parseFloat(searchStyle.paddingRight),
      }
      return {
        rootFont: parseFloat(
          getComputedStyle(document.documentElement).fontSize
        ),
        bodyWidth: document.documentElement.scrollWidth,
        viewportWidth: innerWidth,
        placeholder,
        searchControl: rect(search),
        filtersControl: rect(
          [...document.querySelectorAll('button[aria-controls]')].find(
            (button) => button.textContent.trim().startsWith('Filters')
          )
        ),
        selectionControl: rect(
          document.querySelector('button[aria-label="Select files"]')
        ),
        header: rect(document.querySelector('[data-dashboard-header]')),
        brand: fullText(
          document.querySelector('[data-flare-brand] .flare-text')
        ),
        navigation: rect(
          document.querySelector('[aria-label="Open navigation"]')
        ),
        account: rect(document.querySelector('[aria-label="Account menu"]')),
        track,
        handle: rect(document.querySelector('[data-date-rail-handle]')),
        feedback: document.querySelector('[data-date-rail-feedback]')
          ? fullText(document.querySelector('[data-date-rail-feedback]'))
          : null,
        rowGaps: rows.slice(1).flatMap((row, i) =>
          rows[i].index + 1 === row.index
            ? [
                {
                  from: rows[i].index,
                  to: row.index,
                  gapAfterPaddedRow: row.box.y - rows[i].box.bottom,
                  cardGap:
                    row.cards.length && rows[i].cards.length
                      ? row.cards[0].y -
                        Math.max(...rows[i].cards.map((r) => r.bottom))
                      : null,
                },
              ]
            : []
        ),
        cardBounds: cards.map(rect),
        metadata: cards.flatMap((e) =>
          [
            ...e.querySelectorAll(
              '[data-file-label] > span, [data-flare-wrap] > span, [data-file-visibility], [data-file-uploaded], [data-file-type]'
            ),
          ].map(fullText)
        ),
        filenames: cards.map((e) => {
          const name = e.querySelector('[data-file-name]')
          return {
            ...fullText(name),
            text: name.textContent,
            title: name.title,
            ariaLabel: name.getAttribute('aria-label'),
            filenameScrollWidth: name.scrollWidth,
            filenameClientWidth: name.clientWidth,
            lineHeight: parseFloat(getComputedStyle(name).lineHeight),
            link: rect(name),
          }
        }),
      }
    })
    const filenameLinks = page.locator('[data-file-name]')
    for (const [index, filename] of sample.filenames.entries()) {
      await expect(filenameLinks.nth(index)).toHaveAccessibleName(
        filename.title
      )
      filename.fullFilenameGeometry = await filenameLinks
        .nth(index)
        .evaluate(measureFilenameGeometry)
      // CSS pre-wrap may give an unpainted trailing space a hanging Range box.
      // Keep the raw fullText fits/rects, and accept visible filename ink only
      // through the shared non-whitespace grapheme/ancestor checks plus the
      // real scrollWidth bound. Logical whitespace stays owner-API exact.
      filename.visibleFilenameFits =
        filename.fullFilenameGeometry.allGlyphsFit &&
        filename.filenameScrollWidth <= filename.filenameClientWidth + 1
      filename.filenameAcceptance = {
        method:
          'Non-whitespace grapheme bounds and actual scrollWidth; raw pre-wrap hanging-space ranges retained',
        legacyWholeRangeFits: filename.fits,
        whitespaceOverhangs: filename.fullFilenameGeometry.graphemes
          .filter((grapheme) => grapheme.whitespace)
          .flatMap((grapheme) =>
            grapheme.ranges.flatMap((range) => {
              const outside = filename.fullFilenameGeometry.boundaries.filter(
                ({ rect }) =>
                  range.left < rect.left - 1 ||
                  range.right > rect.right + 1 ||
                  range.top < rect.top - 1 ||
                  range.bottom > rect.bottom + 1
              )
              return outside.length
                ? [
                    {
                      utf16Start: grapheme.utf16Start,
                      utf16End: grapheme.utf16End,
                      text: grapheme.text,
                      range,
                      outsideBoundaries: outside,
                    },
                  ]
                : []
            })
          ),
      }
      const expected = ownerFiles[filename.fullFilenameGeometry.fileIndex]
      assert.ok(
        expected,
        'Every measured filename has an independent owner API record'
      )
      filename.expectedFilenameFromOwnerApi = expected.name
      assert.equal(filename.fullFilenameGeometry.text, expected.name)
      assert.equal(filename.title, expected.name)
      assert.ok(
        filename.fullFilenameGeometry.allGlyphsFit,
        'Every grapheme of every complete filename fits its actual link and clipping ancestors'
      )
    }
    assert.equal(sample.rootFont, size)
    for (const control of [sample.searchControl, sample.filtersControl]) {
      assert.ok(
        control.height >= 44 && control.height < 88,
        'Phone search and Filters keep44px minimum targets and grow for text without a doubled88px floor'
      )
    }
    assert.ok(
      sample.selectionControl.height >= 44 &&
        sample.selectionControl.height < 88 &&
        sample.selectionControl.width >= 44,
      'The labeled phone selection control keeps at least44px without a doubled88px floor'
    )
    if (size === 16 && width === 320)
      assert.ok(
        sample.placeholder.width <= sample.placeholder.available + 1,
        'The complete empty320px search placeholder fits its actual text area'
      )
    assert.ok(
      sample.bodyWidth <= width,
      'Enlarged library has no horizontal overflow'
    )
    assert.ok(
      sample.brand.fits && sample.brand.ranges.length,
      'The complete brand word remains visible'
    )
    assert.ok(
      sample.brand.outer.right <= sample.navigation.x &&
        sample.navigation.right <= sample.account.x,
      'Brand, navigation and account hit areas are disjoint'
    )
    for (const control of [sample.navigation, sample.account, sample.handle]) {
      assert.ok(
        control.width >= 44 && control.height >= 44,
        'Icon targets remain at least44 CSS pixels'
      )
      assert.ok(
        control.width <= 44.5 && control.height <= 44.5,
        'Icon-only chrome does not double with text size'
      )
    }
    assert.ok(
      sample.cardBounds.every((r) => r.right <= sample.track.x + 0.5),
      'The full date target stays outside every card rectangle'
    )
    assert.ok(
      sample.rowGaps.length >= 2,
      'Actual consecutive virtual rows were measured'
    )
    assert.ok(
      sample.rowGaps.every((r) => Math.abs(r.gapAfterPaddedRow) <= 1),
      'All consecutive mounted rows use their measured height'
    )
    assert.ok(
      sample.rowGaps.every(
        (r) => r.cardGap === null || Math.abs(r.cardGap - size) <= 1
      ),
      'All consecutive card rows retain the scaled16px gap'
    )
    assert.ok(
      sample.metadata.length >= 4 && sample.metadata.every((r) => r.fits),
      'Complete folder/tag/expiration/visibility/date text fits or wraps'
    )
    assert.ok(
      sample.filenames.every(
        (r) =>
          r.title === r.text &&
          r.fullFilenameGeometry.first?.fits &&
          r.fullFilenameGeometry.lastStem?.fits &&
          (!r.fullFilenameGeometry.extension ||
            (r.fullFilenameGeometry.extension.text ===
              r.expectedFilenameFromOwnerApi.match(
                /^(.+)(\.[A-Za-z0-9]{1,16})$/
              )?.[2] &&
              r.fullFilenameGeometry.extension.glyphs.every(
                (glyph) => glyph.fits
              )))
      ),
      'Touch filenames keep their exact logical name, visible beginning, final stem glyph and complete extension'
    )
    assert.ok(
      sample.filenames.every((r) => r.visibleFilenameFits),
      'Every complete filename keeps all non-whitespace glyphs unclipped; pre-wrap hanging-space ranges stay recorded'
    )
    if (size === 16)
      assert.ok(
        sample.filenames.every(
          (r) => r.link.height >= r.lineHeight && r.visibleFilenameFits
        ),
        'Standard filenames use their natural complete text height without a line clamp'
      )
    if (size === 32) {
      assert.ok(
        sample.feedback?.fits,
        'Enlarged keyboard date feedback retains its whole label'
      )
      assert.ok(
        sample.feedback.outer.bottom <= sample.header.bottom &&
          sample.cardBounds.some(
            (r) =>
              r.y >= sample.header.bottom + 15 &&
              r.y < sample.header.bottom + 18
          ),
        'Date feedback has a reserved header row and the destination clears it'
      )
      await page.screenshot({
        path: path.join(out, `${mode}-library-${width}-css-text-200.png`),
      })
    }
    const imageCard = page
      .locator('[data-file-index]')
      .filter({ has: page.locator('[data-file-kind="image"]') })
      .first()
    await imageCard.locator('[data-file-primary]').focus()
    const shortcuts = await imageCard.evaluate((card) => {
      const box = (e) => {
        const r = e.getBoundingClientRect()
        return {
          x: r.x,
          y: r.y,
          right: r.right,
          bottom: r.bottom,
          width: r.width,
          height: r.height,
        }
      }
      const badges = [
        ...card.querySelectorAll(
          '[data-preview-badges]>span,[data-flare-wrap],button[title="Manage file"]'
        ),
      ].map(box)
      const buttons = [
        ...card.querySelectorAll(
          '[data-preview-actions] button,[data-preview-actions] a'
        ),
      ].filter(
        (e) =>
          e.getBoundingClientRect().height &&
          getComputedStyle(e).display !== 'none'
      )
      return buttons.map((e) => {
        const r = box(e),
          hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
        return {
          name: e.getAttribute('aria-label') || e.textContent.trim(),
          ...r,
          hit: e === hit || e.contains(hit),
          clearOfBadges: badges.every(
            (b) =>
              r.right <= b.x ||
              r.x >= b.right ||
              r.bottom <= b.y ||
              r.y >= b.bottom
          ),
        }
      })
    })
    assert.equal(
      shortcuts.length,
      3,
      'View image, Copy link and Download remain real visible shortcuts'
    )
    assert.ok(
      shortcuts.every(
        (s) => s.width >= 44 && s.height >= 44 && s.hit && s.clearOfBadges
      ),
      'Every enlarged pointer shortcut has a clear44px hit target and does not cover metadata or Manage file'
    )
    const view = imageCard.getByRole('button', {
      name: 'View image',
      exact: true,
    })
    if (size === 16) await expect(view).toHaveText('View image')
    const activations = []
    for (const method of ['click', 'tap']) {
      const touch =
        method === 'tap'
          ? page.evaluate(
              () =>
                new Promise((resolve) =>
                  document.addEventListener(
                    'touchstart',
                    (event) =>
                      resolve({
                        isTrusted: event.isTrusted,
                        touches: event.touches.length,
                      }),
                    { once: true }
                  )
                )
            )
          : null
      await view[method]()
      const close = page.getByRole('button', {
        name: 'Close image viewer',
        exact: true,
      })
      await expect(close).toBeVisible()
      const trustedTouch = touch ? await touch : null
      if (trustedTouch)
        assert.ok(
          trustedTouch.isTrusted && trustedTouch.touches === 1,
          'Image shortcut accepts an actual trusted native touch'
        )
      activations.push({ method, viewerOpened: true, trustedTouch })
      await page.keyboard.press('Escape')
      await expect(close).toBeHidden()
    }
    sample.activations = activations
    await page.screenshot({
      path: path.join(
        out,
        `${mode}-image-shortcuts-${width}-css-root-${size}.png`
      ),
    })
    sample.shortcuts = shortcuts

    measurements.push({ ...sample, fontChangeFrames })
  }
  // Width changes must also discard stale estimates without collapsing gaps.
  await page.setViewportSize({ width: width === 320 ? 390 : 320, height: 844 })
  await page.waitForTimeout(250)
  const resizedGaps = await page
    .locator('[data-row]')
    .evaluateAll((elements) =>
      elements
        .slice(1)
        .flatMap((e, i) =>
          Number(elements[i].dataset.row) + 1 === Number(e.dataset.row)
            ? [
                e.getBoundingClientRect().top -
                  elements[i].getBoundingClientRect().bottom,
              ]
            : []
        )
    )
  assert.ok(
    resizedGaps.length >= 2 && resizedGaps.every((gap) => Math.abs(gap) <= 1),
    'Mounted rows remeasure after a width change too'
  )
  const widthTransitions = []
  if (width === 390) {
    await page.evaluate(() => {
      document.documentElement.style.fontSize = '32px'
    })
    for (const nextWidth of [820, 390, 320, 820]) {
      await page.setViewportSize({ width: nextWidth, height: 844 })
      await page.waitForTimeout(250)
      await page.locator('[data-file-index]').first().scrollIntoViewIfNeeded()
      await slider.press('Home')
      await page.waitForTimeout(250)
      const bounds = await page.evaluate(() => {
        const box = (element) =>
          element?.getBoundingClientRect().toJSON() ?? null
        const rows = [...document.querySelectorAll('[data-row]')]
        const feedback = document.querySelector('[data-date-rail-feedback]')
        return {
          width: innerWidth,
          rootFont: getComputedStyle(document.documentElement).fontSize,
          header: box(document.querySelector('[data-dashboard-header]')),
          navigation: box(
            document.querySelector('[aria-label="Main navigation"]')
          ),
          firstCard: box(document.querySelector('[data-file-index="0"]')),
          feedback: box(feedback),
          feedbackOpacity: feedback ? getComputedStyle(feedback).opacity : null,
          expanded: !!document.querySelector('[data-date-rail-expanded-text]'),
          rowErrors: rows
            .slice(1)
            .flatMap((row, i) =>
              Number(row.dataset.row) === Number(rows[i].dataset.row) + 1
                ? [
                    row.getBoundingClientRect().top -
                      rows[i].getBoundingClientRect().bottom,
                  ]
                : []
            ),
        }
      })
      assert.equal(bounds.rootFont, '32px')
      assert.equal(
        bounds.expanded,
        nextWidth < 640,
        'Rail feedback follows the current responsive layout after crossing640px'
      )
      assert.ok(
        bounds.rowErrors.length >= 2 &&
          bounds.rowErrors.every((error) => Math.abs(error) <= 1),
        'Width crossing retains actual consecutive row measurements'
      )
      if (nextWidth < 640) {
        assert.ok(
          bounds.feedback &&
            bounds.feedbackOpacity === '1' &&
            bounds.feedback.y >= bounds.navigation.bottom + 8 &&
            bounds.feedback.bottom <= bounds.header.bottom,
          'Current navigation measurements place the whole date label inside its reserved row'
        )
        assert.ok(
          bounds.firstCard.y >= bounds.header.bottom + 15 &&
            bounds.firstCard.y <= bounds.header.bottom + 17,
          'Seek clearance follows the expanded header after each width transition'
        )
      } else
        assert.equal(
          bounds.feedback,
          null,
          'Wider layouts remove the phone feedback portal'
        )
      widthTransitions.push(bounds)
    }
  }
  await page.setViewportSize({ width, height: 844 })
  await page.goto(origin + '/dashboard')
  await page.waitForLoadState('networkidle')
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '32px'
  })
  await page.getByRole('button', { name: /^Filters/ }).click()
  const filters = await page
    .locator('[aria-label="Sort files"]')
    .locator('..')
    .evaluate((element) =>
      [...element.querySelectorAll(':scope > button')]
        .filter((e) => e.getBoundingClientRect().height)
        .map((e) => {
          const box = e.getBoundingClientRect(),
            ranges = []
          const walker = document.createTreeWalker(e, NodeFilter.SHOW_TEXT)
          let text
          while ((text = walker.nextNode())) {
            const range = document.createRange()
            range.selectNodeContents(text)
            ranges.push(
              ...[...range.getClientRects()].filter((r) => r.width && r.height)
            )
          }
          return {
            name: e.getAttribute('aria-label'),
            width: box.width,
            textFits:
              ranges.every(
                (r) =>
                  r.x >= box.x - 1 &&
                  r.right <= box.right + 1 &&
                  r.y >= box.y - 1 &&
                  r.bottom <= box.bottom + 1
              ) &&
              [...e.querySelectorAll(':scope > span')].every(
                (s) =>
                  s.scrollWidth <= s.clientWidth + 1 &&
                  s.scrollHeight <= s.clientHeight + 1
              ),
          }
        })
    )
  assert.ok(
    filters.length >= 5 &&
      filters.every((f) => f.width >= width - 150 && f.textFits),
    'Enlarged filters stack into readable complete controls'
  )
  await page.screenshot({
    path: path.join(out, `${mode}-filters-${width}-css-text-200.png`),
  })
  await page.goto(origin + '/dashboard')
  check(
    `${mode} complete enlarged library controls, metadata and measured row gaps at ${width}`,
    {
      method:
        'Explicit CSS root-font16/32/16 simulation and width change; not native OS/browser zoom.',
      measurements,
      resizedGaps,
      widthTransitions,
      filters,
    }
  )
}

async function main() {
  await fs.mkdir(out, { recursive: true })
  const browser = await chromium.launch({ headless: true })
  const errors = []
  try {
    for (const mode of ['light', 'dark']) {
      const context = await browser.newContext({
        storageState: auth,
        viewport: { width: 320, height: 740 },
        hasTouch: true,
        isMobile: true,
        colorScheme: mode,
        reducedMotion: 'reduce',
      })
      const session = await context.request
        .get(origin + '/api/auth/session')
        .then((r) => r.json())
      assert.match(session.user?.email || '', /@[^@]+\.test$/)
      const page = await context.newPage()
      page.on('pageerror', (e) => errors.push(e.message))
      const goto = async (route) => {
        await page.goto(origin + route)
        await page.locator('html.' + mode).waitFor()
      }
      for (const width of [320, 390]) {
        await page.setViewportSize({ width, height: 740 })
        await goto('/dashboard')
        const cards = page.getByRole('list', {
          name: 'Your files',
          exact: true,
        })
        const card = cards.getByRole('listitem').first()
        const preview = card.locator('[data-file-primary]').first()
        await expect(preview).toBeVisible()
        await expect(card.locator('img').first()).toBeVisible()
        const box = await preview.boundingBox()
        assert.ok(
          box.y < 400,
          'The first preview starts within the first 400 CSS pixels'
        )
        const filename = card.locator('[data-file-name]')
        const nameBox = await filename.boundingBox()
        assert.ok(
          await completeFilenameVisible(filename),
          'The full demonstration filename, including its suffix, is visible'
        )
        assert.ok(
          nameBox.y + nameBox.height <= 740,
          'First filename is readable without scrolling'
        )
        for (const label of await card
          .locator(
            'button[aria-label^="Show files tagged"], button[aria-label^="Open folder"], button[aria-label^="View all"]'
          )
          .all()) {
          const target = await label.boundingBox()
          assert.ok(
            target.width >= 44 && target.height >= 44,
            'Metadata filters have 44px touch targets'
          )
        }
        await page.screenshot({
          path: path.join(out, mode + '-library-' + width + '.png'),
        })
        const sort = page.getByRole('combobox', {
          name: 'Sort files',
          exact: true,
        })
        await page.getByRole('button', { name: /^Filters/ }).click()
        for (const name of ['Most downloaded', 'Least downloaded']) {
          await sort.click()
          await page.getByRole('option', { name, exact: true }).click()
          await expect(sort).toContainText(name)
          assert.ok(
            await sort.evaluate((el) => {
              const span = el.querySelector('span')
              const r = el.getBoundingClientRect(),
                t = span.getBoundingClientRect()
              return (
                t.height <= r.height - 4 &&
                t.width <= r.width - 20 &&
                span.scrollWidth <= span.clientWidth + 1
              )
            }),
            'Full sort label fits its trigger'
          )
        }
        check(
          mode +
            ' phone library framing, metadata targets and full sort labels at ' +
            width,
          { firstPreviewY: Math.round(box.y) }
        )
        await goto('/dashboard')
        const firstTag = cards
          .locator('button[aria-label^="Show files tagged"]')
          .first()
        const tagName = (await firstTag.getAttribute('aria-label')).replace(
          'Show files tagged ',
          ''
        )
        await firstTag.tap()
        await expect(
          page.getByRole('button', {
            name: 'Remove ' + tagName + ' filter',
            exact: true,
          })
        ).toBeVisible()
        await page
          .getByRole('button', {
            name: 'Remove ' + tagName + ' filter',
            exact: true,
          })
          .tap()
        check(mode + ' real tag-filter tap and recovery at ' + width)
        await goto('/dashboard')
        await page
          .getByRole('button', { name: 'Select files', exact: true })
          .click()
        const selected = cards.getByRole('checkbox').first()
        await selected.check()
        const actions = page.getByRole('button', {
          name: 'Actions',
          exact: true,
        })
        const toolbar = page.locator('div[aria-busy]').filter({ has: actions })
        assert.ok(
          (await toolbar.boundingBox()).height <= 72,
          'Phone selection toolbar stays one compact row'
        )
        await selected.focus()
        await expect
          .poll(async () => {
            const a = await selected.boundingBox(),
              b = await toolbar.boundingBox()
            return a.y - b.y - b.height
          })
          .toBeGreaterThanOrEqual(6)
        await actions.click()
        for (const name of ['Create archive', 'Move', 'Edit tags'])
          await expect(
            page.getByRole('menuitem', { name, exact: true })
          ).toBeEnabled()
        await expect(
          page.getByRole('menuitem', { name: 'Create archive', exact: true })
        ).toBeInViewport()
        await page
          .getByRole('menuitem', { name: 'Create archive', exact: true })
          .click()
        const archive = page.getByRole('dialog', {
          name: 'Create archive',
          exact: true,
        })
        await expect(archive).toBeVisible()
        await archive
          .getByRole('button', { name: 'Cancel', exact: true })
          .click()
        await expect(archive).toBeHidden()
        await page.screenshot({
          path: path.join(out, mode + '-selection-' + width + '.png'),
        })
        const libraryHeader = page.locator(
          'section[aria-label="Find and filter files"]'
        )
        await libraryHeader
          .getByRole('button', { name: 'Done selecting files', exact: true })
          .tap()
        await expect(
          libraryHeader.getByRole('button', {
            name: 'Select files',
            exact: true,
          })
        ).toHaveAttribute('aria-pressed', 'false')
        await expect(actions).toHaveCount(0)
        check(
          mode +
            ' compact selection actions and focused-card clearance at ' +
            width
        )
      }
      for (const width of [320, 390]) await enlargedLibrary(page, mode, width)
      await page.setViewportSize({ width: 390, height: 844 })
      await goto('/dashboard')
      const densityCards = page
        .getByRole('list', { name: 'Your files', exact: true })
        .getByRole('listitem')
      await expect(
        densityCards.nth(2).locator('[data-file-primary]').first()
      ).toBeVisible()
      const geometry = []
      for (const card of [
        densityCards.nth(0),
        densityCards.nth(1),
        densityCards.nth(2),
      ]) {
        const preview = await card
          .locator('[data-file-primary]')
          .first()
          .boundingBox()
        const bounds = await card.boundingBox()
        assert.ok(
          (await card
            .locator('[data-file-kind]')
            .getAttribute('data-file-kind')) === 'image'
            ? Math.abs(preview.height - 112) <= 1
            : preview.height >= 44,
          'Touch phone images keep112px stages and generic filename primary targets keep at least44px'
        )
        assert.ok(
          (await card
            .locator('[data-file-kind]')
            .getAttribute('data-file-kind')) === 'image'
            ? bounds.height <= 228
            : bounds.height <= 175,
          'Image cards use at most228px without empty metadata rows; ordinary generic cards use at most175px'
        )
        assert.ok(
          bounds.y + bounds.height <= 844,
          'Three complete mixed phone cards fit without scrolling at 390×844'
        )
        assert.ok(
          await completeFilenameVisible(card.locator('[data-file-name]')),
          'Each demonstration filename includes its complete suffix'
        )
        geometry.push(bounds)
      }
      for (let index = 1; index < geometry.length; index++) {
        assert.ok(
          Math.abs(
            geometry[index].y -
              geometry[index - 1].y -
              geometry[index - 1].height -
              16
          ) <= 1,
          'Every phone row has one 16px gap'
        )
      }
      const keyboard = await galleryKeyboard(
        page,
        densityCards.first(),
        densityCards.nth(1)
      )
      await page.screenshot({
        path: path.join(out, mode + '-library-density-390.png'),
      })
      check(
        mode +
          ' three complete phone cards and primary/menu/filter keyboard order',
        { geometry, ...keyboard }
      )
      const generic = await genericDensity(page, true)
      await page.screenshot({
        path: path.join(out, mode + '-generic-density-390.png'),
      })
      check(
        mode + ' compact generic-only phone rows and bounded keyboard stops',
        generic
      )
      for (const width of [320, 390, 820]) {
        await page.setViewportSize({ width, height: 900 })
        await goto('/dashboard/urls')
        const destinations = page
          .getByRole('table', { name: 'Shortened URLs' })
          .locator('a[href^="https://"]')
        await expect(destinations.first()).toBeVisible()
        assert.ok((await destinations.count()) > 1)
        for (const link of await destinations.all()) {
          assert.ok(
            await link.evaluate((el) => {
              const cs = getComputedStyle(el),
                r = el.getBoundingClientRect()
              const text = el.firstChild
              if (!text || text.nodeType !== Node.TEXT_NODE) return false
              const range = document.createRange()
              range.setStart(text, text.length - 1)
              range.setEnd(text, text.length)
              const end = range.getBoundingClientRect()
              return (
                cs.whiteSpace !== 'nowrap' &&
                end.right <= r.right + 1 &&
                end.bottom <= r.bottom + 1 &&
                el.scrollWidth <= el.clientWidth + 1
              )
            }),
            'Complete destination including its suffix is visible on touch'
          )
        }
        await page.screenshot({
          path: path.join(out, mode + '-destinations-' + width + '.png'),
        })
        check(mode + ' complete touch link destinations at ' + width)
      }
      await page.setViewportSize({ width: 390, height: 844 })
      await goto('/dashboard/upload')
      const choose = page.getByRole('button', {
        name: 'Choose files to upload',
        exact: true,
      })
      assert.equal(
        await choose.evaluate((element) => element.tagName),
        'BUTTON'
      )
      await expect(choose.locator('input')).toHaveCount(0)
      await expect(
        page.getByLabel('Files to upload', { exact: true })
      ).toHaveAttribute('type', 'file')
      const chooseBounds = await choose.boundingBox()
      assert.ok(
        chooseBounds.width >= 44 && chooseBounds.height >= 44,
        'Native file-selection button retains its touch target'
      )
      await expect(
        page.getByText('Choose files', { exact: true })
      ).toBeVisible()
      const picked = page.waitForEvent('filechooser')
      await choose.tap()
      const picker = await picked
      assert.equal(picker.isMultiple(), true)
      await picker.setFiles([])
      check(
        mode + ' touch upload picker retains native multiple-file selection'
      )
      const uploadWrites = []
      page.on('request', (request) => {
        if (
          request.method() === 'POST' &&
          new URL(request.url()).pathname.startsWith('/api/upload')
        )
          uploadWrites.push(request.url())
      })
      // Simulate an external file drag in Chromium; the queue is real, but
      // no native OS drag or server upload is claimed by this check.
      const drag = await page.evaluateHandle((name) => {
        const transfer = new DataTransfer()
        transfer.items.add(
          new File(['Local drag validation\n'], name, { type: 'text/plain' })
        )
        return transfer
      }, `simulated-drag-${mode}.txt`)
      const dropRegion = page.getByRole('region', {
        name: 'File selection',
        exact: true,
      })
      await dropRegion.dispatchEvent('dragenter', { dataTransfer: drag })
      await expect(
        page.getByRole('button', { name: 'Drop your files here', exact: true })
      ).toBeVisible()
      await dropRegion.dispatchEvent('drop', { dataTransfer: drag })
      await expect(
        page.getByText(`simulated-drag-${mode}.txt`, { exact: true })
      ).toBeVisible()
      await page.getByRole('button', { name: 'Clear all', exact: true }).click()
      await expect(
        page.getByText(`simulated-drag-${mode}.txt`, { exact: true })
      ).toHaveCount(0)
      assert.deepEqual(uploadWrites, [], 'Dragging queues without uploading')
      await drag.dispose()
      check(
        mode + ' simulated external drag queues and clears without uploading'
      )
      await context.close()
    }
    const desktop = await browser.newContext({
      storageState: auth,
      viewport: { width: 1440, height: 900 },
      colorScheme: 'dark',
      reducedMotion: 'reduce',
    })
    const page = await desktop.newPage()
    page.on('pageerror', (error) => errors.push(error.message))
    for (const mode of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: mode })
      await page.goto(origin + '/dashboard')
      await page.locator('html.' + mode).waitFor()
      const mixed = await mixedGrid(page)
      const filenames = page.locator('[data-file-name]')
      const filenameCount = await filenames.count()
      assert.ok(filenameCount > 0, 'Actual loaded filenames are exercised')
      for (const filename of await filenames.all())
        await expect(filename).toHaveAccessibleName(
          await filename.getAttribute('title')
        )
      await page.addScriptTag({
        path: require.resolve('../../docs/site/node_modules/axe-core/axe.min.js'),
      })
      const filenameLabels = await page.evaluate(async () => {
        const library = document.querySelector(
          '[role="list"][aria-label="Your files"]'
        )
        const report = await window.axe.run(library, {
          runOnly: {
            type: 'rule',
            values: ['label-content-name-mismatch', 'link-name'],
          },
        })
        return {
          axeVersion: report.testEngine.version,
          violations: report.violations.map(({ id, nodes }) => ({
            id,
            targets: nodes.map(({ target, failureSummary }) => ({
              target,
              failureSummary,
            })),
          })),
        }
      })
      assert.deepEqual(
        filenameLabels.violations,
        [],
        'Gallery filename labels match rendered text and links retain names'
      )
      check(
        mode + ' complete accessible filename and visible-label agreement',
        {
          filenameCount,
          ...filenameLabels,
        }
      )
      await page.screenshot({
        path: path.join(out, mode + '-mixed-grid-1440.png'),
      })
      check(mode + ' aligned image and generic gallery rows', mixed)
      const generic = await genericDensity(page, false)
      await page.screenshot({
        path: path.join(out, mode + '-generic-density-1440.png'),
      })
      check(
        mode + ' compact generic-only mouse rows and bounded keyboard stops',
        generic
      )
    }
    await page.goto(origin + '/dashboard/urls')
    await expect(
      page.getByRole('table', { name: 'Shortened URLs' })
    ).toBeVisible()
    assert.equal(
      await page
        .getByRole('table', { name: 'Shortened URLs' })
        .locator('a[href^="https://"]')
        .first()
        .evaluate((el) => getComputedStyle(el).whiteSpace),
      'nowrap'
    )
    await page.goto(origin + '/dashboard/upload')
    // Await hydration/session work before testing native keyboard activation.
    await page.waitForLoadState('networkidle')
    const choose = page.getByRole('button', {
      name: 'Choose files to upload',
      exact: true,
    })
    for (const key of ['Enter', 'Space']) {
      await page.bringToFront()
      await choose.focus()
      await expect(choose).toBeFocused()
      const chosen = page.waitForEvent('filechooser')
      await choose.press(key)
      const picker = await chosen
      assert.equal(picker.isMultiple(), true)
      await picker.setFiles([])
    }
    await page.goto(origin + '/dashboard/roles')
    const scheme = await page
      .locator('#role-position')
      .evaluate((el) => getComputedStyle(el).colorScheme)
    assert.equal(
      scheme,
      'dark',
      'Native number controls inherit the actual dark scheme'
    )
    check(
      'Mouse destination density, keyboard upload picker and native dark control scheme',
      { colorScheme: scheme }
    )
    await desktop.close()
    assert.deepEqual(errors, [])
    check('No uncaught browser errors')
  } finally {
    await fs.writeFile(
      path.join(out, 'results.json'),
      JSON.stringify(checks, null, 2)
    )
    await browser.close()
  }
}
main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
