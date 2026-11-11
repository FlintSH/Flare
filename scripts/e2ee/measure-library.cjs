/* eslint-disable @typescript-eslint/no-require-imports */
// Measures what a large library of encrypted files costs in a real browser
// (docs/e2ee-spec.md, section 9.8): the time of the first sync of the local
// search cache, the size of that cache, the time until the last record can
// be found, the time of a search after that, the time of a second visit
// that reads the cache, and the peak memory of every process of the browser.
// A production build, a disposable database, headless Chromium.
//
// The seed writes the records straight into the database. It makes them
// with the library of the application (lib/e2ee), so each one is a record
// that the browser opens: a header, a sealed name and type, an account
// stanza for the account key, and for one file in ten a sealed image text.
// No file content is stored: nothing here reads content.
//
// Setup, with the application built and PostgreSQL running:
//
//   export DATABASE_URL='postgresql://flare_test@127.0.0.1:5432/flare_e2ee_measure_local'
//   pnpm exec prisma migrate deploy
//   NEXTAUTH_URL='http://localhost:3295' NEXTAUTH_SECRET=... \
//     pnpm exec next start -H 127.0.0.1 -p 3295
//   node scripts/e2ee/measure-library.cjs
//
// Options: FLARE_E2EE_MEASURE_ORIGIN (default http://localhost:3295),
// FLARE_E2EE_MEASURE_FILES (default 20000), FLARE_E2EE_MEASURE_RESULTS (a
// file for the numbers as JSON).
const assert = require('node:assert/strict')
const { randomBytes, randomUUID } = require('node:crypto')
const {
  existsSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} = require('node:fs')
const { mkdtemp, rm } = require('node:fs/promises')
const { registerHooks } = require('node:module')
const os = require('node:os')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const {
  chromium,
  expect: baseExpect,
} = require('../../docs/site/node_modules/@playwright/test')
const { PrismaClient } = require('@prisma/client')
const shared = require('../shared/passphrase-accounts.cjs')
const expect = baseExpect.configure({ timeout: 60000 })

const origin = process.env.FLARE_E2EE_MEASURE_ORIGIN || 'http://localhost:3295'
if (new URL(origin).hostname !== 'localhost')
  throw new Error('Use a disposable localhost instance, matching NEXTAUTH_URL.')
const database = new URL(process.env.DATABASE_URL || 'postgresql://unset/')
if (
  !['localhost', '127.0.0.1'].includes(database.hostname) ||
  database.pathname !== '/flare_e2ee_measure_local'
)
  throw new Error(
    'This measurement needs a local PostgreSQL database named exactly flare_e2ee_measure_local.'
  )
const FILES = Number(process.env.FLARE_E2EE_MEASURE_FILES || 20000)
assert.ok(Number.isSafeInteger(FILES) && FILES >= 100)

// Demonstration secrets. They are public and only for disposable fixtures.
const PASSPHRASE = 'Measure-library-demo-only-2026!'
const ACCOUNT = { id: 'e2ee-measure-library', name: 'Alex Morgan' }
const prisma = new PrismaClient()
const root = path.resolve(__dirname, '../..')

/**
 * The library of the application is TypeScript with imports that have no
 * file extension. Node removes the types itself. This hook finds the file
 * of such an import, and the root of an `@/` import.
 */
function loadApplicationLibrary() {
  registerHooks({
    resolve(specifier, context, nextResolve) {
      const from = context.parentURL?.startsWith('file:')
        ? path.dirname(new URL(context.parentURL).pathname)
        : root
      const base = specifier.startsWith('@/')
        ? path.join(root, specifier.slice(2))
        : specifier.startsWith('.')
          ? path.resolve(from, specifier)
          : null
      if (base && !path.extname(base))
        for (const candidate of [`${base}.ts`, path.join(base, 'index.ts')])
          if (existsSync(candidate))
            return nextResolve(pathToFileURL(candidate).href, context)
      return nextResolve(specifier, context)
    },
  })
  return import(pathToFileURL(path.join(root, 'lib/e2ee/client/files.ts')).href)
}

const WORDS = [
  'harbor', 'invoice', 'receipt', 'contract', 'meeting', 'sketch', 'diagram',
  'holiday', 'report', 'budget', 'ticket', 'letter', 'draft', 'screen',
  'window', 'garden', 'kitchen', 'bridge', 'summit', 'canyon', 'market',
  'ledger', 'manual', 'poster', 'banner', 'recipe', 'survey', 'roster',
] // prettier-ignore
const KINDS = [
  ['png', 'image/png'], ['png', 'image/png'], ['png', 'image/png'],
  ['jpg', 'image/jpeg'], ['pdf', 'application/pdf'], ['txt', 'text/plain'],
  ['mp4', 'video/mp4'], ['zip', 'application/zip'],
] // prettier-ignore
const word = (index) => WORDS[index % WORDS.length]
const lastName = `zz-last-marker-${FILES - 1}.png`
/** The name of file `index`. The last file has a name that no other file has. */
const nameOf = (index) =>
  index === FILES - 1
    ? lastName
    : `${word(index)}-${word(index * 3 + 1)}-${index}.${KINDS[index % KINDS.length][0]}`

