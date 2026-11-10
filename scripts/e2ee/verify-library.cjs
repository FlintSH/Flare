/* eslint-disable @typescript-eslint/no-require-imports */
// Real browser checks of the library features of encrypted files
// (docs/e2ee-spec.md, sections 6.9, 8.3, 8.4, 9.4 to 9.8 and 12.1) against a
// production build and a disposable database: folders with keys and shared
// folder links, sealed tags and their rules, thumbnails, text recognition in
// the browser, work that waits for the browser, search with a local cache,
// key rotation with the stanza migration, and a reset.
//
// The browser talks to the application through a small recording proxy that
// this script starts. The proxy keeps every request as it arrived, so the
// search at the end reads what was really sent.
//
// Setup, with the application built (`pnpm build`) and PostgreSQL running:
//
//   export DATABASE_URL='postgresql://flare_test@127.0.0.1:5432/flare_e2ee_library_local'
//   pnpm exec prisma migrate deploy
//   NEXTAUTH_URL='http://localhost:3096' NEXTAUTH_SECRET=... \
//     pnpm exec next start -H 127.0.0.1 -p 3095
//   node scripts/e2ee/verify-library.cjs
//
// The application listens on 3095. The proxy of this script listens on
// 3096, which is the origin the browser uses and `NEXTAUTH_URL` names.
const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const { createHash, randomBytes } = require('node:crypto')
const { mkdir, readFile } = require('node:fs/promises')
const http = require('node:http')
const os = require('node:os')
const path = require('node:path')
const zlib = require('node:zlib')
const {
  chromium,
  expect: baseExpect,
} = require('../../docs/site/node_modules/@playwright/test')
const { PrismaClient } = require('@prisma/client')
const { blake3 } = require('@noble/hashes/blake3.js')
const { sha512 } = require('@noble/hashes/sha2.js')
const { x25519 } = require('@noble/curves/ed25519.js')
const { xchacha20 } = require('@noble/ciphers/chacha.js')
const shared = require('../shared/passphrase-accounts.cjs')
const expect = baseExpect.configure({ timeout: 45000 })

const origin = process.env.FLARE_E2EE_LIBRARY_ORIGIN || 'http://localhost:3096'
const upstream =
  process.env.FLARE_E2EE_LIBRARY_UPSTREAM || 'http://127.0.0.1:3095'
if (new URL(origin).hostname !== 'localhost')
  throw new Error('Use a disposable localhost instance, matching NEXTAUTH_URL.')
const database = new URL(process.env.DATABASE_URL || 'postgresql://unset/')
if (
  !['localhost', '127.0.0.1'].includes(database.hostname) ||
  database.pathname !== '/flare_e2ee_library_local'
)
  throw new Error(
    'This check needs a local PostgreSQL database named exactly flare_e2ee_library_local.'
  )
const screenshots = process.env.FLARE_E2EE_SCREENSHOTS
const mobile = process.env.FLARE_E2EE_VIEWPORT === 'mobile'
const theme = process.env.FLARE_E2EE_THEME === 'light' ? 'light' : 'dark'
const prisma = new PrismaClient()
const results = []

// Demonstration secrets. They are public and only for disposable fixtures.
const PASSPHRASE = 'copper lantern walrus opera 58'
const NEXT_PASSPHRASE = 'granite harbor violin meadow 73'
const RESET_PASSPHRASE = 'saffron comet lattice ember 19'
const FILE_PASSWORD = 'harbor violet canyon pepper 41'
const ALEX = { id: 'e2ee-library-alex', name: 'Alex Morgan', urlId: 'alexl' }

// Names and texts that only the browser may read. None may reach the server.
const FOLDERS = {
  top: 'Tax Papers 2026',
  child: 'Receipts March',
  other: 'Travel Plans',
}
const TAGS = {
  name: { name: 'Screenshots', rule: 'screenshot' },
  text: { name: 'Bills', rule: 'OVERDUE' },
}
const OCR_WORDS = 'OVERDUE INVOICE 7741'

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
function pngFixture(seed, width = 640, height = 400) {
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
  for (const ffmpeg of candidates) {
    try {
      const out = path.join(os.tmpdir(), `flare-library-${process.pid}.webm`)
      execFileSync(
        ffmpeg,
        [
          '-y',
          '-loglevel',
          'error',
          '-f',
          'lavfi',
          '-i',
          'testsrc=size=320x180:rate=12',
          '-t',
          '1',
          '-c:v',
          'libvpx',
          '-b:v',
          '200k',
          out,
        ],
        { stdio: 'ignore' }
      )
      return require('node:fs').readFileSync(out)
    } catch {
      // Try the next candidate.
    }
  }
  return null
}

const fixtures = {
  photo: {
    name: 'harbor-sunrise-private.png',
    mimeType: 'image/png',
    buffer: pngFixture(1),
  },
  nested: {
    name: 'receipt-bakery-private.png',
    mimeType: 'image/png',
    buffer: pngFixture(2),
  },
  hidden: {
    name: 'diary-private.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('A private file in a shared folder.\n'),
  },
  locked: {
    name: 'payroll-private.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('Only with the password.\n'),
  },
  shot: {
    name: 'Screenshot 2026-03-01 private.png',
    mimeType: 'image/png',
    buffer: pngFixture(3),
  },
  script: {
    name: 'screenshot-from-tool-private.png',
    mimeType: 'image/png',
    buffer: pngFixture(4),
  },
  notes: {
    name: 'meeting-notes-private.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('Notes of a meeting.\n'),
  },
}
const PLAIN = {
  name: 'harbor-map-public.png',
  mimeType: 'image/png',
  buffer: pngFixture(5),
}
const PLAIN_IN_FOLDER = {
  name: 'receipt-scan-public.png',
  mimeType: 'image/png',
  buffer: pngFixture(6),
}
const video = videoFixture()
if (video)
  fixtures.video = {
    name: 'screen-recording-private.webm',
    mimeType: 'video/webm',
    buffer: video,
  }

// ---------------------------------------------------------------- recording

/** Every request the browser sent, as it arrived. */
const requests = []
/** Every request of a browser page to an address that is not this instance. */
const external = []

function startRecordingProxy() {
  const target = new URL(upstream)
  const listen = new URL(origin)
  const server = http.createServer((request, response) => {
    const chunks = []
    request.on('data', (chunk) => chunks.push(chunk))
    request.on('end', () => {
      const body = Buffer.concat(chunks)
      requests.push({
        method: request.method,
        target: request.url,
        headers: JSON.stringify(request.rawHeaders),
        body: body.toString('latin1'),
      })
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
          answer.pipe(response)
        }
      )
      forward.on('error', () => {
        response.statusCode = 502
        response.end()
      })
      forward.end(body)
    })
  })
  return new Promise((resolve) =>
    server.listen(Number(listen.port), '127.0.0.1', () => resolve(server))
  )
}

// ---------------------------------------------------------------- crypto
// Independent code for the records, so the search knows every key and every
// name the browser made without asking the application for it.

const deriveKey = (context, material) =>
  blake3(material, { context: new Uint8Array(Buffer.from(context, 'ascii')) })

/** The plaintext of `nonce || ciphertext || tag`. The tag is not checked: this only reads. */
function openSeal(key, sealed) {
  const box = Buffer.from(sealed)
  return Buffer.from(
    xchacha20(
      deriveKey('flare e2ee v1 seal cipher', key),
      box.subarray(0, 24),
      box.subarray(24, -32)
    )
  )
}

function exchangeKeyOf(accountPrivateKeyHex) {
  const key = sha512(Buffer.from(accountPrivateKeyHex, 'hex')).slice(0, 32)
  key[0] &= 248
  key[31] &= 127
  key[31] |= 64
  return key
}

/** `file_key` of a stored file, from an account private key and the account stanza. */
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

const metadataOf = (file, fileKey) =>
  JSON.parse(
    openSeal(
      deriveKey('flare e2ee v1 file metadata', fileKey),
      Buffer.from(file.sealedMetadata).subarray(1)
    ).toString('utf8')
  )

function byteForms(bytes) {
  const buffer = Buffer.from(bytes)
  return [
    buffer.toString('hex'),
    buffer.toString('base64url'),
    buffer.toString('base64'),
    buffer.toString('base64').replace(/=+$/, ''),
    buffer.toString('latin1'),
  ]
}

function textForms(text) {
  const utf8 = Buffer.from(text, 'utf8')
  return [
    text,
    encodeURIComponent(text),
    encodeURIComponent(text).replace(/%20/g, '+'),
    JSON.stringify(text).slice(1, -1),
    utf8.toString('base64'),
    utf8.toString('base64url'),
    utf8.toString('hex'),
  ]
}

function safeDecode(text) {
  try {
    return decodeURIComponent(text)
  } catch {
    return text
  }
}

/** What links of this run carried after `#`, and file passwords typed into a page. */
const fragments = new Set()
const passwords = new Set()
/** Every account private key the account had, hex, newest last. */
const accountKeys = []
/** Folder private keys read from the database during the run, before a change of keys. */
const folderKeys = new Map()

