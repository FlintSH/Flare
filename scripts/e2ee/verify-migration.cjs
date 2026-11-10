/* eslint-disable @typescript-eslint/no-require-imports */
// Real browser checks of the migration of an existing account
// (docs/e2ee-spec.md, section 14) against a production build and a
// disposable database: an account as it was before the upgrade signs in with
// its password, sets up keys, is asked one time which existing files the
// server encrypts, takes the default, and later encrypts everything.
//
// Setup, with the application built (`pnpm build`) and PostgreSQL running.
// Start the application in the directory of this checkout: the seed writes
// the plain files where its local storage reads them.
//
//   export DATABASE_URL='postgresql://flare_test@127.0.0.1:5432/flare_e2ee_migration_local'
//   pnpm exec prisma migrate deploy
//   NEXTAUTH_URL='http://localhost:3097' NEXTAUTH_SECRET=... \
//     pnpm exec next start -H 127.0.0.1 -p 3097 > /tmp/flare-migration.log 2>&1 &
//   FLARE_E2EE_MIGRATION_LOG=/tmp/flare-migration.log node scripts/e2ee/verify-migration.cjs
//
// Options: FLARE_E2EE_MIGRATION_ORIGIN (default http://localhost:3097),
// FLARE_E2EE_SCREENSHOTS (a directory), FLARE_E2EE_VIEWPORT=mobile,
// FLARE_E2EE_THEME=light.
const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const { randomUUID } = require('node:crypto')
const { existsSync } = require('node:fs')
const { mkdir, readFile, writeFile } = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const zlib = require('node:zlib')
const {
  chromium,
  expect: baseExpect,
} = require('../../docs/site/node_modules/@playwright/test')
const { PrismaClient } = require('@prisma/client')
const { hashSync } = require('bcryptjs')
const { blake3 } = require('@noble/hashes/blake3.js')
const { sha512 } = require('@noble/hashes/sha2.js')
const { x25519 } = require('@noble/curves/ed25519.js')
const { xchacha20 } = require('@noble/ciphers/chacha.js')
const shared = require('../shared/passphrase-accounts.cjs')
const expect = baseExpect.configure({ timeout: 45000 })

const origin =
  process.env.FLARE_E2EE_MIGRATION_ORIGIN || 'http://localhost:3097'
if (new URL(origin).hostname !== 'localhost')
  throw new Error('Use a disposable localhost instance, matching NEXTAUTH_URL.')
const database = new URL(process.env.DATABASE_URL || 'postgresql://unset/')
if (
  !['localhost', '127.0.0.1'].includes(database.hostname) ||
  database.pathname !== '/flare_e2ee_migration_local'
)
  throw new Error(
    'This check needs a local PostgreSQL database named exactly flare_e2ee_migration_local.'
  )
const screenshots = process.env.FLARE_E2EE_SCREENSHOTS
const appLog = process.env.FLARE_E2EE_MIGRATION_LOG
const mobile = process.env.FLARE_E2EE_VIEWPORT === 'mobile'
const theme = process.env.FLARE_E2EE_THEME === 'light' ? 'light' : 'dark'
const prisma = new PrismaClient()
const results = []
const pageProblems = []
/** Every request and every answer of the browser, in order. */
const traffic = []

// Demonstration secrets. They are public and only for disposable fixtures.
const PASSWORD = 'copper lantern walrus opera 58'
const FILE_PASSWORD = 'harbor violet canyon pepper 41'
const ROBIN = {
  id: 'e2ee-migration-robin',
  name: 'Robin Vale',
  urlId: 'robinm',
  email: 'e2ee-migration-robin@example.test',
}
const FOLDER = 'Receipts 2025'
const TAG = 'Finance'
const OCR_WORDS = 'OVERDUE INVOICE 7741'
const NAMES = {
  notes: 'private-notes.txt',
  receipt: 'holiday-receipt.png',
  clip: 'beach-clip.webm',
  paste: 'paste-snippet.txt',
  poster: 'public-poster.png',
  plan: 'protected-plan.pdf',
}

// ---------------------------------------------------------------- fixtures

function pngChunk(type, data) {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(zlib.crc32(body) >>> 0)
  return Buffer.concat([length, body, crc])
}

