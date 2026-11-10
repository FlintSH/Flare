/* eslint-disable @typescript-eslint/no-require-imports */
// Real browser checks of what encrypted files do with their content
// (docs/e2ee-spec.md, sections 12.2 to 12.6): video and audio from a local
// address of the service worker, streamed downloads, PDF, archives, the
// account export, pastes and short links. A production build, a disposable
// database, real uploads and real requests.
//
// The browser talks to the application through a small recording proxy that
// this script starts. The proxy keeps every request as it arrived and counts
// the ciphertext bytes each one asked for, so the suite can prove that a
// seek fetched a part of a file and that no request carried a secret.
//
// Setup, with the application built (`pnpm build`) and PostgreSQL running:
//
//   export DATABASE_URL='postgresql://flare_test@127.0.0.1:5432/flare_e2ee_media_local'
//   pnpm exec prisma migrate deploy
//   NEXTAUTH_URL='http://localhost:3294' NEXTAUTH_SECRET=... \
//     pnpm exec next start -H 127.0.0.1 -p 3293
//   node scripts/e2ee/verify-media.cjs
//
// The application listens on 3293. The proxy of this script listens on
// 3294, which is the origin the browser uses and `NEXTAUTH_URL` names.
// `FLARE_E2EE_MEDIA_ORIGIN` and `FLARE_E2EE_MEDIA_UPSTREAM` change both.
// The video and audio fixtures need an ffmpeg with libvpx and libopus
// (`FLARE_FFMPEG`). They are kept in `FLARE_E2EE_MEDIA_FIXTURES`.
const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const { createHash, randomBytes } = require('node:crypto')
const {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} = require('node:fs')
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
const archiver = require('archiver')
const tarStream = require('tar-stream')
const yauzl = require('yauzl')
const shared = require('../shared/passphrase-accounts.cjs')
const expect = baseExpect.configure({ timeout: 45000 })

const origin = process.env.FLARE_E2EE_MEDIA_ORIGIN || 'http://localhost:3294'
const upstream =
  process.env.FLARE_E2EE_MEDIA_UPSTREAM || 'http://127.0.0.1:3293'
if (new URL(origin).hostname !== 'localhost')
  throw new Error('Use a disposable localhost instance, matching NEXTAUTH_URL.')
const database = new URL(process.env.DATABASE_URL || 'postgresql://unset/')
if (
  !['localhost', '127.0.0.1'].includes(database.hostname) ||
  database.pathname !== '/flare_e2ee_media_local'
)
  throw new Error(
    'This check needs a local PostgreSQL database named exactly flare_e2ee_media_local.'
  )
const screenshots = process.env.FLARE_E2EE_SCREENSHOTS
const mobile = process.env.FLARE_E2EE_VIEWPORT === 'mobile'
const theme = process.env.FLARE_E2EE_THEME === 'light' ? 'light' : 'dark'
const only = (process.env.FLARE_E2EE_MEDIA_ONLY || '')
  .split(',')
  .filter(Boolean)
const fixtureDirectory =
  process.env.FLARE_E2EE_MEDIA_FIXTURES ||
  path.join(os.tmpdir(), 'flare-e2ee-media-fixtures')
const prisma = new PrismaClient()
const results = []

// Demonstration secrets. They are public and only for disposable fixtures.
const PASSPHRASE = 'copper lantern walrus opera 58'
const FILE_PASSWORD = 'harbor violet canyon pepper 41'
const accounts = {
  alex: { id: 'e2ee-media-alex', name: 'Alex Morgan' },
}
const LOCAL_PREFIX = '/_flare/local/'
const STORED_CHUNK = 65568
const CHUNK = 65536

// ---------------------------------------------------------------- fixtures

/** A text that is in the plaintext of a fixture and must never leave the browser. */
const marker = (name) => `FLARE-PLAINTEXT-MARKER-${name}-9f3a7c`

function ffmpegBinary() {
  const candidates = [
    process.env.FLARE_FFMPEG,
    path.join(
      os.homedir(),
      '.local/share/film-deps/ffmpeg/ffmpeg-n8.1-latest-linux64-gpl-8.1/bin/ffmpeg'
    ),
    'ffmpeg',
  ].filter(Boolean)
  for (const candidate of candidates) {
    try {
      execFileSync(candidate, ['-version'], { stdio: 'ignore' })
      return candidate
    } catch {
      // Try the next candidate.
    }
  }
  return null
}

/** Makes a media fixture once and reads it from the fixture directory after that. */
function mediaFixture(file, args) {
  const out = path.join(fixtureDirectory, file)
  if (!existsSync(out)) {
    const ffmpeg = ffmpegBinary()
    if (!ffmpeg) return null
    mkdirSync(fixtureDirectory, { recursive: true })
    try {
      execFileSync(ffmpeg, ['-y', '-loglevel', 'error', ...args, out], {
        stdio: 'ignore',
      })
    } catch {
      return null
    }
  }
  return readFileSync(out)
}

/** Three minutes of VP8 and Opus, about 38 MiB: far more than a player reads to start. */
const longVideo = mediaFixture('long-video.webm', [
  '-f',
  'lavfi',
  '-i',
  'testsrc2=size=640x360:rate=24',
  '-f',
  'lavfi',
  '-i',
  'sine=frequency=440:sample_rate=48000',
  '-t',
  '180',
  '-c:v',
  'libvpx',
  '-deadline',
  'realtime',
  '-cpu-used',
  '8',
  '-b:v',
  '1600k',
  '-minrate',
  '1600k',
  '-maxrate',
  '1600k',
  '-g',
  '48',
  '-c:a',
  'libopus',
  '-b:a',
  '64k',
  '-metadata',
  `title=${marker('video')}`,
])
const audioTrack = mediaFixture('tone.ogg', [
  '-f',
  'lavfi',
  '-i',
  'sine=frequency=330:sample_rate=48000',
  '-t',
  '240',
  '-c:a',
  'libopus',
  '-b:a',
  '96k',
  '-metadata',
  `title=${marker('audio')}`,
])

function pdfFixture(text) {
  const stream = `BT /F1 20 Tf 40 120 Td (${text}) Tj ET`
  const objects = [
    '<</Type/Catalog/Pages 2 0 R>>',
    '<</Type/Pages/Kids[3 0 R]/Count 1>>',
    '<</Type/Page/Parent 2 0 R/MediaBox[0 0 520 200]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>',
    `<</Length ${stream.length}>>stream\n${stream}\nendstream`,
    '<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>',
  ]
  let body = '%PDF-1.4\n'
  const offsets = objects.map((object, index) => {
    const offset = body.length
    body += `${index + 1} 0 obj${object}endobj\n`
    return offset
  })
  const xref = body.length
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const offset of offsets)
    body += `${String(offset).padStart(10, '0')} 00000 n \n`
  body += `trailer<</Size ${objects.length + 1}/Root 1 0 R>>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(body, 'latin1')
}

function pngChunk(type, data) {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(zlib.crc32(body) >>> 0)
  return Buffer.concat([length, body, crc])
}

/** A real 96 by 64 PNG with a gradient, and the marker in a text chunk. */
function pngFixture(text) {
  const width = 96
  const height = 64
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header.set([8, 2, 0, 0, 0], 8)
  const rows = Buffer.alloc(height * (1 + width * 3))
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const offset = y * (1 + width * 3) + 1 + x * 3
      rows[offset] = 40 + x * 2
      rows[offset + 1] = 60 + y * 2
      rows[offset + 2] = 200 - x
    }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', header),
    pngChunk('tEXt', Buffer.from(`Comment\0${text}`, 'latin1')),
    pngChunk('IDAT', zlib.deflateSync(rows)),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

const HOSTILE_HTML = `<!doctype html><title>${marker('html')}</title>
<script>window.__flarePwned = 'html-script'; try { parent.__flarePwned = 'html-script' } catch {} try { top.__flarePwned = 'html-script' } catch {}</script>
<img src="x" onerror="window.__flarePwned = 'html-onerror'">
<p>${marker('html')}</p>`
const HOSTILE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="120" onload="window.__flarePwned = 'svg-onload'">
<script>window.__flarePwned = 'svg-script'; try { top.__flarePwned = 'svg-script' } catch {}</script>
<rect width="240" height="120" fill="#2d6cdf"/><text x="16" y="64" fill="#fff" font-size="14">${marker('svg').slice(0, 26)}</text>
</svg>`

/** 24 MiB that does not compress: several upload parts and many chunks. */
function largeFixture() {
  const body = randomBytes(24 * 1024 * 1024 + 4321)
  body.write(marker('large'), 70000, 'latin1')
  return body
}

const fixtures = {
  pdf: {
    name: 'contract-draft-private.pdf',
    mimeType: 'application/pdf',
    buffer: pdfFixture(marker('pdf')),
    marker: marker('pdf'),
  },
  large: {
    name: 'backup-volume-private.bin',
    mimeType: 'application/octet-stream',
    buffer: largeFixture(),
    marker: marker('large'),
  },
  html: {
    name: 'landing-page-private.html',
    mimeType: 'text/html',
    buffer: Buffer.from(HOSTILE_HTML),
    marker: marker('html'),
  },
  svg: {
    name: 'diagram-private.svg',
    mimeType: 'image/svg+xml',
    buffer: Buffer.from(HOSTILE_SVG),
    marker: marker('svg').slice(0, 26),
  },
  image: {
    name: 'harbor-sunrise-private.png',
    mimeType: 'image/png',
    buffer: pngFixture(marker('image')),
    marker: marker('image'),
  },
  text: {
    name: 'budget-notes-private.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from(
      `${marker('text')}\nQuarterly notes.\nLine three of the notes.\n`
    ),
    marker: marker('text'),
  },
}
if (longVideo)
  fixtures.video = {
    name: 'product-walkthrough-private.webm',
    mimeType: 'video/webm',
    buffer: longVideo,
    marker: marker('video'),
  }