/** About 700 bytes of text, as a screenshot of a document gives. */
function imageText(index) {
  const lines = []
  for (let line = 0; line < 12; line++)
    lines.push(
      Array.from({ length: 9 }, (_, at) =>
        word(index * 7 + line * 3 + at)
      ).join(' ')
    )
  return `${lines.join('\n')}\nreference ${index} end`
}

async function seed() {
  await fetch(`${origin}/auth/login`)
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
      urlId: 'alexl',
    },
  })

  const library = await loadApplicationLibrary()
  const accountPublicKey = new Uint8Array(record.columns.accountPublicKey)
  const started = Date.now()
  const newest = Date.now()
  let withText = 0
  for (let from = 0; from < FILES; from += 1000) {
    const rows = []
    const texts = []
    for (let index = from; index < Math.min(FILES, from + 1000); index++) {
      const type = KINDS[index % KINDS.length][1]
      const created = library.newEncryptedFile({
        name: nameOf(index),
        type,
        accountPublicKey,
      })
      const id = `measure${String(index).padStart(8, '0')}`
      rows.push({
        id,
        userId: ACCOUNT.id,
        name: '',
        mimeType: 'application/octet-stream',
        urlPath: `/alexl/e_${randomBytes(16).toString('base64url')}`,
        path: `uploads/alexl/${randomUUID()}/measure`,
        size: 0.05 + (index % 40) / 10,
        encrypted: true,
        header: Buffer.from(created.records.header, 'base64url'),
        sealedMetadata: Buffer.from(
          created.records.sealedMetadata,
          'base64url'
        ),
        accountStanza: Buffer.from(created.records.accountStanza, 'base64url'),
        stanzaAccountPublicKey: Buffer.from(accountPublicKey),
        // Three years of uploads. The first file is the newest, so the
        // last record of the sync is the oldest file: the library does not
        // show it before a search finds it.
        uploadedAt: new Date(newest - (index + 1) * 4731 * 1000),
      })
      if (index % 10 === 0 && type.startsWith('image/')) {
        withText++
        texts.push({
          fileId: id,
          sealedOcrText: Buffer.from(
            library.sealedOcrTextRecord(created, imageText(index)),
            'base64url'
          ),
        })
      }
    }
    await prisma.file.createMany({ data: rows })
    if (texts.length) await prisma.fileSealedData.createMany({ data: texts })
  }
  return { seedSeconds: (Date.now() - started) / 1000, withText }
}

/**
 * Megabytes that the browser of this profile holds, in all its processes
 * (proportional set size). The main process has the profile directory in
 * its command line. Renderers, workers and the GPU process are below it.
 */
function memoryOf(profile) {
  const parents = new Map()
  const roots = []
  for (const entry of readdirSync('/proc')) {
    if (!/^\d+$/.test(entry)) continue
    try {
      const stat = readFileSync(`/proc/${entry}/stat`, 'utf8')
      // The fields after the name, which can have spaces: state, parent.
      parents.set(entry, stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1])
      if (readFileSync(`/proc/${entry}/cmdline`, 'utf8').includes(profile))
        roots.push(entry)
    } catch {
      // The process ended between the two reads.
    }
  }
  const inBrowser = (pid) => {
    for (
      let at = pid, steps = 0;
      at && steps < 64;
      at = parents.get(at), steps++
    )
      if (roots.includes(at)) return true
    return false
  }
  let total = 0
  for (const pid of parents.keys()) {
    if (!inBrowser(pid)) continue
    try {
      const rollup = readFileSync(`/proc/${pid}/smaps_rollup`, 'utf8')
      total += Number(/^Pss:\s+(\d+) kB/m.exec(rollup)?.[1] ?? 0) / 1024
    } catch {
      // The process ended.
    }
  }
  return total
}

/** The bytes of every file in the origin private file system of the page. */
const cacheBytes = (page) =>
  page.evaluate(async () => {
    const sizeOf = async (directory) => {
      let bytes = 0
      for await (const entry of directory.values())
        bytes +=
          entry.kind === 'file'
            ? (await entry.getFile()).size
            : await sizeOf(entry)
      return bytes
    }
    return sizeOf(await navigator.storage.getDirectory())
  })

/** Types a search and waits for the card of one file. Returns the milliseconds. */
async function search(page, query, name, timeout = 600000) {
  const field = page.getByPlaceholder('Search your files…')
  await field.fill('')
  const started = Date.now()
  await field.fill(query)
  await expect(page.getByText(name, { exact: true }).first()).toBeVisible({
    timeout,
  })
  return Date.now() - started
}

