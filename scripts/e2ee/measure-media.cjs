/* eslint-disable @typescript-eslint/no-require-imports */
// Measures what large encrypted files cost in a real browser
// (docs/e2ee-spec.md, section 12.2): the time to upload and to download one,
// the time to start and to seek in a long video, the ciphertext bytes the
// seek asked for, and the peak memory of every process of the browser.
// A production build, a disposable database, headless Chromium.
//
// The browser that is measured runs without Playwright. Playwright turns on
// the DevTools Network domain for every page, and with it Chromium keeps
// the body of every request until the page navigates: a 2 GiB upload then
// shows 2 GiB more memory than a person's browser uses. Playwright only
// signs in, into a profile directory. A second Chromium is started on that
// profile and driven through a few DevTools commands (Runtime, DOM, Target,
// Browser), never Network.
//
// Setup, with the application built and PostgreSQL running:
//
//   export DATABASE_URL='postgresql://flare_test@127.0.0.1:5432/flare_e2ee_measure_local'
//   pnpm exec prisma migrate deploy
//   NEXTAUTH_URL='http://localhost:3296' NEXTAUTH_SECRET=... \
//     pnpm exec next start -H 127.0.0.1 -p 3295
//   FLARE_E2EE_MEASURE_FILE=/path/to/2GiB.bin \
//   FLARE_E2EE_MEASURE_VIDEO=/path/to/two-hours.webm \
//     node scripts/e2ee/measure-media.cjs
//
// The application listens on 3295. This script's counting proxy listens on
// 3296, the origin the browser uses. The proxy passes bodies through as
// streams and keeps none. Either file can be left out. The measured browser
// listens for DevTools on `FLARE_E2EE_MEASURE_DEBUG_PORT` (3298).
const assert = require('node:assert/strict')
const { spawn } = require('node:child_process')
const { createHash } = require('node:crypto')
const {
  createReadStream,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} = require('node:fs')
const { mkdir, rm } = require('node:fs/promises')
const http = require('node:http')
const os = require('node:os')
const path = require('node:path')
const {
  chromium,
  expect: baseExpect,
} = require('../../docs/site/node_modules/@playwright/test')
const { PrismaClient } = require('@prisma/client')
const shared = require('../shared/passphrase-accounts.cjs')
const expect = baseExpect.configure({ timeout: 45000 })

const origin = process.env.FLARE_E2EE_MEASURE_ORIGIN || 'http://localhost:3296'
const upstream =
  process.env.FLARE_E2EE_MEASURE_UPSTREAM || 'http://127.0.0.1:3295'
if (new URL(origin).hostname !== 'localhost')
  throw new Error('Use a disposable localhost instance, matching NEXTAUTH_URL.')
const database = new URL(process.env.DATABASE_URL || 'postgresql://unset/')
if (
  !['localhost', '127.0.0.1'].includes(database.hostname) ||
  database.pathname !== '/flare_e2ee_measure_local'
)
  throw new Error(
    'This check needs a local PostgreSQL database named exactly flare_e2ee_measure_local.'
  )
const bigFile = process.env.FLARE_E2EE_MEASURE_FILE
const videoFile = process.env.FLARE_E2EE_MEASURE_VIDEO
const downloadsPath =
  process.env.FLARE_E2EE_MEASURE_DOWNLOADS ||
  path.join(os.tmpdir(), 'flare-e2ee-measure-downloads')
const debugPort = Number(process.env.FLARE_E2EE_MEASURE_DEBUG_PORT) || 3298
const uploadTimeoutMs =
  Number(process.env.FLARE_E2EE_MEASURE_TIMEOUT_MS) || 3600000
const prisma = new PrismaClient()
const PASSPHRASE = 'copper lantern walrus opera 58'
const ACCOUNT = { id: 'e2ee-measure-alex', name: 'Alex Morgan' }
const MIB = 1048576

// ---------------------------------------------------------------- proxy

/** Ciphertext requests: `{ target, range, asked, sent }`. No body is kept. */
const ciphertext = []