/** A real PNG with a gradient. `seed` makes each one different. */
function pngFixture(seed, width = 960, height = 540) {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header.set([8, 2, 0, 0, 0], 8)
  const rows = Buffer.alloc(height * (1 + width * 3))
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const offset = y * (1 + width * 3) + 1 + x * 3
      rows[offset] = (40 + x / 4 + seed * 37) % 256
      rows[offset + 1] = (60 + y / 2 + seed * 11) % 256
      rows[offset + 2] = (200 - x / 5 + seed * 53) % 256
    }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', zlib.deflateSync(rows)),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

/** A one-second VP8 video, if an ffmpeg with libvpx is available. */
function videoFixture() {
  const candidates = [
    process.env.FLARE_FFMPEG,
    path.join(
      os.homedir(),
      '.local/share/film-deps/ffmpeg/ffmpeg-n8.1-latest-linux64-gpl-8.1/bin/ffmpeg'
    ),
    'ffmpeg',
  ].filter(Boolean)
  for (const ffmpeg of candidates)
    try {
      const out = path.join(os.tmpdir(), `flare-migration-${process.pid}.webm`)
      execFileSync(
        ffmpeg,
        ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i'].concat([
          'testsrc=size=320x180:rate=12',
          '-t',
          '1',
          '-c:v',
          'libvpx',
          out,
        ])
      )
      return require('node:fs').readFileSync(out)
    } catch {
      // The next candidate.
    }
  // Bytes with the stored type of a video. The job does not read the type.
  return Buffer.from('not a real video, only bytes with a video type')
}

// ---------------------------------------------------------------- crypto
// Independent code that reads the records with the account private key, so
// the check knows each `file_key` that the server made.

const deriveKey = (context, material) =>
  blake3(material, { context: new Uint8Array(Buffer.from(context, 'ascii')) })

function exchangeKeyOf(accountPrivateKeyHex) {
  const key = sha512(Buffer.from(accountPrivateKeyHex, 'hex')).slice(0, 32)
  key[0] &= 248
  key[31] &= 127
  key[31] |= 64
  return key
}

/** `file_key` of a stored file, from the account private key and the account stanza. */
function fileKeyOf(file, accountPrivateKeyHex) {
  const exchangePrivateKey = exchangeKeyOf(accountPrivateKeyHex)
  const stanza = Buffer.from(file.accountStanza).subarray(1)
  const ephemeralPublicKey = stanza.subarray(0, 32)
  const stanzaKey = deriveKey(
    'flare e2ee v1 account stanza',
    Buffer.concat([
      x25519.getSharedSecret(exchangePrivateKey, ephemeralPublicKey),
      ephemeralPublicKey,
      x25519.getPublicKey(exchangePrivateKey),
    ])
  )
  const nonce = deriveKey('flare e2ee v1 one-time nonce', stanzaKey).slice(
    0,
    24
  )
  return Buffer.from(
    xchacha20(
      deriveKey('flare e2ee v1 seal cipher', stanzaKey),
      nonce,
      stanza.subarray(32, 64)
    )
  )
}

/** The name and the type in `sealed_metadata`. The tag is not checked: this only reads. */
function metadataOf(file, fileKey) {
  const box = Buffer.from(file.sealedMetadata).subarray(1)
  return JSON.parse(
    Buffer.from(
      xchacha20(
        deriveKey(
          'flare e2ee v1 seal cipher',
          deriveKey('flare e2ee v1 file metadata', fileKey)
        ),
        box.subarray(0, 24),
        box.subarray(24, -32)
      )
    ).toString('utf8')
  )
}

const byteForms = (bytes) => {
  const buffer = Buffer.from(bytes)
  return [
    buffer.toString('hex'),
    buffer.toString('base64url'),
    buffer.toString('base64'),
    buffer.toString('base64').replace(/=+$/, ''),
  ]
}

// ---------------------------------------------------------------- browser

