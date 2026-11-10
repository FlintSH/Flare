/* eslint-disable @typescript-eslint/no-require-imports */
// Real browser checks of encrypted files (docs/e2ee-spec.md, sections 7 to
// 13) against a production build and a disposable database. Uploads,
// downloads, share pages and every request are real.
//
// The browser talks to the application through a small recording proxy that
// this script starts. The proxy keeps the request target, the headers and
// the body of every request exactly as they arrived, so the search at the
// end reads what was really sent, and proves that the part of a link after
// `#` was not.
//
// Setup, with the application built (`pnpm build`) and PostgreSQL running:
//
//   export DATABASE_URL='postgresql://flare_test@127.0.0.1:5432/flare_e2ee_files_local'
//   pnpm exec prisma migrate deploy
//   NEXTAUTH_URL='http://localhost:3094' NEXTAUTH_SECRET=... \
//     pnpm exec next start -H 127.0.0.1 -p 3093
//   node scripts/e2ee/verify-files.cjs
//
// The application listens on 3093. The proxy of this script listens on
// 3094, which is the origin the browser uses and `NEXTAUTH_URL` names.
const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const { randomBytes } = require('node:crypto')
const { existsSync } = require('node:fs')
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

const origin = process.env.FLARE_E2EE_FILES_ORIGIN || 'http://localhost:3094'
const upstream =
  process.env.FLARE_E2EE_FILES_UPSTREAM || 'http://127.0.0.1:3093'
if (new URL(origin).hostname !== 'localhost')
  throw new Error('Use a disposable localhost instance, matching NEXTAUTH_URL.')
const database = new URL(process.env.DATABASE_URL || 'postgresql://unset/')
if (
  !['localhost', '127.0.0.1'].includes(database.hostname) ||
  database.pathname !== '/flare_e2ee_files_local'
)
  throw new Error(
    'This check needs a local PostgreSQL database named exactly flare_e2ee_files_local.'
  )
const screenshots = process.env.FLARE_E2EE_SCREENSHOTS
const mobile = process.env.FLARE_E2EE_VIEWPORT === 'mobile'
const theme = process.env.FLARE_E2EE_THEME === 'light' ? 'light' : 'dark'
const appDirectory = path.resolve(__dirname, '../..')
const prisma = new PrismaClient()
const results = []

// Demonstration secrets. They are public and only for disposable fixtures.
const PASSPHRASE = 'copper lantern walrus opera 58'
const FILE_PASSWORD = 'harbor violet canyon pepper 41'
const FILE_PASSWORD_NEXT = 'meadow signal amber walnut 27'
const WRONG_PASSWORD = 'quartz ribbon velvet thistle 60'
const accounts = {
  alex: { id: 'e2ee-files-alex', name: 'Alex Morgan' },
  morgan: { id: 'e2ee-files-morgan', name: 'Morgan Lee' },
}

// ---------------------------------------------------------------- fixtures

/** A text that is in the plaintext of a fixture and must never leave the browser. */
const marker = (name) => `FLARE-PLAINTEXT-MARKER-${name}-9f3a7c`

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
      const out = path.join(os.tmpdir(), `flare-e2ee-${process.pid}.webm`)
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
          '-metadata',
          `title=${marker('video')}`,
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

/** 11 MiB that does not compress: the upload goes in parts, and a download can be compared. */
function largeFixture() {
  const body = randomBytes(11 * 1024 * 1024)
  body.write(marker('large'), 4096, 'latin1')
  return body
}

const HOSTILE_HTML = `<!doctype html><title>${marker('html')}</title>
<script>window.__flarePwned = 'html-script'; try { parent.__flarePwned = 'html-script' } catch {}</script>
<img src="x" onerror="window.__flarePwned = 'html-onerror'">
<p>${marker('html')}</p>`
const HOSTILE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="120" onload="window.__flarePwned = 'svg-onload'">
<script>window.__flarePwned = 'svg-script'; try { top.__flarePwned = 'svg-script' } catch {}</script>
<rect width="240" height="120" fill="#2d6cdf"/><text x="16" y="64" fill="#fff" font-size="14">${marker('svg').slice(0, 26)}</text>
<foreignObject width="10" height="10"><body xmlns="http://www.w3.org/1999/xhtml"><img src="x" onerror="top.__flarePwned = 'svg-foreign'"/></body></foreignObject>
</svg>`

const fixtures = {
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
  pdf: {
    name: 'contract-draft-private.pdf',
    mimeType: 'application/pdf',
    buffer: pdfFixture(marker('pdf')),
    marker: marker('pdf'),
  },
  large: {
    name: 'backup-archive-private.bin',
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
  protected: {
    name: 'payroll-private.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from(`${marker('protected')}\nOnly with the password.\n`),
    marker: marker('protected'),
  },
  hidden: {
    name: 'diary-private.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from(`${marker('hidden')}\nA private file.\n`),
    marker: marker('hidden'),
  },
}
const video = videoFixture()
if (video)
  fixtures.video = {
    name: 'screen-recording-private.webm',
    mimeType: 'video/webm',
    buffer: video,
    marker: marker('video'),
  }
const PASTE = {
  name: 'release-plan-private.md',
  text: `# ${marker('paste')}\n\nShip on Friday.\n`,
  marker: marker('paste'),
}
const PLAIN = {
  name: 'public-screenshot.png',
  mimeType: 'image/png',
  buffer: pngFixture('a plain file'),
}

// ---------------------------------------------------------------- recording

/** Every request the browser sent, as it arrived: `{ method, target, headers, body }`. */
const requests = []

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
        // The request target exactly as the browser wrote it on the wire.
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