function startCountingProxy() {
  const target = new URL(upstream)
  const listen = new URL(origin)
  const server = http.createServer((request, response) => {
    let entry = null
    if (
      request.method === 'GET' &&
      /^\/api\/files\/[^/]+\/e_/.test(request.url)
    ) {
      const match = /^bytes=(\d+)-(\d+)$/.exec(request.headers.range || '')
      entry = {
        target: request.url,
        range: request.headers.range || null,
        asked: match ? Number(match[2]) + 1 - Number(match[1]) : null,
        start: match ? Number(match[1]) : 0,
        sent: 0,
      }
      ciphertext.push(entry)
    }
    const forward = http.request(
      {
        host: target.hostname,
        port: target.port,
        method: request.method,
        path: request.url,
        headers: request.headers,
      },
      (answer) => {
        response.writeHead(answer.statusCode, answer.rawHeaders)
        if (entry)
          answer.on('data', (chunk) => {
            entry.sent += chunk.length
          })
        answer.pipe(response)
      }
    )
    response.on('close', () => forward.destroy())
    forward.on('error', () => {
      if (!response.headersSent) response.statusCode = 502
      response.end()
    })
    request.pipe(forward)
  })
  return new Promise((resolve) =>
    server.listen(Number(listen.port), '127.0.0.1', () => resolve(server))
  )
}

// ---------------------------------------------------------------- memory

/** The proportional set size of a process in MiB, or 0 if it is gone. */
function pssOf(pid) {
  try {
    const rollup = readFileSync(`/proc/${pid}/smaps_rollup`, 'utf8')
    return Number(/^Pss:\s+(\d+) kB/m.exec(rollup)?.[1] ?? 0) / 1024
  } catch {
    return 0
  }
}

/** Every process below `root`, with its Chromium process type. */
function browserProcesses(root) {
  const parents = new Map()
  for (const entry of readdirSync('/proc')) {
    if (!/^\d+$/.test(entry)) continue
    try {
      const stat = readFileSync(`/proc/${entry}/stat`, 'utf8')
      parents.set(
        Number(entry),
        Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1])
      )
    } catch {
      // The process ended while the list was read.
    }
  }
  const found = []
  const visit = (pid) => {
    let type = 'browser'
    try {
      type =
        /--type=([a-z-]+)/.exec(
          readFileSync(`/proc/${pid}/cmdline`, 'utf8')
        )?.[1] ?? 'browser'
    } catch {
      return
    }
    found.push({ pid, type })
    for (const [child, parent] of parents) if (parent === pid) visit(child)
  }
  visit(root)
  return found
}

/** Samples the memory of the whole browser once a second while `work` runs. */
async function withPeakMemory(root, work) {
  const sample = () => {
    const processes = browserProcesses(root).map((process) => ({
      ...process,
      pss: pssOf(process.pid),
    }))
    return {
      total: processes.reduce((sum, process) => sum + process.pss, 0),
      largestRenderer: Math.max(
        0,
        ...processes
          .filter((process) => process.type === 'renderer')
          .map((process) => process.pss)
      ),
    }
  }
  const before = sample()
  const peak = { ...before }
  const timer = setInterval(() => {
    const now = sample()
    peak.total = Math.max(peak.total, now.total)
    peak.largestRenderer = Math.max(peak.largestRenderer, now.largestRenderer)
  }, 1000)
  const started = Date.now()
  try {
    const value = await work()
    return {
      value,
      seconds: (Date.now() - started) / 1000,
      beforeMiB: Math.round(before.total),
      peakMiB: Math.round(peak.total),
      peakRendererMiB: Math.round(peak.largestRenderer),
    }
  } finally {
    clearInterval(timer)
  }
}

function sha256File(file) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    createReadStream(file)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => resolve(hash.digest('hex')))
      .on('error', reject)
  })
}

// ---------------------------------------------------------------- browser

/** A few DevTools commands over one WebSocket. No Network domain. */
async function devtools(port) {
  let version = null
  for (let attempt = 0; attempt < 100 && !version; attempt++) {
    version = await fetch(`http://127.0.0.1:${port}/json/version`)
      .then((response) => response.json())
      .catch(() => null)
    if (!version) await new Promise((resolve) => setTimeout(resolve, 100))
  }
  assert.ok(version, 'The browser did not open its DevTools port')
  const socket = new WebSocket(version.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    socket.onopen = resolve
    socket.onerror = reject
  })
  let next = 1
  const pending = new Map()
  const listeners = new Set()
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data)
    if (message.id) {
      const waiter = pending.get(message.id)
      pending.delete(message.id)
      if (message.error) waiter?.reject(new Error(message.error.message))
      else waiter?.resolve(message.result)
    } else for (const listener of listeners) listener(message)
  }
  const send = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      const id = next++
      pending.set(id, { resolve, reject })
      socket.send(JSON.stringify({ id, method, params, sessionId }))
    })
  return {
    version: version.Browser,
    send,
    on: (listener) => listeners.add(listener),
    close: () => socket.close(),
  }
}

