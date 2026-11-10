/* eslint-disable @typescript-eslint/no-require-imports */
// Measures what large encrypted files cost in a real browser
// (docs/e2ee-spec.md, section 12.2): the time to upload and to download one,
// the time to start and to seek in a long video, the ciphertext bytes the
// seek asked for, and the peak memory of every process of the browser.
// A production build, a disposable database, headless Chromium.
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
// streams and keeps none. Either file can be left out.
const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const {
  createReadStream,
  readFileSync,
  readdirSync,
  statSync,
} = require('node:fs')
const { mkdir } = require('node:fs/promises')
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
      uploadToken: `${ACCOUNT.id}-public-disposable-upload-token`,
    },
  })
}

async function upload(page, file) {
  const name = path.basename(file)
  await page.goto(`${origin}/dashboard/upload`)
  await expect(page.locator('[data-encryption-choice]')).toHaveAttribute(
    'data-encryption-choice',
    'encrypted'
  )
  await page.locator('input[type="file"]').setInputFiles(file)
  await page.getByRole('button', { name: /^Upload 1 file$/ }).click()
  try {
    await expect(
      page.getByRole('link', { name: `Open ${name}`, exact: true })
    ).toBeVisible({ timeout: uploadTimeoutMs })
  } catch (error) {
    await page
      .screenshot({ path: path.join(downloadsPath, 'upload-failed.png') })
      .catch(() => undefined)
    throw error
  }
  await page
    .getByRole('button', { name: `Copy link for ${name}`, exact: true })
    .click()
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toMatch(/\/alexm\/e_[A-Za-z0-9_-]{22}#/)
  return page.evaluate(() => navigator.clipboard.readText())
}

async function main() {
  await mkdir(downloadsPath, { recursive: true })
  const proxy = await startCountingProxy()
  const server = await chromium.launchServer({
    headless: true,
    channel: 'chromium',
    downloadsPath,
  })
  const root = server.process().pid
  const browser = await chromium.connect(server.wsEndpoint())
  const report = { chromium: browser.version(), cpus: os.cpus().length }
  try {
    await seed()
    const ctx = await browser.newContext({
      baseURL: origin,
      viewport: { width: 1440, height: 900 },
      acceptDownloads: true,
      permissions: ['clipboard-read', 'clipboard-write'],
    })
    const page = await ctx.newPage()
    page.setDefaultTimeout(60000)
    // What went wrong, if something does: refused requests and page errors.
    page.on('response', (response) => {
      if (response.status() >= 400)
        console.error(
          `HTTP ${response.status()} ${response.request().method()} ${new URL(response.url()).pathname}`
        )
    })
    page.on('pageerror', (error) =>
      console.error(`page error: ${error.message}`)
    )
    page.on('console', (message) => {
      if (message.type() === 'error')
        console.error(`console: ${message.text()}`)
    })
    await shared.signIn(page, expect, {
      origin,
      email: `${ACCOUNT.id}@example.test`,
      secret: PASSPHRASE,
    })

    if (bigFile) {
      const bytes = statSync(bigFile).size
      const expected = await sha256File(bigFile)
      const uploaded = await withPeakMemory(root, () => upload(page, bigFile))
      report.upload = {
        mib: Math.round(bytes / MIB),
        seconds: Math.round(uploaded.seconds),
        mibPerSecond: +(bytes / MIB / uploaded.seconds).toFixed(1),
        browserBeforeMiB: uploaded.beforeMiB,
        browserPeakMiB: uploaded.peakMiB,
        largestRendererPeakMiB: uploaded.peakRendererMiB,
      }
      console.log(JSON.stringify({ upload: report.upload }))

      // A signed-out visitor downloads it from the share page.
      const visitor = await browser.newContext({
        baseURL: origin,
        acceptDownloads: true,
      })
      const share = await visitor.newPage()
      await share.goto(uploaded.value)
      await expect(share.locator('[data-encrypted-share]')).toHaveAttribute(
        'data-encrypted-share',
        'open',
        { timeout: 60000 }
      )
      const before = ciphertext.length
      const saved = await withPeakMemory(root, async () => {
        const [download] = await Promise.all([
          share.waitForEvent('download', { timeout: 120000 }),
          share.getByRole('button', { name: 'Download', exact: true }).click(),
        ])
        assert.match(download.url(), /\/_flare\/local\//)
        // Resolves when the browser wrote the last byte.
        return download.path()
      })
      const size = statSync(saved.value).size
      assert.equal(size, bytes, 'The download has a different size')
      assert.equal(await sha256File(saved.value), expected, 'SHA-256')
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
      await visitor.close()
    }

    if (videoFile) {
      const bytes = statSync(videoFile).size
      const uploaded = await withPeakMemory(root, () => upload(page, videoFile))
      report.videoUpload = {
        mib: Math.round(bytes / MIB),
        seconds: Math.round(uploaded.seconds),
        browserPeakMiB: uploaded.peakMiB,
      }
      const visitor = await browser.newContext({ baseURL: origin })
      const share = await visitor.newPage()
      const before = ciphertext.length
      const asked = () =>
        ciphertext
          .slice(before)
          .reduce((sum, request) => sum + (request.asked ?? bytes), 0)
      const sent = () =>
        ciphertext.slice(before).reduce((sum, request) => sum + request.sent, 0)
      const played = await withPeakMemory(root, async () => {
        const opened = Date.now()
        await share.goto(uploaded.value)
        const player = share.locator('video')
        await expect(player).toBeVisible({ timeout: 60000 })
        await expect
          .poll(() => player.evaluate((element) => element.readyState >= 1), {
            timeout: 120000,
            intervals: [50],
          })
          .toBe(true)
        const ready = (Date.now() - opened) / 1000
        const duration = await player.evaluate((element) => element.duration)
        const start = { asked: asked(), sent: sent() }
        // Seek to three quarters of the film and play.
        const seekTo = Math.floor(duration * 0.75)
        const seekStarted = Date.now()
        await player.evaluate(async (element, time) => {
          element.muted = true
          element.currentTime = time
          await element.play()
        }, seekTo)
        await expect
          .poll(() => player.evaluate((element) => element.currentTime), {
            timeout: 120000,
            intervals: [50],
          })
          .toBeGreaterThan(seekTo + 0.5)
        const seek = (Date.now() - seekStarted) / 1000
        await player.evaluate((element) => element.pause())
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
      await visitor.close()
    }
    console.log(JSON.stringify(report, null, 2))
  } finally {
    await browser.close()
    await server.close()
    proxy.close()
    await prisma.$disconnect()
  }
}
main().catch((error) => {
  console.error(error.stack || error.message)
  process.exitCode = 1
})