/** `file_key` of a stored file, from the account private key and the account stanza. */
function fileKeyOf(file, accountPrivateKeyHex) {
  const seed = Buffer.from(accountPrivateKeyHex, 'hex')
  const exchangePrivateKey = sha512(seed).slice(0, 32)
  exchangePrivateKey[0] &= 248
  exchangePrivateKey[31] &= 127
  exchangePrivateKey[31] |= 64
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

/** `link_secret` of a password stanza, from the sealed copy that `file_key` opens. */
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

async function assertNothingSecretWasSent(keys) {
  const forbidden = new Map()
  const add = (label, forms) => {
    for (const form of forms) if (form.length >= 8) forbidden.set(form, label)
  }
  for (const [name, key] of Object.entries(keys.private))
    add(`the ${name}`, byteForms(Buffer.from(key, 'hex')))
  add('a passphrase', textForms(PASSPHRASE))
  for (const password of passwords) add('a file password', textForms(password))
  for (const fragment of fragments) add('a link fragment', [fragment])
  const files = await prisma.file.findMany({
    where: { userId: accounts.alex.id, encrypted: true },
  })
  let linkSecrets = 0
  for (const file of files) {
    const fileKey = fileKeyOf(file, keys.private.account_private_key)
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
    add('the name of an encrypted file', textForms(metadata.name))
  }
  for (const secret of everyLinkSecret) {
    add('a link_secret', byteForms(secret))
    linkSecrets++
  }
  for (const fixture of [...Object.values(fixtures), PASTE]) {
    add('plaintext of an encrypted file', textForms(fixture.marker))
    add('the name of an encrypted file', textForms(fixture.name))
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
  // The search can fail: the plain upload did send its name and its bytes.
  const plainSeen = requests.filter(
    (request) =>
      request.body.includes(PLAIN.name) && request.body.includes('a plain file')
  ).length
  assert.ok(plainSeen >= 1, 'The search did not see the plain upload')
  const bodies = requests.filter((request) => request.body).length
  results.push(
    `No request carried a secret: the recording proxy kept ${requests.length} requests (${bodies} with a body, ${Math.round(requests.reduce((total, request) => total + request.body.length, 0) / 1048576)} MiB of bodies) as they arrived, and none holds, in its request target, headers or body, any of ${forbidden.size} forms of: the account private key and its exchange key, the passphrase, ${passwords.size} file passwords, ${fragments.size} link fragments, the file_key of each of ${files.length} encrypted files and the four keys derived from it, ${linkSecrets} link secrets, the plaintext markers of ${Object.keys(fixtures).length + 1} encrypted files, and their file names. No request target has a '#'. The same search found the plain upload's name and bytes in ${plainSeen} request, which is the one upload that sends them by design`
  )
}

function safeDecode(text) {
  try {
    return decodeURIComponent(text)
  } catch {
    return text
  }
}

/** Link secrets of password stanzas that were later replaced or removed. */
const everyLinkSecret = []

// ---------------------------------------------------------------- browser

let address = 10
/** Console errors and policy violations of every page, by page address. */
const pageProblems = []

async function context(browser, { signedOut = false } = {}) {
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
  await ctx.addInitScript((theme) => {
    try {
      localStorage.setItem('theme', theme)
    } catch {}
    // Every policy violation of the page, and the type of every object
    // address it makes: a decrypted file must never become a page.
    window.__cspViolations = []
    document.addEventListener('securitypolicyviolation', (event) => {
      window.__cspViolations.push(
        `${event.violatedDirective} ${event.blockedURI} ${event.sourceFile || ''}`
      )
    })
    window.__blobTypes = []
    const create = URL.createObjectURL.bind(URL)
    URL.createObjectURL = (object) => {
      window.__blobTypes.push(object instanceof Blob ? object.type : 'source')
      return create(object)
    }
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
  void signedOut
  return { ctx, page }
}

function watchPage(page) {
  page.on('pageerror', (error) => {
    pageProblems.push(`${page.url()}: page error: ${error.message}`)
  })
  page.on('console', (message) => {
    if (message.type() !== 'error') return
    const text = message.text()
    // A request that the server refused on purpose logs a resource error.
    if (/Failed to load resource/.test(text)) return
    // The answer of a local address is sandboxed. In a frame the browser
    // then refuses the script this suite adds to every document, and says
    // so. That is the policy at work, not a fault of a page.
    if (
      /Blocked script execution in '[^']*\/_flare\/local\/[^']*' because the document's frame is sandboxed/.test(
        text
      )
    )
      return
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
  const keys = {}
  for (const [key, { id, name }] of Object.entries(accounts)) {
    const record = await shared.createAccountRecord(PASSPHRASE)
    keys[key] = shared.keysOfMnemonic(record.mnemonic)
    await prisma.user.create({
      data: {
        id,
        name,
        email: `${id}@example.test`,
        ...record.columns,
        roles: { connect: { systemKey: 'administrator' } },
        urlId: key === 'alex' ? 'alexm' : 'morgl',
      },
    })
  }
  return keys
}

async function signIn(browser, account) {
  const signedIn = await context(browser)
  await shared.signIn(signedIn.page, expect, {
    origin,
    email: `${accounts[account].id}@example.test`,
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

// ---------------------------------------------------------------- scenarios

const uploaded = {}

async function chooseFiles(page, list) {
  await page
    .locator('input[type="file"]')
    .setInputFiles(
      list.map(({ name, mimeType, buffer }) => ({ name, mimeType, buffer }))
    )
}

async function uploadEncrypted(page, list, { visibility, password } = {}) {
  await page.goto(`${origin}/dashboard/upload`)
  await expect(page.locator('[data-encryption-choice]')).toHaveAttribute(
    'data-encryption-choice',
    'encrypted'
  )
  await chooseFiles(page, list)
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
    await expect(page.locator('#upload-password-hint')).toHaveAttribute(
      'data-strength-score',
      /[34]/
    )
  }
  await page.getByRole('button', { name: /^Upload \d+ files?$/ }).click()
  for (const { name } of list)
    await expect(
      page.getByRole('link', { name: `Open ${name}`, exact: true })
    ).toBeVisible({ timeout: 120000 })
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

async function testUpload(alex) {
  const { page } = alex
  await page.goto(`${origin}/dashboard/upload`)
  await expect(
    page.getByText('Encrypted in this browser before upload.')
  ).toBeVisible()
  await shot(page, 'upload-choice-encrypted')
  await page.getByRole('radio', { name: /Plain/ }).check()
  await expect(
    page.getByText('The server and its administrators can read the file')
  ).toBeVisible()
  await shot(page, 'upload-choice-plain')

  // A weak password of an encrypted file stops the upload in the browser.
  await page.getByRole('radio', { name: /Encrypted/ }).check()
  await chooseFiles(page, [fixtures.text])
  await page.locator('#upload-password').fill('sunshine2024')
  await expect(page.locator('#upload-password-hint')).toHaveAttribute(
    'data-strength-score',
    /[012]/
  )
  await expect(
    page.getByRole('button', { name: /^Upload 1 file$/ })
  ).toBeDisabled()
  await shot(page, 'upload-password-weak')

  // Small files in one request each; the large one in parts.
  const small = [fixtures.image, fixtures.text, fixtures.pdf]
  if (fixtures.video) small.push(fixtures.video)
  Object.assign(uploaded, await uploadEncrypted(page, small))
  await shot(page, 'upload-complete')

  await page.goto(`${origin}/dashboard/upload`)
  await chooseFiles(page, [fixtures.large])
  await page.getByRole('button', { name: /^Upload 1 file$/ }).click()
  await expect(
    page.getByRole('button', { name: 'Encrypting and uploading…' })
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Cancel upload' })
  ).toBeVisible()
  await shot(page, 'upload-progress')
  await expect(
    page.getByRole('link', { name: `Open ${fixtures.large.name}`, exact: true })
  ).toBeVisible({ timeout: 180000 })
  await page
    .getByRole('button', {
      name: `Copy link for ${fixtures.large.name}`,
      exact: true,
    })
    .click()
  await expect.poll(() => clipboard(page)).toMatch(/#/)
  uploaded[fixtures.large.name] = link(await clipboard(page))

  const parts = requests.filter((request) =>
    /^\/api\/files\/chunks\/[a-z0-9]+\/part\/\d+$/.test(request.target)
  )
  assert.ok(
    parts.length >= 3,
    `The large file went in ${parts.length} parts, expected 3 or more`
  )
  assert.ok(
    parts.every((part) => part.body.length <= 6 * 1024 * 1024),
    'A part was larger than one encrypted part'
  )

  // What the server stored: ciphertext, and a row with no name and no type.
  const rows = await prisma.file.findMany({
    where: { userId: accounts.alex.id },
  })
  assert.equal(rows.length, small.length + 1)
  for (const row of rows) {
    assert.equal(row.encrypted, true)
    assert.equal(row.name, '')
    assert.equal(row.mimeType, 'application/octet-stream')
    assert.equal(row.password, null)
    assert.equal(row.ocrText, null)
    assert.match(row.urlPath, /^\/alexm\/e_[A-Za-z0-9_-]{22}$/)
    assert.match(
      row.path,
      /^uploads\/alexm\/[0-9a-f-]{36}\/e_[A-Za-z0-9_-]{22}$/
    )
    assert.equal(row.header.length, 26)
    assert.equal(row.accountStanza.length, 97)
    const stored = await readFile(path.join(appDirectory, row.path))
    assert.equal(stored.subarray(0, 8).toString('latin1'), 'FLAREE2E')
    assert.ok(stored.subarray(0, 26).equals(Buffer.from(row.header)))
    const text = stored.toString('latin1')
    for (const fixture of Object.values(fixtures)) {
      assert.ok(
        !text.includes(fixture.marker),
        'A stored object holds plaintext'
      )
      assert.ok(
        !JSON.stringify({ ...row, header: null }).includes(fixture.name),
        'A database row holds a file name'
      )
    }
    assert.ok(!text.includes('\x89PNG'), 'A stored object holds a PNG header')
  }
  const large = rows.find((row) => row.size > 10)
  const storedLarge = await readFile(path.join(appDirectory, large.path))
  // header + plaintext + one 32-byte tag for each 64 KiB chunk
  assert.equal(
    storedLarge.length,
    26 +
      fixtures.large.buffer.length +
      32 * Math.ceil(fixtures.large.buffer.length / 65536)
  )
  results.push(
    `Uploads from the browser are encrypted by default: ${small.length} files in one request each and an 11 MiB file in ${parts.length} parts of at most 5.1 MiB. On disk each object starts with FLAREE2E and its 26-byte header, holds no plaintext marker and no PNG signature, and has the exact length of header, plaintext and one tag per 64 KiB chunk. Each database row has an empty name, the generic type, no password hash, an address /alexm/e_… and a storage key without a name`
  )
  results.push(
    'A weak password of an encrypted file is refused in the browser by the strength check, before any request'
  )
}

/**
 * The library draws only the rows near the viewport. On a phone that is one
 * or two cards, so the checks that count every card use a tall viewport.
 */
async function viewportHeight(page, tall) {
  if (mobile)
    await page.setViewportSize({ width: 390, height: tall ? 4600 : 844 })
}

async function testLibrary(alex, keys) {
  const { page } = alex
  await viewportHeight(page, true)
  await page.goto(`${origin}/dashboard`)
  for (const name of Object.keys(uploaded))
    await expect(
      page.getByRole('link', { name: `Open ${name}`, exact: true }).first()
    ).toBeVisible()
  await expect(page.locator('[data-file-encryption="encrypted"]')).toHaveCount(
    Object.keys(uploaded).length
  )
  // The server makes no thumbnail and reads no text of an encrypted image:
  // the page asks for the sealed thumbnail only, which this browser opens.
  await expect(page.locator('[data-sealed-thumbnail]').first()).toBeVisible()
  assert.ok(
    !requests.some((request) =>
      /^\/api\/files\/[^/]+\/(thumbnail|ocr)(\?|$)/.test(request.target)
    ),
    'The library asked the server for a thumbnail or OCR of an encrypted file'
  )
  assert.ok(
    requests.some((request) => /\/sealed-thumbnail$/.test(request.target)),
    'The library did not ask for a sealed thumbnail'
  )
  await shot(page, 'library-unlocked')

  // The actions of an encrypted file: the newest card, at the top.
  await viewportHeight(page, false)
  await page
    .getByRole('button', { name: `Manage ${fixtures.large.name}`, exact: true })
    .click()
  const menu = page.getByRole('menu')
  await expect(menu.getByRole('menuitem', { name: 'Copy link' })).toBeVisible()
  await expect(menu.getByRole('menuitem', { name: /OCR/ })).toHaveCount(0)
  await expect(
    menu.getByRole('menuitem', { name: 'Browse archive' })
  ).toHaveCount(0)
  await shot(page, 'library-file-actions')
  await menu.getByRole('menuitem', { name: 'Copy link' }).click()
  await expect.poll(() => clipboard(page)).toBe(uploaded[fixtures.large.name])
  await shot(page, 'library-copy-link')
  await viewportHeight(page, true)

  // Download: decrypted in the browser, byte for byte the uploaded file.
  for (const fixture of [fixtures.text, fixtures.large]) {
    await page
      .getByRole('button', { name: `Manage ${fixture.name}`, exact: true })
      .click()
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 180000 }),
      page.getByRole('menuitem', { name: 'Download file' }).click(),
    ])
    assert.equal(download.suggestedFilename(), fixture.name)
    const saved = await readFile(await download.path())
    assert.ok(
      saved.equals(fixture.buffer),
      `${fixture.name} did not round-trip`
    )
  }
  results.push(
    'The library shows the decrypted names of encrypted files, marks them as encrypted, asks the server for no thumbnail and no OCR of them (only for the sealed thumbnail), offers no archive action for them and no OCR for a file that is not an image, and "Download file" saves the 11 MiB file and a text file byte for byte as they were uploaded, under their real names'
  )

  // The server has no names of encrypted files, so the browser searches
  // them: the file shows, and the request for the plain matches carries
  // the search and no encrypted file.
  await page.getByPlaceholder('Search your files…').fill('budget')
  await expect(
    page.getByRole('link', { name: `Open ${fixtures.text.name}`, exact: true })
  ).toBeVisible()
  await expect(page.locator('[data-file-encryption="encrypted"]')).toHaveCount(
    1
  )
  await expect(page.locator('[data-encrypted-search-note]')).toHaveCount(0)
  await shot(page, 'library-search-encrypted')
  results.push(
    'A search for a part of the name of an encrypted file finds it: the browser searches the names it decrypted'
  )

  // Locked: the key store is emptied, as on another device.
  await page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const request = indexedDB.deleteDatabase('flare-e2ee')
        request.onsuccess = () => resolve()
        request.onerror = () => reject(request.error)
        request.onblocked = () => resolve()
      })
  )
  await page.goto(`${origin}/dashboard`)
  await expect(page.locator('[data-unlock-banner]')).toBeVisible()
  // Soon after a sign-in the unlock prompt opens by itself, one time.
  const prompt = page.getByRole('dialog', {
    name: 'Unlock your encryption keys',
  })
  if (await prompt.isVisible().catch(() => false)) {
    await prompt.getByRole('button', { name: 'Not now', exact: true }).click()
    await expect(prompt).toHaveCount(0)
  }
  await expect(page.locator('[data-encrypted-file="locked"]')).toHaveCount(
    Object.keys(uploaded).length
  )
  for (const name of Object.keys(uploaded))
    await expect(page.getByText(name, { exact: true })).toHaveCount(0)
  await shot(page, 'library-locked')
  await page.goto(`${origin}/dashboard/upload`)
  await expect(
    page.getByText(
      'Your encryption keys are locked in this browser. Unlock them to'
    )
  ).toBeVisible()
  await chooseFiles(page, [fixtures.text])
  await expect(
    page.getByRole('button', { name: /^Upload 1 file$/ })
  ).toBeDisabled()
  await shot(page, 'upload-locked')

  await page.goto(`${origin}/dashboard`)
  await page
    .locator('[data-encrypted-file="locked"]')
    .first()
    .getByRole('button', { name: 'Unlock', exact: true })
    .click()
  const dialog = page.getByRole('dialog', {
    name: 'Unlock your encryption keys',
  })
  await dialog.getByLabel('Passphrase', { exact: true }).fill(PASSPHRASE)
  await dialog.getByRole('button', { name: 'Unlock', exact: true }).click()
  await expect(dialog).toHaveCount(0, { timeout: 60000 })
  await expect(page.locator('[data-encrypted-file]')).toHaveCount(0)
  for (const name of Object.keys(uploaded))
    await expect(
      page.getByRole('link', { name: `Open ${name}`, exact: true }).first()
    ).toBeVisible()
  const [record] = await shared.storedKeys(page)
  assert.equal(record.accountPrivateKey, keys.alex.accountPrivateKey)
  await viewportHeight(page, false)
  results.push(
    'With the keys locked, each encrypted file is a placeholder with no name, the upload form asks to unlock and cannot send an encrypted file, and the passphrase brings every name back'
  )
}

async function expectShareState(page, state) {
  await expect(page.locator('[data-encrypted-share]')).toHaveAttribute(
    'data-encrypted-share',
    state,
    { timeout: 60000 }
  )
}

async function testSharePages(browser, alex) {
  const visitor = await context(browser, { signedOut: true })
  const { page } = visitor

  // Image
  await page.goto(uploaded[fixtures.image.name])
  await expectShareState(page, 'open')
  const image = page.getByRole('img', { name: fixtures.image.name })
  await expect(image).toBeVisible()
  await expect
    .poll(() => image.evaluate((element) => element.naturalWidth))
    .toBe(96)
  assert.match(await image.getAttribute('src'), /^blob:/)
  await expect(page.locator('[data-encrypted-title="open"]')).toHaveText(
    fixtures.image.name
  )
  await shot(page, 'share-image')

  // Text
  await page.goto(uploaded[fixtures.text.name])
  await expectShareState(page, 'open')
  await expect(page.getByText(fixtures.text.marker)).toBeVisible()
  await shot(page, 'share-text')
  // Download from the share page, signed out.
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download', exact: true }).click(),
  ])
  assert.equal(download.suggestedFilename(), fixtures.text.name)
  assert.ok(
    (await readFile(await download.path())).equals(fixtures.text.buffer)
  )

  // PDF: a sandboxed frame where the browser can fill one, a download here.
  await page.goto(uploaded[fixtures.pdf.name])
  await expectShareState(page, 'open')
  const frame = page.locator('iframe[title$="document preview"]')
  // Three outcomes, by browser: a frame on a local address of the service
  // worker (a Chromium with a PDF viewer), a sandboxed frame on a Blob (a
  // browser that shows PDFs in one), or the download card (no PDF viewer).
  await expect(
    frame.or(page.getByText('PDF preview is not available in this browser'))
  ).toBeVisible({ timeout: 60000 })
  const pdfSource = (await frame.count())
    ? await frame.getAttribute('src')
    : null
  const pdfState = !pdfSource
    ? 'download'
    : pdfSource.startsWith('blob:')
      ? 'frame'
      : 'local'
  if (pdfState === 'frame')
    assert.equal(await frame.getAttribute('sandbox'), '')
  else if (pdfState === 'local') {
    assert.match(
      pdfSource,
      /^\/_flare\/local\/[A-Za-z0-9_-]{43}\/document\.pdf#/
    )
    assert.equal(await frame.getAttribute('sandbox'), null)
  }
  await shot(page, 'share-pdf')
  const [pdf] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download', exact: true }).click(),
  ])
  assert.ok((await readFile(await pdf.path())).equals(fixtures.pdf.buffer))

  // Video
  if (fixtures.video) {
    await page.goto(uploaded[fixtures.video.name])
    await expectShareState(page, 'open')
    const player = page.locator('video')
    await expect(player).toBeVisible()
    await expect
      .poll(() => player.evaluate((element) => element.readyState >= 1), {
        timeout: 30000,
      })
      .toBe(true)
    assert.equal(
      await player.evaluate((element) => element.videoWidth),
      320,
      'The decrypted video did not load'
    )
    await shot(page, 'share-video')
  }

  // The large file is not text, image or media: it is offered as a download.
  await page.goto(uploaded[fixtures.large.name])
  await expectShareState(page, 'open')
  await expect(page.getByText('Preview not available')).toBeVisible()
  await shot(page, 'share-download-only')
  const [large] = await Promise.all([
    page.waitForEvent('download', { timeout: 180000 }),
    page.getByRole('button', { name: 'Download', exact: true }).click(),
  ])
  assert.ok((await readFile(await large.path())).equals(fixtures.large.buffer))

  // Every object address of these pages has a fixed, safe type.
  const types = await page.evaluate(() => window.__blobTypes)
  assert.ok(
    types.every((type) => type === 'application/octet-stream'),
    `Unexpected object types: ${types}`
  )

  // No fragment: the server has nothing that opens the file.
  const bare = uploaded[fixtures.image.name].split('#')[0]
  await page.goto(bare)
  await expectShareState(page, 'missing-key')
  await expect(
    page.getByRole('heading', { name: 'This link is missing its key' })
  ).toBeVisible()
  await expect(page.getByText(fixtures.image.name)).toHaveCount(0)
  await shot(page, 'share-missing-key')

  // The key of a different file.
  const otherKey = uploaded[fixtures.text.name].split('#')[1]
  await page.goto(`${bare}#${otherKey}`)
  await page.reload()
  await expectShareState(page, 'wrong-key')
  await expect(
    page.getByRole('heading', { name: 'This key does not open this file' })
  ).toBeVisible()
  await shot(page, 'share-wrong-key')

  // A prefix of a later version: the client says so and tries nothing else.
  await page.goto(`${bare}#q.${otherKey}`)
  await page.reload()
  await expectShareState(page, 'update')

  assert.deepEqual(await violations(page), [])
  await visitor.ctx.close()
  results.push(
    `A signed-out visitor with the copied link sees the decrypted image (an <img> on a blob of image/png), the text, the PDF (${pdfState === 'frame' ? 'in a frame with an empty sandbox attribute' : pdfState === 'local' ? 'in a frame on a local address of the service worker, whose answer carries the sandbox policy' : 'offered as a download, because this browser has no PDF viewer'})${fixtures.video ? ', and plays the video' : ''}; downloads from the share page are byte-identical, the 11 MiB file included; the same address without its fragment says "This link is missing its key", with the key of another file "This key does not open this file", and with an unknown prefix it asks for a newer version`
  )
  void alex
}