/** One tab: go to an address, run script in it, wait for a condition. */
async function openTab(browser) {
  const { targetId } = await browser.send('Target.createTarget', {
    url: 'about:blank',
  })
  const { sessionId } = await browser.send('Target.attachToTarget', {
    targetId,
    flatten: true,
  })
  // A tab that a person looks at: visible and focused. A hidden tab plays
  // media in another way.
  await browser.send('Page.enable', {}, sessionId)
  await browser.send('Page.bringToFront', {}, sessionId)
  await browser.send(
    'Emulation.setFocusEmulationEnabled',
    { enabled: true },
    sessionId
  )
  const evaluate = async (expression) => {
    const result = await browser.send(
      'Runtime.evaluate',
      { expression, awaitPromise: true, returnByValue: true },
      sessionId
    )
    if (result.exceptionDetails)
      throw new Error(
        result.exceptionDetails.exception?.description ||
          result.exceptionDetails.text
      )
    return result.result.value
  }
  const until = async (expression, timeoutMs = 60000, intervalMs = 50) => {
    const deadline = Date.now() + timeoutMs
    for (;;) {
      const value = await evaluate(expression).catch(() => null)
      if (value) return value
      if (Date.now() > deadline) {
        // A picture and the address of the page, to see what it waited on.
        const shot = await browser
          .send('Page.captureScreenshot', { format: 'png' }, sessionId)
          .catch(() => null)
        if (shot)
          writeFileSync(
            path.join(downloadsPath, 'timed-out.png'),
            Buffer.from(shot.data, 'base64')
          )
        const where = await evaluate('location.href').catch(() => '?')
        throw new Error(
          `Timed out at ${where} waiting for: ${expression.slice(0, 120)}`
        )
      }
      await new Promise((resolve) => setTimeout(resolve, intervalMs))
    }
  }
  return {
    evaluate,
    until,
    goto: (url) => browser.send('Page.navigate', { url }, sessionId),
    /** A real mouse click, which gives the page user activation. */
    async click(x, y) {
      for (const type of ['mousePressed', 'mouseReleased'])
        await browser.send(
          'Input.dispatchMouseEvent',
          { type, x, y, button: 'left', clickCount: 1 },
          sessionId
        )
    },
    async setFile(selector, file) {
      const { root } = await browser.send('DOM.getDocument', {}, sessionId)
      const { nodeId } = await browser.send(
        'DOM.querySelector',
        { nodeId: root.nodeId, selector },
        sessionId
      )
      await browser.send(
        'DOM.setFileInputFiles',
        { nodeId, files: [file] },
        sessionId
      )
    },
    close: () => browser.send('Target.closeTarget', { targetId }),
  }
}

const clickButton = (name) => `(() => {
  const button = [...document.querySelectorAll('button')].find(
    (candidate) =>
      !candidate.disabled &&
      (candidate.getAttribute('aria-label') || candidate.textContent).trim() === ${JSON.stringify(name)}
  )
  if (!button) return false
  button.click()
  return true
})()`

// ---------------------------------------------------------------- run

async function seed() {
  await fetch(`${upstream}/auth/login`)
  const config = await prisma.config.findUnique({
    where: { key: 'flare_config' },
  })
  assert.ok(config, 'The application did not create its configuration')
  config.value.settings.general.setup = {
    completed: true,
    completedAt: new Date().toISOString(),
  }
  config.value.settings.general.ocr = { enabled: false }
  config.value.settings.general.oidc = { enabled: false }
  config.value.settings.general.storage.maxUploadSize = { value: 8, unit: 'GB' }
  config.value.settings.general.storage.quotas = {
    ...config.value.settings.general.storage.quotas,
    enabled: false,
  }
  await prisma.config.update({
    where: { key: 'flare_config' },
    data: { value: config.value },
  })
  await prisma.user.deleteMany({ where: { id: ACCOUNT.id } })
  await prisma.authRateLimit.deleteMany()
  const record = await shared.createAccountRecord(PASSPHRASE)
  await prisma.user.create({
    data: {
      id: ACCOUNT.id,
      name: ACCOUNT.name,
      email: `${ACCOUNT.id}@example.test`,
      ...record.columns,
      roles: { connect: { systemKey: 'administrator' } },
      urlId: 'alexm',
    },
  })
}

