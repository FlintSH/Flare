/* Self-contained browser measurement. Pass directly to locator.evaluate;
   it uses no module closure and does not modify the rendered page. */
function measureFilenameGeometry(element) {
  const rect = (node) => node?.getBoundingClientRect().toJSON() ?? null
  const inside = (a, b) =>
    a.left >= b.left - 1 &&
    a.right <= b.right + 1 &&
    a.top >= b.top - 1 &&
    a.bottom <= b.bottom + 1
  const card = element.closest('[data-file-card]')
  const heading = element.closest('[data-file-heading]')
  const boundaries = [{ kind: 'link', rect: rect(element) }]
  if (heading) boundaries.push({ kind: 'heading', rect: rect(heading) })
  if (card) boundaries.push({ kind: 'card', rect: rect(card) })
  for (
    let parent = element;
    parent && !parent.matches('[data-file-index]');
    parent = parent.parentElement
  ) {
    const css = getComputedStyle(parent)
    if (
      ['hidden', 'clip', 'auto', 'scroll'].includes(css.overflowX) ||
      ['hidden', 'clip', 'auto', 'scroll'].includes(css.overflowY)
    )
      boundaries.push({
        kind: 'clipping-ancestor',
        tag: parent.tagName,
        overflowX: css.overflowX,
        overflowY: css.overflowY,
        rect: rect(parent),
      })
  }
  const nodes = [],
    walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
  let node,
    total = 0
  while ((node = walker.nextNode())) {
    nodes.push({ node, start: total, end: total + node.textContent.length })
    total += node.textContent.length
  }
  const text = element.textContent
  const makeRange = (start, end) => {
    const first = nodes.find(
      (value) => start >= value.start && start < value.end
    )
    const last = [...nodes]
      .reverse()
      .find((value) => end > value.start && end <= value.end)
    if (!first || !last) return null
    const range = document.createRange()
    range.setStart(first.node, start - first.start)
    range.setEnd(last.node, end - last.start)
    return range
  }
  const segments =
    typeof Intl.Segmenter === 'function'
      ? [
          ...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(
            text
          ),
        ].map((value) => ({
          text: value.segment,
          start: value.index,
          end: value.index + value.segment.length,
        }))
      : (() => {
          let offset = 0
          return Array.from(text).map((value) => {
            const result = {
              text: value,
              start: offset,
              end: offset + value.length,
            }
            offset += value.length
            return result
          })
        })()
  const graphemes = segments.map((segment) => {
    const range = makeRange(segment.start, segment.end)
    const ranges = range
      ? [...range.getClientRects()]
          .filter((value) => value.width > 0 && value.height > 0)
          .map((value) => value.toJSON())
      : []
    const whitespace = !/\S/u.test(segment.text)
    return {
      text: segment.text,
      utf16Start: segment.start,
      utf16End: segment.end,
      whitespace,
      ranges,
      fits:
        whitespace ||
        (ranges.length > 0 &&
          boundaries.every((boundary) =>
            ranges.every((value) => inside(value, boundary.rect))
          )),
    }
  })
  const glyphs = graphemes.filter((value) => !value.whitespace)
  const extensionText = text.match(/^(.+)(\.[A-Za-z0-9]{1,16})$/)?.[2] || ''
  const extensionStart = text.length - extensionText.length
  const extensionRange = extensionText
    ? makeRange(extensionStart, text.length)
    : null
  const extension = extensionText
    ? {
        text: extensionRange?.toString() ?? null,
        utf16Start: extensionStart,
        utf16End: text.length,
        ranges: extensionRange
          ? [...extensionRange.getClientRects()]
              .filter((value) => value.width > 0 && value.height > 0)
              .map((value) => value.toJSON())
          : [],
        glyphs: glyphs.filter((value) => value.utf16Start >= extensionStart),
      }
    : null
  const whole = document.createRange()
  whole.selectNodeContents(element)
  const lineRects = [...whole.getClientRects()]
    .filter((value) => value.width > 0 && value.height > 0)
    .map((value) => value.toJSON())
  const style = getComputedStyle(element)
  const canvas = document.createElement('canvas').getContext('2d')
  canvas.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
  return {
    renderContractVersion: 'full-filename-v1',
    text,
    title: element.title,
    ariaLabel: element.getAttribute('aria-label'),
    fileIndex: Number(element.closest('[data-file-index]')?.dataset.fileIndex),
    utf16Length: text.length,
    segmentation:
      typeof Intl.Segmenter === 'function'
        ? 'Intl.Segmenter-grapheme'
        : 'code-point-range-fallback',
    graphemes,
    glyphs,
    lineRects,
    lineCount: new Set(lineRects.map((value) => Math.round(value.top))).size,
    lineHeight: parseFloat(style.lineHeight),
    fullInlineWidth: canvas.measureText(text).width,
    font: {
      family: style.fontFamily,
      size: style.fontSize,
      weight: style.fontWeight,
      style: style.fontStyle,
    },
    display: style.display,
    css: {
      whiteSpace: style.whiteSpace,
      textOverflow: style.textOverflow,
      overflowX: style.overflowX,
      overflowY: style.overflowY,
      webkitLineClamp: style.webkitLineClamp,
    },
    link: rect(element),
    heading: rect(heading),
    card: rect(card),
    boundaries,
    first: glyphs[0] || null,
    lastStem:
      glyphs.filter((value) => value.utf16End <= extensionStart).at(-1) || null,
    extension,
    allGlyphsFit: glyphs.length > 0 && glyphs.every((value) => value.fits),
  }
}
module.exports = { measureFilenameGeometry }