async function main() {
  const { seedSeconds, withText } = await seed()
  const profile = await mkdtemp(
    path.join(os.tmpdir(), 'flare-measure-library-')
  )
  const context = await chromium.launchPersistentContext(profile, {
    viewport: { width: 1440, height: 900 },
    colorScheme: 'dark',
  })
  let peak = 0
  const sampler = setInterval(() => {
    peak = Math.max(peak, memoryOf(profile))
  }, 500)
  try {
    const page = context.pages()[0] || (await context.newPage())
    // The pages of the first sync: their number and their bytes.
    const sync = { requests: 0, bytes: 0, lastAt: 0 }
    page.on('requestfinished', (request) => {
      if (!request.url().includes('/api/files/sync?since=')) return
      sync.requests++
      sync.lastAt = Date.now()
      void request
        .sizes()
        .then((sizes) => {
          sync.bytes += sizes.responseBodySize
        })
        .catch(() => undefined)
    })
    const signInStarted = Date.now()
    await shared.signIn(page, expect, {
      origin,
      email: `${ACCOUNT.id}@example.test`,
      secret: PASSPHRASE,
    })
    const signInMs = Date.now() - signInStarted
    // The first visit: the cache is empty. The last record of the sync is
    // the last one that the worker opens, so it can be found only when the
    // whole library is in memory.
    // The sign-in ended on the library, and the sync started there. The
    // library shows its newest files at once. The oldest file is the last
    // record of the sync, so a search finds it only when every record is
    // in memory.
    const firstStarted = Date.now()
    await expect(
      page.getByText(nameOf(0), { exact: true }).first()
    ).toBeVisible()
    const firstFilesMs = Date.now() - firstStarted
    await expect(page.getByText(lastName, { exact: true })).toHaveCount(0)
    await search(page, 'zz-last-marker', lastName)
    const firstVisitMs = Date.now() - firstStarted
    const firstSyncNetworkMs = sync.lastAt - firstStarted
    const memoryAfterSync = memoryOf(profile)
    // The worker writes the cache after it has the records in memory.
    let cache = 0
    for (let quiet = 0; quiet < 3;) {
      await page.waitForTimeout(1000)
      const bytes = await cacheBytes(page)
      quiet = bytes === cache && bytes > 0 ? quiet + 1 : 0
      cache = bytes
    }

    // Searches with everything in memory. Each one has one answer, a file
    // that the library does not show before the search: by a number in a
    // name, by a whole name, and by words that are only in image text.
    const named = [Math.floor(FILES * 0.75), Math.floor(FILES * 0.6) + 1]
    // Every fortieth file is an image with text.
    const textFiles = [0.2, 0.4].map(
      (part) => 40 * Math.floor((FILES * part) / 40)
    )
    const targets = [
      [`-${named[0]}.`, nameOf(named[0])],
      [nameOf(named[1]), nameOf(named[1])],
      ...textFiles.map((index) => [`reference ${index} end`, nameOf(index)]),
    ]
    const searches = []
    for (let round = 0; round < 3; round++)
      for (const [query, name] of targets) {
        // Back to the whole library first, which starts with its newest file.
        await page.getByPlaceholder('Search your files…').fill('')
        await expect(
          page.getByText(nameOf(0), { exact: true }).first()
        ).toBeVisible()
        await expect(page.getByText(name, { exact: true })).toHaveCount(0)
        const started = Date.now()
        await page.getByPlaceholder('Search your files…').fill(query)
        await expect(
          page.getByText(name, { exact: true }).first()
        ).toBeVisible()
        searches.push(Date.now() - started)
      }

    // A second visit: the records come from the cache on the disk.
    const secondStarted = Date.now()
    const syncBefore = sync.requests
    // A reload would keep the last search, which is in the address.
    await page.goto(`${origin}/dashboard`)
    await expect(
      page.getByText(nameOf(0), { exact: true }).first()
    ).toBeVisible()
    await expect(page.getByText(lastName, { exact: true })).toHaveCount(0)
    await search(page, 'zz-last-marker', lastName)
    const secondVisitMs = Date.now() - secondStarted

    peak = Math.max(peak, memoryOf(profile))
    const sorted = [...searches].sort((a, b) => a - b)
    const results = {
      files: FILES,
      filesWithImageText: withText,
      seedSeconds,
      signInMs,
      firstFilesMs,
      firstSyncNetworkMs,
      firstVisitMs,
      firstSyncRequests: syncBefore,
      firstSyncMegabytes: sync.bytes / 1048576,
      cacheMegabytes: cache / 1048576,
      searchMedianMs: sorted[Math.floor(sorted.length / 2)],
      searchSlowestMs: sorted[sorted.length - 1],
      searches,
      secondVisitMs,
      secondVisitSyncRequests: sync.requests - syncBefore,
      memoryAfterSyncMegabytes: memoryAfterSync,
      peakMemoryMegabytes: peak,
      processor: os.cpus()[0].model,
      cores: os.cpus().length,
    }
    console.log(JSON.stringify(results, null, 2))
    if (process.env.FLARE_E2EE_MEASURE_RESULTS)
      writeFileSync(
        process.env.FLARE_E2EE_MEASURE_RESULTS,
        `${JSON.stringify(results, null, 2)}\n`
      )
  } finally {
    clearInterval(sampler)
    await context.close()
    await rm(profile, { recursive: true, force: true })
    await prisma.$disconnect()
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