if (audioTrack)
  fixtures.audio = {
    name: 'voice-memo-private.ogg',
    mimeType: 'audio/ogg',
    buffer: audioTrack,
    marker: marker('audio'),
  }
const PLAIN = {
  name: 'public-screenshot.png',
  mimeType: 'image/png',
  buffer: pngFixture('a plain file'),
}

// ---------------------------------------------------------------- recording

/**
 * Every request the browser sent, as it arrived: `{ method, target, headers,
 * body, range, sent }`. `sent` is the number of body bytes of the answer
 * that the proxy passed on before the browser stopped reading.
 */
const requests = []

function startRecordingProxy() {
  const target = new URL(upstream)
  const listen = new URL(origin)
  const server = http.createServer((request, response) => {
    const chunks = []
    request.on('data', (chunk) => chunks.push(chunk))
    request.on('end', () => {
      const body = Buffer.concat(chunks)
      const entry = {
        method: request.method,
        // The request target exactly as the browser wrote it on the wire.
        target: request.url,
        headers: JSON.stringify(request.rawHeaders),
        range: request.headers.range || null,
        body: body.toString('latin1'),
        status: 0,
        sent: 0,
      }
      requests.push(entry)
      const forward = http.request(
        {
          host: target.hostname,
          port: target.port,
          method: request.method,
          path: request.url,
          headers: request.headers,
        },
        (answer) => {
          entry.status = answer.statusCode
          response.writeHead(answer.statusCode, answer.rawHeaders)
          answer.on('data', (chunk) => {
            entry.sent += chunk.length
          })
          answer.pipe(response)
        }
      )
      // A reader that stops (a seek, a cancelled download) stops the source.
      response.on('close', () => forward.destroy())
      forward.on('error', () => {
        if (!response.headersSent) response.statusCode = 502
        response.end()
      })
      forward.end(body)
    })
  })
  return new Promise((resolve) =>
    server.listen(Number(listen.port), '127.0.0.1', () => resolve(server))
  )
}

/** The ciphertext requests for one file since `from`, with the bytes each asked for. */
function ciphertextRequests(row, from = 0) {
  return requests
    .slice(from)
    .filter(
      (request) =>
        request.method === 'GET' &&
        request.target.split('?')[0] === `/api/files${row.urlPath}`
    )
    .map((request) => {
      const match = /^bytes=(\d+)-(\d+)$/.exec(request.range || '')
      return {
        start: match ? Number(match[1]) : 0,
        end: match ? Number(match[2]) + 1 : null,
        asked: match ? Number(match[2]) + 1 - Number(match[1]) : null,
        sent: request.sent,
        target: request.target,
      }
    })
}

// ---------------------------------------------------------------- crypto
// Independent code for the records, so the search knows every key the
// browser made without asking the application for it.

const deriveKey = (context, material) =>
  blake3(material, { context: new Uint8Array(Buffer.from(context, 'ascii')) })

function openBox(key, nonce, ciphertext) {
  return xchacha20(
    deriveKey('flare e2ee v1 seal cipher', key),
    nonce,
    ciphertext
  )
}

function exchangePrivateKeyOf(accountPrivateKeyHex) {
  const key = sha512(Buffer.from(accountPrivateKeyHex, 'hex')).slice(0, 32)
  key[0] &= 248
  key[31] &= 127
  key[31] |= 64
  return key
}

/** `file_key` of a stored file, from the account private key and the account stanza. */
function fileKeyOf(file, accountPrivateKeyHex) {
  const exchangePrivateKey = exchangePrivateKeyOf(accountPrivateKeyHex)
  const stanza = Buffer.from(file.accountStanza).subarray(1)
  const ephemeralPublicKey = stanza.subarray(0, 32)
  const sharedSecret = x25519.getSharedSecret(
    exchangePrivateKey,
    ephemeralPublicKey
  )
  const stanzaKey = deriveKey(
    'flare e2ee v1 account stanza',
    Buffer.concat([
      sharedSecret,
      ephemeralPublicKey,
      x25519.getPublicKey(exchangePrivateKey),
    ])
  )
  const nonce = deriveKey('flare e2ee v1 one-time nonce', stanzaKey).slice(
    0,
    24
  )
  return Buffer.from(openBox(stanzaKey, nonce, stanza.subarray(32, 64)))
}

function linkSecretOf(file, fileKey) {
  const sealed = Buffer.from(file.passwordStanza).subarray(1 + 128)
  const key = deriveKey('flare e2ee v1 link secret copy', fileKey)
  return Buffer.from(
    openBox(key, sealed.subarray(0, 24), sealed.subarray(24, 56))
  )
}

/** The name and type in `sealed_metadata`, opened with independent code. */
function metadataOf(file, fileKey) {
  const sealed = Buffer.from(file.sealedMetadata).subarray(1)
  const key = deriveKey('flare e2ee v1 file metadata', fileKey)
  return JSON.parse(
    Buffer.from(
      openBox(key, sealed.subarray(0, 24), sealed.subarray(24, -32))
    ).toString('utf8')
  )
}

/** The whole plaintext of a stored file, decrypted with independent code. */
async function plaintextOf(file, fileKey) {
  const stored = await readFile(path.join(appDirectory, file.path))
  const noncePrefix = stored.subarray(10, 26)
  const cipherKey = deriveKey('flare e2ee v1 content cipher', fileKey)
  const parts = []
  for (
    let offset = 26, index = 0;
    offset < stored.length;
    offset += STORED_CHUNK, index++
  ) {
    const chunk = stored.subarray(
      offset,
      Math.min(offset + STORED_CHUNK, stored.length) - 32
    )
    const counter = Buffer.alloc(8)
    counter.writeBigUInt64LE(BigInt(index))
    parts.push(
      Buffer.from(
        xchacha20(cipherKey, Buffer.concat([noncePrefix, counter]), chunk)
      )
    )
  }
  return Buffer.concat(parts)
}

