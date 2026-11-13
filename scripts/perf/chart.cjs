/* eslint-disable @typescript-eslint/no-require-imports */
// Draws the results of scripts/perf/api.cjs and scripts/perf/browser.cjs as
// two pictures: every headline scenario before and after on one scale, and
// what the browser downloads for the first library screen.
//
//   node scripts/perf/chart.cjs --api results/api.json \
//     --browser results/browser.json --out .github/assets/perf
const { mkdirSync, readFileSync } = require('node:fs')
const path = require('node:path')
const { chromium } = require('../../docs/site/node_modules/@playwright/test')
const sharp = require('../../docs/site/node_modules/sharp')

const args = Object.fromEntries(
  process.argv
    .slice(2)
    .map((value, index, all) =>
      value.startsWith('--') ? [value.slice(2), all[index + 1]] : null
    )
    .filter(Boolean)
)
const read = (file) => JSON.parse(readFileSync(file, 'utf8'))
const api = read(args.api)
const browser = read(args.browser)
const out = args.out || '.github/assets/perf'

const apiRow = (id) => api.results.find((row) => row.id === id)
const browserRow = (id, network = 'fast4g') =>
  browser.results.find((row) => row.id === id && row.network === network)

const escape = (text) =>
  String(text).replace(
    /[&<>]/g,
    (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[character]
  )
const number = (value) =>
  value >= 100
    ? Math.round(value).toLocaleString('en-US')
    : value >= 10
      ? value.toFixed(0)
      : value.toFixed(1)
const time = (ms) =>
  ms >= 1000 ? `${number(ms / 1000)} s` : `${number(ms)} ms`
const size = (bytes) =>
  bytes >= 1024 ** 2
    ? `${number(bytes / 1024 ** 2)} MB`
    : `${number(bytes / 1024)} KB`

// The headline rows, in the order a person meets them: opening the library,
// sharing, signing in, then the server work behind them. Every row is "less
// is better", so one kind of bar reads the same way down the list.
const ROWS = [
  {
    label: 'Open a 100,000-file library',
    note: 'Fast 4G, empty cache, until the thumbnails in view show',
    row: browserRow('library-open'),
    value: (side) => side.median,
    format: time,
  },
  {
    label: 'Scroll ten screens into the library',
    note: 'Fast 4G, each screen waits for its thumbnails',
    row: browserRow('library-scroll'),
    value: (side) => side.median,
    format: time,
  },
  {
    label: 'Download for the first library screen',
    note: 'Everything the browser fetches',
    row: browserRow('library-open'),
    value: (side) => side.bytes.total,
    format: size,
  },
  {
    label: 'Fetch the thumbnail of a private photo',
    note: 'A 2.6 MB photo on a library card',
    row: apiRow('thumbnail'),
    value: (side) => side.bytes,
    format: size,
  },
  {
    label: 'Open a shared screenshot',
    note: 'Fast 4G, empty cache, until the image shows',
    row: browserRow('share-image'),
    value: (side) => side.median,
    format: time,
  },
  {
    label: 'Download for the sign-in page',
    note: 'Everything the browser fetches',
    row: browserRow('sign-in'),
    value: (side) => side.bytes.total,
    format: size,
  },
  {
    label: 'Load a page of the library',
    note: 'Server time for 48 files of 100,000',
    row: apiRow('library-page'),
    value: (side) => side.median,
    format: time,
  },
  {
    label: 'List the file types in a library',
    note: 'Server time, 100,000 files',
    row: apiRow('types'),
    value: (side) => side.median,
    format: time,
  },
  {
    label: 'Serve 480 library pages to 16 people',
    note: 'Server time, all asking at once',
    row: apiRow('library-busy'),
    value: (side) => side.median,
    format: time,
  },
  {
    label: 'Upload a screenshot',
    note: 'Server time, into a 100,000-file library',
    row: apiRow('upload'),
    value: (side) => side.median,
    format: time,
  },
  {
    label: 'Upload 48 screenshots at once',
    // `work` is how many of the 48 the worst burst stored.
    note: (row) => {
      const lost = (side) =>
        side.work < 48 ? `lost up to ${48 - side.work} of 48` : 'stored all 48'
      return `Before ${lost(row.before)}; now ${lost(row.after)}`
    },
    row: apiRow('upload-burst'),
    value: (side) => side.median,
    format: time,
  },
].filter((entry) => entry.row?.before && entry.row?.after)

const STYLE = `
  * { box-sizing: border-box; margin: 0; }
  body { background: #010610; font-family: Inter, system-ui, sans-serif; color: #f8fafc; }
  .card { width: 1200px; padding: 44px 48px 36px; background: #040c1b; border: 1px solid #222d40; border-radius: 24px; }
  h1 { font-size: 34px; font-weight: 650; letter-spacing: -0.02em; }
  .lede { margin-top: 10px; font-size: 17px; color: #9aa8bc; }
  .rows { margin-top: 30px; border-top: 1px solid #222d40; }
  .row { display: grid; grid-template-columns: 400px 1fr 250px 90px; align-items: center; gap: 28px; padding: 17px 0; border-bottom: 1px solid #222d40; }
  .name { font-size: 19px; font-weight: 550; }
  .note { margin-top: 4px; font-size: 14px; color: #9aa8bc; }
  .bars { display: grid; gap: 5px; }
  .bar { height: 8px; border-radius: 4px; min-width: 4px; }
  .before { background: #8a3a1a; }
  .after { background: #d95926; }
  .figures { font-size: 17px; color: #9aa8bc; text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .figures b { color: #f8fafc; font-weight: 650; }
  .times { font-size: 26px; font-weight: 650; text-align: right; font-variant-numeric: tabular-nums; letter-spacing: -0.01em; }
  .foot { display: flex; justify-content: space-between; align-items: center; margin-top: 22px; font-size: 14px; color: #9aa8bc; }
  .key { display: flex; gap: 22px; align-items: center; }
  .key span { display: inline-flex; align-items: center; gap: 8px; }
  .key i { display: inline-block; width: 28px; height: 8px; border-radius: 4px; }
  .stack { margin-top: 30px; display: grid; gap: 26px; }
  .stack h2 { font-size: 17px; font-weight: 550; display: flex; justify-content: space-between; }
  .stack h2 span { color: #9aa8bc; font-weight: 450; }
  .segments { margin-top: 10px; display: flex; gap: 2px; height: 28px; }
  .segments div { border-radius: 4px; min-width: 3px; }
  .legend { margin-top: 26px; display: flex; flex-wrap: wrap; gap: 12px 26px; font-size: 15px; color: #9aa8bc; }
  .legend span { display: inline-flex; align-items: center; gap: 8px; }
  .legend i { display: inline-block; width: 12px; height: 12px; border-radius: 3px; }
  .legend b { color: #f8fafc; font-weight: 550; }
`

function summary() {
  const rows = ROWS.map((entry) => {
    const before = entry.value(entry.row.before)
    const after = entry.value(entry.row.after)
    const note =
      typeof entry.note === 'function' ? entry.note(entry.row) : entry.note
    const ratio = before / after
    return `<div class="row">
      <div><div class="name">${escape(entry.label)}</div><div class="note">${escape(note)}</div></div>
      <div class="bars">
        <div class="bar before" style="width:100%"></div>
        <div class="bar after" style="width:${Math.max(0.4, (after / before) * 100).toFixed(2)}%"></div>
      </div>
      <div class="figures">${escape(entry.format(before))} → <b>${escape(entry.format(after))}</b></div>
      <div class="times">${ratio >= 10 ? Math.round(ratio) : ratio.toFixed(1)}×</div>
    </div>`
  })
  return `<div class="card">
    <h1>Flare is faster with a large library</h1>
    <p class="lede">The same requests before and after this change, on the same data: one account with 100,000 files among 120,000, 401 accounts and 300,000 audit events.</p>
    <div class="rows">${rows.join('')}</div>
    <div class="foot">
      <div class="key"><span><i class="before"></i>before</span><span><i class="after"></i>now, on the same scale</span></div>
      <div>Median of ${browser.runs} browser loads and ${api.runs} requests a side, alternating · scripts/perf</div>
    </div>
  </div>`
}

// What the first library screen downloads, by kind. Fixed order and colour
// for each kind, so the two bars compare segment by segment.
const KINDS = [
  ['thumbnail', 'Thumbnails', '#3987e5'],
  ['font', 'Fonts', '#d95926'],
  ['script', 'Scripts', '#199e70'],
  ['data', 'Data', '#c98500'],
  ['other', 'Pages and styles', '#d55181'],
]

function downloads() {
  const row = browserRow('library-open')
  const parts = (side) => {
    const bytes = side.bytes
    const known = KINDS.slice(0, 4).reduce(
      (total, [kind]) => total + (bytes[kind] ?? 0),
      0
    )
    return KINDS.map(([kind, label, colour]) => ({
      label,
      colour,
      bytes: kind === 'other' ? bytes.total - known : (bytes[kind] ?? 0),
    }))
  }
  const before = parts(row.before)
  const after = parts(row.after)
  const scale = row.before.bytes.total
  const bar = (title, side, total) => `<div>
      <h2>${title}<span>${escape(size(total))}</span></h2>
      <div class="segments" style="width:${((total / scale) * 100).toFixed(2)}%">${side
        .filter((part) => part.bytes > 0)
        .map(
          (part) =>
            `<div style="background:${part.colour};flex:${part.bytes} 0 0"></div>`
        )
        .join('')}</div>
    </div>`
  return `<div class="card">
    <h1>What the first library screen downloads</h1>
    <p class="lede">A 100,000-file library opened with an empty browser cache at 1440 × 900. Both bars share one scale.</p>
    <div class="stack">
      ${bar('Before', before, row.before.bytes.total)}
      ${bar('Now', after, row.after.bytes.total)}
    </div>
    <div class="legend">${before
      .map(
        (part, index) =>
          `<span><i style="background:${part.colour}"></i>${escape(part.label)} <b>${escape(size(part.bytes))} → ${escape(size(after[index].bytes))}</b></span>`
      )
      .join('')}</div>
  </div>`
}

async function main() {
  mkdirSync(out, { recursive: true })
  const browserInstance = await chromium.launch()
  const page = await browserInstance.newPage({
    viewport: { width: 1296, height: 900 },
    deviceScaleFactor: 2,
  })
  const font = readFileSync(
    path.join(process.cwd(), 'public/fonts/inter/Inter-latin.woff2')
  ).toString('base64')
  for (const [name, body] of [
    ['summary', summary()],
    ['library-downloads', downloads()],
  ]) {
    await page.setContent(
      `<style>@font-face{font-family:Inter;font-weight:100 900;src:url(data:font/woff2;base64,${font})}${STYLE}</style><div id="frame" style="padding:48px;display:inline-block">${body}</div>`
    )
    await page.evaluate(() => document.fonts.ready)
    const png = await page.locator('#frame').screenshot()
    await sharp(png)
      .webp({ quality: 92 })
      .toFile(path.join(out, `${name}.webp`))
    console.log(`${path.join(out, `${name}.webp`)}`)
  }
  await browserInstance.close()
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