async function context(browser, { record = true } = {}) {
  const ctx = await browser.newContext({
    baseURL: origin,
    viewport: mobile
      ? { width: 390, height: 844 }
      : { width: 1440, height: 900 },
    colorScheme: theme,
    reducedMotion: 'reduce',
    permissions: ['clipboard-read', 'clipboard-write'],
  })
  if (record)
    ctx.on('response', (response) => {
      const request = response.request()
      const url = request.url()
      if (!url.startsWith(origin)) return
      const entry = {
        at: Date.now(),
        url,
        sent: request.postData() ?? '',
        answer: '',
      }
      traffic.push(entry)
      const type = response.headers()['content-type'] ?? ''
      if (/json|text|javascript|x-component/.test(type))
        response
          .text()
          .then((text) => {
            entry.answer = text
          })
          .catch(() => undefined)
    })
  await ctx.addInitScript((mode) => {
    try {
      localStorage.setItem('theme', mode)
    } catch {}
  }, theme)
  const page = await ctx.newPage()
  page.setDefaultTimeout(45000)
  page.on('pageerror', (error) =>
    pageProblems.push(`${page.url()}: page error: ${error.message}`)
  )
  page.on('console', (message) => {
    if (message.type() !== 'error') return
    const text = message.text()
    // A request that the server refused on purpose logs a resource error.
    if (/Failed to load resource/.test(text)) return
    pageProblems.push(`${page.url()}: console error: ${text}`)
  })
  return { ctx, page }
}

async function shot(page, name) {
  if (!screenshots) return
  await mkdir(screenshots, { recursive: true })
  await page.waitForTimeout(350)
  await page.screenshot({
    path: path.join(
      screenshots,
      `${name}-${mobile ? 'mobile' : 'desktop'}-${theme}.png`
    ),
  })
}

const card = (page, name) =>
  page
    .locator('div.group, [class*="group"]')
    .filter({
      has: page.getByRole('link', { name: `Open ${name}`, exact: true }),
    })
    .first()

async function until(what, read, { timeout = 150000 } = {}) {
  const deadline = Date.now() + timeout
  for (;;) {
    const value = await read()
    if (value) return value
    assert.ok(Date.now() < deadline, `Timed out: ${what}`)
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }
}

async function check(name, run) {
  const started = Date.now()
  await run()
  results.push(`${name} (${Date.now() - started} ms)`)
  console.log(`ok - ${name}`)
}

// ---------------------------------------------------------------- seed

const rows = () =>
  prisma.file.findMany({
    where: { userId: ROBIN.id },
    include: { sealedData: true, tags: true },
  })
const rowOf = (id) =>
  prisma.file.findUniqueOrThrow({
    where: { id },
    include: { sealedData: true, tags: true },
  })
const stored = (file) => path.join(process.cwd(), file.path)

