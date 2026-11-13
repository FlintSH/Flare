/* eslint-disable @typescript-eslint/no-require-imports */
// Photographs the library opening on two running Flare servers at the same
// moments after the click, under Chrome's "Fast 4G" preset with an empty
// cache, and lays the frames out as one picture. Seed both databases with
// scripts/perf/seed.cjs first.
//
//   node scripts/perf/filmstrip.cjs --before http://localhost:3311 \
//     --after http://localhost:3312 --out .github/assets/perf
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
const SIDES = [
  ['Before', args.before],
  ['Now', args.after],
]
if (!args.before || !args.after)
  throw new Error('Pass --before and --after server URLs.')
const out = args.out || '.github/assets/perf'
const MOMENTS = [2000, 3000, 5000, 8000]
const FAST_4G = {
  offline: false,
  latency: 165,
  downloadThroughput: (9 * 1024 * 1024) / 8,
  uploadThroughput: (1.5 * 1024 * 1024) / 8,
}

async function frames(browser, base) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  })
  const csrf = await context.request.get(`${base}/api/auth/csrf`)
  await context.request.post(`${base}/api/auth/callback/credentials`, {
    form: {
      csrfToken: (await csrf.json()).csrfToken,
      email: 'perf-owner@example.test',
      password: 'Perf-bench-only-2026!',
      json: 'true',
      callbackUrl: `${base}/dashboard`,
    },
  })
  const page = await context.newPage()
  // One unmeasured load fills the server's caches, as a running instance has
  // them. The browser's own cache is then emptied.
  await page.goto(`${base}/dashboard`, { waitUntil: 'networkidle' })
  await page.goto('about:blank')
  const devtools = await context.newCDPSession(page)
  await devtools.send('Network.enable')
  await devtools.send('Network.clearBrowserCache')
  await devtools.send('Network.emulateNetworkConditions', FAST_4G)
  const started = Date.now()
  void page.goto(`${base}/dashboard`, { waitUntil: 'commit' }).catch(() => {})
  const shots = []
  for (const moment of MOMENTS) {
    await page.waitForTimeout(Math.max(0, moment - (Date.now() - started)))
    const png = await page.screenshot({ timeout: 10_000 })
    shots.push(
      (
        await sharp(png).resize({ width: 760 }).webp({ quality: 85 }).toBuffer()
      ).toString('base64')
    )
  }
  await context.close()
  return shots
}

async function main() {
  mkdirSync(out, { recursive: true })
  const browser = await chromium.launch()
  const rows = []
  for (const [label, base] of SIDES)
    rows.push([label, await frames(browser, base)])
  const font = readFileSync(
    path.join(process.cwd(), 'public/fonts/inter/Inter-latin.woff2')
  ).toString('base64')
  const page = await browser.newPage({
    viewport: { width: 1800, height: 900 },
    deviceScaleFactor: 2,
  })
  await page.setContent(`<style>
      @font-face { font-family: Inter; font-weight: 100 900; src: url(data:font/woff2;base64,${font}); }
      * { box-sizing: border-box; margin: 0; }
      body { background: #010610; font-family: Inter, system-ui, sans-serif; color: #f8fafc; }
      .card { padding: 40px 44px 34px; background: #040c1b; border: 1px solid #222d40; border-radius: 24px; }
      h1 { font-size: 30px; font-weight: 650; letter-spacing: -0.02em; }
      p { margin-top: 10px; font-size: 16px; color: #9aa8bc; }
      .grid { margin-top: 26px; display: grid; grid-template-columns: 76px repeat(${MOMENTS.length}, 380px); gap: 12px; align-items: center; }
      .time { font-size: 15px; color: #9aa8bc; text-align: center; font-variant-numeric: tabular-nums; }
      .side { font-size: 17px; font-weight: 600; }
      img { display: block; width: 380px; border-radius: 8px; border: 1px solid #222d40; }
    </style>
    <div id="frame" style="padding:44px;display:inline-block"><div class="card">
      <h1>Opening a 100,000-file library</h1>
      <p>The same account on Fast 4G with an empty browser cache, photographed at the same moments after the page was requested.</p>
      <div class="grid">
        <div></div>${MOMENTS.map((moment) => `<div class="time">${moment / 1000} s</div>`).join('')}
        ${rows
          .map(
            ([label, shots]) =>
              `<div class="side">${label}</div>${shots
                .map(
                  (shot) =>
                    `<img alt="" src="data:image/webp;base64,${shot}" />`
                )
                .join('')}`
          )
          .join('')}
      </div>
    </div></div>`)
  await page.evaluate(() => document.fonts.ready)
  const png = await page.locator('#frame').screenshot()
  const target = path.join(out, 'library-filmstrip.webp')
  await sharp(png).webp({ quality: 88 }).toFile(target)
  console.log(target)
  await browser.close()
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
