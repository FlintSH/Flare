/* eslint-disable @typescript-eslint/no-require-imports */
// Loads the same pages from two running Flare servers in headless Chromium,
// each time in a new profile with an empty cache, alternating between the
// servers. Reports how long each page took to show its content and what it
// downloaded. Seed both databases with scripts/perf/seed.cjs first.
//
//   node scripts/perf/browser.cjs --before http://localhost:3311 \
//     --after http://localhost:3312 --runs 5 --out results/browser.json
const { mkdirSync, writeFileSync } = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { chromium } = require('../../docs/site/node_modules/@playwright/test')

const args = Object.fromEntries(
  process.argv
    .slice(2)
    .map((value, index, all) =>
      value.startsWith('--') ? [value.slice(2), all[index + 1]] : null
    )
    .filter(Boolean)
)
const SIDES = { before: args.before, after: args.after }
if (!SIDES.before || !SIDES.after)
  throw new Error('Pass --before and --after server URLs.')
const RUNS = Number(args.runs || 5)
const ONLY = args.only ? args.only.split(',') : null
const NETWORKS = (args.networks || 'fast4g,local').split(',')

// Chrome DevTools' "Fast 4G" preset.
const NETWORK = {
  local: null,
  fast4g: {
    offline: false,
    latency: 165,
    downloadThroughput: (9 * 1024 * 1024) / 8,
    uploadThroughput: (1.5 * 1024 * 1024) / 8,
  },
}

// An image counts once it has decoded and nothing hides it: a page can hold
// a finished image behind its loading state, at no opacity, until it is ready
// to show it.
const SHOWING = `(image) => {
  if (!image.complete || !image.naturalWidth) return false
  for (let node = image; node instanceof Element; node = node.parentElement) {
    const style = getComputedStyle(node)
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) < 0.99)
      return false
  }
  return true
}`

// Each resolves in the page once the content its scenario names is on screen.
const WAIT = {
  // Every thumbnail in the viewport is showing, and there are some.
  thumbnails: `new Promise((resolve) => {
    const showing = ${SHOWING}
    const started = performance.now()
    const check = () => {
      const visible = [...document.querySelectorAll('main img')].filter((image) => {
        const box = image.getBoundingClientRect()
        return box.top < innerHeight && box.bottom > 0 && box.width > 100
      })
      if (visible.length >= 4 && visible.every(showing))
        return resolve({ shown: visible.length })
      if (performance.now() - started > 120000) return resolve({ shown: 0 })
      requestAnimationFrame(check)
    }
    check()
  })`,
  image: `new Promise((resolve) => {
    const showing = ${SHOWING}
    const started = performance.now()
    const check = () => {
      const image = [...document.querySelectorAll('img')].find(
        (candidate) => candidate.getBoundingClientRect().width > 200
      )
      if (image && showing(image)) return resolve({ shown: 1 })
      if (performance.now() - started > 120000) return resolve({ shown: 0 })
      requestAnimationFrame(check)
    }
    check()
  })`,
  text: `new Promise((resolve) => {
    const started = performance.now()
    const check = () => {
      if (document.body.innerText.includes('invoice') || document.body.innerText.includes('meeting'))
        return resolve({ shown: 1 })
      if (performance.now() - started > 120000) return resolve({ shown: 0 })
      requestAnimationFrame(check)
    }
    check()
  })`,
  form: `new Promise((resolve) => {
    const started = performance.now()
    const check = () => {
      if (document.querySelector('input[type=password]')) return resolve({ shown: 1 })
      if (performance.now() - started > 120000) return resolve({ shown: 0 })
      requestAnimationFrame(check)
    }
    check()
  })`,
}

const SCENARIOS = [
  {
    id: 'library-open',
    label: 'Open a 100,000-file library',
    path: '/dashboard',
    signedIn: true,
    wait: WAIT.thumbnails,
  },
  {
    id: 'library-scroll',
    label: 'Scroll ten screens into the library',
    path: '/dashboard',
    signedIn: true,
    wait: WAIT.thumbnails,
    // Timed from the first scroll: ten screens down, each waiting for its
    // thumbnails.
    after: async (page) => {
      const started = Date.now()
      let shown = 0
      for (let screen = 0; screen < 10; screen++) {
        await page.mouse.wheel(0, 850)
        await page.waitForTimeout(120)
        shown += (await page.evaluate(WAIT.thumbnails)).shown
      }
      return { ms: Date.now() - started, shown }
    },
  },
  {
    id: 'share-image',
    label: 'Open a shared screenshot',
    path: '/perf/perf-public-screenshot.png',
    wait: WAIT.image,
  },
  {
    id: 'share-photo',
    label: 'Open a shared photo',
    path: '/perf/perf-public-photo.jpg',
    wait: WAIT.image,
  },
  {
    id: 'share-text',
    label: 'Open a shared text file',
    path: '/perf/perf-public-notes.txt',
    wait: WAIT.text,
  },
  {
    id: 'sign-in',
    label: 'Open the sign-in page',
    path: '/auth/login',
    wait: WAIT.form,
  },
]