/** The account as it was before the upgrade: a password, plain names, plain files. */
async function seed() {
  // The first page load creates the configuration.
  await fetch(`${origin}/auth/login`)
  const config = await prisma.config.findUnique({
    where: { key: 'flare_config' },
  })
  assert.ok(config, 'The application did not create its configuration')
  config.value.settings.general.setup = {
    completed: true,
    completedAt: new Date().toISOString(),
  }
  config.value.settings.general.ocr = { enabled: true }
  config.value.settings.general.oidc = { enabled: false }
  config.value.settings.advanced = { customCSS: '', customHead: '' }
  await prisma.config.update({
    where: { key: 'flare_config' },
    data: { value: config.value },
  })
  await prisma.user.deleteMany({ where: { id: ROBIN.id } })
  await prisma.fileEncryptionJob.deleteMany({ where: { userId: ROBIN.id } })
  await prisma.storageDeletion.deleteMany({ where: { ownerId: ROBIN.id } })
  await prisma.authRateLimit.deleteMany()
  await prisma.user.create({
    data: {
      id: ROBIN.id,
      name: ROBIN.name,
      email: ROBIN.email,
      emailVerified: new Date(),
      emailVerifiedFor: ROBIN.email,
      emailVerificationSource: 'email',
      password: hashSync(PASSWORD, 10),
      roles: { connect: { systemKey: 'administrator' } },
      urlId: ROBIN.urlId,
    },
  })
  const folder = await prisma.vaultFolder.create({
    data: {
      userId: ROBIN.id,
      name: FOLDER,
      normalizedName: FOLDER.toLowerCase(),
    },
  })
  const tag = await prisma.vaultTag.create({
    data: { userId: ROBIN.id, name: TAG, normalizedName: TAG.toLowerCase() },
  })
  const files = {}
  let used = 0
  const plain = async (key, content, mimeType, data = {}) => {
    const name = NAMES[key]
    const filePath = `uploads/${ROBIN.urlId}/${randomUUID()}/${name}`
    await mkdir(path.dirname(path.join(process.cwd(), filePath)), {
      recursive: true,
    })
    await writeFile(path.join(process.cwd(), filePath), content)
    const size = content.length / (1024 * 1024)
    used += size
    files[key] = {
      ...(await prisma.file.create({
        data: {
          userId: ROBIN.id,
          name,
          urlPath: `/${ROBIN.urlId}/${name}`,
          path: filePath,
          storageTarget: { provider: 'local' },
          mimeType,
          size,
          visibility: 'PRIVATE',
          uploadedAt: new Date('2025-06-01T09:00:00Z'),
          ...data,
        },
      })),
      content,
    }
  }
  await plain('notes', Buffer.from('dentist on the 14th\n'), 'text/plain', {
    folderId: folder.id,
    tags: { create: { tagId: tag.id } },
  })
  await plain('receipt', pngFixture(1), 'image/png', {
    ocrText: OCR_WORDS,
    ocrConfidence: 93,
    isOcrProcessed: true,
  })
  await plain('clip', videoFixture(), 'video/webm')
  await plain('paste', Buffer.from('SELECT 1;\n'), 'text/plain', {
    isPaste: true,
  })
  await plain('poster', pngFixture(2), 'image/png', {
    visibility: 'PUBLIC',
    isOcrProcessed: true,
    ocrText: '',
    views: 12,
  })
  await plain('plan', Buffer.from('%PDF-1.4\n% plan\n'), 'application/pdf', {
    visibility: 'PUBLIC',
    password: hashSync(FILE_PASSWORD, 10),
  })
  await prisma.user.update({
    where: { id: ROBIN.id },
    data: { storageUsed: used },
  })
  return { files, folder, tag }
}

// ---------------------------------------------------------------- checks

/** An encrypted row with nothing plain in the database or in storage. */
async function assertEncrypted(before, accountPrivateKey) {
  const file = await rowOf(before.id)
  assert.equal(file.encrypted, true, `${before.name} is not encrypted`)
  assert.equal(file.name, '')
  assert.equal(file.mimeType, 'application/octet-stream')
  assert.equal(file.ocrText, null)
  assert.match(
    file.urlPath,
    new RegExp(`^/${ROBIN.urlId}/e_[A-Za-z0-9_-]{22}$`)
  )
  assert.ok(!file.path.includes(before.name), 'The storage path has the name')
  const ciphertext = await readFile(stored(file))
  assert.equal(ciphertext.subarray(0, 8).toString('latin1'), 'FLAREE2E')
  assert.ok(
    !ciphertext.includes(before.content.subarray(0, 16)) ||
      before.content.length < 16,
    'The stored object contains plaintext'
  )
  assert.ok(!existsSync(stored(before)), 'The plaintext object is still stored')
  const fileKey = fileKeyOf(file, accountPrivateKey)
  assert.deepEqual(metadataOf(file, fileKey), {
    name: before.name,
    type: before.mimeType,
  })
  // What stays.
  assert.equal(file.uploadedAt.toISOString(), before.uploadedAt.toISOString())
  // The counters stay. A view of the old link by this check counts.
  assert.ok(file.views >= before.views, 'The view count was reset')
  assert.equal(file.folderId, before.folderId)
  return { file, fileKey }
}