/** Reads every folder key and name that exists now, with independent code. */
async function recordFolderKeys() {
  const key = accountKeys[accountKeys.length - 1]
  const owner = deriveKey('flare e2ee v1 folder owner', Buffer.from(key, 'hex'))
  const names = {}
  for (const folder of await prisma.vaultFolder.findMany({
    where: { userId: ALEX.id, folderPublicKey: { not: null } },
  })) {
    const privateKey = openSeal(
      owner,
      Buffer.from(folder.sealedFolderPrivateKey).subarray(1)
    )
    assert.ok(
      Buffer.from(x25519.getPublicKey(privateKey)).equals(
        Buffer.from(folder.folderPublicKey)
      ),
      'A sealed folder key does not give the folder public key'
    )
    folderKeys.set(privateKey.toString('hex'), privateKey)
    names[folder.id] = JSON.parse(
      openSeal(
        deriveKey('flare e2ee v1 folder metadata', privateKey),
        Buffer.from(folder.sealedFolderMetadata).subarray(1)
      ).toString('utf8')
    ).name
  }
  return names
}

async function assertNothingSecretWasSent() {
  const forbidden = new Map()
  const add = (label, forms) => {
    for (const form of forms) if (form.length >= 8) forbidden.set(form, label)
  }
  for (const key of accountKeys) {
    add('an account private key', byteForms(Buffer.from(key, 'hex')))
    add('an exchange private key', byteForms(exchangeKeyOf(key)))
    add(
      'a folder owner key',
      byteForms(
        deriveKey('flare e2ee v1 folder owner', Buffer.from(key, 'hex'))
      )
    )
    add(
      'a tag key',
      byteForms(
        deriveKey('flare e2ee v1 tag metadata', Buffer.from(key, 'hex'))
      )
    )
  }
  for (const passphrase of [PASSPHRASE, NEXT_PASSPHRASE, RESET_PASSPHRASE])
    add('a passphrase', textForms(passphrase))
  for (const password of passwords) add('a file password', textForms(password))
  for (const fragment of fragments) add('a link fragment', [fragment])
  await recordFolderKeys().catch(() => undefined)
  for (const key of folderKeys.values())
    add('a folder private key', byteForms(key))
  for (const name of Object.values(FOLDERS))
    add('a folder name', textForms(name))
  for (const tag of Object.values(TAGS)) {
    add('a tag name', textForms(tag.name))
    add('a tag rule', textForms(tag.rule))
  }
  add('text of an encrypted image', textForms(OCR_WORDS))
  for (const fixture of [...Object.values(fixtures), TEXT_IMAGE])
    add('the name of an encrypted file', textForms(fixture.name))
  let fileKeys = 0
  for (const file of everyEncryptedFile.values())
    for (const key of accountKeys) {
      let fileKey
      try {
        fileKey = fileKeyOf(file, key)
        metadataOf(file, fileKey)
      } catch {
        continue
      }
      fileKeys++
      add('a file_key', byteForms(fileKey))
      for (const context of [
        'content cipher',
        'content mac',
        'file metadata',
        'ocr text',
        'thumbnail',
        'link secret copy',
      ])
        add(
          `a key derived from file_key (${context})`,
          byteForms(deriveKey(`flare e2ee v1 ${context}`, fileKey))
        )
      break
    }
  const leaks = []
  for (const request of requests)
    for (const [part, text] of [
      ['request target', request.target],
      ['request target', safeDecode(request.target)],
      ['headers', request.headers],
      ['body', request.body],
    ])
      for (const [value, label] of forbidden)
        if (text.includes(value))
          leaks.push(
            `${request.method} ${request.target.split('?')[0].slice(0, 80)} sent ${label} in its ${part}`
          )
  assert.deepEqual([...new Set(leaks)], [], 'A request carried a secret')
  assert.ok(
    requests.every((request) => !request.target.includes('#')),
    'A request target carried a fragment'
  )
  // The search can fail: the plain upload did send its name.
  const plainSeen = requests.filter((request) =>
    request.body.includes(PLAIN.name)
  ).length
  assert.ok(plainSeen >= 1, 'The search did not see the plain upload')
  results.push(
    `No request carried a secret: the recording proxy kept ${requests.length} requests as they arrived, and none holds, in its request target, headers or body, any of ${forbidden.size} forms of: ${accountKeys.length} account private keys with their exchange, folder owner and tag keys, the passphrases, ${passwords.size} file passwords, ${fragments.size} link fragments, ${folderKeys.size} folder private keys, the file_key of ${fileKeys} encrypted files and six keys derived from each, the names of ${Object.keys(fixtures).length + 1} encrypted files, ${Object.keys(FOLDERS).length} folder names, the names and rule texts of ${Object.keys(TAGS).length} tags, and the text read from an image. No request target has a '#'. The same search found the plain upload's name in ${plainSeen} request, which sends it by design`
  )
}

/** Every encrypted file row the run saw, by ID, also ones deleted later. */
const everyEncryptedFile = new Map()
async function recordFiles() {
  for (const file of await prisma.file.findMany({
    where: { userId: ALEX.id, encrypted: true },
  }))
    everyEncryptedFile.set(
      `${file.id}:${Buffer.from(file.accountStanza).toString('hex').slice(0, 16)}`,
      file
    )
}

// ---------------------------------------------------------------- browser

let address = 10
const pageProblems = []
/** Failures that the background work of a page reported. */
const workFailures = []

async function context(browser) {
  const ctx = await browser.newContext({
    baseURL: origin,
    viewport: mobile
      ? { width: 390, height: 844 }
      : { width: 1440, height: 900 },
    colorScheme: theme,
    reducedMotion: 'reduce',
    acceptDownloads: true,
    permissions: ['clipboard-read', 'clipboard-write'],
    extraHTTPHeaders: { 'X-Forwarded-For': `198.51.100.${address++}` },
  })
  // Every request of a page or of one of its workers. Only this instance
  // may be asked: text recognition must load nothing from another site.
  ctx.on('request', (request) => {
    const url = new URL(request.url())
    if (['blob:', 'data:'].includes(url.protocol)) return
    if (url.origin !== origin) external.push(request.url())
  })
  await ctx.addInitScript((theme) => {
    try {
      localStorage.setItem('theme', theme)
    } catch {}
    window.__cspViolations = []
    document.addEventListener('securitypolicyviolation', (event) => {
      window.__cspViolations.push(
        `${event.violatedDirective} ${event.blockedURI} ${event.sourceFile || ''}`
      )
    })
    const install = () => {
      if (!document.documentElement) return false
      const style = document.createElement('style')
      style.textContent = 'nextjs-portal { display: none !important; }'
      document.documentElement.appendChild(style)
      return true
    }
    if (!install()) {
      const observer = new MutationObserver(() => {
        if (install()) observer.disconnect()
      })
      observer.observe(document, { childList: true, subtree: true })
    }
  }, theme)
  const page = await ctx.newPage()
  page.setDefaultTimeout(45000)
  watchPage(page)
  return { ctx, page }
}

function watchPage(page) {
  page.on('pageerror', (error) => {
    pageProblems.push(`${page.url()}: page error: ${error.message}`)
  })
  page.on('console', (message) => {
    if (message.type() === 'warning' && /background work/.test(message.text()))
      workFailures.push(message.text())
    if (message.type() !== 'error') return
    const text = message.text()
    // A request that the server refused on purpose logs a resource error.
    if (/Failed to load resource/.test(text)) return
    pageProblems.push(`${page.url()}: console error: ${text}`)
  })
}

async function shot(page, name) {
  if (!screenshots) return
  await mkdir(screenshots, { recursive: true })
  await page.waitForTimeout(300)
  await page.screenshot({
    path: path.join(
      screenshots,
      `${name}-${mobile ? 'mobile' : 'desktop'}-${theme}.png`
    ),
    fullPage: mobile && !(await page.getByRole('dialog').count()),
  })
}

async function api(ctx, route, method = 'GET', data, expected = 200) {
  const response = await ctx.request.fetch(origin + route, {
    method,
    ...(data === undefined ? {} : { data }),
    headers: { Origin: origin },
  })
  assert.equal(
    response.status(),
    expected,
    `${method} ${route}: ${response.status()} ${await response.text()}`
  )
  return response.json().catch(() => null)
}

const clipboard = (page) => page.evaluate(() => navigator.clipboard.readText())

/** Records the fragment of a link the suite read, and returns the link. */
function link(text) {
  const hash = text.indexOf('#')
  assert.ok(hash > 0, `The link has no fragment: ${text}`)
  fragments.add(text.slice(hash + 1))
  return text
}

async function viewportHeight(page, tall) {
  if (mobile)
    await page.setViewportSize({ width: 390, height: tall ? 5200 : 844 })
}

/**
 * Waits until the background work of the page has nothing left to do. Work
 * that arrives while the page is idle starts when the tab is looked at
 * again: the check says so to the page, as a person switching tabs does.
 */