/** Uploads a file through the upload form and returns its address without a key. */
async function upload(tab, file) {
  const name = path.basename(file)
  await tab.goto(`${origin}/dashboard/upload`)
  await tab.until(
    `Boolean(document.querySelector('[data-encryption-choice="encrypted"]') && document.querySelector('input[type="file"]'))`
  )
  // The form takes the file once React has hydrated it. A choice that came
  // too early is cleared, so the next one is a change again.
  await tab.until(
    `(() => { const input = document.querySelector('input[type="file"]'); return Boolean(input && Object.keys(input).some((key) => key.startsWith('__reactProps'))) })()`
  )
  for (let attempt = 0; ; attempt++) {
    await tab.evaluate(
      `(() => { const input = document.querySelector('input[type="file"]'); if (input) input.value = ''; return true })()`
    )
    await tab.setFile('input[type="file"]', file)
    const clicked = await tab
      .until(clickButton('Upload 1 file'), 8000)
      .catch(() => false)
    if (clicked) break
    assert.ok(attempt < 8, 'The upload form did not take the file')
  }
  await tab.until(
    `[...document.querySelectorAll('a')].some((link) => (link.getAttribute('aria-label') || link.textContent).trim() === ${JSON.stringify(`Open ${name}`)})`,
    uploadTimeoutMs,
    500
  )
  const row = await prisma.file.findFirstOrThrow({
    where: { userId: ACCOUNT.id },
    orderBy: [{ uploadedAt: 'desc' }, { id: 'desc' }],
  })
  return `${origin}${row.urlPath}`
}