async function signIn(browser, base) {
  const context = await browser.newContext()
  const csrf = await context.request.get(`${base}/api/auth/csrf`)
  const { csrfToken } = await csrf.json()
  await context.request.post(`${base}/api/auth/callback/credentials`, {
    form: {
      csrfToken,
      email: 'perf-owner@example.test',
      password: 'Perf-bench-only-2026!',
      json: 'true',
      callbackUrl: `${base}/dashboard`,
    },
  })
  const cookies = await context.cookies()
  await context.close()
  if (!cookies.some((cookie) => cookie.name === 'next-auth.session-token'))
    throw new Error(`Could not sign in to ${base}`)
  return cookies
}

const KINDS = {
  Document: 'html',
  Stylesheet: 'css',
  Script: 'script',
  Font: 'font',
  Image: 'image',
  Media: 'media',
}

async function load(browser, side, scenario, network) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  })
  if (scenario.signedIn) await context.addCookies(side.cookies)
  const page = await context.newPage()
  const devtools = await context.newCDPSession(page)
  await devtools.send('Network.enable')
  if (NETWORK[network])
    await devtools.send('Network.emulateNetworkConditions', NETWORK[network])
  const responses = new Map()
  const bytes = { total: 0, requests: 0 }
  devtools.on('Network.responseReceived', (event) =>
    responses.set(event.requestId, {
      type: event.type,
      url: event.response.url,
    })
  )
  devtools.on('Network.loadingFinished', (event) => {
    const response = responses.get(event.requestId)
    if (!response) return
    const kind = /\/thumbnail|\/_next\/image/.test(response.url)
      ? 'thumbnail'
      : (KINDS[response.type] ?? 'data')
    bytes[kind] = (bytes[kind] ?? 0) + event.encodedDataLength
    bytes.total += event.encodedDataLength
    bytes.requests++
  })
  const started = Date.now()
  await page.goto(side.base + scenario.path, { waitUntil: 'commit' })
  let { shown } = await page.evaluate(scenario.wait)
  let ms = Date.now() - started
  if (scenario.after && shown) ({ ms, shown } = await scenario.after(page))
  // Let trailing downloads finish so the byte counts are whole.
  await page.waitForLoadState('networkidle').catch(() => {})
  await context.close()
  return { ms, shown, bytes }
}

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

async function main() {
  // Before the run adds its own load.
  const loadAverageAtStart = os
    .loadavg()
    .map((value) => Math.round(value * 100) / 100)
  const browser = await chromium.launch()
  const sides = {}
  for (const [name, base] of Object.entries(SIDES))
    sides[name] = { name, base, cookies: await signIn(browser, base) }
  const results = []
  for (const network of NETWORKS)
    for (const scenario of SCENARIOS) {
      if (ONLY && !ONLY.includes(scenario.id)) continue
      const samples = { before: [], after: [] }
      const errors = { before: 0, after: 0 }
      // One unmeasured load a side fills server caches, as a running
      // instance has them; the browser's cache starts empty every time.
      for (const side of Object.values(sides))
        await load(browser, side, scenario, 'local')
      for (let run = 0; run < RUNS; run++) {
        const order = run % 2 ? ['after', 'before'] : ['before', 'after']
        for (const name of order) {
          const sample = await load(browser, sides[name], scenario, network)
          if (sample.shown) samples[name].push(sample)
          else errors[name]++
        }
      }
      const summary = (name) => {
        const side = samples[name]
        if (!side.length) return { errors: errors[name] }
        const times = side.map((sample) => sample.ms)
        const middle = side.find((sample) => sample.ms === median(times))
        return {
          median: median(times),
          min: Math.min(...times),
          max: Math.max(...times),
          runs: RUNS,
          errors: errors[name],
          shown: middle.shown,
          bytes: middle.bytes,
        }
      }
      const row = {
        id: scenario.id,
        label: scenario.label,
        network,
        unit: 'ms',
        before: summary('before'),
        after: summary('after'),
      }
      results.push(row)
      const show = (side) =>
        `${side.median} ms (${side.min}-${side.max}) ${Math.round((side.bytes?.total ?? 0) / 1024)} KB in ${side.bytes?.requests} requests`
      console.log(
        `${network.padEnd(7)}${row.id.padEnd(16)} before ${show(row.before).padEnd(48)} after ${show(row.after).padEnd(48)} errors ${errors.before}/${errors.after}`
      )
    }
  await browser.close()
  const report = {
    kind: 'browser',
    measuredAt: new Date().toISOString(),
    host: {
      cpus: os.cpus().length,
      memoryGiB: Math.round(os.totalmem() / 1024 ** 3),
      loadAverageAtStart,
      node: process.version,
    },
    runs: RUNS,
    viewport: '1440x900',
    results,
  }
  if (args.out) {
    mkdirSync(path.dirname(args.out), { recursive: true })
    writeFileSync(args.out, `${JSON.stringify(report, null, 2)}\n`)
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