async function main() {
  const seeded = await seed()
  const { files } = seeded
  const browser = await chromium.launch()
  const fileKeys = []
  let accountPrivateKey
  let robin
  let allEncryptedAt = Infinity
  try {
    robin = await context(browser)
    const { page } = robin

    await check(
      'an account from before the upgrade signs in with its password and sets up keys',
      async () => {
        const method = await shared.submitSignIn(page, expect, {
          origin,
          email: ROBIN.email,
          secret: PASSWORD,
        })
        assert.equal(method, 'password')
        const { mnemonic } = await shared.completeKeySetup(page, expect, {
          password: PASSWORD,
        })
        await page.waitForURL(/\/dashboard/, { timeout: 90000 })
        accountPrivateKey = shared.keysOfMnemonic(mnemonic).accountPrivateKey
        const user = await prisma.user.findUniqueOrThrow({
          where: { id: ROBIN.id },
        })
        assert.equal(user.password, null, 'The password hash was not deleted')
        assert.ok(user.accountPublicKey)
        assert.equal(user.existingFilesChoice, null)
      }
    )

    await check('the old password no longer signs in the old way', async () => {
      const other = await context(browser, { record: false })
      try {
        const method = await shared.submitSignIn(other.page, expect, {
          origin,
          email: ROBIN.email,
          secret: PASSWORD,
        })
        // The account has keys: the form asks for the passphrase, and the
        // server has no password hash to check.
        assert.equal(method, 'passphrase')
      } finally {
        await other.ctx.close()
      }
    })

    await check(
      'the prompt appears one time, with the table of consequences and the default',
      async () => {
        const prompt = page.locator('[data-existing-files-prompt]')
        await expect(prompt).toBeVisible()
        await expect(prompt).toContainText('6 files from before encryption')
        await shot(page, 'migration-prompt')
        await prompt
          .getByRole('button', { name: 'Choose', exact: true })
          .click()
        const dialog = page.locator('[data-existing-files-dialog]')
        await expect(dialog).toBeVisible()
        const table = dialog.locator('[data-existing-files-table]')
        await expect(table.getByRole('row', { name: /Private/ })).toContainText(
          '4 files'
        )
        await expect(table.getByRole('row', { name: /Public/ })).toContainText(
          '1 file'
        )
        await expect(
          table.getByRole('row', { name: /With a password/ })
        ).toContainText('1 file')
        await expect(table).toContainText('The link you shared stops working')
        await expect(table).toContainText('The password cannot be kept')
        await expect(
          dialog.getByRole('radio', { name: /Private files/ })
        ).toBeChecked()
        await expect(dialog).toContainText(
          'backups from before may still contain'
        )
        await shot(page, 'migration-choice')
        const confirm = dialog.locator('[data-existing-files-confirm]')
        await expect(confirm).toHaveText('Encrypt 4 files')
        await confirm.click()
        await expect(dialog).toHaveCount(0)
        await expect(prompt).toHaveCount(0)
      }
    )

    await check(
      'the progress is shown and the private files finish',
      async () => {
        const progress = page.locator('[data-existing-files-progress]')
        await progress
          .waitFor({ state: 'visible', timeout: 10000 })
          .then(() => shot(page, 'migration-progress'))
          .catch(() => undefined)
        await until('the private files are encrypted', async () => {
          const all = await rows()
          return (
            all.filter((file) => file.encrypted).length === 4 &&
            (await prisma.fileEncryptionJob.count({
              where: { userId: ROBIN.id, status: { not: 'done' } },
            })) === 0
          )
        })
        await expect(progress).toHaveCount(0, { timeout: 20000 })
        const user = await prisma.user.findUniqueOrThrow({
          where: { id: ROBIN.id },
        })
        assert.equal(user.existingFilesChoice, 'private')
      }
    )

    await check(
      'the private files are ciphertext in storage and nameless in the database',
      async () => {
        for (const key of ['notes', 'receipt', 'clip', 'paste']) {
          const { fileKey } = await assertEncrypted(
            files[key],
            accountPrivateKey
          )
          fileKeys.push(fileKey)
        }
        const notes = await rowOf(files.notes.id)
        assert.equal(notes.tags.length, 1, 'The tag of the file is gone')
        assert.equal(notes.visibility, 'PRIVATE')
        const receipt = await rowOf(files.receipt.id)
        assert.ok(receipt.sealedData?.sealedThumbnail, 'No sealed thumbnail')
        assert.ok(receipt.sealedData?.sealedOcrText, 'No sealed image text')
        assert.equal(receipt.thumbnailPending, false)
        await until(
          'the queued deletions are done',
          async () =>
            (await prisma.storageDeletion.count({
              where: { ownerId: ROBIN.id },
            })) === 0
        )
        const dump = JSON.stringify(
          await prisma.file.findMany({
            where: { userId: ROBIN.id, encrypted: true },
          })
        )
        for (const key of ['notes', 'receipt', 'clip', 'paste'])
          assert.ok(!dump.includes(NAMES[key]), `A row holds ${NAMES[key]}`)
        assert.ok(!dump.includes('OVERDUE'), 'A row holds the image text')
      }
    )

    await check(
      'the library shows names, thumbnails, tags and folders, and search finds the image text',
      async () => {
        await page.goto(`${origin}/dashboard`)
        for (const key of ['notes', 'receipt', 'clip'])
          await expect(card(page, NAMES[key])).toBeVisible()
        // The thumbnail that the server sealed during the job.
        await expect(
          card(page, NAMES.receipt).locator('img[src^="blob:"]')
        ).toBeVisible()
        await expect(card(page, NAMES.notes)).toContainText(FOLDER)
        await expect(card(page, NAMES.notes)).toContainText(TAG)
        await shot(page, 'migration-library-default')
        const search = page.getByLabel('Search files by name')
        await search.fill('OVERDUE')
        await expect(card(page, NAMES.receipt)).toBeVisible()
        await expect(card(page, NAMES.notes)).toHaveCount(0)
        await search.fill('')
        await expect(card(page, NAMES.notes)).toBeVisible()
      }
    )

    await check(
      'the public file and the password file are still plain and the old link works',
      async () => {
        for (const key of ['poster', 'plan']) {
          const file = await rowOf(files[key].id)
          assert.equal(file.encrypted, false)
          assert.equal(file.name, NAMES[key])
          assert.equal(file.urlPath, files[key].urlPath)
          assert.ok(existsSync(stored(file)))
        }
        const raw = await fetch(`${origin}${files.poster.urlPath}/raw`)
        assert.equal(raw.status, 200)
        assert.ok(
          Buffer.from(await raw.arrayBuffer()).equals(files.poster.content),
          'The old link does not give the file'
        )
        const locked = await fetch(`${origin}${files.plan.urlPath}/raw`)
        assert.notEqual(
          locked.status,
          200,
          'The password file opened without it'
        )
      }
    )

    await check(
      'the same choice is in the profile, and "All files" encrypts the rest',
      async () => {
        await page.goto(`${origin}/dashboard/profile?section=data`)
        const settings = page.locator('[data-existing-files-settings]')
        await expect(settings).toBeVisible()
        await expect(settings).toContainText('2 files are stored readable')
        await expect(settings).toContainText(
          'You chose to encrypt private files'
        )
        await settings.scrollIntoViewIfNeeded()
        await shot(page, 'migration-settings')
        await settings
          .getByRole('button', { name: 'Change what is encrypted' })
          .click()
        const dialog = page.locator('[data-existing-files-dialog]')
        await dialog.getByRole('radio', { name: /All files/ }).check()
        await expect(dialog).toContainText(
          '1 file gets a new link and 1 file needs a new password'
        )
        await shot(page, 'migration-choice-all')
        const confirm = dialog.locator('[data-existing-files-confirm]')
        await expect(confirm).toHaveText('Encrypt 2 files')
        await confirm.click()
        await until('every file is encrypted', async () =>
          (await rows()).every((file) => file.encrypted)
        )
        allEncryptedAt = Date.now()
        for (const key of ['poster', 'plan']) {
          const { fileKey } = await assertEncrypted(
            files[key],
            accountPrivateKey
          )
          fileKeys.push(fileKey)
        }
        await expect(settings).toContainText(
          'Every file in your library is encrypted',
          { timeout: 20000 }
        )
      }
    )

    await check(
      'the old public link stops and a new link from the library opens signed out',
      async () => {
        for (const suffix of ['', '/raw']) {
          const old = await fetch(`${origin}${files.poster.urlPath}${suffix}`, {
            redirect: 'manual',
          })
          assert.equal(old.status, 404, `The old link answers ${old.status}`)
        }
        const poster = await rowOf(files.poster.id)
        assert.equal(poster.visibility, 'PUBLIC')
        assert.equal(poster.passwordPendingFrom, null)
        await page.goto(`${origin}/dashboard`)
        const posterCard = card(page, NAMES.poster)
        await expect(posterCard).toBeVisible()
        await posterCard
          .getByRole('button', { name: `Manage ${NAMES.poster}` })
          .click()
        await page.getByRole('menuitem', { name: 'Copy link' }).click()
        const link = await until('the link is on the clipboard', async () => {
          const text = await page.evaluate(() => navigator.clipboard.readText())
          return text.includes('/e_') && text.includes('#') ? text : null
        })
        assert.ok(link.startsWith(`${origin}${poster.urlPath}#`))
        const visitor = await context(browser, { record: false })
        try {
          await visitor.page.goto(link)
          await expect(
            visitor.page.getByText(NAMES.poster).first()
          ).toBeVisible()
          await shot(visitor.page, 'migration-new-link')
        } finally {
          await visitor.ctx.close()
        }
      }
    )

    await check(
      'the password file is private without a password until its owner sets one again',
      async () => {
        const plan = await rowOf(files.plan.id)
        assert.equal(plan.visibility, 'PRIVATE')
        assert.equal(plan.password, null)
        assert.equal(plan.passwordStanza, null)
        assert.equal(plan.passwordPendingFrom, 'PUBLIC')
        for (const address of [files.plan.urlPath, plan.urlPath]) {
          const anonymous = await fetch(`${origin}${address}/raw`, {
            redirect: 'manual',
          })
          assert.notEqual(anonymous.status, 200, `${address} is open`)
        }
        const planCard = card(page, NAMES.plan)
        await expect(planCard).toContainText('Password removed')
        await shot(page, 'migration-library-all')
        await planCard
          .getByRole('button', { name: `Manage ${NAMES.plan}` })
          .click()
        await page.getByRole('menuitem', { name: 'Add password' }).click()
        const dialog = page.getByRole('dialog')
        await dialog.getByPlaceholder('Enter a password').fill(FILE_PASSWORD)
        const save = dialog.locator('button[type="submit"]')
        await expect(save).toBeEnabled()
        await save.click()
        await until('the password stanza is stored', async () => {
          const row = await rowOf(files.plan.id)
          return row.passwordStanza !== null
        })
        const again = await rowOf(files.plan.id)
        assert.equal(
          again.visibility,
          'PUBLIC',
          'The visibility was not restored'
        )
        assert.equal(again.passwordPendingFrom, null)
        assert.equal(again.password, null)
      }
    )

    await check(
      'a plain file is encrypted from its menu, and several from the selection bar',
      async () => {
        // Plain files that arrive later, as an old tool configuration sends them.
        const late = {}
        for (const [key, name, visibility] of [
          ['late', 'late-upload.txt', 'PUBLIC'],
          ['bulk', 'late-bulk.txt', 'PRIVATE'],
        ]) {
          const filePath = `uploads/${ROBIN.urlId}/${randomUUID()}/${name}`
          await mkdir(path.dirname(path.join(process.cwd(), filePath)), {
            recursive: true,
          })
          const content = Buffer.from(`from an old tool: ${key}\n`)
          await writeFile(path.join(process.cwd(), filePath), content)
          late[key] = {
            ...(await prisma.file.create({
              data: {
                userId: ROBIN.id,
                name,
                urlPath: `/${ROBIN.urlId}/${name}`,
                path: filePath,
                storageTarget: { provider: 'local' },
                mimeType: 'text/plain',
                size: content.length / 1048576,
                visibility,
              },
            })),
            content,
          }
          NAMES[key] = name
        }
        allEncryptedAt = Infinity
        await page.goto(`${origin}/dashboard`)
        const lateCard = card(page, NAMES.late)
        await expect(lateCard).toBeVisible()
        await lateCard
          .getByRole('button', { name: `Manage ${NAMES.late}` })
          .click()
        await expect(
          page.getByRole('menuitem', { name: 'Encrypt', exact: true })
        ).toBeVisible()
        await shot(page, 'migration-file-menu')
        await page
          .getByRole('menuitem', { name: 'Encrypt', exact: true })
          .click()
        const dialog = page.locator('[data-encrypt-files-dialog]')
        await expect(dialog).toContainText('Its link changes')
        await shot(page, 'migration-encrypt-one')
        await dialog.locator('[data-encrypt-files-confirm]').click()
        await until(
          'the late file is encrypted',
          async () => (await rowOf(late.late.id)).encrypted
        )
        // The library shows it as an encrypted file without a reload by hand.
        await expect(
          card(page, NAMES.late).locator('[data-file-encryption="encrypted"]')
        ).toBeVisible({ timeout: 30000 })
        // An encrypted file has no such action.
        await card(page, NAMES.late)
          .getByRole('button', { name: `Manage ${NAMES.late}` })
          .click()
        await expect(
          page.getByRole('menuitem', { name: 'Copy link' })
        ).toBeVisible()
        await expect(
          page.getByRole('menuitem', { name: 'Encrypt', exact: true })
        ).toHaveCount(0)
        await page.keyboard.press('Escape')

        // The selection bar.
        await page.getByRole('button', { name: 'Select files' }).click()
        await page.getByLabel(`Select ${NAMES.bulk}`, { exact: true }).check()
        await page.getByLabel(`Select ${NAMES.late}`, { exact: true }).check()
        await shot(page, 'migration-bulk')
        await page.getByRole('button', { name: 'Encrypt', exact: true }).click()
        // Only the plain file of the two is counted.
        await expect(dialog).toContainText('Encrypt this file?')
        await expect(dialog).toContainText('no link breaks')
        await shot(page, 'migration-encrypt-selection')
        await dialog.locator('[data-encrypt-files-confirm]').click()
        await until(
          'the selected file is encrypted',
          async () => (await rowOf(late.bulk.id)).encrypted
        )
        allEncryptedAt = Date.now()
        for (const key of ['late', 'bulk']) {
          const { fileKey } = await assertEncrypted(
            late[key],
            accountPrivateKey
          )
          fileKeys.push(fileKey)
        }
        await page
          .getByRole('button', { name: 'Finish selecting files' })
          .click()
      }
    )

    await check(
      'no file key left the server and no name of an encrypted file is in a later answer or in the log',
      async () => {
        // Traffic after the last file became encrypted.
        await page.goto(`${origin}/dashboard`)
        await expect(card(page, NAMES.notes)).toBeVisible()
        await page.goto(`${origin}/dashboard/profile?section=data`)
        await expect(
          page.locator('[data-existing-files-settings]')
        ).toBeVisible()
        await page.waitForTimeout(2500)
        const keyForms = fileKeys.flatMap(byteForms)
        assert.equal(fileKeys.length, 8)
        let searched = 0
        for (const entry of traffic) {
          const text = `${entry.url}\n${entry.sent}\n${entry.answer}`
          searched++
          for (const form of keyForms)
            assert.ok(
              !text.includes(form),
              `A file key is in the traffic of ${entry.url}`
            )
        }
        const later = traffic.filter((entry) => entry.at > allEncryptedAt + 500)
        assert.ok(
          later.length > 10,
          'No traffic after the encryption to search'
        )
        for (const entry of later)
          for (const name of Object.values(NAMES))
            assert.ok(
              !`${entry.url}\n${entry.answer}`.includes(name),
              `${entry.url} names ${name} after it was encrypted`
            )
        let logNote = 'no application log was given'
        if (appLog) {
          const log = await readFile(appLog, 'utf8')
          for (const name of [...Object.values(NAMES), 'OVERDUE'])
            assert.ok(!log.includes(name), `The application log names ${name}`)
          for (const form of keyForms)
            assert.ok(!log.includes(form), 'The application log has a file key')
          logNote = `${log.length} bytes of application log`
        }
        // The database outside the sealed records.
        const dump = JSON.stringify([
          await prisma.file.findMany({ where: { userId: ROBIN.id } }),
          await prisma.fileEncryptionJob.findMany({
            where: { userId: ROBIN.id },
          }),
          await prisma.event.findMany(),
          await prisma.auditEvent.findMany(),
          await prisma.storageDeletion.findMany(),
        ])
        for (const name of Object.values(NAMES))
          assert.ok(!dump.includes(name), `The database still names ${name}`)
        results.push(
          `searched ${searched} requests and answers for ${fileKeys.length} file keys in ${keyForms.length} forms, ${later.length} later answers for ${Object.keys(NAMES).length} names, and ${logNote}`
        )
      }
    )

    assert.deepEqual(pageProblems, [], 'The pages reported problems')
  } finally {
    await browser.close()
    await prisma.$disconnect()
  }
  console.log(`\n${results.length} results:\n- ${results.join('\n- ')}`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