function byteForms(bytes) {
  const buffer = Buffer.from(bytes)
  return [
    buffer.toString('hex'),
    buffer.toString('hex').toUpperCase(),
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

/** What the share links of this run carried after `#`, as text. */
const fragments = new Set()
/** File passwords typed into a page. */
const passwords = new Set()
/** Plaintext names and texts that later scenarios add: archive entries and the like. */
const extraPlaintext = new Map()
/** Local address tokens the suite saw. They are not secrets, and still never leave the browser. */
const localTokens = new Set()

async function assertNothingSecretWasSent(keys) {
  const forbidden = new Map()
  const add = (label, forms) => {
    for (const form of forms) if (form.length >= 8) forbidden.set(form, label)
  }
  add(
    'the account_private_key',
    byteForms(Buffer.from(keys.accountPrivateKey, 'hex'))
  )
  add(
    'the exchange_private_key',
    byteForms(exchangePrivateKeyOf(keys.accountPrivateKey))
  )
  add('a passphrase', textForms(PASSPHRASE))
  for (const password of passwords) add('a file password', textForms(password))
  for (const fragment of fragments) add('a link fragment', [fragment])
  const files = await prisma.file.findMany({
    where: { userId: accounts.alex.id, encrypted: true },
  })
  let linkSecrets = 0
  const names = new Set()
  for (const file of files) {
    const fileKey = fileKeyOf(file, keys.accountPrivateKey)
    add('a file_key', byteForms(fileKey))
    for (const context of [
      'content cipher',
      'content mac',
      'file metadata',
      'link secret copy',
    ])
      add(
        `a key derived from file_key (${context})`,
        byteForms(deriveKey(`flare e2ee v1 ${context}`, fileKey))
      )
    if (file.passwordStanza) {
      add('a link_secret', byteForms(linkSecretOf(file, fileKey)))
      linkSecrets++
    }
    const metadata = metadataOf(file, fileKey)
    names.add(metadata.name)
    add('the name of an encrypted file', textForms(metadata.name))
  }
  for (const fixture of Object.values(fixtures)) {
    add('plaintext of an encrypted file', textForms(fixture.marker))
    add('the name of an encrypted file', textForms(fixture.name))
  }
  for (const [text, label] of extraPlaintext) add(label, textForms(text))
  for (const token of localTokens) add('a local address', [token])
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
  assert.ok(
    requests.every((request) => !request.target.startsWith(LOCAL_PREFIX)),
    'A request for a local address reached the server'
  )
  // The search can fail: the plain upload did send its name and its bytes.
  const plainSeen = requests.filter(
    (request) =>
      request.body.includes(PLAIN.name) && request.body.includes('a plain file')
  ).length
  assert.ok(plainSeen >= 1, 'The search did not see the plain upload')
  const bodies = requests.filter((request) => request.body).length
  results.push(
    `No request carried a secret: the recording proxy kept ${requests.length} requests (${bodies} with a body, ${Math.round(requests.reduce((total, request) => total + request.body.length, 0) / 1048576)} MiB of bodies) as they arrived, and none holds, in its request target, headers or body, any of ${forbidden.size} forms of: the account private key and its exchange key, the passphrase, ${passwords.size} file passwords, ${fragments.size} link fragments, the file_key of each of ${files.length} encrypted files and the four keys derived from it, ${linkSecrets} link secrets, the plaintext markers of the fixtures, ${names.size} decrypted file names, ${extraPlaintext.size} names and texts from inside archives and the export, and ${localTokens.size} local address tokens. No request target has a '#', and no request for ${LOCAL_PREFIX} reached the server. The same search found the plain upload's name and bytes in ${plainSeen} request, which is the one upload that sends them by design`
  )
}

function safeDecode(text) {
  try {
    return decodeURIComponent(text)
  } catch {
    return text
  }
}

// ---------------------------------------------------------------- browser

const appDirectory = path.resolve(__dirname, '../..')
let address = 10
/** Console errors and policy violations of every page, by page address. */
const pageProblems = []
/** Times the browser refused to run script in a sandboxed answer of a local address. */
let sandboxRefusals = 0

async function context(browser, options = {}) {
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
    ...options,
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
    // What the service worker tells this page: `need` shows that a worker
    // started again without its keys and asked for them.
    window.__workerMessages = []
    try {
      // A sandboxed frame throws when it reads the property.
      navigator.serviceWorker?.addEventListener('message', (event) => {
        if (event.data && typeof event.data.type === 'string')
          window.__workerMessages.push(event.data.type)
      })
    } catch {}
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
  if (process.env.FLARE_E2EE_MEDIA_TRACE)
    page.on('response', (response) => {
      if (!response.url().includes(LOCAL_PREFIX)) return
      console.error(
        `TRACE ${response.status()} ${response.request().resourceType()} ${response.headers()['content-type']} ${response.url().slice(-12)} from-worker=${response.fromServiceWorker()}`
      )
    })
  page.on('pageerror', (error) => {
    pageProblems.push(`${page.url()}: page error: ${error.message}`)
  })
  page.on('console', (message) => {
    if (message.type() !== 'error') return
    const text = message.text()
    // A request that was refused on purpose logs a resource error.
    if (/Failed to load resource/.test(text)) return
    // The answer of a local address is sandboxed. In a frame the browser
    // then refuses even the script this suite adds to every document, and
    // says so. That is the policy at work, not a fault of a page.
    if (
      /Blocked script execution in '[^']*\/_flare\/local\/[^']*' because the document's frame is sandboxed/.test(
        text
      )
    ) {
      sandboxRefusals++
      return
    }
    pageProblems.push(`${page.url()}: console error: ${text}`)
  })
}

async function violations(page) {
  return page.evaluate(() => window.__cspViolations.slice())
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

async function clipboard(page) {
  return page.evaluate(() => navigator.clipboard.readText())
}

/** Records the fragment of a link the suite read, and returns the link. */
function link(text) {
  const hash = text.indexOf('#')
  assert.ok(hash > 0, `The link has no fragment: ${text}`)
  fragments.add(text.slice(hash + 1))
  return text
}

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')

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
  config.value.settings.general.ocr = { enabled: false }
  config.value.settings.general.oidc = { enabled: false }
  config.value.settings.advanced = { customCSS: '', customHead: '' }
  await prisma.config.update({
    where: { key: 'flare_config' },
    data: { value: config.value },
  })
  await prisma.user.deleteMany({
    where: { id: { in: Object.values(accounts).map(({ id }) => id) } },
  })
  await prisma.authRateLimit.deleteMany()
  const record = await shared.createAccountRecord(PASSPHRASE)
  const keys = shared.keysOfMnemonic(record.mnemonic)
  await prisma.user.create({
    data: {
      id: accounts.alex.id,
      name: accounts.alex.name,
      email: `${accounts.alex.id}@example.test`,
      ...record.columns,
      roles: { connect: { systemKey: 'administrator' } },
      urlId: 'alexm',
      uploadToken: `${accounts.alex.id}-public-disposable-upload-token`,
    },
  })
  return keys
}

async function signIn(browser, options) {
  const signedIn = await context(browser, options)
  await shared.signIn(signedIn.page, expect, {
    origin,
    email: `${accounts.alex.id}@example.test`,
    secret: PASSPHRASE,
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

/** The share link of each uploaded fixture, by file name. */
const uploaded = {}
let accountPrivateKey = ''

/**
 * Files are chosen by path: the browser reads large ones from disk, as a
 * person's browser does, and takes each type from the file's extension.
 */
async function chooseFiles(page, list) {
  const directory = path.join(fixtureDirectory, 'upload')
  mkdirSync(directory, { recursive: true })
  const paths = []
  for (const { name, buffer } of list) {
    const file = path.join(directory, name)
    writeFileSync(file, buffer)
    paths.push(file)
  }
  await page.locator('input[type="file"]').setInputFiles(paths)
}

async function uploadEncrypted(page, list, { password } = {}) {
  await page.goto(`${origin}/dashboard/upload`)
  await expect(page.locator('[data-encryption-choice]')).toHaveAttribute(
    'data-encryption-choice',
    'encrypted'
  )
  await chooseFiles(page, list)
  if (password) {
    passwords.add(password)
    await page.locator('#upload-password').fill(password)
    await expect(page.locator('#upload-password-hint')).toHaveAttribute(
      'data-strength-score',
      /[34]/
    )
  }
  await page.getByRole('button', { name: /^Upload \d+ files?$/ }).click()
  for (const { name } of list)
    await expect(
      page.getByRole('link', { name: `Open ${name}`, exact: true })
    ).toBeVisible({ timeout: 240000 })
  const links = {}
  for (const { name } of list) {
    await page
      .getByRole('button', { name: `Copy link for ${name}`, exact: true })
      .click()
    await expect
      .poll(() => clipboard(page))
      .toMatch(/\/alexm\/e_[A-Za-z0-9_-]{22}#/)
    links[name] = link(await clipboard(page))
  }
  return links
}

/** The database row of an uploaded fixture, found by its address. */
async function rowOf(address) {
  const urlPath = new URL(address).pathname
  return prisma.file.findUniqueOrThrow({ where: { urlPath } })
}

async function expectShareState(page, state) {
  await expect(page.locator('[data-encrypted-share]')).toHaveAttribute(
    'data-encrypted-share',
    state,
    { timeout: 60000 }
  )
}

/** The local address a media element or frame of the page plays from. */
async function localSource(locator) {
  await expect
    .poll(() => locator.evaluate((element) => element.getAttribute('src')))
    .toMatch(/^\/_flare\/local\/[A-Za-z0-9_-]{43}/)
  const src = await locator.evaluate((element) => element.getAttribute('src'))
  localTokens.add(src.slice(LOCAL_PREFIX.length).split('#')[0])
  return src
}

async function waitForMetadata(player) {
  await expect
    .poll(() => player.evaluate((element) => element.readyState >= 1), {
      timeout: 30000,
    })
    .toBe(true)
}

/** Plays from `time` and waits until the playhead moved past it. */
async function playFrom(player, time) {
  await player.evaluate(async (element, time) => {
    element.muted = true
    element.currentTime = time
    await element.play()
  }, time)
  await expect
    .poll(() => player.evaluate((element) => element.currentTime), {
      timeout: 30000,
    })
    .toBeGreaterThan(time + 0.4)
  await player.evaluate((element) => element.pause())
}

/** Stops every service worker of the browser through the DevTools protocol. */
async function stopServiceWorkers(page) {
  const session = await page.context().newCDPSession(page)
  const versions = []
  session.on('ServiceWorker.workerVersionUpdated', (event) =>
    versions.push(...event.versions)
  )
  await session.send('ServiceWorker.enable')
  await expect
    .poll(() => versions.some((version) => version.runningStatus === 'running'))
    .toBe(true)
  await session.send('ServiceWorker.stopAllWorkers')
  await expect
    .poll(() => {
      const last = new Map()
      for (const version of versions) last.set(version.versionId, version)
      return [...last.values()].every(
        (version) => version.runningStatus === 'stopped'
      )
    })
    .toBe(true)
  await session.send('ServiceWorker.disable')
  await session.detach()
}

// ---------------------------------------------------------------- scenarios

async function testUploads(alex) {
  const { page } = alex
  const small = [
    fixtures.pdf,
    fixtures.html,
    fixtures.svg,
    fixtures.image,
    fixtures.text,
  ]
  if (fixtures.audio) small.push(fixtures.audio)
  Object.assign(uploaded, await uploadEncrypted(page, small))
  const large = [fixtures.large]
  if (fixtures.video) large.push(fixtures.video)
  Object.assign(uploaded, await uploadEncrypted(page, large))
  // One plain file: the search at the end must be able to find something.
  await page.goto(`${origin}/dashboard/upload`)
  await page.getByRole('radio', { name: /Plain/ }).check()
  await chooseFiles(page, [PLAIN])
  await page.getByRole('button', { name: /^Upload 1 file$/ }).click()
  await expect(
    page.getByRole('link', { name: `Open ${PLAIN.name}`, exact: true })
  ).toBeVisible()
}

async function testVideo(browser) {
  if (!fixtures.video) return
  const fixture = fixtures.video
  const row = await rowOf(uploaded[fixture.name])
  const storedBytes = Math.round(row.size * 1048576)
  const visitor = await context(browser)
  const { page } = visitor
  const before = requests.length
  await page.goto(uploaded[fixture.name])
  await expectShareState(page, 'open')
  const player = page.locator('video')
  await expect(player).toBeVisible()
  const src = await localSource(player)
  await waitForMetadata(player)
  assert.equal(await player.evaluate((element) => element.videoWidth), 640)
  const duration = await player.evaluate((element) => element.duration)
  assert.ok(Math.abs(duration - 180) < 1, `duration ${duration}`)
  const asked = () =>
    ciphertextRequests(row, before).reduce(
      (sum, request) => sum + (request.asked ?? storedBytes),
      0
    )
  const sent = () =>
    ciphertextRequests(row, before).reduce(
      (sum, request) => sum + request.sent,
      0
    )
  const atStart = { asked: asked(), sent: sent() }
  assert.ok(
    ciphertextRequests(row, before).every((request) => request.asked !== null),
    'A request asked for the whole ciphertext'
  )
  assert.ok(
    atStart.asked < storedBytes * 0.3,
    `The player read ${atStart.asked} of ${storedBytes} bytes before it played`
  )
  await shot(page, 'media-video')

  // A seek to 80 percent: the chunks there, not the 80 percent before them.
  const seekTo = Math.floor(duration * 0.8)
  await playFrom(player, seekTo)
  const afterSeek = { asked: asked(), sent: sent() }
  assert.ok(
    afterSeek.asked < storedBytes * 0.5,
    `After the seek the browser had asked for ${afterSeek.asked} of ${storedBytes} bytes`
  )
  const near = ciphertextRequests(row, before).filter(
    (request) => request.start > storedBytes * 0.7
  )
  assert.ok(near.length >= 1, 'No request was for the part the seek went to')
  // Every range starts and ends at a border of stored chunks.
  for (const request of ciphertextRequests(row, before)) {
    assert.equal((request.start - 26) % STORED_CHUNK, 0, 'range start')
    assert.ok(
      request.end === storedBytes || (request.end - 26) % STORED_CHUNK === 0,
      'range end'
    )
  }
  assert.equal(await page.evaluate(() => window.__flarePwned), undefined)
  assert.deepEqual(await violations(page), [])
  results.push(
    `An encrypted ${Math.round(fixture.buffer.length / 1048576)} MiB video plays for a signed-out visitor of its share link from the local address ${LOCAL_PREFIX}{token}: the <video> has its real size (640 px) and duration (180 s) after ${ciphertextRequests(row, 0).length ? Math.round((atStart.asked / storedBytes) * 100) : 0}% of the ciphertext was asked for (${atStart.asked} of ${storedBytes} bytes, ${atStart.sent} sent), and a seek to ${seekTo} s plays after ${Math.round((afterSeek.asked / storedBytes) * 100)}% in total (${afterSeek.asked} bytes asked, ${afterSeek.sent} sent) in ${ciphertextRequests(row, before).length} range requests that all start and end at stored chunk borders`
  )

  // The browser stops the worker. Playback goes on from a part that was
  // never fetched: the new worker asks this page for the key.
  const needsBefore = await page.evaluate(
    () =>
      window.__workerMessages.filter((type) => type === 'flare-local-need')
        .length
  )
  await stopServiceWorkers(page)
  await playFrom(player, Math.floor(duration * 0.35))
  const needs = await page.evaluate(
    () =>
      window.__workerMessages.filter((type) => type === 'flare-local-need')
        .length
  )
  assert.ok(needs > needsBefore, 'The restarted worker did not ask for the key')
  assert.equal(
    await player.evaluate((element) => element.getAttribute('src')),
    src,
    'The player changed its address'
  )
  await expect(page.getByText('This video couldn’t be played')).toHaveCount(0)
  results.push(
    `After the service worker was stopped through the DevTools protocol (ServiceWorker.stopAllWorkers), the same <video> plays from 35% of the file, which it had not fetched: the new worker had no key, asked the page (${needs - needsBefore} "need" message), the page gave the key again, and the address did not change`
  )
  await visitor.ctx.close()
}

async function testAudio(browser) {
  if (!fixtures.audio) return
  const fixture = fixtures.audio
  const visitor = await context(browser)
  const { page } = visitor
  await page.goto(uploaded[fixture.name])
  await expectShareState(page, 'open')
  const player = page.locator('audio')
  await expect(player).toBeVisible()
  await localSource(player)
  await waitForMetadata(player)
  const duration = await player.evaluate((element) => element.duration)
  assert.ok(Math.abs(duration - 240) < 1, `duration ${duration}`)
  await playFrom(player, 200)
  await shot(page, 'media-audio')
  assert.deepEqual(await violations(page), [])
  await visitor.ctx.close()
  results.push(
    'An encrypted Ogg Opus file plays in the <audio> element of its share page from a local address, with its real duration (240 s), and plays on after a seek to 200 s'
  )
}

async function testPasswordVideo(browser, alex) {
  if (!fixtures.video) return
  // A second, shorter copy with a password: the first 3 MiB are still a video.
  const short = {
    name: 'team-update-private.webm',
    mimeType: 'video/webm',
    buffer: mediaFixture('short-video.webm', [
      '-f',
      'lavfi',
      '-i',
      'testsrc2=size=320x180:rate=24',
      '-t',
      '20',
      '-c:v',
      'libvpx',
      '-deadline',
      'realtime',
      '-cpu-used',
      '8',
      '-b:v',
      '900k',
      '-metadata',
      `title=${marker('shortvideo')}`,
    ]),
    marker: marker('shortvideo'),
  }
  if (!short.buffer) return
  fixtures.shortVideo = short
  const links = await uploadEncrypted(alex.page, [short], {
    password: FILE_PASSWORD,
  })
  const address = links[short.name]
  assert.match(address, /#p\.[A-Za-z0-9_-]{43}$/)
  uploaded[short.name] = address
  const visitor = await context(browser)
  const { page } = visitor
  await page.goto(address)
  await expectShareState(page, 'password')
  await page.locator('#encrypted-share-password').fill(FILE_PASSWORD)
  await page.getByRole('button', { name: 'Open file' }).click()
  await expectShareState(page, 'open')
  const player = page.locator('video')
  await localSource(player)
  await waitForMetadata(player)
  assert.equal(await player.evaluate((element) => element.videoWidth), 320)
  await playFrom(player, 12)
  await visitor.ctx.close()

  // The owner, signed in, without a fragment: the account stanza gives the key.
  await alex.page.goto(address.split('#')[0])
  await expectShareState(alex.page, 'open')
  const own = alex.page.locator('video')
  await localSource(own)
  await waitForMetadata(own)
  await playFrom(own, 5)
  results.push(
    'A video with a password plays from a local address for a signed-out visitor after the password is typed (the key comes from the link secret and the password, in the browser), and for its owner without a fragment (the key comes from the account stanza)'
  )
}

/**
 * The attack: decrypted bytes are attacker-controlled content at an address
 * of the application's origin. The suite registers addresses the way a page
 * does, for files that are HTML and SVG with script, and then opens them in
 * every way a browser can.
 */
async function testNavigationAttack(browser) {
  const visitor = await context(browser)
  const { page } = visitor
  // A page that is controlled by the worker, with a real file open.
  await page.goto(uploaded[fixtures.image.name])
  await expectShareState(page, 'open')
  // The worker is registered by the first file that needs it.
  await page.goto(uploaded[(fixtures.video || fixtures.pdf).name])
  await expectShareState(page, 'open')
  await expect
    .poll(() =>
      page.evaluate(() => Boolean(navigator.serviceWorker.controller))
    )
    .toBe(true)

  const rows = {
    html: await rowOf(uploaded[fixtures.html.name]),
    svg: await rowOf(uploaded[fixtures.svg.name]),
  }
  /** Registers an address for a hostile file, as script of the page can. */
  const register = (kind, mode, contentType) =>
    page.evaluate(
      async ({ urlPath, header, key, mode, contentType }) => {
        const decode = (text) =>
          Uint8Array.from(
            atob(text.replace(/-/g, '+').replace(/_/g, '/')),
            (character) => character.charCodeAt(0)
          )
        const token = btoa(
          String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))
        )
          .replace(/\+/g, '-')
          .replace(/\//g, '_')
          .replace(/=+$/, '')
        const channel = new MessageChannel()
        const reply = new Promise((resolve) => {
          channel.port1.onmessage = (event) => resolve(event.data)
        })
        navigator.serviceWorker.controller.postMessage(
          {
            type: 'flare-local-register',
            resource: {
              token,
              mode,
              contentType,
              filename: 'attack.html',
              source: {
                kind: 'file',
                url: `/api/files${urlPath}`,
                fileKey: decode(key),
                header: decode(header),
              },
            },
          },
          [channel.port2]
        )
        return { token, reply: await reply }
      },
      {
        urlPath: rows[kind].urlPath,
        header: Buffer.from(rows[kind].header).toString('base64url'),
        key: uploaded[fixtures[kind].name].split('#')[1],
        mode,
        contentType,
      }
    )

  // 1. The worker refuses to give HTML or SVG an address as what they are.
  for (const [kind, mode, type] of [
    ['html', 'media', 'text/html'],
    ['svg', 'media', 'image/svg+xml'],
    ['html', 'frame', 'text/html'],
    ['svg', 'frame', 'image/svg+xml'],
    ['html', 'media', 'application/xhtml+xml'],
  ]) {
    const { reply } = await register(kind, mode, type)
    assert.equal(reply.type, 'refused', `${kind} as ${mode} ${type}`)
  }

  // 2. An attacker lies about the type to get an address. The address then
  // answers only a media element of this page, with the lied type and
  // nosniff: the bytes never become a document.
  let checked = 0
  for (const kind of ['html', 'svg']) {
    const { token, reply } = await register(kind, 'media', 'image/png')
    assert.equal(reply.type, 'registered')
    localTokens.add(token)
    const address = `${origin}${LOCAL_PREFIX}${token}`
    // Opened directly in this tab, in a new tab, and in a frame.
    const top = await visitor.ctx.newPage()
    const response = await top.goto(address)
    assert.equal(response.status(), 403, `${kind}: top-level navigation`)
    assert.equal(
      response.headers()['content-security-policy'],
      "sandbox; default-src 'none'"
    )
    assert.equal(response.headers()['x-content-type-options'], 'nosniff')
    assert.match(response.headers()['content-type'], /^text\/plain/)
    assert.equal(await top.evaluate(() => window.__flarePwned), undefined)
    assert.ok(
      !(await top.content()).includes(fixtures[kind].marker),
      'The refusal shows the file'
    )
    await top.close()
    const framed = await page.evaluate(
      (address) =>
        new Promise((resolve) => {
          const frame = document.createElement('iframe')
          frame.src = address
          frame.onload = () =>
            resolve({
              pwned: window.__flarePwned,
              // A sandboxed answer has an opaque origin: no access from here.
              reachable: (() => {
                try {
                  return Boolean(frame.contentDocument)
                } catch {
                  return false
                }
              })(),
            })
          document.body.appendChild(frame)
        }),
      address
    )
    assert.equal(framed.pwned, undefined, `${kind}: frame`)
    assert.equal(framed.reachable, false, `${kind}: the frame is same-origin`)
    // As an image it is not an image, and as a script it is refused.
    const loaded = await page.evaluate(
      (address) =>
        new Promise((resolve) => {
          const image = new Image()
          image.onload = () => resolve('image loaded')
          image.onerror = () => resolve('image failed')
          image.src = address
        }),
      address
    )
    assert.equal(loaded, 'image failed', `${kind}: <img>`)
    const fetched = await page.evaluate(
      (address) => fetch(address).then((response) => response.status),
      address
    )
    assert.equal(fetched, 403, `${kind}: fetch from script`)
    // Another page of the same origin does not get it either.
    const other = await visitor.ctx.newPage()
    await other.goto(`${origin}/auth/login`)
    const fromOther = await other.evaluate(
      (address) =>
        new Promise((resolve) => {
          const image = new Image()
          image.onload = () => resolve('loaded')
          image.onerror = () => resolve('failed')
          image.src = address
        }),
      address
    )
    assert.equal(fromOther, 'failed')
    await other.close()
    assert.equal(await page.evaluate(() => window.__flarePwned), undefined)
    checked++
  }

  // 3. A download address is the one address a navigation gets. It answers
  // with an attachment: the browser saves the bytes and shows no page.
  for (const kind of ['html', 'svg']) {
    const { token, reply } = await register(kind, 'download', 'text/html')
    assert.equal(reply.type, 'registered')
    localTokens.add(token)
    const top = await visitor.ctx.newPage()
    const [download] = await Promise.all([
      top.waitForEvent('download'),
      top.goto(`${origin}${LOCAL_PREFIX}${token}`).catch(() => undefined),
    ])
    assert.equal(download.suggestedFilename(), 'attack.html')
    assert.ok(
      (await readFile(await download.path())).equals(fixtures[kind].buffer)
    )
    assert.equal(
      await top.evaluate(() => window.__flarePwned).catch(() => undefined),
      undefined
    )
    await top.close()
    // One use: the same address answers nothing a second time.
    const again = await page.evaluate(
      (address) =>
        new Promise((resolve) => {
          const frame = document.createElement('iframe')
          frame.onload = () => resolve('loaded')
          frame.src = address
          document.body.appendChild(frame)
          setTimeout(() => resolve('timeout'), 8000)
        }),
      `${origin}${LOCAL_PREFIX}${token}`
    )
    assert.equal(again, 'loaded')
    assert.equal(await page.evaluate(() => window.__flarePwned), undefined)
  }

  // 4. A PDF frame address for HTML: a navigation in a frame gets it, as
  // application/pdf with a sandbox policy. A top-level navigation does not.
  {
    const { token, reply } = await register('html', 'frame', 'application/pdf')
    assert.equal(reply.type, 'registered')
    localTokens.add(token)
    const top = await visitor.ctx.newPage()
    const response = await top.goto(`${origin}${LOCAL_PREFIX}${token}`)
    assert.equal(response.status(), 403)
    await top.close()
    await page.evaluate(
      (address) =>
        new Promise((resolve) => {
          const frame = document.createElement('iframe')
          frame.onload = resolve
          frame.src = address
          document.body.appendChild(frame)
          setTimeout(resolve, 4000)
        }),
      `${origin}${LOCAL_PREFIX}${token}`
    )
    await page.waitForTimeout(500)
    assert.equal(await page.evaluate(() => window.__flarePwned), undefined)
  }
  await visitor.ctx.close()
  results.push(
    `The navigation attack on a local address runs no script. The worker refuses to register HTML or SVG as media or as a frame (5 forms). For an HTML file and an SVG file with <script> that were registered under a false media type (${checked} files): a top-level navigation to the address answers 403 text/plain with "sandbox; default-src 'none'" and nosniff, a frame gets the same refusal with an opaque origin, an <img> fails, fetch from script gets 403, and another page of the origin gets nothing. A download address answers a navigation with an attachment named by the cleaned file name, byte-identical, one time. A frame address under application/pdf refuses a top-level navigation. window.__flarePwned stayed undefined in every page and frame, and the browser reported ${sandboxRefusals} times that it blocked script in a sandboxed answer (the script this suite adds to every document)`
  )
}

async function testSignOut(browser) {
  if (!fixtures.video) return
  const session = await signIn(browser)
  const { page } = session
  // The owner opens the video without a fragment and plays it.
  await page.goto(uploaded[fixtures.video.name].split('#')[0])
  await expectShareState(page, 'open')
  const player = page.locator('video')
  const src = await localSource(player)
  await waitForMetadata(player)
  // A second page of the same browser asks for the address: it exists, and
  // it is not for that page.
  const other = await session.ctx.newPage()
  await other.goto(`${origin}/dashboard/profile`)
  const probe = () =>
    other.evaluate(
      (src) =>
        new Promise((resolve) => {
          const video = document.createElement('video')
          video.onloadedmetadata = () => resolve('played')
          video.onerror = () => resolve('failed')
          video.src = src
        }),
      src
    )
  assert.equal(await probe(), 'failed')
  const status = (target) =>
    target.evaluate(
      (src) => fetch(src).then((response) => response.status),
      src
    )
  assert.equal(await status(other), 403, 'The address is known to the worker')

  // Sign out in the second page.
  await other.getByRole('button', { name: 'Account menu' }).click()
  await other.getByRole('menuitem', { name: /Sign out|Log out/ }).click()
  await other.waitForURL(/\/auth\/login/)
  // The worker holds nothing now: the same request is "not found" (after
  // the worker asked the pages and none had the address), not "forbidden".
  await expect.poll(() => status(other), { timeout: 30000 }).toBe(404)
  const stored = await shared.storedKeys(other)
  assert.deepEqual(stored, [])
  await session.ctx.close()
  results.push(
    'Sign-out drops the keys of the service worker: while the owner plays a video, a second page of the browser gets 403 for its local address (known, and not for that page); after sign-out in that second page the same request gets 404 (the worker holds nothing and no page answers for it), and the key store is empty'
  )
}

async function testFallback(browser) {
  if (!fixtures.audio) return
  // A browser without service workers: a private window of some browsers,
  // an insecure origin, a blocked registration.
  const visitor = await context(browser, { serviceWorkers: 'block' })
  const { page } = visitor
  const before = requests.length
  await page.goto(uploaded[fixtures.audio.name])
  await expectShareState(page, 'open')
  const player = page.locator('audio')
  await expect(player).toBeVisible({ timeout: 60000 })
  assert.match(await player.getAttribute('src'), /^blob:/)
  await waitForMetadata(player)
  await playFrom(player, 100)
  const row = await rowOf(uploaded[fixtures.audio.name])
  const whole = ciphertextRequests(row, before)
  assert.equal(whole.length, 1)
  assert.equal(whole[0].asked, null, 'The fallback asked for a range')
  assert.equal(
    await page.evaluate(() => navigator.serviceWorker.controller),
    null
  )
  // The download without a worker: decrypted in memory, byte-identical.
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download', exact: true }).click(),
  ])
  assert.equal(download.suggestedFilename(), fixtures.audio.name)
  assert.equal(
    sha256(await readFile(await download.path())),
    sha256(fixtures.audio.buffer)
  )
  await visitor.ctx.close()
  results.push(
    'Without a service worker (registration blocked in the browser context) the same audio file plays from a blob: address after one request for the whole ciphertext, and its download is byte-identical: the fallback of section 12.2'
  )
}

/** The library card menu of a file, by its decrypted name. */
async function openCardMenu(page, name) {
  await page.goto(`${origin}/dashboard`)
  const manage = page.getByRole('button', {
    name: `Manage ${name}`,
    exact: true,
  })
  await expect(manage).toBeVisible({ timeout: 60000 })
  await manage.click()
  return page.getByRole('menu')
}

async function testDownload(browser, alex) {
  const fixture = fixtures.large
  const row = await rowOf(uploaded[fixture.name])
  const storedBytes = Math.round(row.size * 1048576)
  const { page } = alex
  // Every Blob the page makes: a streamed download makes none.
  await page.addInitScript(() => {
    window.__blobBytes = []
    const create = URL.createObjectURL.bind(URL)
    URL.createObjectURL = (object) => {
      window.__blobBytes.push(object instanceof Blob ? object.size : -1)
      return create(object)
    }
  })
  const menu = await openCardMenu(page, fixture.name)
  const before = requests.length
  const started = Date.now()
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 180000 }),
    menu.getByRole('menuitem', { name: 'Download file' }).click(),
  ])
  assert.equal(download.suggestedFilename(), fixture.name)
  assert.match(download.url(), /\/_flare\/local\/[A-Za-z0-9_-]{43}$/)
  localTokens.add(download.url().split(LOCAL_PREFIX)[1])
  const saved = await readFile(await download.path())
  const seconds = (Date.now() - started) / 1000
  assert.equal(sha256(saved), sha256(fixture.buffer), 'SHA-256 of the download')
  assert.deepEqual(
    await page.evaluate(() => window.__blobBytes),
    [],
    'The page made a Blob for a streamed download'
  )
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.__workerMessages.filter((type) =>
          ['flare-local-started', 'flare-local-finished'].includes(type)
        )
      )
    )
    .toEqual(['flare-local-started', 'flare-local-finished'])
  // The end of the file first, then one request for all of it, which is
  // the one the server counts as a download.
  const asked = ciphertextRequests(row, before)
  assert.equal(asked.length, 2)
  assert.equal(asked[0].end, storedBytes)
  assert.ok(asked[0].asked <= STORED_CHUNK)
  assert.ok(asked[1].target.endsWith('?download=true'))
  assert.equal(asked[1].start, 26)
  assert.equal(asked[1].end, storedBytes)
  assert.equal(
    (await prisma.file.findUniqueOrThrow({ where: { id: row.id } })).downloads,
    row.downloads + 1
  )

  // A signed-out visitor of the share page, with the same result.
  const visitor = await context(browser)
  await visitor.page.goto(uploaded[fixture.name])
  await expectShareState(visitor.page, 'open')
  await expect(visitor.page.getByText('Preview not available')).toBeVisible()
  const [second] = await Promise.all([
    visitor.page.waitForEvent('download', { timeout: 180000 }),
    visitor.page.getByRole('button', { name: 'Download', exact: true }).click(),
  ])
  assert.match(second.url(), /\/_flare\/local\//)
  localTokens.add(second.url().split(LOCAL_PREFIX)[1])
  assert.equal(second.suggestedFilename(), fixture.name)
  assert.equal(
    sha256(await readFile(await second.path())),
    sha256(fixture.buffer)
  )
  await expect(
    visitor.page.getByRole('button', { name: 'Download', exact: true })
  ).toBeEnabled()
  await visitor.ctx.close()
  results.push(
    `A streamed download matches the original: "Download file" in the library saves the ${Math.round(fixture.buffer.length / 1048576)} MiB file from a local address under its decrypted name with the same SHA-256 (${sha256(fixture.buffer).slice(0, 16)}…) in ${seconds.toFixed(1)} s, the page made no Blob, the worker reported "started" and "finished", the server got one request for the final chunk and one for the whole ciphertext with ?download=true, and the download count rose by one. A signed-out visitor's Download on the share page gives the same bytes`
  )
}