async function testPasswords(browser, alex) {
  const { page } = alex
  const links = await uploadEncrypted(page, [fixtures.protected], {
    password: FILE_PASSWORD,
  })
  const first = links[fixtures.protected.name]
  assert.match(first, /#p\.[A-Za-z0-9_-]{43}$/)
  const row = await prisma.file.findFirstOrThrow({
    where: { userId: accounts.alex.id, passwordStanza: { not: null } },
  })
  assert.equal(row.password, null)
  assert.equal(row.passwordStanza.length, 217)

  const visitor = await context(browser, { signedOut: true })
  await visitor.page.goto(first)
  await expectShareState(visitor.page, 'password')
  await shot(visitor.page, 'share-password-prompt')
  passwords.add(WRONG_PASSWORD)
  await visitor.page.locator('#encrypted-share-password').fill(WRONG_PASSWORD)
  await visitor.page.getByRole('button', { name: 'Open file' }).click()
  await expect(
    visitor.page.getByText('That password does not open this file.')
  ).toBeVisible({ timeout: 60000 })
  await shot(visitor.page, 'share-password-wrong')
  await visitor.page.locator('#encrypted-share-password').fill(FILE_PASSWORD)
  const deriving = expect(
    visitor.page.getByRole('button', { name: 'Deriving the key…' })
  ).toBeVisible()
  await visitor.page.getByRole('button', { name: 'Open file' }).click()
  await deriving
  await expectShareState(visitor.page, 'open')
  await expect(visitor.page.getByText(fixtures.protected.marker)).toBeVisible()

  // The owner changes the password: a new link, and the old one stops.
  const before = await prisma.file.findUniqueOrThrow({ where: { id: row.id } })
  everyLinkSecret.push(linkSecretOf(before, fileKeyOf(before, alexPrivateKey)))
  await page.goto(`${origin}/dashboard`)
  await page
    .getByRole('button', {
      name: `Manage ${fixtures.protected.name}`,
      exact: true,
    })
    .click()
  await page.getByRole('menuitem', { name: 'Manage password' }).click()
  const dialog = page.getByRole('dialog', { name: 'Manage password' })
  await shot(page, 'password-dialog')
  passwords.add(FILE_PASSWORD_NEXT)
  await dialog.getByLabel('New password').fill(FILE_PASSWORD_NEXT)
  await expect(dialog.locator('[data-strength-score]')).toHaveAttribute(
    'data-strength-score',
    /[34]/
  )
  await shot(page, 'password-dialog-strong')
  await dialog.getByRole('button', { name: 'Update password' }).click()
  await expect(dialog).toHaveCount(0, { timeout: 60000 })
  await expect.poll(() => clipboard(page)).toMatch(/#p\.[A-Za-z0-9_-]{43}$/)
  const second = link(await clipboard(page))
  assert.notEqual(second, first)

  await visitor.page.goto(first)
  await visitor.page.reload()
  await expectShareState(visitor.page, 'password')
  for (const password of [FILE_PASSWORD, FILE_PASSWORD_NEXT]) {
    await visitor.page.locator('#encrypted-share-password').fill(password)
    await visitor.page.getByRole('button', { name: 'Open file' }).click()
    await expect(
      visitor.page.getByText('That password does not open this file.')
    ).toBeVisible({ timeout: 60000 })
  }
  await visitor.page.goto(second)
  await visitor.page.reload()
  await expectShareState(visitor.page, 'password')
  await visitor.page
    .locator('#encrypted-share-password')
    .fill(FILE_PASSWORD_NEXT)
  await visitor.page.getByRole('button', { name: 'Open file' }).click()
  await expectShareState(visitor.page, 'open')
  await visitor.ctx.close()
  results.push(
    'A file uploaded with a password gets a link with #p. and a password stanza, and no password hash on the server; the share page asks for the password, shows the Argon2id step, rejects a wrong password and opens with the right one; after the owner changes the password, the old link opens with neither password and the new link opens with the new one'
  )
}

let alexPrivateKey = ''

async function testPrivate(browser, alex) {
  const links = await uploadEncrypted(alex.page, [fixtures.hidden], {
    visibility: 'PRIVATE',
  })
  const address = links[fixtures.hidden.name]
  const row = await prisma.file.findFirstOrThrow({
    where: { userId: accounts.alex.id, visibility: 'PRIVATE' },
  })
  const stranger = await context(browser, { signedOut: true })
  await stranger.page.goto(address)
  await expect(stranger.page.locator('[data-encrypted-share]')).toHaveCount(0)
  await expect(stranger.page.getByText(fixtures.hidden.marker)).toHaveCount(0)
  for (const route of [
    `/api/files${row.urlPath}`,
    `/api/files/${row.id}/encryption`,
    `/api/files/${row.id}/download`,
    `${row.urlPath}/raw`,
  ]) {
    const response = await stranger.ctx.request.get(origin + route)
    assert.ok(
      [401, 404].includes(response.status()),
      `${route} answered ${response.status()} to a stranger`
    )
  }
  await stranger.ctx.close()
  // The owner opens it without a fragment: the account key opens the stanza.
  await alex.page.goto(address.split('#')[0])
  await expectShareState(alex.page, 'open')
  await expect(alex.page.getByText(fixtures.hidden.marker)).toBeVisible()
  results.push(
    'A private encrypted file is refused by the server to a stranger who has the full link: the page, the ciphertext, the records and the download answer 401 or 404; the owner opens it without a fragment, through the account stanza'
  )
}

async function testPaste(browser, alex) {
  const { page } = alex
  await page.goto(`${origin}/dashboard/paste`)
  await page.locator('#content').fill(PASTE.text)
  await page.locator('#filename').fill(PASTE.name)
  await expect(page.locator('[data-encryption-choice]')).toHaveAttribute(
    'data-encryption-choice',
    'encrypted'
  )
  await shot(page, 'paste-form')
  await page.getByRole('button', { name: 'Create paste' }).click()
  const field = page.locator('#paste-created-link')
  await expect(field).toHaveValue(
    /\/alexm\/e_[A-Za-z0-9_-]{22}#[A-Za-z0-9_-]{43}$/
  )
  const address = link(await field.inputValue())
  const row = await prisma.file.findFirstOrThrow({
    where: { userId: accounts.alex.id, isPaste: true },
  })
  assert.equal(row.encrypted, true)
  assert.equal(row.name, '')
  const stored = await readFile(path.join(appDirectory, row.path))
  assert.ok(!stored.toString('latin1').includes(PASTE.marker))
  const visitor = await context(browser, { signedOut: true })
  await visitor.page.goto(address)
  await expectShareState(visitor.page, 'open')
  await expect(visitor.page.getByText(PASTE.marker)).toBeVisible()
  await expect(
    visitor.page.locator('[data-encrypted-title="open"]')
  ).toHaveText(PASTE.name)
  await visitor.ctx.close()
  results.push(
    'A paste is encrypted by default: the stored object holds no paste text, the row has no name, and a signed-out visitor with the link reads the paste with its name'
  )
}

async function testPlain(browser, alex) {
  const { page } = alex
  await page.goto(`${origin}/dashboard/upload`)
  await page.getByRole('radio', { name: /Plain/ }).check()
  await chooseFiles(page, [PLAIN])
  await page.getByRole('button', { name: /^Upload 1 file$/ }).click()
  await expect(
    page.getByRole('link', { name: `Open ${PLAIN.name}`, exact: true })
  ).toBeVisible()
  const row = await prisma.file.findFirstOrThrow({
    where: { userId: accounts.alex.id, encrypted: false },
  })
  assert.equal(row.name, PLAIN.name)
  assert.equal(row.mimeType, 'image/png')
  assert.equal(row.urlPath, `/alexm/${PLAIN.name}`)
  assert.equal(row.header, null)
  const stored = await readFile(path.join(appDirectory, row.path))
  assert.ok(
    stored.equals(PLAIN.buffer),
    'The plain file is not stored as it is'
  )

  const crawler = { 'User-Agent': 'Mozilla/5.0 (compatible; Discordbot/2.0)' }
  // A plain file keeps its redirect to the raw content and its metadata.
  const plainPage = await fetch(`${origin}${row.urlPath}`, {
    headers: crawler,
    redirect: 'manual',
  })
  assert.equal(plainPage.status, 307)
  assert.equal(
    new URL(plainPage.headers.get('location'), origin).pathname,
    `${row.urlPath}/raw`
  )
  const raw = await fetch(`${origin}${row.urlPath}/raw`)
  assert.equal(raw.headers.get('content-type'), 'image/png')
  assert.ok(Buffer.from(await raw.arrayBuffer()).equals(PLAIN.buffer))
  const html = await (await fetch(`${origin}${row.urlPath}`)).text()
  // A production build writes these addresses with https, whatever the test origin is.
  const host = new URL(origin).host
  // Text as it is, with every character that a pattern reads as a rule escaped.
  const literal = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  assert.match(
    html,
    new RegExp(
      `property="og:image" content="https?://${literal(host)}${literal(row.urlPath)}/raw"`
    )
  )
  assert.ok(html.includes(PLAIN.name))

  // An encrypted file: no redirect, a generic preview, nothing about the file.
  const encrypted = await prisma.file.findFirstOrThrow({
    where: { userId: accounts.alex.id, encrypted: true, visibility: 'PUBLIC' },
    orderBy: { uploadedAt: 'asc' },
  })
  const answer = await fetch(`${origin}${encrypted.urlPath}`, {
    headers: crawler,
    redirect: 'manual',
  })
  assert.equal(answer.status, 200, 'A crawler was redirected')
  const preview = await answer.text()
  const meta = (property) =>
    new RegExp(`<meta (?:property|name)="${property}" content="([^"]*)"`).exec(
      preview
    )?.[1]
  assert.equal(meta('og:title'), 'Encrypted file')
  assert.equal(meta('og:description'), 'Open the link to view this file.')
  assert.match(meta('og:image'), new RegExp(`^https?://${host}/icon\\.svg$`))
  assert.equal(meta('robots'), 'noindex, nofollow')
  assert.ok(meta('og:site_name'))
  assert.ok(!preview.includes('/raw'), 'The preview names a raw address')
  for (const fixture of Object.values(fixtures))
    assert.ok(!preview.includes(fixture.name), 'The preview names the file')
  for (const route of ['raw', 'direct']) {
    const response = await fetch(`${origin}${encrypted.urlPath}/${route}`, {
      headers: crawler,
      redirect: 'manual',
    })
    assert.equal(response.status, 404, `/${route} of an encrypted file`)
  }
  // The ciphertext is served as a download and never as a page.
  const ciphertext = await fetch(`${origin}/api/files${encrypted.urlPath}`, {
    headers: { Range: 'bytes=0-25' },
  })
  assert.equal(ciphertext.status, 206)
  assert.equal(
    ciphertext.headers.get('content-type'),
    'application/octet-stream'
  )
  assert.match(ciphertext.headers.get('content-disposition'), /^attachment/)
  assert.equal(ciphertext.headers.get('x-content-type-options'), 'nosniff')
  assert.equal(ciphertext.headers.get('content-security-policy'), 'sandbox')
  assert.ok(
    Buffer.from(await ciphertext.arrayBuffer()).equals(
      Buffer.from(encrypted.header)
    )
  )

  // The plain file's share page still shows its content.
  const visitor = await context(browser, { signedOut: true })
  await visitor.page.goto(`${origin}${row.urlPath}`)
  const image = visitor.page.getByRole('img', { name: PLAIN.name })
  await expect(image).toBeVisible()
  await expect
    .poll(() => image.evaluate((element) => element.naturalWidth))
    .toBe(96)
  await visitor.ctx.close()
  await page.goto(`${origin}/dashboard`)
  await expect(page.locator('[data-file-encryption="plain"]')).toHaveCount(1)
  await shot(page, 'library-plain-and-encrypted')
  results.push(
    'A plain upload still works as before: it is stored as it is under /alexm/public-screenshot.png with its name and type, a crawler is redirected to its raw image, its page names the image in og:image, its share page shows it, and the library marks it as plain. For an encrypted file a crawler gets the page with no redirect and the generic preview (site name, "Encrypted file", "Open the link to view this file.", the instance icon, noindex), /raw and /direct answer 404, and the ciphertext is served with ranges as application/octet-stream, attachment, nosniff and a sandbox policy'
  )
}

async function testHostileContent(browser, alex) {
  const links = await uploadEncrypted(alex.page, [fixtures.html, fixtures.svg])
  const visitor = await context(browser, { signedOut: true })
  const { page } = visitor

  await page.goto(links[fixtures.html.name])
  await expectShareState(page, 'open')
  // The markup is shown as text: its source is readable on the page.
  await expect(page.getByText('window.__flarePwned').first()).toBeVisible()
  await page.waitForTimeout(500)
  assert.equal(await page.evaluate(() => window.__flarePwned), undefined)
  assert.equal(await page.locator('iframe').count(), 0)
  assert.notEqual(await page.title(), fixtures.html.marker)
  await shot(page, 'share-html-as-text')

  await page.goto(links[fixtures.svg.name])
  await expectShareState(page, 'open')
  const image = page.getByRole('img', { name: fixtures.svg.name })
  await expect(image).toBeVisible()
  await expect
    .poll(() => image.evaluate((element) => element.naturalWidth))
    .toBe(240)
  assert.match(await image.getAttribute('src'), /^data:image\/svg\+xml;base64,/)
  await page.waitForTimeout(500)
  assert.equal(await page.evaluate(() => window.__flarePwned), undefined)
  assert.equal(
    await page.locator('iframe, object, embed, svg script').count(),
    0
  )
  // Opening the image's own address must not make it a page of this origin.
  const src = await image.getAttribute('src')
  const popup = await visitor.ctx.newPage()
  await popup.goto(src).catch(() => undefined)
  await popup.waitForTimeout(500)
  const popupOrigin = await popup
    .evaluate(() => window.origin)
    .catch(() => 'blocked')
  assert.notEqual(popupOrigin, origin)
  await popup.close()
  await shot(page, 'share-svg')
  const types = await page.evaluate(() => window.__blobTypes)
  assert.deepEqual(types, [], `An SVG became an object address: ${types}`)
  await visitor.ctx.close()

  // The owner's library: the names are text, and the cards run nothing.
  await viewportHeight(alex.page, true)
  await alex.page.goto(`${origin}/dashboard`)
  await expect(
    alex.page
      .getByRole('link', { name: `Open ${fixtures.html.name}`, exact: true })
      .first()
  ).toBeVisible()
  assert.equal(await alex.page.evaluate(() => window.__flarePwned), undefined)
  await viewportHeight(alex.page, false)
  results.push(
    'Hostile decrypted content does not run in the application origin: an encrypted "text/html" file with a <script> and an onerror handler is shown as source text, with no frame and no script run; an encrypted SVG with a <script>, an onload handler and a foreignObject is drawn by an <img> from a data: address, runs nothing, makes no blob address, and its address opened in a new tab is not a page of the application origin'
  )
}

async function testModerator(browser) {
  const morgan = await signIn(browser, 'morgan')
  const { page } = morgan
  const file = await prisma.file.findFirstOrThrow({
    where: { userId: accounts.alex.id, encrypted: true, visibility: 'PUBLIC' },
    orderBy: { uploadedAt: 'asc' },
  })
  const list = await api(
    morgan.ctx,
    `/api/users/${accounts.alex.id}/files?limit=50`
  )
  const listed = JSON.stringify(list)
  for (const fixture of Object.values(fixtures))
    assert.ok(!listed.includes(fixture.name), 'The moderator list names a file')
  const records = await api(morgan.ctx, `/api/files/${file.id}/encryption`)
  assert.equal(records.accountStanza, undefined)
  assert.ok(records.header && records.sealedMetadata)
  await page.goto(`${origin}/dashboard/users`)
  await page
    .getByRole('button', {
      name: `View content for ${accounts.alex.name}`,
      exact: true,
    })
    .click()
  const content = page.getByRole('dialog')
  await expect(content.locator('[data-encrypted-row]').first()).toHaveText(
    'Encrypted file'
  )
  for (const fixture of Object.values(fixtures))
    await expect(content.getByText(fixture.name)).toHaveCount(0)
  await shot(page, 'moderator-content')
  await content
    .getByRole('button', { name: 'Actions for Encrypted file' })
    .first()
    .click()
  await page.getByRole('menuitem', { name: 'Settings' }).click()
  await expect(page.locator('[data-encrypted-file-note]')).toBeVisible()
  await expect(page.locator('#password-protection')).toHaveCount(0)
  await shot(page, 'moderator-file-settings')
  await page.keyboard.press('Escape')
  await page.goto(`${origin}${file.urlPath}`)
  await expectShareState(page, 'moderator')
  await expect(
    page.getByRole('heading', { name: 'This file is encrypted' })
  ).toBeVisible()
  await shot(page, 'moderator-share-page')
  await morgan.ctx.close()
  results.push(
    'A moderator (content.read) can list another account’s encrypted files without names, sees each as "Encrypted file" in View content with a note in place of the password field, gets the records without the account stanza, and sees "This file is encrypted" on the share page: the server gives ciphertext and visible metadata, and nothing that decrypts'
  )
}

async function testShortLinks(alex) {
  const { page } = alex
  const before = requests.length
  await page.goto(`${origin}/dashboard/urls`)
  await page.locator('#url').fill(uploaded[fixtures.image.name])
  await page
    .getByRole('button', { name: /Shorten|Create/ })
    .first()
    .click()
  await expect(
    page.getByText('This link has an encryption key after #.')
  ).toBeVisible()
  await shot(page, 'short-link-refused')
  assert.ok(
    !requests
      .slice(before)
      .some(
        (request) => request.method === 'POST' && request.target === '/api/urls'
      ),
    'The short link form sent a link with a key'
  )
  results.push(
    'The short link form refuses a link that carries a key after #, explains why, and sends no request'
  )
}

async function testPolicy(browser, alex) {
  // The administrator's Custom head script gets the nonce and runs.
  const settings = await api(alex.ctx, '/api/settings')
  const advanced =
    settings.data?.settings?.advanced ?? settings.settings?.advanced
  await api(alex.ctx, '/api/settings', 'PATCH', {
    settings: {
      advanced: {
        ...advanced,
        customHead:
          '<script>window.__customHead = "ran"</script><meta name="flare-test" content="1">',
      },
    },
  })
  const { page } = alex
  await page.goto(`${origin}/dashboard`)
  await expect(page.getByRole('button', { name: 'Account menu' })).toBeVisible()
  assert.equal(await page.evaluate(() => window.__customHead), 'ran')
  const header = await (
    await fetch(`${origin}/auth/login`)
  ).headers.get('content-security-policy')
  assert.match(
    header,
    /script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic' 'wasm-unsafe-eval';/
  )
  assert.ok(!/script-src[^;]*unsafe-inline/.test(header))
  assert.ok(
    !/script-src[^;]*unsafe-eval'/.test(
      header.replace("'wasm-unsafe-eval'", '')
    )
  )
  assert.match(header, /object-src 'none'/)
  assert.match(header, /base-uri 'self'/)
  assert.match(header, /frame-ancestors 'self'/)

  // Markup that reaches the page without the nonce runs nothing: an inline
  // event handler, an inline script that a parser reads (here in a srcdoc
  // frame, which has the page's policy), and a javascript: address.
  await page.evaluate(() => {
    const holder = document.createElement('div')
    holder.innerHTML =
      '<img src="x" onerror="window.__injected = \'handler\'">' +
      '<a id="injected-link" href="javascript:window.__injected = \'link\'">x</a>'
    document.body.appendChild(holder)
    const frame = document.createElement('iframe')
    frame.srcdoc = '<script>parent.__injected = "parsed script"</script>'
    document.body.appendChild(frame)
    document.getElementById('injected-link').click()
  })
  await page.waitForTimeout(700)
  assert.equal(await page.evaluate(() => window.__injected), undefined)
  const blocked = await violations(page)
  assert.ok(
    blocked.some((entry) => entry.startsWith('script-src-attr')),
    `The injected handler was not reported: ${blocked}`
  )
  await api(alex.ctx, '/api/settings', 'PATCH', {
    settings: { advanced: { ...advanced, customHead: '' } },
  })

  // No page of the run broke the policy by itself.
  const visited = [
    '/dashboard',
    '/dashboard/upload',
    '/dashboard/paste',
    '/dashboard/urls',
    '/dashboard/profile',
    '/dashboard/settings',
    '/dashboard/users',
    '/dashboard/customize',
  ]
  for (const route of visited) {
    const fresh = await alex.ctx.newPage()
    watchPage(fresh)
    await fresh.goto(origin + route)
    await fresh.waitForLoadState('networkidle').catch(() => undefined)
    assert.deepEqual(await violations(fresh), [], `${route} broke the policy`)
    await fresh.close()
  }
  const signedOut = await context(browser, { signedOut: true })
  for (const route of ['/auth/login', '/auth/register']) {
    await signedOut.page.goto(origin + route)
    await signedOut.page.waitForLoadState('networkidle').catch(() => undefined)
    assert.deepEqual(
      await violations(signedOut.page),
      [],
      `${route} broke the policy`
    )
  }
  await signedOut.ctx.close()
  results.push(
    `The script policy is enforced: the header has a nonce, 'strict-dynamic' and 'wasm-unsafe-eval' and no 'unsafe-inline' or 'unsafe-eval'; a script of the Custom head setting gets the nonce and runs; injected markup runs nothing: an inline event handler (reported as a script-src-attr violation), an inline script read by the parser in a srcdoc frame, and a javascript: link; ${visited.length + 2} pages (dashboard, upload, paste, short links, profile, settings, users, customize, sign-in, register) load with no violation, and sign-in, uploads with Argon2id and workers, and the share pages ran under it`
  )
}

async function main() {
  const proxy = await startRecordingProxy()
  const browser = await chromium.launch({ headless: true })
  try {
    const keys = await seed()
    alexPrivateKey = keys.alex.accountPrivateKey
    const alex = await signIn(browser, 'alex')
    await useTheme(alex)
    await testUpload(alex)
    await testLibrary(alex, keys)
    await testSharePages(browser, alex)
    await testPasswords(browser, alex)
    await testPrivate(browser, alex)
    await testPaste(browser, alex)
    await testHostileContent(browser, alex)
    await testPlain(browser, alex)
    await testModerator(browser)
    await testShortLinks(alex)
    await testPolicy(browser, alex)

    const exchangePrivateKey = sha512(
      Buffer.from(keys.alex.accountPrivateKey, 'hex')
    ).slice(0, 32)
    exchangePrivateKey[0] &= 248
    exchangePrivateKey[31] &= 127
    exchangePrivateKey[31] |= 64
    await assertNothingSecretWasSent({
      private: {
        account_private_key: keys.alex.accountPrivateKey,
        exchange_private_key: Buffer.from(exchangePrivateKey).toString('hex'),
      },
    })
    // Nothing outside the key store holds a key: no web storage entry.
    const storage = await alex.page.evaluate(() =>
      JSON.stringify({ ...localStorage, ...sessionStorage })
    )
    for (const fragment of fragments)
      assert.ok(!storage.includes(fragment), 'Web storage holds a link key')
    // The policy test injects markup on purpose; its refusals are expected.
    const unexpected = pageProblems.filter(
      (problem) => !/Content Security Policy directive/.test(problem)
    )
    assert.deepEqual(unexpected, [], 'A page logged an error')
    for (const result of results) console.log(`PASS: ${result}`)
    if (!fixtures.video)
      console.log(
        'SKIPPED: the video scenario. No ffmpeg with libvpx was found to make the fixture.'
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
// `existsSync` documents that the suite reads the application's own uploads.
void existsSync
