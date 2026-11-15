/* eslint-disable @typescript-eslint/no-require-imports */
// Draws the results of scripts/ci/timings.mjs as two pictures: the headline
// numbers before and after on one scale, and every job of a typical push on
// a shared clock.
//
//   node scripts/ci/chart.cjs --timings .github/assets/ci-speed/timings.json \
//     --image .github/assets/ci-speed/image.json --out .github/assets/ci-speed
//
// --image is optional: image sizes in MiB, as the Docker Test job reports
// them, in the shape { "linux/amd64": { "before": 1458, "after": 471 } }.
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
const timings = read(args.timings)
const image = args.image ? read(args.image) : {}
const out = args.out || '.github/assets/ci-speed'

const escape = (text) =>
  String(text).replace(
    /[&<>]/g,
    (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[character]
  )
const time = (seconds) =>
  seconds >= 60
    ? `${Math.floor(seconds / 60)} min ${String(Math.round(seconds % 60)).padStart(2, '0')} s`
    : `${Math.round(seconds)} s`
const size = (mib) =>
  mib >= 1024 ? `${(mib / 1024).toFixed(1)} GiB` : `${Math.round(mib)} MiB`

// What each job is, in words. A job missing here keeps its own name.
const NAMES = {
  'Build Checks / Build Check': 'Production build',
  'Code Quality / Code Quality Checks': 'Tests, types, lint and format',
  'Docker Test / Docker Build Test (linux/amd64)':
    'Image build and start, amd64',
  'Docker Test / Docker Build Test (linux/arm64)':
    'Image build and start, arm64',
  'Documentation / check': 'Handbook checks',
  'Documentation / browser (accessibility)': 'Handbook accessibility tests',
  'Documentation / browser (layout and features)': 'Handbook layout tests',
  'Documentation / releases': 'Handbook release site',
  'Documentation Releases / releases': 'Handbook release site',
  'PR Preview Image / checks': 'Preview tooling tests',
  'PR Preview Image / image': 'Preview image',
}
const HANDBOOK = /^Documentation( Releases)? \//

const job = (side, name) => timings[side].jobs[name]?.median
// The handbook's jobs run side by side, so a push waits for the slowest.
const handbook = (side) =>
  Math.max(
    ...Object.entries(timings[side].jobs)
      .filter(([name]) => HANDBOOK.test(name))
      .map(([, value]) => value.median)
  )
const handbookJobs = (side) =>
  Object.keys(timings[side].jobs).filter((name) => HANDBOOK.test(name)).length

const ROWS = [
  {
    label: 'Push to every check finished',
    note: 'From the first job queued to the last one done',
    before: timings.before.wallSeconds.median,
    after: timings.after.wallSeconds.median,
    format: time,
  },
  {
    label: 'Runner time for one push',
    note: 'Added over every job',
    before: timings.before.runnerSeconds.median,
    after: timings.after.runnerSeconds.median,
    format: time,
  },
  {
    label: 'Build the image and start it, amd64',
    note: 'Docker Test, from an empty runner',
    before: job('before', 'Docker Test / Docker Build Test (linux/amd64)'),
    after: job('after', 'Docker Test / Docker Build Test (linux/amd64)'),
    format: time,
  },
  {
    label: 'Build the image and start it, arm64',
    note: 'Docker Test, from an empty runner',
    before: job('before', 'Docker Test / Docker Build Test (linux/arm64)'),
    after: job('after', 'Docker Test / Docker Build Test (linux/arm64)'),
    format: time,
  },
  {
    label: 'Check the handbook',
    note: `Was one job; now the slowest of ${handbookJobs('after')} side by side`,
    before: handbook('before'),
    after: handbook('after'),
    format: time,
  },
  {
    label: 'Tests, types, lint and format',
    note: 'Code Quality, the whole suite against PostgreSQL',
    before: job('before', 'Code Quality / Code Quality Checks'),
    after: job('after', 'Code Quality / Code Quality Checks'),
    format: time,
  },
  {
    label: 'Build the preview image',
    note: 'PR Preview Image',
    before: job('before', 'PR Preview Image / image'),
    after: job('after', 'PR Preview Image / image'),
    format: time,
  },
  {
    label: 'Production build',
    note: 'Build Check',
    before: job('before', 'Build Checks / Build Check'),
    after: job('after', 'Build Checks / Build Check'),
    format: time,
  },
  ...Object.entries(image).map(([platform, value]) => ({
    label: `Image size, ${platform.replace('linux/', '')}`,
    note: value.note || 'As Docker reports it on that runner',
    before: value.before,
    after: value.after,
    format: size,
  })),
].filter((row) => row.before && row.after)

const STYLE = `
  * { box-sizing: border-box; margin: 0; }
  body { background: #010610; font-family: Inter, system-ui, sans-serif; color: #f8fafc; }
  .card { width: 1200px; padding: 44px 48px 36px; background: #040c1b; border: 1px solid #222d40; border-radius: 24px; }
  h1 { font-size: 34px; font-weight: 650; letter-spacing: -0.02em; }
  .lede { margin-top: 10px; font-size: 17px; color: #9aa8bc; }
  .rows { margin-top: 30px; border-top: 1px solid #222d40; }
  .row { display: grid; grid-template-columns: 400px 1fr 270px 90px; align-items: center; gap: 28px; padding: 17px 0; border-bottom: 1px solid #222d40; }
  .name { font-size: 19px; font-weight: 550; }
  .note { margin-top: 4px; font-size: 14px; color: #9aa8bc; }
  .bars { display: grid; gap: 5px; }
  .bar { height: 8px; border-radius: 4px; min-width: 4px; }
  .before { background: #8a3a1a; }
  .after { background: #d95926; }
  .figures { font-size: 17px; color: #9aa8bc; text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .figures b { color: #f8fafc; font-weight: 650; }
  .times { font-size: 26px; font-weight: 650; text-align: right; font-variant-numeric: tabular-nums; letter-spacing: -0.01em; }
  .foot { display: flex; justify-content: space-between; align-items: center; gap: 24px; margin-top: 22px; font-size: 14px; color: #9aa8bc; }
  .key { display: flex; gap: 22px; align-items: center; white-space: nowrap; }
  .key span { display: inline-flex; align-items: center; gap: 8px; }
  .key i { display: inline-block; width: 28px; height: 8px; border-radius: 4px; }
  .panel { margin-top: 30px; }
  .panel h2 { display: flex; justify-content: space-between; font-size: 19px; font-weight: 550; padding-bottom: 12px; border-bottom: 1px solid #222d40; }
  .panel h2 span { color: #9aa8bc; font-weight: 450; }
  .lane { display: grid; grid-template-columns: 290px 1fr; align-items: center; gap: 20px; margin-top: 9px; }
  .lane .what { font-size: 15px; color: #cbd5e1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .track { position: relative; height: 18px; }
  .track .span { position: absolute; top: 3px; height: 12px; border-radius: 4px; min-width: 3px; }
  .track .took { position: absolute; top: 0; font-size: 13px; line-height: 18px; color: #9aa8bc; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .axis { display: grid; grid-template-columns: 290px 1fr; gap: 20px; margin-top: 12px; }
  .ticks { position: relative; height: 20px; border-top: 1px solid #222d40; }
  .ticks span { position: absolute; top: 5px; font-size: 13px; color: #9aa8bc; transform: translateX(-50%); font-variant-numeric: tabular-nums; }
  .ticks span:first-child { transform: none; }
`

function summary() {
  const rows = ROWS.map((row) => {
    const ratio = row.before / row.after
    return `<div class="row">
      <div><div class="name">${escape(row.label)}</div><div class="note">${escape(row.note)}</div></div>
      <div class="bars">
        <div class="bar before" style="width:100%"></div>
        <div class="bar after" style="width:${Math.max(0.4, (row.after / row.before) * 100).toFixed(2)}%"></div>
      </div>
      <div class="figures">${escape(row.format(row.before))} → <b>${escape(row.format(row.after))}</b></div>
      <div class="times">${ratio >= 10 ? Math.round(ratio) : ratio.toFixed(1)}×</div>
    </div>`
  })
  return `<div class="card">
    <h1>Flare's checks finish sooner</h1>
    <p class="lede">The same GitHub Actions workflows before and after this change, on the same runners, timed by GitHub for whole pushes to a pull request.</p>
    <div class="rows">${rows.join('')}</div>
    <div class="foot">
      <div class="key"><span><i class="before"></i>before</span><span><i class="after"></i>now, on the same scale</span></div>
      <div>Median of ${timings.before.pushes} pushes before and ${timings.after.pushes} after · scripts/ci</div>
    </div>
  </div>`
}

// Every job of one push, placed on the clock from when it started to when it
// finished. Both panels share one scale, so the bars compare directly.
function timeline() {
  const scale =
    Math.max(
      ...['before', 'after'].flatMap((side) =>
        timings[side].typical.jobs.map((item) => item.completed)
      )
    ) * 1.1
  const tick = scale > 400 ? 120 : 60
  const panel = (side, title) => {
    const jobs = [...timings[side].typical.jobs].sort(
      (a, b) => b.completed - a.completed || a.name.localeCompare(b.name)
    )
    const end = jobs[0].completed
    const lanes = jobs.map((item) => {
      const left = (item.started / scale) * 100
      const width = ((item.completed - item.started) / scale) * 100
      return `<div class="lane">
        <div class="what">${escape(NAMES[item.name] || item.name)}</div>
        <div class="track">
          <div class="span ${side}" style="left:${left.toFixed(2)}%;width:${width.toFixed(2)}%"></div>
          <div class="took" style="left:calc(${(left + width).toFixed(2)}% + 8px)">${escape(time(item.completed - item.started))}</div>
        </div>
      </div>`
    })
    const ticks = []
    for (let at = 0; at <= scale; at += tick)
      ticks.push(
        `<span style="left:${((at / scale) * 100).toFixed(2)}%">${at / 60} min</span>`
      )
    return `<div class="panel">
      <h2>${title}<span>every check finished after ${escape(time(end))}</span></h2>
      ${lanes.join('')}
      <div class="axis"><div></div><div class="ticks">${ticks.join('')}</div></div>
    </div>`
  }
  return `<div class="card">
    <h1>What one push waits for</h1>
    <p class="lede">Every job GitHub starts for a push to a pull request, from the moment it starts to the moment it finishes. Jobs run side by side, so the longest bar decides when the last check turns green.</p>
    ${panel('before', 'Before')}
    ${panel('after', 'Now')}
  </div>`
}

async function main() {
  mkdirSync(out, { recursive: true })
  const browser = await chromium.launch()
  const page = await browser.newPage({
    viewport: { width: 1296, height: 900 },
    deviceScaleFactor: 2,
  })
  const font = readFileSync(
    path.join(process.cwd(), 'public/fonts/inter/Inter-latin.woff2')
  ).toString('base64')
  for (const [name, body] of [
    ['summary', summary()],
    ['timeline', timeline()],
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
  await browser.close()
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