async function testPdf(browser) {
  const fixture = fixtures.pdf
  const visitor = await context(browser)
  const { page } = visitor
  await page.goto(uploaded[fixture.name])
  await expectShareState(page, 'open')
  const frame = page.locator('iframe[title$="document preview"]')
  await expect(frame).toBeVisible()
  const src = await localSource(frame)
  assert.match(src, /#navpanes=0&view=FitH$/)
  // The answer carries the sandbox; the frame must not, or Chromium shows
  // no PDF in it.
  assert.equal(await frame.getAttribute('sandbox'), null)
  // The browser's own viewer loaded the document.
  await expect
    .poll(
      () =>
        page
          .frames()
          .some((child) => child.url().startsWith('chrome-extension://')),
      { timeout: 30000 }
    )
    .toBe(true)
  await page.waitForTimeout(1500)
  await shot(page, 'media-pdf')
  const picture = await frame.screenshot()
  assert.ok(picture.length > 3000, 'The PDF frame is empty')
  assert.equal(await page.evaluate(() => window.__flarePwned), undefined)
  assert.deepEqual(await violations(page), [])
  await visitor.ctx.close()

  // Without a worker this browser cannot show a PDF in an isolated frame.
  const plain = await context(browser, { serviceWorkers: 'block' })
  await plain.page.goto(uploaded[fixture.name])
  await expectShareState(plain.page, 'open')
  await expect(
    plain.page.getByText('PDF preview is not available in this browser')
  ).toBeVisible({ timeout: 30000 })
  await expect(
    plain.page.locator('iframe[title$="document preview"]')
  ).toHaveCount(0)
  const [download] = await Promise.all([
    plain.page.waitForEvent('download'),
    plain.page.getByRole('button', { name: 'Download', exact: true }).click(),
  ])
  assert.ok((await readFile(await download.path())).equals(fixture.buffer))
  await shot(plain.page, 'media-pdf-no-worker')
  await plain.ctx.close()
  results.push(
    'An encrypted PDF renders inline in Chromium: the frame has a local address and no sandbox attribute, the answer is application/pdf with the sandbox policy, and the browser loaded its PDF viewer in it. With service workers blocked the same page offers the download, which is byte-identical'
  )
}

/**
 * A compromised server cuts a file at a chunk border and reports the
 * shorter length. Every chunk that is left is authentic, so only the rule
 * for the final chunk can tell.
 */
async function testTruncated(browser, alex) {
  if (!fixtures.audio) return
  const cut = {
    ...fixtures.audio,
    name: 'board-call-private.ogg',
  }
  fixtures.cutAudio = cut
  const links = await uploadEncrypted(alex.page, [cut])
  const row = await rowOf(links[cut.name])
  const file = path.join(appDirectory, row.path)
  const stored = await readFile(file)
  const kept = 26 + 20 * STORED_CHUNK
  assert.ok(stored.length > kept + STORED_CHUNK)
  writeFileSync(file, stored.subarray(0, kept))
  await prisma.file.update({
    where: { id: row.id },
    data: { size: kept / 1048576 },
  })
  try {
    const visitor = await context(browser)
    const { page } = visitor
    await page.goto(links[cut.name])
    await expectShareState(page, 'open')
    await expect(
      page.getByText('This file did not pass its integrity check.')
    ).toBeVisible({ timeout: 30000 })
    await expect(page.locator('audio')).toHaveCount(0)
    await shot(page, 'media-integrity-failed')
    // The download is refused too: nothing is saved.
    let downloads = 0
    page.on('download', () => downloads++)
    await page.getByRole('button', { name: 'Download', exact: true }).click()
    await expect(
      page.getByText('Couldn’t download this file').first()
    ).toBeVisible({ timeout: 30000 })
    assert.equal(downloads, 0)
    await visitor.ctx.close()
  } finally {
    writeFileSync(file, stored)
    await prisma.file.update({
      where: { id: row.id },
      data: { size: row.size },
    })
  }
  results.push(
    'A truncated file does not play as if complete: with the stored object of an audio file cut after chunk 20 and the database size set to match, the share page shows "This file did not pass its integrity check." and no player, although every remaining chunk is authentic, and Download saves nothing'
  )
}

// ---------------------------------------------------------------- archives

/** The files inside every archive fixture. Their names and texts are plaintext too. */
const ARCHIVE_ENTRIES = [
  {
    name: 'photos/harbor-inside-private.png',
    buffer: pngFixture(marker('zipimage')),
  },
  {
    name: 'notes/readme-inside-private.txt',
    buffer: Buffer.from(`${marker('ziptext')}\nInside the archive.\n`),
  },
  { name: 'web/landing-inside-private.html', buffer: Buffer.from(HOSTILE_HTML) },
  { name: 'web/diagram-inside-private.svg', buffer: Buffer.from(HOSTILE_SVG) },
  { name: 'data/blob-inside-private.bin', buffer: randomBytes(300 * 1024) },
]
for (const entry of ARCHIVE_ENTRIES) {
  extraPlaintext.set(entry.name, 'the name of an archive entry')
  extraPlaintext.set(
    entry.name.split('/').at(-1),
    'the name of an archive entry'
  )
}
extraPlaintext.set(marker('zipimage'), 'plaintext of an archive entry')
extraPlaintext.set(marker('ziptext'), 'plaintext of an archive entry')

async function zipOf(entries, options = {}) {
  const archive = archiver('zip', options)
  const chunks = []
  const collecting = (async () => {
    for await (const chunk of archive) chunks.push(Buffer.from(chunk))
  })()
  for (const entry of entries)
    archive.append(entry.buffer, { name: entry.name, store: entry.store })
  await archive.finalize()
  await collecting
  return Buffer.concat(chunks)
}

async function tarOf(entries) {
  const pack = tarStream.pack()
  const chunks = []
  const consuming = (async () => {
    for await (const chunk of pack) chunks.push(Buffer.from(chunk))
  })()
  for (const entry of entries) pack.entry({ name: entry.name }, entry.buffer)
  pack.finalize()
  await consuming
  return Buffer.concat(chunks)
}

/** A ZIP whose names real writers refuse to make, with more entries than may be extracted. */
function hostileZip() {
  const items = [
    { name: '../../outside-private.txt', data: Buffer.from('x') },
    { name: '/absolute-private.txt', data: Buffer.from('x') },
    { name: 'ok/plain-private.txt', data: Buffer.from('fine') },
    ...Array.from({ length: 1005 }, (_, index) => ({
      name: `many/entry-${index}.txt`,
      data: Buffer.from('x'),
    })),
  ]
  const contents = []
  const directory = []
  let offset = 0
  for (const item of items) {
    const name = Buffer.from(item.name)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0x0800, 6)
    local.writeUInt32LE(zlib.crc32(item.data), 14)
    local.writeUInt32LE(item.data.length, 18)
    local.writeUInt32LE(item.data.length, 22)
    local.writeUInt16LE(name.length, 26)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50)
    central.writeUInt16LE(0x314, 4)
    local.copy(central, 6, 4, 28)
    central.writeUInt32LE((0o100644 * 65536) >>> 0, 38)
    central.writeUInt32LE(offset, 42)
    contents.push(local, name, item.data)
    directory.push(central, name)
    offset += 30 + name.length + item.data.length
  }
  const central = Buffer.concat(directory)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50)
  end.writeUInt16LE(items.length, 8)
  end.writeUInt16LE(items.length, 10)
  end.writeUInt32LE(central.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...contents, central, end])
}