async function settled(page, { timeout = 150000 } = {}) {
  const left = async () => {
    const [repairs, pending] = await Promise.all([
      prisma.vaultFolder.count({
        where: {
          userId: ALEX.id,
          OR: [{ folderPublicKey: null }, { rekeyPending: true }],
        },
      }),
      prisma.file.count({
        where: {
          userId: ALEX.id,
          unreadable: false,
          pendingAttempts: { lt: 3 },
          OR: [
            { rulesPending: true },
            { ocrPending: true },
            { thumbnailPending: true },
          ],
        },
      }),
    ])
    return (
      repairs + pending + (await page.locator('[data-library-work]').count())
    )
  }
  const deadline = Date.now() + timeout
  let quiet = 0
  for (;;) {
    if ((await left()) === 0) {
      // Two looks apart: a job that is about to start is not missed.
      if (++quiet >= 2) return
    } else {
      quiet = 0
      await page.evaluate(() =>
        document.dispatchEvent(new Event('visibilitychange'))
      )
    }
    assert.ok(
      Date.now() < deadline,
      `The background work did not finish: ${await left()} items left`
    )
    await page.waitForTimeout(1500)
  }
}

// ---------------------------------------------------------------- seed

async function seed() {
  // The first page load creates the configuration.
  await fetch(`${upstream}/auth/login`)
  const config = await prisma.config.findUnique({
    where: { key: 'flare_config' },
  })
  assert.ok(config, 'The application did not create its configuration')
  config.value.settings.general.setup = {
    completed: true,
    completedAt: new Date().toISOString(),
  }
  // The instance reads images automatically, as a new instance does.
  config.value.settings.general.ocr = { enabled: true }
  config.value.settings.general.oidc = { enabled: false }
  config.value.settings.advanced = { customCSS: '', customHead: '' }
  await prisma.config.update({
    where: { key: 'flare_config' },
    data: { value: config.value },
  })
  await prisma.user.deleteMany({ where: { id: ALEX.id } })
  await prisma.authRateLimit.deleteMany()
  const record = await shared.createAccountRecord(PASSPHRASE)
  const keys = shared.keysOfMnemonic(record.mnemonic)
  const email = `${ALEX.id}@example.test`
  await prisma.user.create({
    data: {
      id: ALEX.id,
      name: ALEX.name,
      email,
      emailVerified: new Date(),
      emailVerifiedFor: email,
      emailVerificationSource: 'email',
      ...record.columns,
      roles: { connect: { systemKey: 'administrator' } },
      urlId: ALEX.urlId,
      uploadToken: `${ALEX.id}-public-disposable-upload-token`,
    },
  })
  // What the account had before encryption: a folder and a tag with plain
  // names, and a plain file in that folder with that tag.
  const folder = await prisma.vaultFolder.create({
    data: {
      userId: ALEX.id,
      name: FOLDERS.other,
      normalizedName: FOLDERS.other.toLowerCase(),
    },
  })
  const tag = await prisma.vaultTag.create({
    data: {
      userId: ALEX.id,
      name: TAGS.text.name,
      normalizedName: TAGS.text.name.toLowerCase(),
      ruleSource: 'ocr',
      ruleText: TAGS.text.rule,
    },
  })
  accountKeys.push(keys.accountPrivateKey)
  return { legacyFolder: folder.id, legacyTag: tag.id }
}

async function signIn(browser, passphrase = PASSPHRASE) {
  const signedIn = await context(browser)
  await shared.signIn(signedIn.page, expect, {
    origin,
    email: `${ALEX.id}@example.test`,
    secret: passphrase,
  })
  return signedIn
}

async function useTheme(admin) {
  const { data } = await api(admin.ctx, '/api/customization')
  const document = structuredClone(data.draft ?? data.published)
  document.theme = { ...document.theme, enabled: true, defaultMode: theme }
  await api(admin.ctx, '/api/customization', 'POST', {
    action: 'publish',
    revision: data.revision,
    document,
  })
}

// ---------------------------------------------------------------- helpers

/** An image with words on it, drawn by the browser. */
let TEXT_IMAGE = {
  name: 'letter-from-bank-private.png',
  mimeType: 'image/png',
  buffer: null,
}
async function makeTextImage(page) {
  const base64 = await page.evaluate((words) => {
    const canvas = document.createElement('canvas')
    canvas.width = 900
    canvas.height = 260
    const context = canvas.getContext('2d')
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.fillStyle = '#000000'
    context.font = 'bold 64px Arial, Helvetica, sans-serif'
    context.fillText(words, 40, 150)
    return canvas.toDataURL('image/png').split(',')[1]
  }, OCR_WORDS)
  TEXT_IMAGE.buffer = Buffer.from(base64, 'base64')
}

async function upload(
  page,
  list,
  { folder, visibility, password, plain } = {}
) {
  await page.goto(
    `${origin}/dashboard/upload${folder ? `?folder=${folder}` : ''}`
  )
  await expect(page.locator('[data-encryption-choice]')).toHaveAttribute(
    'data-encryption-choice',
    'encrypted'
  )
  if (plain) await page.getByRole('radio', { name: /Plain/ }).check()
  await page
    .locator('input[type="file"]')
    .setInputFiles(
      list.map(({ name, mimeType, buffer }) => ({ name, mimeType, buffer }))
    )
  if (visibility) {
    await page.locator('#upload-visibility').click()
    await page
      .getByRole('option', {
        name: visibility === 'PRIVATE' ? /Private/ : /Public/,
      })
      .click()
  }
  if (password) {
    passwords.add(password)
    await page.locator('#upload-password').fill(password)
  }
  await page.getByRole('button', { name: /^Upload \d+ files?$/ }).click()
  for (const { name } of list)
    await expect(
      page.getByRole('link', { name: `Open ${name}`, exact: true })
    ).toBeVisible({ timeout: 120000 })
  await recordFiles()
}

/** The row of an encrypted file by its name, which only this script and the browser can read. */
async function fileNamed(name) {
  await recordFiles()
  for (const file of await prisma.file.findMany({
    where: { userId: ALEX.id, encrypted: true, unreadable: false },
    include: { sealedData: true, tags: true },
  }))
    for (const key of accountKeys)
      try {
        if (metadataOf(file, fileKeyOf(file, key)).name === name) return file
      } catch {
        // A stanza for a different key.
      }
  throw new Error(`No encrypted file is named ${name}`)
}

const card = (page, name) =>
  page
    .locator('div.group, [class*="group"]')
    .filter({
      has: page.getByRole('link', { name: `Open ${name}`, exact: true }),
    })
    .first()

async function openFolder(page, name) {
  await page
    .getByRole('button', { name: `Open folder ${name}`, exact: true })
    .click()
}