async function main() {
  await mkdir(downloadsPath, { recursive: true })
  const profile = path.join(downloadsPath, 'profile')
  await rm(profile, { recursive: true, force: true })
  const proxy = await startCountingProxy()
  await seed()

  // Playwright signs in. The session cookie and the account keys stay in
  // the profile directory.
  const signedIn = await chromium.launchPersistentContext(profile, {
    headless: true,
    channel: 'chromium',
    baseURL: origin,
  })
  const page = signedIn.pages()[0] ?? (await signedIn.newPage())
  page.setDefaultTimeout(60000)
  await shared.signIn(page, expect, {
    origin,
    email: `${ACCOUNT.id}@example.test`,
    secret: PASSPHRASE,
  })
  await expect(page.getByRole('button', { name: 'Account menu' })).toBeVisible()
  await signedIn.close()

  const chrome = spawn(
    chromium.executablePath(),
    [
      '--headless=new',
      '--no-sandbox',
      '--disable-gpu',
      '--no-first-run',
      `--user-data-dir=${profile}`,
      `--remote-debugging-port=${debugPort}`,
      'about:blank',
    ],
    { stdio: 'ignore' }
  )
  const root = chrome.pid
  const report = { cpus: os.cpus().length }
  let browser = null
  try {
    browser = await devtools(debugPort)
    report.chromium = browser.version
    const downloads = new Map()
    browser.on((message) => {
      if (message.method === 'Browser.downloadWillBegin')
        downloads.set(message.params.guid, { url: message.params.url })
      if (message.method === 'Browser.downloadProgress')
        Object.assign(downloads.get(message.params.guid) ?? {}, message.params)
    })
    await browser.send('Browser.setDownloadBehavior', {
      behavior: 'allowAndName',
      downloadPath: downloadsPath,
      eventsEnabled: true,
    })
    const tab = await openTab(browser)

    if (bigFile) {
      const bytes = statSync(bigFile).size
      const expected = await sha256File(bigFile)
      const uploaded = await withPeakMemory(root, () => upload(tab, bigFile))
      report.upload = {
        mib: Math.round(bytes / MIB),
        seconds: Math.round(uploaded.seconds),
        mibPerSecond: +(bytes / MIB / uploaded.seconds).toFixed(1),
        browserBeforeMiB: uploaded.beforeMiB,
        browserPeakMiB: uploaded.peakMiB,
        largestRendererPeakMiB: uploaded.peakRendererMiB,
      }
      console.log(JSON.stringify({ upload: report.upload }))

      // The owner downloads it from its page: the account stanza gives the key.
      await tab.goto(uploaded.value)
      await tab.until(
        `Boolean(document.querySelector('[data-encrypted-share="open"]'))`
      )
      const before = ciphertext.length
      const saved = await withPeakMemory(root, async () => {
        await tab.until(clickButton('Download'))
        const deadline = Date.now() + uploadTimeoutMs
        for (;;) {
          const done = [...downloads.entries()].find(
            ([, download]) => download.state === 'completed'
          )
          if (done) return done
          const failed = [...downloads.values()].find(
            (download) => download.state === 'canceled'
          )
          assert.ok(!failed, 'The download failed')
          assert.ok(Date.now() < deadline, 'The download did not finish')
          await new Promise((resolve) => setTimeout(resolve, 250))
        }
      })
      const [guid, download] = saved.value
      assert.match(download.url, /\/_flare\/local\//)
      const file = path.join(downloadsPath, guid)
      assert.equal(
        statSync(file).size,
        bytes,
        'The download has a different size'
      )
      assert.equal(await sha256File(file), expected, 'SHA-256')
      await rm(file, { force: true })
      report.download = {
        mib: Math.round(bytes / MIB),
        seconds: Math.round(saved.seconds),
        mibPerSecond: +(bytes / MIB / saved.seconds).toFixed(1),
        sha256Matches: true,
        browserBeforeMiB: saved.beforeMiB,
        browserPeakMiB: saved.peakMiB,
        largestRendererPeakMiB: saved.peakRendererMiB,
        ciphertextRequests: ciphertext.length - before,
      }
      console.log(JSON.stringify({ download: report.download }))
    }

    if (videoFile) {
      const bytes = statSync(videoFile).size
      const uploaded = await withPeakMemory(root, () => upload(tab, videoFile))
      report.videoUpload = {
        mib: Math.round(bytes / MIB),
        seconds: Math.round(uploaded.seconds),
        browserPeakMiB: uploaded.peakMiB,
      }
      const before = ciphertext.length
      const asked = () =>
        ciphertext
          .slice(before)
          .reduce((sum, request) => sum + (request.asked ?? bytes), 0)
      const sent = () =>
        ciphertext.slice(before).reduce((sum, request) => sum + request.sent, 0)
      const played = await withPeakMemory(root, async () => {
        const opened = Date.now()
        await tab.goto(uploaded.value)
        const duration = await tab.until(
          `(() => { const video = document.querySelector('video'); return video && video.readyState >= 1 ? video.duration : 0 })()`,
          120000,
          25
        )
        const ready = (Date.now() - opened) / 1000
        const start = { asked: asked(), sent: sent() }
        report.videoTab = await tab.evaluate(
          `({ visibility: document.visibilityState, focused: document.hasFocus(), controlled: Boolean(navigator.serviceWorker.controller), source: document.querySelector('video').currentSrc.slice(0, 40).replace(/local\\/.*/, 'local/…') })`
        )
        // As a person does: a click on the player starts it, it plays for
        // two seconds, and then comes a seek to three quarters of the film.
        const centre = await tab.evaluate(
          `(() => { const video = document.querySelector('video'); video.muted = true; const box = video.getBoundingClientRect(); return { x: box.x + box.width / 2, y: box.y + box.height / 2 } })()`
        )
        await tab.click(centre.x, centre.y)
        await tab.until(
          `document.querySelector('video').currentTime > 2`,
          60000
        )
        const seekTo = Math.floor(duration * 0.75)
        const seekStarted = Date.now()
        await tab.evaluate(
          `(() => { document.querySelector('video').currentTime = ${seekTo}; return true })()`
        )
        await tab.until(
          `document.querySelector('video').currentTime > ${seekTo + 0.5}`,
          300000,
          25
        )
        const seek = (Date.now() - seekStarted) / 1000
        await tab.evaluate(`document.querySelector('video').pause()`)
        return { ready, duration, seekTo, seek, start }
      })
      report.videoSeek = {
        mib: Math.round(bytes / MIB),
        durationSeconds: Math.round(played.value.duration),
        secondsToMetadata: +played.value.ready.toFixed(2),
        askedBeforePlayMiB: +(played.value.start.asked / MIB).toFixed(1),
        seekToSeconds: played.value.seekTo,
        secondsFromSeekToPlaying: +played.value.seek.toFixed(2),
        askedAfterSeekMiB: +(asked() / MIB).toFixed(1),
        sentAfterSeekMiB: +(sent() / MIB).toFixed(1),
        askedPercentOfFile: +((asked() / bytes) * 100).toFixed(2),
        rangeRequests: ciphertext.length - before,
        browserPeakMiB: played.peakMiB,
        largestRendererPeakMiB: played.peakRendererMiB,
      }
      console.log(JSON.stringify({ videoSeek: report.videoSeek }))
    }
    console.log(JSON.stringify(report, null, 2))
  } finally {
    browser?.close()
    chrome.kill()
    proxy.close()
    await prisma.$disconnect()
  }
}
main().catch((error) => {
  console.error(error.stack || error.message)
  process.exitCode = 1
})