/** The entries of a ZIP, read with yauzl: `{ name: Buffer }`. */
function unzip(buffer) {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true }, (error, zip) => {
      if (error) return reject(error)
      const files = {}
      zip.on('error', reject)
      zip.on('end', () => resolve(files))
      zip.on('entry', (entry) => {
        zip.openReadStream(entry, (failure, stream) => {
          if (failure) return reject(failure)
          const chunks = []
          stream.on('data', (chunk) => chunks.push(chunk))
          stream.on('end', () => {
            files[entry.fileName] = Buffer.concat(chunks)
            zip.readEntry()
          })
        })
      })
      zip.readEntry()
    })
  })
}

async function openEntry(scope, path) {
  const name = path.split('/').at(-1)
  for (const folder of path.split('/').slice(0, -1))
    await scope
      .getByRole('button', { name: new RegExp(`^Open folder .*${folder}$`) })
      .click()
  await scope.getByRole('button', { name: `Preview ${path}`, exact: true }).click()
  const preview = scope.getByRole('region', { name: 'Entry preview' })
  await expect(preview.getByRole('heading', { name })).toBeVisible()
  return preview
}

async function backToRoot(scope) {
  await scope.getByRole('button', { name: 'Archive root', exact: true }).click()
}

/** Checks the listing and the previews of the common entries in an archive browser. */
async function browseEntries(page, scope, { image = true } = {}) {
  const text = await openEntry(scope, 'notes/readme-inside-private.txt')
  await expect(text.getByLabel('Entry text')).toContainText(marker('ziptext'))
  await backToRoot(scope)
  if (image) {
    const picture = await openEntry(scope, 'photos/harbor-inside-private.png')
    const img = picture.getByRole('img')
    await expect
      .poll(() => img.evaluate((element) => element.naturalWidth), {
        timeout: 30000,
      })
      .toBe(96)
    await localSource(img)
    await backToRoot(scope)
  }
  // HTML and SVG entries are text. Nothing in them runs.
  for (const path of [
    'web/landing-inside-private.html',
    'web/diagram-inside-private.svg',
  ]) {
    const hostile = await openEntry(scope, path)
    await expect(hostile.getByLabel('Entry text')).toContainText(
      '__flarePwned'
    )
    await backToRoot(scope)
  }
  await page.waitForTimeout(300)
  assert.equal(await page.evaluate(() => window.__flarePwned), undefined)
  assert.equal(await scope.locator('iframe, object, embed').count(), 0)
}