async function createFolder(page, name) {
  await page.getByRole('button', { name: 'New folder' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.locator('#folder-name').fill(name)
  await dialog.getByRole('button', { name: 'Create folder' }).click()
  await expect(dialog).toHaveCount(0)
}

// ---------------------------------------------------------------- scenarios

const ids = {}

async function testConversion(alex, seeded) {
  const { page } = alex
  await page.goto(`${origin}/dashboard`)
  // The first unlock converts what the account had before encryption.
  await expect
    .poll(
      async () =>
        (
          await prisma.vaultFolder.findUnique({
            where: { id: seeded.legacyFolder },
          })
        ).name
    )
    .toBe('')
  await expect
    .poll(
      async () =>
        (await prisma.vaultTag.findUnique({ where: { id: seeded.legacyTag } }))
          .name
    )
    .toBe('')
  const tag = await prisma.vaultTag.findUnique({
    where: { id: seeded.legacyTag },
  })
  assert.deepEqual([tag.ruleSource, tag.ruleText], [null, null])
  assert.ok(tag.sealedTagMetadata.length > 57)
  // The same folder and the same tag still show their names, opened here.
  await expect(
    page.getByRole('button', {
      name: `Open folder ${FOLDERS.other}`,
      exact: true,
    })
  ).toBeVisible()
  await page.getByRole('button', { name: 'Filter by tag' }).click()
  await expect(page.getByText(TAGS.text.name, { exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  ids.otherFolder = seeded.legacyFolder
  ids.textTag = seeded.legacyTag
  results.push(
    'The first unlock converts a folder and a tag from before encryption: the browser makes a folder key pair and seals both names and the tag rule, the server deletes the plain name and rule, and the library shows the same names from the sealed records'
  )
}

async function testFolders(browser, alex) {
  const { page } = alex
  await viewportHeight(page, true)
  await page.goto(`${origin}/dashboard`)
  // A new folder opens at once: the second one is made inside the first.
  await createFolder(page, FOLDERS.top)
  await expect(
    page
      .getByRole('navigation', { name: 'Folder breadcrumbs' })
      .getByText(FOLDERS.top)
  ).toBeVisible()
  await createFolder(page, FOLDERS.child)
  await expect(
    page
      .getByRole('navigation', { name: 'Folder breadcrumbs' })
      .getByText(FOLDERS.child)
  ).toBeVisible()
  const names = await recordFolderKeys()
  ids.top = Object.keys(names).find((id) => names[id] === FOLDERS.top)
  ids.child = Object.keys(names).find((id) => names[id] === FOLDERS.child)
  assert.ok(
    ids.top && ids.child,
    'The sealed folder names do not open with independent code'
  )
  const rows = await prisma.vaultFolder.findMany({ where: { userId: ALEX.id } })
  assert.ok(
    rows.every(
      (row) => row.name === '' && row.normalizedName === `/sealed/${row.id}`
    )
  )
  const child = rows.find((row) => row.id === ids.child)
  assert.equal(child.parentId, ids.top)
  assert.equal(child.parentFolderStanza.length, 97)
  // A second folder with the same name here is refused in the browser.
  await page.goto(`${origin}/dashboard?folder=${ids.top}`)
  await expect(
    page.getByRole('button', {
      name: `Open folder ${FOLDERS.child}`,
      exact: true,
    })
  ).toBeVisible()
  await page.getByRole('button', { name: 'New folder' }).click()
  await page
    .getByRole('dialog')
    .locator('#folder-name')
    .fill(FOLDERS.child.toUpperCase())
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Create folder' })
    .click()
  await expect(
    page
      .getByRole('dialog')
      .getByText('A folder with that name already exists here.')
  ).toBeVisible()
  await shot(page, 'folder-name-taken')
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click()
  await shot(page, 'folder-tree')

  // Files in the tree: a public image at the top; in the folder below a
  // public image, a private file, a file with a password and a plain image.
  await upload(page, [fixtures.photo], {
    folder: ids.top,
    visibility: 'PUBLIC',
  })
  await upload(page, [fixtures.nested], {
    folder: ids.child,
    visibility: 'PUBLIC',
  })
  await upload(page, [fixtures.hidden], {
    folder: ids.child,
    visibility: 'PRIVATE',
  })
  await upload(page, [fixtures.locked], {
    folder: ids.child,
    visibility: 'PUBLIC',
    password: FILE_PASSWORD,
  })
  await upload(page, [PLAIN_IN_FOLDER], {
    folder: ids.child,
    visibility: 'PUBLIC',
    plain: true,
  })
  await settled(page)
  const nested = await fileNamed(fixtures.nested.name)
  const hidden = await fileNamed(fixtures.hidden.name)
  const locked = await fileNamed(fixtures.locked.name)
  assert.equal(
    nested.folderStanza.length,
    97,
    'A public file in a folder has a folder stanza'
  )
  assert.equal(hidden.folderStanza, null, 'A private file has no folder stanza')
  assert.equal(locked.folderStanza.length, 97)
  // The upload of the public file carried its folder stanza itself.
  assert.ok(
    requests.some(
      (request) =>
        request.method === 'POST' &&
        request.target.startsWith('/api/files') &&
        request.body.includes('name="folderStanza"')
    ),
    'No upload request carried a folder stanza'
  )

  // Share the top folder.
  await page.goto(`${origin}/dashboard?folder=${ids.top}`)
  await page.getByRole('button', { name: 'Share', exact: true }).click()
  let dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: 'Create share link' }).click()
  await expect(dialog.locator('#folder-share-link')).toHaveValue(
    /\/s\/folders\/[A-Za-z0-9_-]+#[A-Za-z0-9_-]{43}$/
  )
  const first = link(await dialog.locator('#folder-share-link').inputValue())
  await shot(page, 'folder-share-dialog')
  await dialog.getByRole('button', { name: 'Done' }).click()

  // A visitor without a session.
  const visitor = await context(browser)
  await viewportHeight(visitor.page, true)
  await visitor.page.goto(first)
  await expect(visitor.page.locator('[data-shared-folder-name]')).toHaveText(
    FOLDERS.top
  )
  await expect(
    visitor.page.getByRole('link', { name: FOLDERS.child })
  ).toBeVisible()
  await expect(visitor.page.getByText(fixtures.photo.name)).toBeVisible()
  await expect(visitor.page.locator('[data-sealed-thumbnail]')).toHaveCount(1)
  await shot(visitor.page, 'shared-folder')
  await visitor.page.getByRole('link', { name: FOLDERS.child }).click()
  await expect(visitor.page.locator('[data-shared-folder-name]')).toHaveText(
    FOLDERS.child
  )
  await expect(visitor.page.getByText(fixtures.nested.name)).toBeVisible()
  await expect(visitor.page.getByText(PLAIN_IN_FOLDER.name)).toBeVisible()
  await expect(visitor.page.getByText('Password-protected file')).toBeVisible()
  await expect(visitor.page.getByText(fixtures.hidden.name)).toHaveCount(0)
  await expect(visitor.page.getByText(fixtures.locked.name)).toHaveCount(0)
  await expect(visitor.page.getByText('3 files')).toBeVisible()
  assert.ok(
    visitor.page.url().includes(`folder=${ids.child}`) &&
      visitor.page.url().includes('#')
  )
  await shot(visitor.page, 'shared-folder-subfolder')
  // A file in the folder below opens through its folder stanza.
  await visitor.page.locator(`[data-shared-file="${nested.id}"]`).click()
  await visitor.page.waitForURL(/\/alexl\/e_/)
  link(visitor.page.url())
  await expect(
    visitor.page.getByRole('img', { name: fixtures.nested.name })
  ).toBeVisible()
  await expect(
    visitor.page.getByText(fixtures.nested.name).first()
  ).toBeVisible()
  await shot(visitor.page, 'shared-folder-file')
  // The way back keeps the folder key.
  await visitor.page.getByRole('link', { name: /Back to/ }).click()
  await expect(visitor.page.locator('[data-shared-folder-name]')).toHaveText(
    FOLDERS.child
  )
  // The file with a password asks for it, and opens with it.
  await visitor.page.locator(`[data-shared-file="${locked.id}"]`).click()
  await visitor.page.waitForURL(/\/alexl\/e_.*#p\./)
  link(visitor.page.url())
  await expect(visitor.page.locator('#encrypted-share-password')).toBeVisible()
  await shot(visitor.page, 'shared-folder-password')
  await visitor.page.locator('#encrypted-share-password').fill(FILE_PASSWORD)
  await visitor.page.getByRole('button', { name: 'Open file' }).click()
  await expect(visitor.page.getByText('Only with the password.')).toBeVisible()
  // Missing and wrong keys say what is wrong, and plain files still open.
  await visitor.page.goto(`${first.split('#')[0]}?folder=${ids.child}`)
  await expect(
    visitor.page.locator('[data-shared-folder-problem="missing"]')
  ).toBeVisible()
  await expect(visitor.page.getByText(PLAIN_IN_FOLDER.name)).toBeVisible()
  await expect(visitor.page.getByText(fixtures.nested.name)).toHaveCount(0)
  await shot(visitor.page, 'shared-folder-missing-key')
  const wrong = `${first.split('#')[0]}#${randomBytes(32).toString('base64url')}`
  await visitor.page.goto(wrong)
  await visitor.page.reload()
  await expect(
    visitor.page.locator('[data-shared-folder-problem="wrong"]')
  ).toBeVisible()
  await shot(visitor.page, 'shared-folder-wrong-key')
  // A folder outside the shared one is not reachable with this token.
  await visitor.page.goto(
    `${first.split('#')[0]}?folder=${ids.otherFolder}#${first.split('#')[1]}`
  )
  await expect(visitor.page.locator('[data-shared-folder-name]')).toHaveCount(0)
  results.push(
    'A shared folder link opened without a session shows the decrypted names of the folder, of the folder below it and of their public files, opens a file of the folder below through its folder stanza with a working way back, leaves the private file out, sends a file with a password to its page where the password opens it, lists a plain file beside the encrypted ones, says what is wrong for a link without its key and for a wrong key while still listing the plain file, and gives nothing for a folder outside the shared one'
  )

  // Stop sharing: the link is dead at once, the folders get new keys, and a
  // new link works.
  const before = await prisma.vaultFolder.findMany({
    where: { id: { in: [ids.top, ids.child] } },
  })
  await page.goto(`${origin}/dashboard?folder=${ids.top}`)
  await page.getByRole('button', { name: 'Share', exact: true }).click()
  dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: 'Disable link' }).click()
  await expect(
    dialog.getByRole('button', { name: 'Create share link' })
  ).toBeVisible()
  await visitor.page.goto(first)
  await expect(visitor.page.locator('[data-shared-folder-name]')).toHaveCount(0)
  await expect
    .poll(async () => {
      const now = await prisma.vaultFolder.findMany({
        where: { id: { in: [ids.top, ids.child] } },
      })
      return now.every(
        (row) =>
          !row.rekeyPending &&
          !Buffer.from(row.folderPublicKey).equals(
            Buffer.from(before.find((old) => old.id === row.id).folderPublicKey)
          )
      )
    })
    .toBe(true)
  await settled(page)
  await dialog.getByRole('button', { name: 'Create share link' }).click()
  await expect(dialog.locator('#folder-share-link')).toHaveValue(
    /#[A-Za-z0-9_-]{43}$/
  )
  const second = link(await dialog.locator('#folder-share-link').inputValue())
  assert.notEqual(second.split('#')[1], first.split('#')[1])
  assert.notEqual(second.split('#')[0], first.split('#')[0])
  await dialog.getByRole('button', { name: 'Done' }).click()
  await visitor.page.goto(
    `${second.split('#')[0]}?folder=${ids.child}#${second.split('#')[1]}`
  )
  await expect(visitor.page.locator('[data-shared-folder-name]')).toHaveText(
    FOLDERS.child
  )
  await expect(visitor.page.getByText(fixtures.nested.name)).toBeVisible()
  // The old key opens nothing of the new link.
  await visitor.page.goto(`${second.split('#')[0]}#${first.split('#')[1]}`)
  await visitor.page.reload()
  await expect(
    visitor.page.locator('[data-shared-folder-problem="wrong"]')
  ).toBeVisible()
  await recordFolderKeys()
  results.push(
    'Stop sharing closes the old link at once and gives the folder and the folder below it new key pairs with new stanzas, made by the owner’s browser; a new link lists the tree again, and the key of the old link does not open it'
  )

  // Move a file, make it private and public again, and delete a folder.
  await api(alex.ctx, '/api/files/folders', 'POST', {
    fileIds: [nested.id],
    folderId: ids.otherFolder,
  })
  assert.equal(
    (await prisma.file.findUnique({ where: { id: nested.id } })).folderStanza,
    null
  )
  await page.goto(`${origin}/dashboard?folder=${ids.otherFolder}`)
  await expect(
    page.getByRole('link', {
      name: `Open ${fixtures.nested.name}`,
      exact: true,
    })
  ).toBeVisible()
  await expect
    .poll(
      async () =>
        (await prisma.file.findUnique({ where: { id: nested.id } }))
          .folderStanza?.length ?? 0
    )
    .toBe(97)
  await api(alex.ctx, `/api/files/${nested.id}`, 'PATCH', {
    visibility: 'PRIVATE',
  })
  assert.equal(
    (await prisma.file.findUnique({ where: { id: nested.id } })).folderStanza,
    null
  )
  await api(alex.ctx, `/api/files/${nested.id}`, 'PATCH', {
    visibility: 'PUBLIC',
  })
  await api(alex.ctx, '/api/files/folders', 'POST', {
    fileIds: [nested.id],
    folderId: ids.child,
  })
  // Deleting the folder below moves its files up to the top folder.
  await page.goto(`${origin}/dashboard?folder=${ids.top}`)
  await page
    .getByRole('button', {
      name: `Manage folder ${FOLDERS.child}`,
      exact: true,
    })
    .click()
  await page.getByRole('menuitem', { name: 'Remove folder' }).click()
  await shot(page, 'folder-remove-dialog')
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Remove folder, keep files' })
    .click()
  await expect(
    page.getByRole('link', {
      name: `Open ${fixtures.nested.name}`,
      exact: true,
    })
  ).toBeVisible()
  const top = await prisma.vaultFolder.findUnique({ where: { id: ids.top } })
  await expect
    .poll(async () => {
      const moved = await prisma.file.findMany({
        where: { id: { in: [nested.id, locked.id] } },
      })
      return moved.every(
        (file) =>
          file.folderId === ids.top &&
          file.folderStanzaPublicKey &&
          Buffer.from(file.folderStanzaPublicKey).equals(
            Buffer.from(top.folderPublicKey)
          )
      )
    })
    .toBe(true)
  assert.equal(await prisma.vaultFolder.count({ where: { id: ids.child } }), 0)
  // The visitor sees the moved files in the folder that is left. Only the
  // part after `#` differs from the page that is open, so the list is
  // loaded again.
  await visitor.page.goto(second)
  await visitor.page.reload()
  await expect(visitor.page.getByText(fixtures.nested.name)).toBeVisible()
  await expect(visitor.page.getByText(fixtures.photo.name)).toBeVisible()
  await visitor.ctx.close()
  results.push(
    'Moving a file to another folder and making it private delete its folder stanza on the server, and the owner’s browser makes one for the new folder; deleting a folder moves its files up, and they get stanzas for the key of the folder above and show on its shared page'
  )
}

async function testTagsAndPending(alex) {
  const { page } = alex
  await viewportHeight(page, true)
  await page.goto(`${origin}/dashboard`)
  // A tag with a rule on the file name.
  await page.getByRole('button', { name: 'Filter by tag' }).click()
  await page.getByRole('button', { name: /Manage tags/ }).click()
  let dialog = page.getByRole('dialog')
  await dialog
    .getByRole('button', { name: /New tag|Create tag/ })
    .first()
    .click()
  await dialog.locator('#tag-name').fill(TAGS.name.name)
  await dialog.locator('#tag-automatic').click()
  await dialog.getByLabel('Text to match').fill(TAGS.name.rule)
  await shot(page, 'tag-rule-editor')
  await dialog.getByRole('button', { name: 'Create tag' }).click()
  await expect(dialog.getByText(TAGS.name.name, { exact: true })).toBeVisible()
  await shot(page, 'tag-manager')
  const sealed = await prisma.vaultTag.findMany({ where: { userId: ALEX.id } })
  assert.equal(sealed.length, 2)
  assert.ok(
    sealed.every(
      (tag) => tag.name === '' && !tag.ruleText && tag.sealedTagMetadata
    )
  )
  ids.nameTag = sealed.find((tag) => tag.id !== ids.textTag).id
  // A second tag with the same name is refused in the browser.
  await dialog
    .getByRole('button', { name: /New tag|Create tag/ })
    .first()
    .click()
  await dialog.locator('#tag-name').fill(TAGS.name.name.toLowerCase())
  await dialog.getByRole('button', { name: 'Create tag' }).click()
  await expect(
    dialog.getByText('You already have a tag with that name.')
  ).toBeVisible()
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')

  // The rule runs in the browser at the upload: the request carries the tag
  // reference and says that the rules ran.
  const before = requests.length
  await upload(page, [fixtures.shot, fixtures.notes])
  const sent = requests
    .slice(before)
    .filter(
      (request) => request.method === 'POST' && request.target === '/api/files'
    )
  assert.ok(
    sent.some((request) =>
      request.body.includes(`name="ruleTagIds"\r\n\r\n${ids.nameTag}`)
    )
  )
  assert.ok(
    sent.every((request) =>
      request.body.includes('name="rulesApplied"\r\n\r\ntrue')
    )
  )
  const tagged = await fileNamed(fixtures.shot.name)
  const untagged = await fileNamed(fixtures.notes.name)
  assert.deepEqual(
    tagged.tags.map((tag) => tag.tagId),
    [ids.nameTag]
  )
  assert.deepEqual(untagged.tags, [])
  assert.equal(tagged.rulesPending, false)

  // A file as a script client leaves it: no rules, no text, no thumbnail.
  await makeTextImage(page)
  await upload(page, [
    fixtures.script,
    TEXT_IMAGE,
    ...(fixtures.video ? [fixtures.video] : []),
  ])
  await settled(page)
  const script = await fileNamed(fixtures.script.name)
  const letter = await fileNamed(TEXT_IMAGE.name)
  await prisma.$transaction([
    prisma.vaultFileTag.deleteMany({
      where: { fileId: { in: [script.id, letter.id] } },
    }),
    prisma.fileSealedData.deleteMany({
      where: { fileId: { in: [script.id, letter.id] } },
    }),
    prisma.file.updateMany({
      where: { id: { in: [script.id, letter.id] } },
      data: { rulesPending: true, ocrPending: true, thumbnailPending: true },
    }),
  ])
  // A plain file from a script: the server cannot apply a sealed rule to it.
  const plainShot = await prisma.file.create({
    data: {
      userId: ALEX.id,
      name: 'screenshot-plain-tool.png',
      urlPath: `/${ALEX.urlId}/screenshot-plain-tool.png`,
      path: 'uploads/not-stored',
      mimeType: 'image/png',
      size: 0.01,
      rulesPending: true,
      isOcrProcessed: true,
      ocrText: 'Payment OVERDUE since May',
    },
  })
  ids.plainShot = plainShot.id
  const externalBefore = external.length
  await page.goto(`${origin}/dashboard`)
  await expect(page.locator('[data-library-work]')).toBeVisible({
    timeout: 60000,
  })
  await shot(page, 'pending-work')
  await settled(page, { timeout: 240000 })
  const done = await fileNamed(fixtures.script.name)
  const read = await fileNamed(TEXT_IMAGE.name)
  assert.deepEqual(
    done.tags.map((tag) => tag.tagId),
    [ids.nameTag],
    'The name rule did not reach the pending file'
  )
  assert.ok(
    done.sealedData.sealedThumbnail.length > 500 &&
      done.sealedData.sealedOcrText
  )
  assert.deepEqual(
    [done.rulesPending, done.ocrPending, done.thumbnailPending],
    [false, false, false]
  )
  // The text of the image was read in the browser and sealed, and the rule
  // on text gave the tag that came from before encryption.
  const text = openSeal(
    deriveKey('flare e2ee v1 ocr text', fileKeyOf(read, accountKeys[0])),
    Buffer.from(read.sealedData.sealedOcrText).subarray(1)
  ).toString('utf8')
  assert.match(text, /OVERDUE/, `The recognition read: ${text}`)
  assert.match(text, /7741/)
  assert.ok(
    read.tags.some((tag) => tag.tagId === ids.textTag),
    'The text rule did not tag the image'
  )
  const plainTags = await prisma.vaultFileTag.findMany({
    where: { fileId: plainShot.id },
  })
  assert.deepEqual(
    plainTags.map((tag) => tag.tagId).sort(),
    [ids.nameTag, ids.textTag].sort()
  )
  assert.equal(
    (await prisma.file.findUnique({ where: { id: plainShot.id } }))
      .rulesPending,
    false
  )
  // Recognition loaded its program and its language data from this instance.
  const ocrAssets = requests.filter((request) =>
    request.target.startsWith('/api/ocr/')
  )
  assert.ok(
    ocrAssets.some((request) => request.target.endsWith('/worker.min.js'))
  )
  assert.ok(
    ocrAssets.some((request) => request.target.endsWith('/eng.traineddata.gz'))
  )
  assert.ok(
    ocrAssets.some((request) =>
      /tesseract-core.*\.wasm\.js$/.test(request.target)
    )
  )
  assert.deepEqual(
    external.slice(externalBefore),
    [],
    'A page asked another site'
  )
  assert.deepEqual(await page.evaluate(() => window.__cspViolations), [])
  results.push(
    `A tag with a rule on the file name tags a matching upload in the browser (the upload request carries the tag ID and rulesApplied=true, and no rule text); files left as a script client leaves them, with no rules, no text and no thumbnail, are finished in the background when the owner opens the library: the name rule tags one, tesseract.js reads "${text.replace(/\s+/g, ' ').trim()}" from the other under the enforced policy with its worker, core and language data from ${ocrAssets.length} requests to this instance and none to another site, the text is stored sealed, and the rule on text of the tag from before encryption tags it; a plain file from a script gets both sealed rules applied by the browser`
  )

  // Thumbnails on the cards.
  await page.goto(`${origin}/dashboard`)
  await expect(
    card(page, fixtures.script.name).locator('[data-sealed-thumbnail]')
  ).toBeVisible()
  await expect(
    card(page, fixtures.shot.name).locator('[data-sealed-thumbnail]')
  ).toBeVisible()
  if (fixtures.video)
    await expect(
      card(page, fixtures.video.name).locator('[data-sealed-thumbnail]')
    ).toBeVisible()
  const thumbnail = await card(page, fixtures.shot.name)
    .locator('[data-sealed-thumbnail]')
    .evaluate((image) => ({
      width: image.naturalWidth,
      height: image.naturalHeight,
      src: image.src.slice(0, 5),
    }))
  assert.deepEqual(thumbnail, { width: 480, height: 300, src: 'blob:' })
  assert.ok(
    requests.some((request) => /\/sealed-thumbnail$/.test(request.target))
  )
  await shot(page, 'library-thumbnails')
  results.push(
    `Library cards show the sealed thumbnail of an encrypted image${fixtures.video ? ' and of a video' : ''}: a 480 by 300 WebP that the browser made, sealed and now decrypts in a worker into an object URL`
  )

  // The tag filter works by ID.
  await page.goto(`${origin}/dashboard?tag=${ids.nameTag}`)
  await expect(
    page.getByRole('link', { name: `Open ${fixtures.shot.name}`, exact: true })
  ).toBeVisible()
  await expect(
    page.getByRole('link', {
      name: `Open ${fixtures.script.name}`,
      exact: true,
    })
  ).toBeVisible()
  await expect(
    page.getByRole('link', { name: `Open ${fixtures.notes.name}`, exact: true })
  ).toHaveCount(0)
  await expect(
    page.getByRole('button', { name: `Remove ${TAGS.name.name} filter` })
  ).toBeVisible()
  await shot(page, 'tag-filter')

  // "Apply to existing files" runs in the browser.
  await prisma.vaultFileTag.deleteMany({ where: { tagId: ids.nameTag } })
  await page.goto(`${origin}/dashboard`)
  await page.getByRole('button', { name: 'Filter by tag' }).click()
  await page.getByRole('button', { name: /Manage tags/ }).click()
  dialog = page.getByRole('dialog')
  await dialog.getByText(TAGS.name.name, { exact: true }).click()
  const applying = requests.length
  await dialog
    .getByRole('button', { name: 'Apply rule to existing files…' })
    .click()
  await shot(page, 'tag-apply-existing')
  await dialog.getByRole('button', { name: 'Apply to existing files' }).click()
  await expect
    .poll(() => prisma.vaultFileTag.count({ where: { tagId: ids.nameTag } }), {
      timeout: 60000,
    })
    .toBe(3)
  const applied = requests
    .slice(applying)
    .filter((request) => /\/api\/tags\/[^/]+\/apply$/.test(request.target))
  assert.ok(
    applied.length >= 1 &&
      applied.every((request) => /^\{"fileIds":\[/.test(request.body))
  )
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  results.push(
    'The tag filter lists the tagged files by tag ID, and "Apply to existing files" matches the sealed rule in the browser against the names of encrypted and plain files and sends file IDs only'
  )
}

async function testOcrDialog(browser, alex) {
  const { page } = alex
  await viewportHeight(page, false)
  // The owner's stored text opens at once.
  await page.goto(
    `${origin}/dashboard?search=${encodeURIComponent('letter-from')}`
  )
  await page
    .getByRole('button', { name: `Manage ${TEXT_IMAGE.name}`, exact: true })
    .click()
  await page.getByRole('menuitem', { name: /Extract text/ }).click()
  await expect(page.getByRole('dialog').getByText(/OVERDUE/)).toBeVisible({
    timeout: 120000,
  })
  await shot(page, 'ocr-dialog')
  await page.keyboard.press('Escape')
  // A visitor reads the image in their own browser, and nothing is stored.
  const file = await fileNamed(TEXT_IMAGE.name)
  await api(alex.ctx, `/api/files/${file.id}`, 'PATCH', {
    visibility: 'PUBLIC',
  })
  await prisma.fileSealedData.update({
    where: { fileId: file.id },
    data: { sealedOcrText: null },
  })
  await page.goto(
    `${origin}/dashboard?search=${encodeURIComponent('letter-from')}`
  )
  await page
    .getByRole('button', { name: `Manage ${TEXT_IMAGE.name}`, exact: true })
    .click()
  await page.getByRole('menuitem', { name: 'Copy link' }).click()
  await expect
    .poll(() => clipboard(page))
    .toMatch(/\/alexl\/e_[A-Za-z0-9_-]{22}#/)
  const share = link(await clipboard(page))
  const visitor = await context(browser)
  const before = requests.length
  await visitor.page.goto(share)
  await expect(
    visitor.page.getByRole('img', { name: TEXT_IMAGE.name })
  ).toBeVisible()
  await visitor.page.locator('[data-encrypted-ocr]').click()
  await expect(
    visitor.page.getByRole('dialog').getByText(/OVERDUE/)
  ).toBeVisible({ timeout: 180000 })
  await expect(
    visitor.page
      .getByRole('dialog')
      .getByText('The text is not sent to the server.')
  ).toBeVisible()
  await shot(visitor.page, 'ocr-dialog-visitor')
  assert.equal(
    requests.slice(before).filter((request) => request.target.endsWith('/work'))
      .length,
    0,
    'A visitor sent work to the server'
  )
  assert.equal(
    (await prisma.fileSealedData.findUnique({ where: { fileId: file.id } }))
      .sealedOcrText,
    null
  )
  assert.deepEqual(
    await visitor.page.evaluate(() => window.__cspViolations),
    []
  )
  await visitor.ctx.close()
  // The owner reads it again from the page of the file, and it is stored.
  await page.goto(share.split('#')[0])
  await page.locator('[data-encrypted-ocr]').click()
  await expect(page.getByRole('dialog').getByText(/OVERDUE/)).toBeVisible({
    timeout: 180000,
  })
  await expect
    .poll(async () =>
      Boolean(
        (await prisma.fileSealedData.findUnique({ where: { fileId: file.id } }))
          .sealedOcrText
      )
    )
    .toBe(true)
  await page.keyboard.press('Escape')
  results.push(
    '"Extract text" opens the owner’s sealed text; a visitor of the share page reads the image in the visitor’s own browser, sees the text, and nothing is stored or sent; the owner’s own recognition from the file page is sealed and stored'
  )
}

async function testSearch(alex) {
  const { page } = alex
  await viewportHeight(page, true)
  await upload(page, [PLAIN], { plain: true })
  await page.goto(`${origin}/dashboard`)
  await settled(page)
  const search = page.getByPlaceholder('Search your files…')
  const names = async () =>
    (
      await page
        .getByRole('link', { name: /^Open / })
        .evaluateAll((links) =>
          links.map((link) => link.getAttribute('aria-label').slice(5))
        )
    ).filter((name, index, all) => all.indexOf(name) === index)
  // One list: an encrypted file by its name, a plain file by its name.
  const sorted = async () => (await names()).sort()
  await search.fill('harbor')
  await expect.poll(sorted).toEqual([fixtures.photo.name, PLAIN.name].sort())
  await expect(page.getByText('2 files', { exact: true })).toBeVisible()
  await expect(page.locator('[data-encrypted-search-note]')).toHaveCount(0)
  await shot(page, 'search-mixed')
  // By the text of an image, which only the browser has.
  await search.fill('invoice 7741')
  await expect.poll(names).toEqual([TEXT_IMAGE.name])
  await shot(page, 'search-image-text')
  await search.fill('no file has this')
  await expect(page.getByText('No files match your search')).toBeVisible()
  // The server got the search for its plain files and no encrypted match.
  const order = requests.filter((request) =>
    request.target.startsWith('/api/files/order')
  )
  assert.ok(order.some((request) => /search=harbor/.test(request.target)))
  assert.ok(
    order.every((request) => /encrypted=false|search=/.test(request.target))
  )
  const photo = await fileNamed(fixtures.photo.name)
  assert.ok(
    !requests.some(
      (request) =>
        request.target.includes('ids=') &&
        request.target.includes(photo.id) &&
        !request.target.startsWith('/api/files/sync')
    ),
    'The page asked the server for an encrypted match by its ID'
  )
  await search.fill('')

  // The type filter: the real types of encrypted files are offered.
  await page.goto(`${origin}/dashboard?types=text%2Fplain`)
  await expect
    .poll(sorted)
    .toEqual(
      [fixtures.notes.name, fixtures.locked.name, fixtures.hidden.name].sort()
    )
  await shot(page, 'type-filter')

  // Order by name, across plain and encrypted files.
  const everyName = [
    ...Object.values(fixtures).map((fixture) => fixture.name),
    TEXT_IMAGE.name,
    PLAIN.name,
    PLAIN_IN_FOLDER.name,
    'screenshot-plain-tool.png',
  ]
  const expected = [...everyName].sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
  )
  await page.goto(`${origin}/dashboard?sortBy=name`)
  await expect.poll(names).toEqual(expected)
  await expect(page.locator('[data-encrypted-search-note]')).toHaveCount(0)
  const ordered = await names()
  await page.goto(`${origin}/dashboard?sortBy=name-desc`)
  await expect.poll(names).toEqual([...expected].reverse())
  await shot(page, 'sort-by-name')
  results.push(
    `One search box covers both kinds of file: "harbor" lists an encrypted file and a plain file together, and "invoice 7741" finds an encrypted image by the text read from it; the server gets the search for its plain files only and is never asked for an encrypted match; the type filter offers and applies the real type of encrypted files; and the order by name puts ${ordered.length} plain and encrypted files in one alphabetical list, in both directions`
  )

  // The cache of encrypted records is in the OPFS, holds no name, and is
  // read after a reload.
  const cacheOf = () =>
    page.evaluate(async () => {
      try {
        const root = await navigator.storage.getDirectory()
        const directory = await root.getDirectoryHandle('flare-e2ee-search')
        let text = ''
        for await (const [, account] of directory.entries()) {
          const file = await (
            await account.getFileHandle('records.ndjson')
          ).getFile()
          text += await file.text()
        }
        return text
      } catch {
        return null
      }
    })
  const cache = await cacheOf()
  assert.ok(cache && cache.length > 1000, 'The OPFS cache is empty')
  const lines = cache
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))
  assert.ok(
    lines.some(
      (line) =>
        line.r?.encryption?.sealedMetadata && line.r.encryption.accountStanza
    )
  )
  assert.ok(lines.some((line) => line.r?.sealedOcrText))
  for (const text of [
    fixtures.photo.name,
    TEXT_IMAGE.name,
    'OVERDUE',
    FOLDERS.top,
    TAGS.name.name,
  ])
    assert.ok(!cache.includes(text), `The cache holds plaintext: ${text}`)
  const before = requests.length
  await page.goto(`${origin}/dashboard?search=harbor`)
  await expect.poll(sorted).toEqual([fixtures.photo.name, PLAIN.name].sort())
  const sync = requests
    .slice(before)
    .filter((request) => request.target.startsWith('/api/files/sync'))
  assert.ok(
    sync.length >= 1 &&
      sync.every((request) => !/since=0(&|$)/.test(request.target)),
    `After a reload the page asked for every record again: ${sync.map((request) => request.target)}`
  )
  const storage = await page.evaluate(() =>
    JSON.stringify({ ...localStorage, ...sessionStorage })
  )
  for (const text of [fixtures.photo.name, 'OVERDUE', ...fragments])
    assert.ok(
      !storage.includes(text),
      'Web storage holds a name, a text or a link key'
    )
  results.push(
    `The local cache is a file in the origin private file system with ${lines.length} lines of sealed records (header, sealed metadata, account stanza, sealed image text) and no name, text, folder name or tag name; after a reload the page reads it and asks the server only for records after its last sequence number`
  )
  return cacheOf
}

async function testLocked(alex) {
  const { page } = alex
  // Locked keys: search says that encrypted files are not included.
  await page.evaluate(
    () =>
      new Promise((resolve) => {
        const request = indexedDB.deleteDatabase('flare-e2ee')
        request.onsuccess =
          request.onerror =
          request.onblocked =
            () => resolve()
      })
  )
  await page.goto(`${origin}/dashboard?search=harbor`)
  await expect(
    page.locator('[data-encrypted-search-note="locked"]')
  ).toBeVisible()
  await expect(
    page.getByRole('link', { name: `Open ${PLAIN.name}`, exact: true })
  ).toBeVisible()
  await shot(page, 'search-locked')
  await page.goto(`${origin}/dashboard`)
  await expect(page.getByText('Encrypted folder').first()).toBeVisible()
  await shot(page, 'folders-locked')
}

async function testRotation(browser, alex, cacheOf) {
  const { page } = alex
  const oldLink = await (async () => {
    const file = await fileNamed(fixtures.photo.name)
    return `${origin}${file.urlPath}#${fileKeyOf(file, accountKeys[0]).toString('base64url')}`
  })()
  link(oldLink)
  const filesBefore = await prisma.file.count({
    where: { userId: ALEX.id, encrypted: true },
  })
  // Sign out first: the cache goes with the session.
  await page.goto(`${origin}/dashboard`)
  await page.getByRole('button', { name: 'Account menu' }).click()
  await page.getByRole('menuitem', { name: 'Sign out' }).click()
  await page.waitForURL(/\/auth\/login/)
  assert.equal(await cacheOf(), null, 'The cache survived the sign-out')
  results.push(
    'Signing out deletes the cache of encrypted records from the origin private file system'
  )
  await shared.signIn(page, expect, {
    origin,
    email: `${ALEX.id}@example.test`,
    secret: PASSPHRASE,
  })

  // Change the passphrase, which rotates the keys.
  await page.goto(`${origin}/dashboard/profile`)
  const before = requests.length
  await page.getByRole('button', { name: 'Change passphrase' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: 'Continue' }).click()
  await dialog.locator('#current-passphrase').fill(PASSPHRASE)
  await dialog.locator('#change-passphrase').fill(NEXT_PASSPHRASE)
  await dialog.locator('#change-confirmation').fill(NEXT_PASSPHRASE)
  await expect(dialog.locator('#change-strength')).toHaveAttribute(
    'data-strength-score',
    /[34]/
  )
  await dialog
    .getByRole('button', { name: 'Change passphrase and sign out' })
    .click()
  await expect(dialog.getByText('Save your new recovery phrase')).toBeVisible({
    timeout: 90000,
  })
  const rotation = JSON.parse(
    requests
      .slice(before)
      .find((request) => request.target === '/api/auth/e2ee/rotation').body
  )
  const folders = await prisma.vaultFolder.findMany({
    where: { userId: ALEX.id },
  })
  const tags = await prisma.vaultTag.findMany({ where: { userId: ALEX.id } })
  assert.deepEqual(
    rotation.folders.map((folder) => folder.id).sort(),
    folders.map((folder) => folder.id).sort()
  )
  assert.deepEqual(
    rotation.tags.map((tag) => tag.id).sort(),
    tags.map((tag) => tag.id).sort()
  )
  const mnemonic = await shared.saveRecoveryPhrase(page, expect)
  accountKeys.push(shared.keysOfMnemonic(mnemonic).accountPrivateKey)
  await page.waitForURL(/\/auth\/login/)
  const user = await prisma.user.findUnique({ where: { id: ALEX.id } })
  assert.ok(user.sealedKeyring, 'The rotation stored a keyring')
  assert.equal(
    await prisma.file.count({
      where: {
        userId: ALEX.id,
        encrypted: true,
        stanzaAccountPublicKey: Buffer.from(user.accountPublicKey),
      },
    }),
    0
  )
  // The folder names and the tag still open with the new keys.
  const names = await recordFolderKeys()
  assert.deepEqual(
    Object.values(names).sort(),
    [FOLDERS.top, FOLDERS.other].sort()
  )

  // Sign in with the new passphrase: the migration runs in the background.
  await shared.signIn(page, expect, {
    origin,
    email: `${ALEX.id}@example.test`,
    secret: NEXT_PASSPHRASE,
  })
  await page.goto(`${origin}/dashboard`)
  await expect(
    page.getByRole('button', {
      name: `Open folder ${FOLDERS.top}`,
      exact: true,
    })
  ).toBeVisible()
  await expect
    .poll(
      async () => {
        const fresh = await prisma.user.findUnique({ where: { id: ALEX.id } })
        const old = await prisma.file.count({
          where: {
            userId: ALEX.id,
            encrypted: true,
            NOT: {
              stanzaAccountPublicKey: Buffer.from(fresh.accountPublicKey),
            },
          },
        })
        return `${old} old stanzas, keyring ${fresh.sealedKeyring ? 'kept' : 'pruned'}`
      },
      { timeout: 120000, intervals: [500] }
    )
    .toBe('0 old stanzas, keyring pruned')
  await recordFiles()
  const keyring = requests.filter(
    (request) =>
      request.method === 'PUT' && request.target === '/api/auth/e2ee/keyring'
  )
  assert.equal(keyring.length, 1)
  assert.equal(JSON.parse(keyring[0].body).sealedKeyring, null)
  assert.ok(/x-flare-e2ee-signature/i.test(keyring[0].headers))
  // The browser dropped the old key too.
  const storedOld = () =>
    page.evaluate(
      () =>
        new Promise((resolve, reject) => {
          const opening = indexedDB.open('flare-e2ee')
          opening.onerror = () => reject(opening.error)
          opening.onsuccess = () => {
            const read = opening.result
              .transaction('account-keys')
              .objectStore('account-keys')
              .get('current')
            read.onsuccess = () => resolve(read.result?.oldPrivateKeys.length)
            read.onerror = () => reject(read.error)
          }
        })
    )
  await expect.poll(storedOld).toBe(0)
  // The library opens every file with the new key alone, and search works.
  await page.goto(`${origin}/dashboard?search=harbor`)
  await expect(
    page.getByRole('link', { name: `Open ${fixtures.photo.name}`, exact: true })
  ).toBeVisible()
  await shot(page, 'after-rotation')
  // An old share link still opens: the file key did not change.
  const visitor = await context(browser)
  await visitor.page.goto(oldLink)
  await expect(
    visitor.page.getByRole('img', { name: fixtures.photo.name })
  ).toBeVisible()
  await visitor.ctx.close()
  results.push(
    `A passphrase change sends, in the rotation request, a new sealed private key for each of ${folders.length} folders and a new sealed record for each of ${tags.length} tags; after the next sign-in the browser moves the account stanzas of ${filesBefore} files to the new key in the background, stores an empty keyring with one signed request, and drops the old key from its own store; folder and tag names open with the new keys, search works, and a share link from before the rotation still opens its file`
  )
}

async function testReset(browser, alex) {
  const { page } = alex
  // An email reset link, made the way the server makes one.
  const config = await prisma.config.findUnique({
    where: { key: 'flare_config' },
  })
  config.value.settings.email = {
    ...config.value.settings.email,
    enabled: true,
    smtp: {
      ...config.value.settings.email.smtp,
      host: '127.0.0.1',
      port: 9,
      authentication: false,
    },
    fromAddress: 'no-reply@example.test',
    publicUrl: origin,
    recovery: { ...config.value.settings.email.recovery, enabled: true },
  }
  await prisma.config.update({
    where: { key: 'flare_config' },
    data: { value: config.value },
  })
  const token = randomBytes(32).toString('base64url')
  await prisma.emailToken.create({
    data: {
      userId: ALEX.id,
      email: `${ALEX.id}@example.test`,
      purpose: 'reset',
      tokenHash: createHash('sha256').update(token).digest('hex'),
      expiresAt: new Date(Date.now() + 600000),
    },
  })
  const encrypted = await prisma.file.count({
    where: { userId: ALEX.id, encrypted: true },
  })
  const visitor = await context(browser)
  const reset = visitor.page
  // The configuration is cached for a moment by the running application.
  await expect
    .poll(
      async () => {
        await reset.goto(`${origin}/auth/reset-password?token=${token}`)
        return reset
          .getByRole('button', { name: /I lost my recovery phrase/ })
          .count()
      },
      { timeout: 90000, intervals: [3000] }
    )
    .toBe(1)
  await reset.getByRole('button', { name: /I lost my recovery phrase/ }).click()
  await reset.locator('#reset-passphrase').fill(RESET_PASSPHRASE)
  await reset.locator('#reset-confirmation').fill(RESET_PASSPHRASE)
  await reset.getByLabel(/can never be\s+opened again/).check()
  await reset.getByRole('button', { name: 'Reset account keys' }).click()
  const mnemonic = await shared.saveRecoveryPhrase(reset, expect)
  accountKeys.push(shared.keysOfMnemonic(mnemonic).accountPrivateKey)
  await reset.waitForURL(/\/auth\/login/)
  assert.equal(
    await prisma.file.count({
      where: { userId: ALEX.id, encrypted: true, unreadable: true },
    }),
    encrypted
  )
  assert.equal(
    await prisma.vaultFolder.count({
      where: { userId: ALEX.id, folderPublicKey: { not: null } },
    }),
    0
  )
  assert.equal(
    await prisma.vaultTag.count({
      where: { userId: ALEX.id, sealedTagMetadata: { not: null } },
    }),
    0
  )

  await shared.signIn(reset, expect, {
    origin,
    email: `${ALEX.id}@example.test`,
    secret: RESET_PASSPHRASE,
  })
  await viewportHeight(reset, true)
  await reset.goto(`${origin}/dashboard`)
  await expect(
    reset.locator('[data-encrypted-file="unreadable"]').first()
  ).toBeVisible()
  await expect(
    reset.getByRole('link', { name: `Open ${PLAIN.name}`, exact: true })
  ).toBeVisible()
  assert.equal(
    await reset.locator('[data-encrypted-file="unreadable"]').count(),
    encrypted
  )
  await shot(reset, 'unreadable-files')
  // The folders and tags are usable again under placeholder names, with new keys.
  await expect(
    reset.getByRole('button', { name: /^Open folder Folder / }).first()
  ).toBeVisible()
  await expect
    .poll(() =>
      prisma.vaultFolder.count({
        where: { userId: ALEX.id, folderPublicKey: null },
      })
    )
    .toBe(0)
  // An unreadable file can be deleted.
  await reset
    .locator('[data-encrypted-file="unreadable"]')
    .first()
    .getByRole('button', { name: 'Delete' })
    .click()
  await shot(reset, 'unreadable-delete')
  await reset
    .getByRole('dialog')
    .getByRole('button', { name: 'Delete file' })
    .click()
  await expect
    .poll(() =>
      prisma.file.count({ where: { userId: ALEX.id, encrypted: true } })
    )
    .toBe(encrypted - 1)
  await visitor.ctx.close()
  void page
  results.push(
    `A reset without the recovery phrase marks all ${encrypted} encrypted files of the account unreadable and leaves the plain files as they were; the library shows each as unreadable with a delete action that works; the folders and tags come back under placeholder names and get new keys at the next unlock`
  )
}

// ---------------------------------------------------------------- main

async function main() {
  const proxy = await startRecordingProxy()
  const browser = await chromium.launch({ headless: true })
  try {
    const seeded = await seed()
    const alex = await signIn(browser)
    await useTheme(alex)
    await testConversion(alex, seeded)
    await testFolders(browser, alex)
    await testTagsAndPending(alex)
    await testOcrDialog(browser, alex)
    const cacheOf = await testSearch(alex)
    if (process.env.FLARE_E2EE_SCREENSHOTS) {
      const locked = await signIn(browser)
      await testLocked(locked)
      await locked.ctx.close()
    }
    await testRotation(browser, alex, cacheOf)
    await assertNothingSecretWasSent()
    await testReset(browser, alex)

    assert.deepEqual(external, [], 'A page asked another site')
    assert.deepEqual(pageProblems, [], 'A page logged an error')
    for (const result of results) console.log(`PASS: ${result}`)
    if (!fixtures.video)
      console.log(
        'SKIPPED: the video thumbnail. No ffmpeg with libvpx was found to make the fixture.'
      )
  } catch (error) {
    if (process.env.FLARE_E2EE_DEBUG) {
      await mkdir(process.env.FLARE_E2EE_DEBUG, { recursive: true })
      let index = 0
      for (const ctx of browser.contexts())
        for (const page of ctx.pages())
          await page
            .screenshot({
              path: path.join(
                process.env.FLARE_E2EE_DEBUG,
                `failure-${index++}.png`
              ),
            })
            .catch(() => undefined)
      console.error(pageProblems.join('\n'))
      console.error(
        workFailures.map((failure) => `WORK FAILURE: ${failure}`).join('\n')
      )
      for (const ctx of browser.contexts())
        for (const page of ctx.pages())
          console.error(
            `DEBUG ${page.url().slice(0, 90)}: ${page.workers().length} workers, violations ${JSON.stringify(await page.evaluate(() => window.__cspViolations).catch(() => null))}`
          )
      console.error(
        `DEBUG last requests: ${requests
          .slice(-12)
          .map((request) => `${request.method} ${request.target.slice(0, 70)}`)
          .join(' | ')}`
      )
      console.error(
        results
          .map((result) => `PASSED BEFORE: ${result.slice(0, 80)}`)
          .join('\n')
      )
    }
    throw error
  } finally {
    await browser.close()
    proxy.close()
    await prisma.$disconnect()
  }
}
main().catch((error) => {
  console.error(error.stack || error.message)
  process.exitCode = 1
})
void readFile