async function testArchives(browser, alex, keys) {
  const { page } = alex
  const zip = {
    name: 'project-bundle-private.zip',
    mimeType: 'application/zip',
    buffer: await zipOf(ARCHIVE_ENTRIES),
    marker: marker('ziptext'),
  }
  const tar = {
    name: 'project-bundle-private.tar',
    mimeType: 'application/x-tar',
    buffer: await tarOf(ARCHIVE_ENTRIES),
    marker: marker('ziptext'),
  }
  const tgz = {
    name: 'project-bundle-private.tar.gz',
    mimeType: 'application/gzip',
    buffer: zlib.gzipSync(await tarOf(ARCHIVE_ENTRIES)),
    marker: marker('ziptext'),
  }
  const gz = {
    name: 'readme-inside-private.txt.gz',
    mimeType: 'application/gzip',
    buffer: zlib.gzipSync(ARCHIVE_ENTRIES[1].buffer),
    marker: marker('ziptext'),
  }
  const hostile = {
    name: 'hostile-names-private.zip',
    mimeType: 'application/zip',
    buffer: hostileZip(),
    marker: marker('hostilezip'),
  }
  for (const name of ['outside-private.txt', 'absolute-private.txt', 'plain-private.txt'])
    extraPlaintext.set(name, 'the name of an archive entry')
  Object.assign(fixtures, { zip, tar, tgz, gz, hostileArchive: hostile })
  Object.assign(
    uploaded,
    await uploadEncrypted(page, [zip, tar, tgz, gz, hostile])
  )
  const before = requests.length

  // --- The owner browses the ZIP from the library.
  const menu = await openCardMenu(page, zip.name)
  await menu.getByRole('menuitem', { name: 'Browse archive' }).click()
  const dialog = page.getByRole('dialog', { name: 'Browse archive' })
  await expect(dialog.getByText(zip.name)).toBeVisible()
  await expect(dialog.getByText(/ZIP · 5 files · 4 folders/)).toBeVisible({
    timeout: 30000,
  })
  await shot(page, 'archive-browser')
  await browseEntries(page, dialog)
  const preview = await openEntry(dialog, 'photos/harbor-inside-private.png')
  await expect(preview.getByRole('img')).toBeVisible()
  await shot(page, 'archive-entry-image')
  // One entry saved on its own.
  await backToRoot(dialog)
  const blob = await openEntry(dialog, 'data/blob-inside-private.bin')
  const [entryDownload] = await Promise.all([
    page.waitForEvent('download'),
    blob.getByRole('button', { name: 'Download entry' }).click(),
  ])
  assert.equal(entryDownload.suggestedFilename(), 'blob-inside-private.bin')
  assert.equal(
    sha256(await readFile(await entryDownload.path())),
    sha256(ARCHIVE_ENTRIES[4].buffer)
  )
  localTokens.add(entryDownload.url().split(LOCAL_PREFIX)[1])
  // The list was read from a part of the ciphertext.
  const zipRow = await rowOf(uploaded[zip.name])
  const listed = ciphertextRequests(zipRow, before)
  assert.ok(listed.length >= 2)
  assert.ok(listed.every((request) => request.asked !== null))

  // --- Extract all: every entry becomes a new encrypted file.
  const filesBefore = await prisma.file.count({
    where: { userId: accounts.alex.id },
  })
  await backToRoot(dialog)
  await dialog.getByRole('button', { name: 'Extract all' }).click()
  await expect(
    page.getByRole('heading', { name: 'Extract archive' })
  ).toBeVisible()
  await shot(page, 'archive-extract-form')
  await page.getByRole('button', { name: 'Extract files' }).click()
  await expect(
    page.getByRole('heading', { name: 'Archive extracted' })
  ).toBeVisible({ timeout: 120000 })
  await shot(page, 'archive-extracted')
  await page.getByRole('button', { name: 'Done', exact: true }).click()
  const extracted = await prisma.file.findMany({
    where: { userId: accounts.alex.id },
    orderBy: [{ uploadedAt: 'desc' }, { id: 'desc' }],
    take: (await prisma.file.count({ where: { userId: accounts.alex.id } })) -
      filesBefore,
  })
  assert.equal(extracted.length, ARCHIVE_ENTRIES.length)
  const made = new Map()
  for (const row of extracted) {
    assert.equal(row.encrypted, true)
    assert.equal(row.name, '')
    assert.equal(row.visibility, 'PRIVATE')
    const fileKey = fileKeyOf(row, keys.accountPrivateKey)
    made.set(metadataOf(row, fileKey).name, await plaintextOf(row, fileKey))
  }
  for (const entry of ARCHIVE_ENTRIES) {
    const name = entry.name.split('/').join(' - ')
    extraPlaintext.set(name, 'the name of an extracted file')
    assert.ok(made.has(name), `No extracted file is named ${name}`)
    assert.ok(made.get(name).equals(entry.buffer), `${name} differs`)
  }
  results.push(
    `The owner browses an encrypted ZIP from the library: "Browse archive" lists 5 files in 4 folders after ${listed.length} range requests for parts of the ciphertext, a text entry and an image entry open (the image from a local address), HTML and SVG entries are shown as source text and run nothing, and "Download entry" saves one entry byte for byte. "Extract all" makes ${extracted.length} new private encrypted files whose decrypted names carry their path ("photos - harbor-inside-private.png") and whose decrypted bytes equal the entries`
  )

  // --- Create an archive from two encrypted files and one plain file.
  await page.goto(`${origin}/dashboard`)
  await page.getByRole('button', { name: 'Select files', exact: true }).click()
  for (const name of [fixtures.text.name, fixtures.image.name, PLAIN.name])
    await page.getByLabel(`Select ${name}`, { exact: true }).check()
  await page.getByRole('button', { name: 'Create archive', exact: true }).click()
  const create = page.getByRole('dialog', { name: 'Create archive' })
  await create.getByLabel('Archive name').fill('handover-private.zip')
  extraPlaintext.set('handover-private', 'the name of a created archive')
  await shot(page, 'archive-create-form')
  await create.getByRole('button', { name: 'Create archive' }).click()
  await expect(
    page.getByRole('heading', { name: 'Archive created' })
  ).toBeVisible({ timeout: 120000 })
  await shot(page, 'archive-created')
  const createdRow = await prisma.file.findFirstOrThrow({
    where: { userId: accounts.alex.id },
    orderBy: [{ uploadedAt: 'desc' }, { id: 'desc' }],
  })
  assert.equal(createdRow.encrypted, true)
  const createdKey = fileKeyOf(createdRow, keys.accountPrivateKey)
  assert.deepEqual(metadataOf(createdRow, createdKey), {
    name: 'handover-private.zip',
    type: 'application/zip',
  })
  const members = await unzip(await plaintextOf(createdRow, createdKey))
  assert.deepEqual(Object.keys(members).sort(), [
    fixtures.text.name,
    fixtures.image.name,
    PLAIN.name,
  ].sort())
  assert.ok(members[fixtures.text.name].equals(fixtures.text.buffer))
  assert.ok(members[fixtures.image.name].equals(fixtures.image.buffer))
  assert.ok(members[PLAIN.name].equals(PLAIN.buffer))
  // The new archive opens in the browser straight away.
  await page.getByRole('button', { name: 'Open archive' }).click()
  const fresh = page.getByRole('dialog', { name: 'Browse archive' })
  await expect(fresh.getByText(/ZIP · 3 files/)).toBeVisible({ timeout: 30000 })
  await page.keyboard.press('Escape')
  results.push(
    'An archive is created in the browser from two encrypted files and one plain file: the result is a new encrypted file named handover-private.zip in sealed metadata; decrypted with independent code and read with yauzl it holds the three files byte for byte, and "Open archive" lists it'
  )

  // --- TAR.GZ: browse and extract as the owner.
  const tgzMenu = await openCardMenu(page, tgz.name)
  await tgzMenu.getByRole('menuitem', { name: 'Browse archive' }).click()
  const tgzDialog = page.getByRole('dialog', { name: 'Browse archive' })
  await expect(tgzDialog.getByText(/TAR\.GZ · 5 files/)).toBeVisible({
    timeout: 30000,
  })
  await browseEntries(page, tgzDialog)
  const countBefore = await prisma.file.count({
    where: { userId: accounts.alex.id },
  })
  await tgzDialog.getByRole('button', { name: 'Extract all' }).click()
  await page.getByRole('button', { name: 'Extract files' }).click()
  await expect(
    page.getByRole('heading', { name: 'Archive extracted' })
  ).toBeVisible({ timeout: 120000 })
  await page.getByRole('button', { name: 'Done', exact: true }).click()
  assert.equal(
    (await prisma.file.count({ where: { userId: accounts.alex.id } })) -
      countBefore,
    ARCHIVE_ENTRIES.length
  )

  // --- A hostile archive: listed with its problems, and not extracted.
  const hostileMenu = await openCardMenu(page, hostile.name)
  await hostileMenu.getByRole('menuitem', { name: 'Browse archive' }).click()
  const hostileDialog = page.getByRole('dialog', { name: 'Browse archive' })
  await expect(hostileDialog.getByText(/ZIP · 1,008 files/)).toBeVisible({
    timeout: 30000,
  })
  await expect(
    hostileDialog.getByRole('button', { name: 'Extract all' })
  ).toBeDisabled()
  await expect(
    hostileDialog.getByText(/Extract all isn’t available because/)
  ).toBeVisible()
  // The entry that tries to leave the archive is listed and cannot be opened.
  await hostileDialog.getByLabel('Search archive').fill('outside-private')
  await hostileDialog
    .getByRole('button', { name: /outside-private\.txt \(unavailable\)/ })
    .click()
  await expect(
    hostileDialog.getByText('This entry’s path is unsafe, so Flare won’t open it.')
  ).toBeVisible()
  await expect(
    hostileDialog.getByRole('button', { name: 'Download entry' })
  ).toHaveCount(0)
  await shot(page, 'archive-hostile')
  const filesNow = await prisma.file.count({
    where: { userId: accounts.alex.id },
  })
  await page.keyboard.press('Escape')
  assert.equal(
    await prisma.file.count({ where: { userId: accounts.alex.id } }),
    filesNow
  )
  results.push(
    'A hostile encrypted ZIP (entries named ../../outside-private.txt and /absolute-private.txt, and 1,008 entries) is listed, its unsafe entries are marked and cannot be opened or saved, "Extract all" is disabled with its reason, and no file was made from it'
  )

  // --- A signed-out visitor browses each format on its share page.
  const visitor = await context(browser)
  const archiveCalls = requests.length
  for (const [fixture, label, image] of [
    [zip, /ZIP · 5 files/, true],
    [tar, /TAR · 5 files/, true],
    [tgz, /TAR\.GZ · 5 files/, true],
  ]) {
    await visitor.page.goto(uploaded[fixture.name])
    await expectShareState(visitor.page, 'open')
    const section = visitor.page.locator('[data-encrypted-archive]')
    await expect(section.getByText(label)).toBeVisible({ timeout: 30000 })
    await browseEntries(visitor.page, section, { image })
    if (fixture === zip) await shot(visitor.page, 'archive-share-page')
    // A visitor is not offered extraction.
    await expect(
      section.getByRole('button', { name: 'Extract all' })
    ).toHaveCount(0)
  }
  await visitor.page.goto(uploaded[gz.name])
  await expectShareState(visitor.page, 'open')
  const single = visitor.page.locator('[data-encrypted-archive]')
  await expect(single.getByText(/GZIP · 1 file/)).toBeVisible({ timeout: 30000 })
  await single
    .getByRole('button', { name: 'Preview readme-inside-private.txt' })
    .click()
  await expect(single.getByLabel('Entry text')).toContainText(marker('ziptext'))
  assert.deepEqual(await violations(visitor.page), [])
  // The server's archive routes were never asked: it could not answer, and
  // no unlock cookie exists for an encrypted file.
  assert.ok(
    !requests
      .slice(archiveCalls)
      .some((request) => /\/archive(\/|$|\?)/.test(request.target)),
    'A visitor asked the server for an archive listing or entry'
  )
  const cookies = await visitor.ctx.cookies()
  assert.ok(
    !cookies.some((cookie) => /archive/i.test(cookie.name)),
    'The visitor got an archive unlock cookie'
  )
  await visitor.ctx.close()
  results.push(
    'A signed-out visitor browses encrypted archives on their share pages with the key of the link: ZIP, TAR and TAR.GZ list 5 files and open a text entry and an image entry, HTML and SVG entries are source text, a GZIP lists its one file and opens it, no extraction is offered, the server got no archive request and set no unlock cookie'
  )
}

// ---------------------------------------------------------------- run

const scenarios = []
function scenario(name, run) {
  scenarios.push({ name, run })
}

async function main() {
  const proxy = await startRecordingProxy()
  const browser = await chromium.launch({
    headless: true,
    // The full browser in its new headless mode: the headless shell has no
    // PDF viewer.
    channel: 'chromium',
  })
  try {
    const keys = await seed()
    accountPrivateKey = keys.accountPrivateKey
    const alex = await signIn(browser)
    await useTheme(alex)
    await testUploads(alex)
    scenario('video', () => testVideo(browser))
    scenario('audio', () => testAudio(browser))
    scenario('password', () => testPasswordVideo(browser, alex))
    scenario('attack', () => testNavigationAttack(browser))
    scenario('signout', () => testSignOut(browser))
    scenario('fallback', () => testFallback(browser))
    scenario('download', () => testDownload(browser, alex))
    scenario('pdf', () => testPdf(browser))
    scenario('truncated', () => testTruncated(browser, alex))
    scenario('archives', () => testArchives(browser, alex, keys))
    for (const { name, run } of scenarios)
      if (!only.length || only.includes(name)) await run()

    await assertNothingSecretWasSent(keys)
    assert.deepEqual(pageProblems, [], 'A page logged an error')
    for (const result of results) console.log(`PASS: ${result}`)
    if (!fixtures.video || !fixtures.audio)
      console.log(
        'SKIPPED: the video and audio scenarios. No ffmpeg with libvpx and libopus was found to make the fixtures.'
      )
  } catch (error) {
    // With FLARE_E2EE_DEBUG set, a failed run leaves a picture of each page.
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
void accountPrivateKey
void plaintextOf
void CHUNK
