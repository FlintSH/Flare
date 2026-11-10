/* eslint-disable @typescript-eslint/no-require-imports */
// The real `flare-upload` program against the real application
// (docs/e2ee-spec.md, sections 8.3.6, 10.2, 11 and 14.4): a production
// build, a disposable database, a headless browser. Nothing is a stand-in.
//
// The run makes each configuration the way a person does, in the Upload
// tools card of a signed-in browser, so the account public key of a
// configuration comes from the unlocked keys of that browser. It then
// starts the program with those files, opens each printed link signed out,
// and checks that the content decrypts.
//
// The browser and the program both reach the application through a small
// recording proxy that this script starts. At the end the script searches
// every recorded request for what must never leave the machine: the name
// and the content of each encrypted file, each file key, each link secret,
// the password, and each part of a link after `#`.
//
// Setup, with the application built (`pnpm build`), the program built
// (`cargo build --release` in clients/flare-upload) and PostgreSQL running:
//
//   export DATABASE_URL='postgresql://flare_test@127.0.0.1:5432/flare_e2ee_script_local'
//   pnpm exec prisma migrate deploy
//   NEXTAUTH_URL='http://localhost:3094' NEXTAUTH_SECRET=... \
//     pnpm exec next start -H 127.0.0.1 -p 3093
//   node scripts/e2ee/verify-script-upload.cjs
//
// The application listens on 3093. The proxy of this script listens on
// 3094, which is the origin the browser uses and `NEXTAUTH_URL` names.
// FLARE_SCRIPT_UPLOAD_ORIGIN and FLARE_SCRIPT_UPLOAD_UPSTREAM change both.
const assert = require('node:assert/strict')
const { spawn } = require('node:child_process')
const { createHash, randomBytes, randomInt } = require('node:crypto')
const { existsSync } = require('node:fs')
const {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} = require('node:fs/promises')
const http = require('node:http')
const os = require('node:os')
const path = require('node:path')
const zlib = require('node:zlib')
const {
  chromium,
  expect: baseExpect,
} = require('../../docs/site/node_modules/@playwright/test')
const { PrismaClient } = require('@prisma/client')
const shared = require('../shared/passphrase-accounts.cjs')
const expect = baseExpect.configure({ timeout: 45000 })

const origin = process.env.FLARE_SCRIPT_UPLOAD_ORIGIN || 'http://localhost:3094'
const upstream =
  process.env.FLARE_SCRIPT_UPLOAD_UPSTREAM || 'http://127.0.0.1:3093'
if (new URL(origin).hostname !== 'localhost')
  throw new Error('Use a disposable localhost instance, matching NEXTAUTH_URL.')
const database = new URL(process.env.DATABASE_URL || 'postgresql://unset/')
if (
  !['localhost', '127.0.0.1'].includes(database.hostname) ||
  database.pathname !== '/flare_e2ee_script_local'
)
  throw new Error(
    'This check needs a local PostgreSQL database named exactly flare_e2ee_script_local.'
  )
const binary =
  process.env.FLARE_UPLOAD_BINARY ||
  path.resolve(
    __dirname,
    '../../clients/flare-upload/target/release/flare-upload'
  )
if (!existsSync(binary))
  throw new Error(
    `No flare-upload program at ${binary}. Build it: cargo build --release in clients/flare-upload.`
  )
const screenshots = process.env.FLARE_E2EE_SCREENSHOTS
const mobile = process.env.FLARE_E2EE_VIEWPORT === 'mobile'
const theme = process.env.FLARE_E2EE_THEME === 'light' ? 'light' : 'dark'
const prisma = new PrismaClient()
const results = []
const pageProblems = []

// Demonstration secrets. They are public and only for disposable fixtures.
const PASSPHRASE = 'copper lantern walrus opera 58'
const FILE_PASSWORD = 'harbor violet canyon pepper 41'
const LEGACY_TOKEN = 'script-demo-alex-public-disposable-upload-token'
const accounts = {
  alex: { id: 'e2ee-script-alex', name: 'Alex Morgan', urlId: 'alexs' },
  morgan: { id: 'e2ee-script-morgan', name: 'Morgan Lee', urlId: 'morgs' },
}
const profiles = {
  // Not the name of a starter recipe of the profile manager.
  encrypted: { name: 'Work captures', file: 'work-captures.json' },
  plain: { name: 'Chat screenshots', file: 'chat-screenshots.json' },
}

// ---------------------------------------------------------------- fixtures

/** A text in the plaintext of a fixture that must never reach the server. */
const marker = (name) => `FLARE-SCRIPT-MARKER-${name}-4c81e2`

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

/** Over the single-request limit of the program (8 MiB) and over one part. */
function largeFixture() {
  const head = Buffer.from(`${marker('large')}\n`, 'utf8')
  return Buffer.concat([head, randomBytes(9 * 1024 * 1024 + 4321)])
}

const fixtures = {
  image: {
    name: 'tax-return-2026-screenshot.png',
    marker: marker('image'),
    buffer: pngFixture(marker('image')),
  },
  large: {
    name: 'board-meeting-recording.bin',
    marker: marker('large'),
    buffer: largeFixture(),
  },
  protected: {
    name: 'salary-negotiation-notes.txt',
    marker: marker('protected'),
    buffer: Buffer.from(`${marker('protected')}\nprivate notes\n`, 'utf8'),
  },
  extra: {
    name: 'second-private-capture.txt',
    marker: marker('extra'),
    buffer: Buffer.from(`${marker('extra')}\nmore notes\n`, 'utf8'),
  },
  // Plain uploads: the server is meant to read these.
  plain: {
    name: 'public-changelog.txt',
    buffer: Buffer.from('A plain file for a chat preview.\n', 'utf8'),
  },
  legacy: {
    name: 'legacy-tool-capture.txt',
    buffer: Buffer.from('Sent by a configuration from before encryption.\n'),
  },
}
/** The fixtures whose name and content are secret. */
const secretFixtures = ['image', 'large', 'protected', 'extra']

// ---------------------------------------------------------------- proxy

const requests = []

function startRecordingProxy() {
  const target = new URL(upstream)
  const listen = new URL(origin)
  // The program sends no forwarding header. Each run gives its requests an
  // address of their own, so a run after a run does not meet the upload
  // rate limit of the one before. The recorded request is not changed.
  const programAddress = `203.0.113.${randomInt(1, 251)}`
  const server = http.createServer((request, response) => {
    const chunks = []
    request.on('data', (chunk) => chunks.push(chunk))
    request.on('end', () => {
      const body = Buffer.concat(chunks)
      requests.push({
        method: request.method,
        // The request target exactly as the client wrote it on the wire.
        target: request.url,
        headers: JSON.stringify(request.rawHeaders),
        agent: request.headers['user-agent'] || '',
        body: body.toString('latin1'),
      })
      const forward = http.request(
        {
          host: target.hostname,
          port: target.port,
          method: request.method,
          path: request.url,
          headers: request.headers['x-forwarded-for']
            ? request.headers
            : { ...request.headers, 'x-forwarded-for': programAddress },
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

/** The requests that the program itself sent since `from`. */
const programRequests = (from) =>
  requests.slice(from).filter(({ agent }) => agent.startsWith('flare-upload/'))

// ---------------------------------------------------------------- browser

let address = 1

async function context(browser) {
  const ctx = await browser.newContext({
    baseURL: origin,
    viewport: mobile
      ? { width: 390, height: 844 }
      : { width: 1440, height: 900 },
    colorScheme: theme,
    reducedMotion: 'reduce',
    acceptDownloads: true,
    extraHTTPHeaders: { 'X-Forwarded-For': `198.51.100.${address++}` },
  })
  await ctx.addInitScript((theme) => {
    try {
      localStorage.setItem('theme', theme)
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
  page.on('pageerror', (error) => {
    pageProblems.push(`${page.url()}: page error: ${error.message}`)
  })
  page.on('console', (message) => {
    if (message.type() !== 'error') return
    const text = message.text()
    // A request that the server refused on purpose logs a resource error.
    if (/Failed to load resource/.test(text)) return
    pageProblems.push(`${page.url()}: console error: ${text}`)
  })
  return { ctx, page }
}

async function shot(page, name, locator) {
  if (!screenshots) return
  await mkdir(screenshots, { recursive: true })
  await page.waitForTimeout(300)
  const file = path.join(
    screenshots,
    `${name}-${mobile ? 'mobile' : 'desktop'}-${theme}.png`
  )
  if (locator) {
    await locator.scrollIntoViewIfNeeded()
    await page.waitForTimeout(150)
  }
  await page.screenshot({
    path: file,
    fullPage: mobile && !(await page.getByRole('dialog').count()),
  })
}

/**
 * With FLARE_E2EE_HANDBOOK set to a directory, saves a picture of one
 * element for the handbook (docs/images), in the desktop dark run only.
 * Notifications and the fixed navigation are hidden so that neither covers
 * the element.
 */
const handbookDirectory =
  !mobile && theme === 'dark' ? process.env.FLARE_E2EE_HANDBOOK : undefined
async function handbook(page, locator, name) {
  if (!handbookDirectory) return
  const file = path.join(handbookDirectory, name)
  await mkdir(path.dirname(file), { recursive: true })
  const style = await page.addStyleTag({
    // The fixed navigation would lie over an element taller than the window.
    content:
      'div[role="region"][aria-label^="Notifications"], body > div header.fixed { display: none !important; }',
  })
  await locator.scrollIntoViewIfNeeded()
  await page.waitForTimeout(300)
  await locator.screenshot({ path: file })
  await style.evaluate((element) => element.remove())
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

async function expectShareState(page, state) {
  await expect(page.locator('[data-encrypted-share]')).toHaveAttribute(
    'data-encrypted-share',
    state,
    { timeout: 60000 }
  )
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
  config.value.settings.general.encryption = { forbidPlainUploads: false }
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
  for (const [key, { id, name, urlId }] of Object.entries(accounts)) {
    const record = await shared.createAccountRecord(PASSPHRASE)
    keys[key] = shared.keysOfMnemonic(record.mnemonic)
    await prisma.user.create({
      data: {
        id,
        name,
        email: `${id}@example.test`,
        ...record.columns,
        roles: { connect: { systemKey: 'administrator' } },
        urlId,
        // Alex had screenshot tools before the upgrade. The migration left
        // the SHA-256 of the old upload token (section 14.4).
        ...(key === 'alex' && {
          uploadTokenHash: createHash('sha256')
            .update(LEGACY_TOKEN)
            .digest('hex'),
        }),
      },
    })
  }
  for (const [kind, { name }] of Object.entries(profiles))
    profiles[kind].id = (
      await prisma.uploadProfile.create({
        data: {
          userId: accounts.alex.id,
          name,
          options: kind === 'plain' ? { encryption: 'plain' } : {},
        },
      })
    ).id
  return keys
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

// ---------------------------------------------------------------- program

let workDirectory
/** What the links of this run carried after `#`. */
const fragments = new Set()
/** The printed link of each fixture. */
const links = {}

async function writeFixture({ name, buffer }) {
  const file = path.join(workDirectory, name)
  await writeFile(file, buffer)
  return file
}

/**
 * Starts the program as a screenshot tool does. Not `spawnSync`: the proxy
 * of this script must answer while the program runs.
 */
function run(config, args, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, ['--config', config, ...args], {
      // Nothing of this process: no token, no home directory to read.
      env: { PATH: process.env.PATH, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => (stdout += chunk))
    child.stderr.on('data', (chunk) => (stderr += chunk))
    const timer = setTimeout(() => child.kill('SIGKILL'), 180000)
    child.on('error', reject)
    child.on('close', (status) => {
      clearTimeout(timer)
      resolve({ status, stdout, stderr })
    })
  })
}

function linkOf(result) {
  assert.equal(result.status, 0, `flare-upload failed: ${result.stderr}`)
  const lines = result.stdout.trimEnd().split('\n')
  assert.equal(lines.length, 1, `Expected one line, got: ${result.stdout}`)
  const [text] = lines
  const hash = text.indexOf('#')
  assert.ok(hash > 0, `The link has no key: ${text}`)
  fragments.add(text.slice(hash + 1))
  return text
}

async function editedConfig(source, name, change) {
  const config = JSON.parse(await readFile(source, 'utf8'))
  change(config)
  const file = path.join(workDirectory, name)
  await writeFile(file, JSON.stringify(config))
  await chmod(file, 0o600)
  return file
}

// ---------------------------------------------------------------- scenarios

const TOOLS = '/dashboard/profile?section=uploads'

async function openTools(page) {
  await page.goto(origin + TOOLS)
  const card = page.locator('#upload-tools')
  await expect(card.locator('[data-upload-tools]')).toBeVisible()
  return card
}

/** Makes a configuration in the card and saves the flare-upload file. */
async function createConfiguration(page, kind, { download: save = true } = {}) {
  const card = await openTools(page)
  const again = card.getByRole('button', { name: 'Create another' })
  if (await again.count()) await again.click()
  await card.locator('#tool-profile').click()
  await page.getByRole('option', { name: profiles[kind].name }).click()
  await expect(
    card.locator('[data-configuration-encryption]').first()
  ).toHaveAttribute('data-configuration-encryption', kind)
  await card.getByRole('button', { name: 'Create configuration' }).click()
  await expect(card.locator('[data-upload-configuration]')).toBeVisible()
  await expect(card.locator('[data-upload-tools]')).toHaveAttribute(
    'data-upload-tools',
    'ready'
  )
  if (!save) return { card, file: null }
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    card.getByRole('button', { name: 'Download configuration' }).click(),
  ])
  assert.equal(download.suggestedFilename(), profiles[kind].file)
  const file = path.join(workDirectory, profiles[kind].file)
  await download.saveAs(file)
  await chmod(file, 0o600)
  return { card, file }
}

async function testConfigurations(alex, keys) {
  const { page } = alex
  let card = await openTools(page)

  // Before a configuration: the warning, and no download that works.
  const warning = card.locator('[data-legacy-token-warning]')
  await expect(warning).toContainText(
    'Configurations from before encryption upload plain files'
  )
  await expect(warning).toContainText('Your old upload token still works.')
  await expect(warning).toContainText('Create a configuration below')
  await expect(
    card.getByRole('button', { name: 'Download configuration' })
  ).toBeDisabled()
  await shot(page, 'tools-before-configuration', card)
  await handbook(page, card, 'preferences/profile-upload-tools-upgrade.png')

  // No request and no page shows the old token: Flare has only its hash.
  assert.equal(
    (await alex.ctx.request.get(`${origin}/api/profile/upload-token`)).status(),
    404
  )
  const tools = await api(alex.ctx, '/api/profile/upload-tools')
  assert.deepEqual(Object.keys(tools).sort(), ['legacyToken', 'origin'])
  assert.equal(tools.origin, origin)
  assert.ok(!(await page.content()).includes(LEGACY_TOKEN))

  // An encrypted profile.
  const encrypted = await createConfiguration(page, 'encrypted')
  card = encrypted.card
  const config = JSON.parse(await readFile(encrypted.file, 'utf8'))
  assert.deepEqual(Object.keys(config).sort(), [
    'account_public_key',
    'encryption',
    'format',
    'origin',
    'profile_id',
    'protocol_version',
    'token',
    'version',
  ])
  assert.equal(config.origin, origin)
  assert.equal(config.encryption, 'encrypted')
  assert.equal(config.protocol_version, 1)
  assert.equal(config.profile_id, profiles.encrypted.id)
  assert.match(config.token, /^flr_[A-Za-z0-9_-]{43}$/)
  // The key of the configuration is the key of the unlocked browser.
  assert.equal(
    Buffer.from(config.account_public_key, 'base64url').toString('hex'),
    keys.alex.accountPublicKey
  )
  // The token is stored as a hash, bound to the profile, and marked new.
  const stored = await prisma.apiToken.findUniqueOrThrow({
    where: { hash: createHash('sha256').update(config.token).digest('hex') },
  })
  assert.equal(stored.profileId, profiles.encrypted.id)
  assert.deepEqual(stored.scopes, ['files:upload'])
  assert.equal(stored.predatesEncryption, false)
  assert.ok(!(await page.content()).includes(config.token))

  // What an encrypted profile offers: no format that cannot encrypt.
  await expect(
    card.getByRole('button', { name: 'Set up ShareX' })
  ).toBeEnabled()
  await expect(
    card.getByRole('button', { name: 'Set up iTake' })
  ).toBeDisabled()
  await expect(card).toContainText(
    'an iTake uploader file describes one web request and cannot encrypt'
  )
  await expect(card).toContainText(
    'A ShareX uploader file describes one web request and cannot encrypt'
  )
  await expect(
    card.getByRole('button', { name: 'Download config', exact: true })
  ).toHaveCount(0)
  await shot(page, 'tools-encrypted-configuration', card)
  await card.getByRole('button', { name: 'Set up ShareX' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText('--use work-captures --copy "$input"')
  await expect(dialog).toContainText(
    '%APPDATA%\\flare-upload\\work-captures.json'
  )
  await shot(page, 'tools-sharex-steps')
  await handbook(page, dialog, 'preferences/profile-sharex-flare-upload.png')
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  // The Flameshot script of an encrypted profile starts the program.
  await card
    .locator('[data-tool="Flameshot"]')
    .getByRole('button', { name: 'Download script' })
    .click()
  const [flameshot] = await Promise.all([
    page.waitForEvent('download'),
    page
      .getByRole('dialog')
      .getByRole('button', { name: 'Download script' })
      .click(),
  ])
  const script = await readFile(await flameshot.path(), 'utf8')
  assert.match(script, /flare-upload --config "\$FLARE_UPLOAD_CONFIG"/)
  assert.ok(!script.includes(config.token), 'A helper script holds the token')
  assert.ok(!script.includes('curl'))

  // A plain profile: the declarative configurations, as before.
  const plain = await createConfiguration(page, 'plain')
  card = plain.card
  const plainConfig = JSON.parse(await readFile(plain.file, 'utf8'))
  assert.equal(plainConfig.encryption, 'plain')
  assert.ok(!('account_public_key' in plainConfig))
  await expect(card.getByRole('button', { name: 'Set up iTake' })).toBeEnabled()
  const [sxcu] = await Promise.all([
    page.waitForEvent('download'),
    card.getByRole('button', { name: 'Download config', exact: true }).click(),
  ])
  const sharex = JSON.parse(await readFile(await sxcu.path(), 'utf8'))
  assert.equal(
    sharex.RequestURL,
    `${origin}/api/files?profileId=${profiles.plain.id}`
  )
  assert.equal(sharex.Headers.Authorization, `Bearer ${plainConfig.token}`)
  await shot(page, 'tools-plain-configuration', card)

  // With a new configuration, the warning asks for the revocation.
  card = await openTools(page)
  await expect(card.locator('[data-legacy-token-warning]')).toContainText(
    'Once every tool uses a new configuration, revoke the old token.'
  )
  // Where tokens are managed, one line points to the card.
  await page.goto(`${origin}/dashboard/profile?section=integrations`)
  const note = page.locator('[data-legacy-token-note]')
  await expect(note).toContainText(
    'Your upload token from before encryption still works'
  )
  await expect(page.getByText('Upload tools: Work captures')).toBeVisible()
  await shot(page, 'integrations-legacy-note', note)
  results.push(
    'The Upload tools card warns about the old upload token and shows it nowhere; a configuration gets a new token bound to its profile, stored as a hash, and pins the account public key of the unlocked browser; an encrypted profile offers flare-upload, the ShareX action and helper scripts and no format that cannot encrypt; a plain profile offers the declarative files'
  )
  return { encrypted: encrypted.file, plain: plain.file, config, plainConfig }
}

async function testEncryptedUploads(configs) {
  // A small file: one request.
  let from = requests.length
  links.image = linkOf(
    await run(configs.encrypted, [await writeFixture(fixtures.image)])
  )
  assert.match(
    links.image,
    new RegExp(
      `^${origin}/${accounts.alex.urlId}/e_[A-Za-z0-9_-]{22}#[A-Za-z0-9_-]{43}$`
    )
  )
  let sent = programRequests(from)
  assert.deepEqual(
    sent.map(({ method, target }) => `${method} ${target}`),
    ['GET /api/settings', 'POST /api/files']
  )
  // The version check carries no token.
  assert.ok(!/authorization/i.test(sent[0].headers))
  assert.match(sent[1].headers, /"X-Flare-Encrypted","true"/i)
  assert.ok(sent[1].body.includes('name="rulesApplied"\r\n\r\nfalse'))
  assert.ok(sent[1].body.includes('name="isImage"\r\n\r\ntrue'))
  assert.ok(sent[1].body.includes('filename="encrypted"'))

  // A large file: the chunked route, in parts.
  from = requests.length
  links.large = linkOf(
    await run(configs.encrypted, [await writeFixture(fixtures.large)])
  )
  sent = programRequests(from).map(({ method, target }) =>
    `${method} ${target}`.replace(/chunks\/[a-z0-9]+\//, 'chunks/{id}/')
  )
  assert.deepEqual(sent, [
    'GET /api/settings',
    'POST /api/files/chunks',
    'PUT /api/files/chunks/{id}/part/1',
    'PUT /api/files/chunks/{id}/part/2',
    'POST /api/files/chunks/{id}/complete',
  ])

  // A password: the link carries a link secret, not the file key.
  links.protected = linkOf(
    await run(
      configs.encrypted,
      ['--password', await writeFixture(fixtures.protected)],
      { FLARE_UPLOAD_PASSWORD: FILE_PASSWORD }
    )
  )
  assert.match(links.protected, /#p\.[A-Za-z0-9_-]{43}$/)

  // Two files and JSON output.
  const json = await run(configs.encrypted, [
    '--json',
    await writeFixture(fixtures.extra),
  ])
  assert.equal(json.status, 0, json.stderr)
  const output = JSON.parse(json.stdout)
  assert.equal(output.ok, true)
  assert.equal(output.uploads[0].encrypted, true)
  assert.deepEqual(output.uploads[0].deferred, [
    'tag_rules',
    'text_recognition',
    'thumbnail',
  ])
  links.extra = output.uploads[0].url
  fragments.add(links.extra.slice(links.extra.indexOf('#') + 1))

  // What the server stored: ciphertext, and no name or type.
  const rows = await prisma.file.findMany({
    where: { userId: accounts.alex.id, encrypted: true },
    orderBy: { uploadedAt: 'asc' },
  })
  assert.equal(rows.length, 4)
  for (const row of rows) {
    assert.equal(row.name, '')
    assert.equal(row.mimeType, 'application/octet-stream')
    assert.equal(row.password, null)
    assert.equal(row.header.length, 26)
    assert.equal(row.accountStanza.length, 97)
    assert.ok(row.urlPath.startsWith(`/${accounts.alex.urlId}/e_`))
    assert.equal(row.uploadOptions.profileId, profiles.encrypted.id)
  }
  assert.equal(rows.filter((row) => row.passwordStanza).length, 1)
  results.push(
    'flare-upload encrypts and uploads a small file in one request and a 9 MiB file through the chunked route in two parts, with a password it prints a #p. link; the server stores ciphertext with no name and no type, bound to the profile of the token'
  )
}

async function testShareLinks(browser) {
  const visitor = await context(browser)
  const { page } = visitor

  // The image: the visitor's browser decrypts it and shows its name.
  await page.goto(links.image)
  await expectShareState(page, 'open')
  const image = page.getByRole('img', { name: fixtures.image.name })
  await expect(image).toBeVisible()
  await expect
    .poll(() => image.evaluate((element) => element.naturalWidth))
    .toBe(96)
  await expect(page.locator('[data-encrypted-title="open"]')).toHaveText(
    fixtures.image.name
  )
  await shot(page, 'share-image-from-flare-upload')

  // The large file: every byte, through the download of the share page.
  await page.goto(links.large)
  await expectShareState(page, 'open')
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 120000 }),
    page.getByRole('button', { name: 'Download', exact: true }).click(),
  ])
  assert.equal(download.suggestedFilename(), fixtures.large.name)
  assert.ok(
    (await readFile(await download.path())).equals(fixtures.large.buffer),
    'The large file did not decrypt to what was uploaded'
  )

  // The password link: the link alone does not open the file.
  await page.goto(links.protected)
  await expectShareState(page, 'password')
  await page.locator('#encrypted-share-password').fill(FILE_PASSWORD)
  await page.getByRole('button', { name: 'Open file' }).click()
  await expectShareState(page, 'open')
  await expect(page.getByText(fixtures.protected.marker)).toBeVisible()

  // Without the part after `#` there is nothing to open.
  await page.goto(links.image.slice(0, links.image.indexOf('#')))
  await expect(page.locator('[data-encrypted-share]')).not.toHaveAttribute(
    'data-encrypted-share',
    'open'
  )
  await visitor.ctx.close()
  results.push(
    'Each printed link opens signed out in headless Chromium: the image renders, the 9 MiB file downloads byte for byte, the password link asks for the password and then opens; a link without its fragment opens nothing'
  )
}

async function testOwnerLibrary(alex) {
  // The owner's browser opens the account stanza that the program made.
  const { page } = alex
  await page.goto(`${origin}/dashboard`)
  for (const key of ['image', 'protected', 'extra'])
    await expect(page.getByText(fixtures[key].name).first()).toBeVisible()
  results.push(
    'The library of the owner shows each file from flare-upload with its name: the account stanza opens with the account private key in the browser'
  )
}

async function testPlainProfile(configs) {
  const result = await run(configs.plain, [await writeFixture(fixtures.plain)])
  assert.equal(result.status, 0, result.stderr)
  const url = result.stdout.trim()
  assert.equal(url, `${origin}/${accounts.alex.urlId}/${fixtures.plain.name}`)
  const row = await prisma.file.findFirstOrThrow({
    where: { userId: accounts.alex.id, name: fixtures.plain.name },
  })
  assert.equal(row.encrypted, false)
  assert.equal(row.mimeType, 'text/plain')
  assert.equal(row.uploadOptions.profileId, profiles.plain.id)
  const raw = await fetch(`${origin}/api/files${row.urlPath}`)
  assert.equal(await raw.text(), fixtures.plain.buffer.toString())
  results.push(
    'With the configuration of a plain profile, flare-upload uploads as the older tools did and prints the address of a plain file that the server can serve'
  )
}

async function testMismatch(configs) {
  // A plain upload to the encrypted profile.
  const plainToEncrypted = await run(configs.encrypted, [
    '--mode',
    'plain',
    await writeFixture(fixtures.plain),
  ])
  assert.equal(plainToEncrypted.status, 5, plainToEncrypted.stderr)
  assert.equal(plainToEncrypted.stdout, '')
  assert.match(plainToEncrypted.stderr, /takes encrypted uploads/)

  // An encrypted upload to the plain profile: the encrypted configuration
  // with the token and the profile of the plain one.
  const crossed = await editedConfig(
    configs.encrypted,
    'crossed.json',
    (config) => {
      config.token = configs.plainConfig.token
      config.profile_id = configs.plainConfig.profile_id
    }
  )
  const encryptedToPlain = await run(crossed, [
    await writeFixture(fixtures.extra),
  ])
  assert.equal(encryptedToPlain.status, 5, encryptedToPlain.stderr)
  assert.equal(encryptedToPlain.stdout, '')
  assert.match(encryptedToPlain.stderr, /takes plain uploads/)

  // The same refusals with their codes, as any client reads them.
  const form = new FormData()
  form.set('file', new Blob(['plain']), 'refused.txt')
  const refused = await fetch(`${origin}/api/files`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${configs.config.token}` },
    body: form,
  })
  assert.equal(refused.status, 403)
  assert.equal((await refused.json()).code, 'profile_requires_encrypted')
  // A token cannot leave its profile for one that takes what it sends.
  const escape = await fetch(
    `${origin}/api/files?profileId=${profiles.plain.id}`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${configs.config.token}` },
      body: form,
    }
  )
  assert.equal(escape.status, 403)
  assert.equal(
    await prisma.file.count({ where: { name: 'refused.txt' } }),
    0,
    'A refused upload was stored'
  )
  results.push(
    'The server refuses a plain upload to the encrypted profile (profile_requires_encrypted) and an encrypted upload to the plain profile (profile_requires_plain); flare-upload exits with code 5 and prints no link'
  )
}

async function legacyUpload(name = fixtures.legacy.name) {
  const form = new FormData()
  form.set('file', new Blob([fixtures.legacy.buffer]), name)
  return fetch(`${origin}/api/files`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${LEGACY_TOKEN}` },
    body: form,
  })
}

async function testLegacyToken(alex, configs) {
  const { page } = alex
  // An old configuration still uploads, and the file is plain.
  const response = await legacyUpload()
  assert.equal(response.status, 200, await response.clone().text())
  const body = await response.json()
  assert.equal(body.data.name, fixtures.legacy.name)
  const row = await prisma.file.findFirstOrThrow({
    where: { userId: accounts.alex.id, name: fixtures.legacy.name },
  })
  assert.equal(row.encrypted, false)
  // It cannot send an encrypted upload: flare-upload with the old token.
  const old = await editedConfig(
    configs.encrypted,
    'old-token.json',
    (config) => {
      config.token = LEGACY_TOKEN
      delete config.profile_id
    }
  )
  const refused = await run(old, [await writeFixture(fixtures.extra)])
  assert.equal(refused.status, 5, refused.stderr)
  assert.match(refused.stderr, /from before encryption/)

  // The application says that an old configuration was used.
  let card = await openTools(page)
  const warning = card.locator('[data-legacy-token-warning]')
  await expect(warning).toContainText(
    'A tool last uploaded with your old upload token on'
  )
  await shot(page, 'tools-legacy-warning-used', warning)

  // The owner revokes it.
  await warning.getByRole('button', { name: 'Revoke old token' }).click()
  const dialog = page.getByRole('alertdialog')
  await expect(dialog).toContainText('Revoke your old upload token?')
  await shot(page, 'tools-legacy-revoke-dialog')
  await dialog.getByRole('button', { name: 'Revoke old token' }).click()
  await expect(card.locator('[data-legacy-token-warning]')).toHaveCount(0)
  assert.equal((await legacyUpload('after-revocation.txt')).status, 401)
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: accounts.alex.id },
  })
  assert.equal(user.uploadTokenHash, null)
  // A new configuration is not touched.
  card = await openTools(page)
  await expect(card.locator('[data-legacy-token-warning]')).toHaveCount(0)
  if (handbookDirectory) {
    // The card as an account without an old token sees it.
    // Not saved: the files of the run keep the token they were made with.
    const ready = await createConfiguration(page, 'encrypted', {
      download: false,
    })
    await handbook(page, ready.card, 'preferences/profile-upload-tools.png')
  }
  results.push(
    'A configuration from before encryption still uploads, as a plain file, and cannot send an encrypted upload (token_predates_encryption); the Upload tools card names the day of its last use; after the owner revokes the old token it answers 401 and the warning is gone'
  )
}

async function testForbidPlain(browser, alex, configs) {
  const { page } = alex
  // The administrator turns plain uploads off in the settings.
  await page.goto(`${origin}/dashboard/settings?section=access`)
  const encryptionCard = page.locator('#settings-encryption')
  await expect(encryptionCard).toContainText('Encryption has no off switch.')
  await shot(page, 'admin-encryption-setting', encryptionCard)
  await encryptionCard
    .getByRole('switch', { name: 'Forbid plain uploads' })
    .click()
  await shot(page, 'admin-encryption-setting-changed', encryptionCard)
  await handbook(page, encryptionCard, 'preferences/settings-encryption.png')
  await page.getByRole('button', { name: /^Save/ }).first().click()
  await expect
    .poll(async () => {
      const config = await prisma.config.findUnique({
        where: { key: 'flare_config' },
      })
      return config.value.settings.general.encryption?.forbidPlainUploads
    })
    .toBe(true)
  const announced = await (await fetch(`${origin}/api/settings`)).json()
  assert.deepEqual(announced.data.encryption, {
    protocolVersions: [1],
    forbidPlainUploads: true,
  })

  // Every plain path is refused: the plain profile, the old upload
  // token, and the application itself.
  const plain = await run(configs.plain, [await writeFixture(fixtures.plain)])
  assert.equal(plain.status, 5, plain.stderr)
  assert.match(plain.stderr, /accepts encrypted uploads only/)
  // A configuration from before encryption has no upload left.
  const old = await legacyUpload('forbidden-legacy.txt')
  assert.equal(old.status, 403)
  assert.equal((await old.json()).code, 'plain_uploads_forbidden')
  const session = await alex.ctx.request.post(`${origin}/api/files`, {
    headers: { Origin: origin },
    multipart: {
      file: {
        name: 'forbidden.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from('plain'),
      },
    },
  })
  assert.equal(session.status(), 403)
  assert.equal((await session.json()).code, 'plain_uploads_forbidden')
  assert.equal(
    await prisma.file.count({
      where: { name: { in: ['forbidden.txt', 'forbidden-legacy.txt'] } },
    }),
    0
  )
  // An encrypted upload goes on.
  const still = await run(configs.encrypted, [
    await writeFixture(fixtures.extra),
  ])
  assert.equal(still.status, 0, still.stderr)
  fragments.add(still.stdout.trim().split('#')[1])

  // The upload dialog shows no plain choice.
  await page.goto(`${origin}/dashboard/upload`)
  const choice = page.locator('[data-encryption-choice]')
  await expect(choice).toHaveAttribute('data-plain-forbidden', 'true')
  await expect(choice).toContainText(
    'This server accepts encrypted uploads only.'
  )
  await expect(page.getByRole('radio', { name: /Plain/ })).toHaveCount(0)
  await shot(page, 'upload-dialog-plain-forbidden')
  await handbook(
    page,
    // The panel of the form, with its padding.
    choice.locator('xpath=ancestor::div[contains(@class,"rounded")][1]'),
    'encryption/upload-encrypted-only.png'
  )
  await page.goto(`${origin}/dashboard/paste`)
  await expect(page.locator('[data-plain-forbidden]')).toBeVisible()
  await expect(page.getByRole('radio', { name: /Plain/ })).toHaveCount(0)
  // The profile editor says so, and the tools card too.
  await page.goto(origin + TOOLS)
  await page
    .getByRole('button', { name: new RegExp(profiles.plain.name) })
    .first()
    .click()
  await expect(page.locator('[data-profile-encryption-help]')).toContainText(
    'Plain uploads are turned off on this server.'
  )
  await shot(
    page,
    'profile-editor-plain-forbidden',
    page.locator('#profile-encryption')
  )

  // Off again: the plain choice comes back.
  await api(alex.ctx, '/api/settings', 'PATCH', {
    settings: { general: { encryption: { forbidPlainUploads: false } } },
  })
  await page.goto(`${origin}/dashboard/upload`)
  await expect(page.getByRole('radio', { name: /Plain/ })).toHaveCount(1)
  const allowed = await run(configs.plain, [
    '--name',
    'allowed-again.txt',
    await writeFixture(fixtures.plain),
  ])
  assert.equal(allowed.status, 0, allowed.stderr)
  void browser
  results.push(
    'With "Forbid plain uploads" on, the public settings say so, the plain profile, the old upload token and a plain upload of the application are refused (plain_uploads_forbidden) and store nothing, encrypted uploads go on, and the upload and paste dialogs show no plain choice; with it off the choice is back'
  )
}

async function testDialogFollowsProfile(alex) {
  const { page } = alex
  await page.goto(`${origin}/dashboard/upload`)
  const choice = page.locator('[data-encryption-choice]')
  await expect(choice).toHaveAttribute('data-encryption-choice', 'encrypted')
  await page.locator('#upload-profile').click()
  await page.getByRole('option', { name: profiles.plain.name }).click()
  await expect(choice).toHaveAttribute('data-encryption-choice', 'plain')
  await shot(page, 'upload-dialog-plain-profile')
  // The choice of the person wins over the profile.
  await page.getByRole('radio', { name: /Encrypted/ }).click()
  await expect(choice).toHaveAttribute('data-encryption-choice', 'encrypted')
  await page.locator('#upload-profile').click()
  await page.getByRole('option', { name: profiles.encrypted.name }).click()
  await expect(choice).toHaveAttribute('data-encryption-choice', 'encrypted')
  results.push(
    'The upload dialog shows first what the selected profile says (Plain for a plain profile) and keeps the choice a person makes there'
  )
}

async function testProfileEditor(alex) {
  const { page } = alex
  await page.goto(origin + TOOLS)
  await page
    .getByRole('button', { name: new RegExp(profiles.encrypted.name) })
    .first()
    .click()
  const help = page.locator('[data-profile-encryption-help]')
  await expect(help).toContainText(
    'must encrypt, with the flare-upload program'
  )
  await shot(
    page,
    'profile-editor-encrypted',
    page.locator('#profile-encryption')
  )
  await handbook(
    page,
    page
      .locator('#profile-encryption')
      .locator('xpath=ancestor::div[contains(@class,"rounded")][1]'),
    'customization/upload-profile-encryption.png'
  )
  await page.locator('#profile-encryption').click()
  await shot(page, 'profile-editor-encryption-options')
  // A full-page picture on a phone can close the list.
  const plainOption = page.getByRole('option', { name: /^Plain/ })
  if (!(await plainOption.isVisible()))
    await page.locator('#profile-encryption').click()
  await plainOption.click()
  await expect(help).toContainText('send files as they are')
  await shot(page, 'profile-editor-plain', page.locator('#profile-encryption'))
  // Not saved: the profile stays encrypted for the uploads of this run.
  await page.reload()
  const saved = await prisma.uploadProfile.findUniqueOrThrow({
    where: { id: profiles.encrypted.id },
  })
  assert.deepEqual(saved.options, {})
  // The API saves the setting and refuses any other value.
  const created = await api(
    alex.ctx,
    '/api/upload-profiles',
    'POST',
    { name: 'Previews', options: { encryption: 'plain' } },
    201
  )
  assert.equal(created.data.options.encryption, 'plain')
  await api(
    alex.ctx,
    '/api/upload-profiles',
    'POST',
    { name: 'Wrong', options: { encryption: 'none' } },
    400
  )
  await prisma.uploadProfile.delete({ where: { id: created.data.id } })
  results.push(
    'The profile editor has the Encryption setting with a line that says what each value means for tools and for link previews; the API saves "plain" and refuses any other value'
  )
}

async function testRotatedKey(configs, keys) {
  // After a rotation the account has a new key (section 8.3.6). A tool
  // whose configuration pins a different key is refused: here the key of a
  // different account stands for the key from before the rotation.
  const stale = await editedConfig(
    configs.encrypted,
    'stale-key.json',
    (config) => {
      config.account_public_key = Buffer.from(
        keys.morgan.accountPublicKey,
        'hex'
      ).toString('base64url')
    }
  )
  const before = await prisma.file.count({
    where: { userId: accounts.alex.id },
  })
  const small = await run(stale, [await writeFixture(fixtures.extra)])
  assert.equal(small.status, 3, small.stderr)
  assert.equal(small.stdout, '')
  assert.equal(small.stderr.trim().split('\n').length, 1)
  assert.match(small.stderr, /no longer the key of the account/)
  assert.match(small.stderr, /Download a new configuration/)
  // A large file learns it at the start, before it sends a part.
  const from = requests.length
  const large = await run(stale, [await writeFixture(fixtures.large)])
  assert.equal(large.status, 3, large.stderr)
  assert.deepEqual(
    programRequests(from).map(({ method, target }) => `${method} ${target}`),
    ['GET /api/settings', 'POST /api/files/chunks']
  )
  assert.equal(
    await prisma.file.count({ where: { userId: accounts.alex.id } }),
    before,
    'An upload for a different account key was stored'
  )
  // The rotation also cancels the token: the same message.
  await prisma.apiToken.updateMany({
    where: {
      hash: createHash('sha256').update(configs.config.token).digest('hex'),
    },
    data: { revokedAt: new Date() },
  })
  const revoked = await run(configs.encrypted, [
    await writeFixture(fixtures.extra),
  ])
  assert.equal(revoked.status, 3, revoked.stderr)
  assert.match(revoked.stderr, /Download a new configuration/)
  results.push(
    'An upload whose account stanza is for a key that is not the current account key is refused with account_key_not_current, at the start of a chunked upload before any part is sent; flare-upload exits with code 3 and one line that says to download a new configuration, also for a cancelled token'
  )
}

async function testRefusedLocally(configs) {
  // The program refuses these before it sends anything.
  const from = requests.length
  const version = await editedConfig(configs.encrypted, 'v2.json', (config) => {
    config.protocol_version = 2
  })
  const unknown = await run(version, [await writeFixture(fixtures.extra)])
  assert.equal(unknown.status, 4)
  assert.match(unknown.stderr, /Update flare-upload/)
  const remote = await editedConfig(
    configs.encrypted,
    'http.json',
    (config) => {
      config.origin = 'http://flare.example'
    }
  )
  assert.equal(
    (await run(remote, [await writeFixture(fixtures.extra)])).status,
    2
  )
  const argument = await run(configs.encrypted, [
    '--token',
    'flr_never',
    await writeFixture(fixtures.extra),
  ])
  assert.equal(argument.status, 2)
  assert.equal(programRequests(from).length, 0)
  const selfTest = await new Promise((resolve, reject) => {
    const child = spawn(binary, ['--self-test'])
    let stdout = ''
    child.stdout.on('data', (chunk) => (stdout += chunk))
    child.on('error', reject)
    child.on('close', (status) => resolve({ status, stdout }))
  })
  assert.equal(selfTest.status, 0)
  assert.match(selfTest.stdout, /self-test passed/)
  results.push(
    'flare-upload refuses a configuration for a protocol version it does not know (exit 4), an http:// origin that is not this machine and a token in an argument (exit 2) without sending a request; its self-test passes'
  )
}

// ---------------------------------------------------------------- leak check

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
    utf8.toString('base64'),
    utf8.toString('base64url'),
    utf8.toString('hex'),
  ]
}

function assertNothingSecretWasSent(keys) {
  const forbidden = []
  for (const key of secretFixtures) {
    const { name, marker: text, buffer } = fixtures[key]
    for (const form of textForms(name))
      forbidden.push([`the name of ${key}`, form])
    for (const form of textForms(name.replace(/\.[a-z]+$/, '')))
      forbidden.push([`the name of ${key} without its extension`, form])
    for (const form of textForms(text))
      forbidden.push([`the content of ${key}`, form])
    forbidden.push([
      `the bytes of ${key}`,
      buffer.subarray(buffer.length - 48).toString('latin1'),
    ])
  }
  for (const fragment of fragments) {
    forbidden.push(['a link fragment', fragment])
    const secret = Buffer.from(fragment.replace(/^p\./, ''), 'base64url')
    assert.equal(secret.length, 32)
    for (const form of byteForms(secret))
      forbidden.push(['a file key or link secret', form])
  }
  for (const form of textForms(FILE_PASSWORD))
    forbidden.push(['the file password', form])
  for (const form of byteForms(Buffer.from(keys.alex.accountPrivateKey, 'hex')))
    forbidden.push(['the account private key', form])
  assert.ok(fragments.size >= 5, 'The run printed too few links to check')
  for (const request of requests) {
    const sent = `${request.target}\n${request.headers}\n${request.body}`
    for (const [what, needle] of forbidden)
      assert.ok(
        !sent.includes(needle),
        `${request.method} ${request.target} carried ${what}`
      )
    // No request line has a part after `#`.
    assert.ok(!request.target.includes('#'), `${request.target} has a fragment`)
  }
  const uploads = requests.filter(({ agent }) =>
    agent.startsWith('flare-upload/')
  )
  assert.ok(uploads.length >= 20, 'Too few program requests were recorded')
  results.push(
    `Across ${requests.length} recorded requests (${uploads.length} from flare-upload), none carried the name or the content of an encrypted file, a file key, a link secret, the file password, the account private key, or the part of a link after #`
  )
}

// ---------------------------------------------------------------- main

async function main() {
  const proxy = await startRecordingProxy()
  const browser = await chromium.launch({ headless: true })
  workDirectory = await mkdtemp(path.join(os.tmpdir(), 'flare-script-upload-'))
  try {
    const keys = await seed()
    const alex = await context(browser)
    await shared.signIn(alex.page, expect, {
      origin,
      email: `${accounts.alex.id}@example.test`,
      secret: PASSPHRASE,
    })
    await useTheme(alex)
    const configs = await testConfigurations(alex, keys)
    await testEncryptedUploads(configs)
    await testShareLinks(browser)
    await testOwnerLibrary(alex)
    await testPlainProfile(configs)
    await testMismatch(configs)
    await testProfileEditor(alex)
    await testDialogFollowsProfile(alex)
    await testForbidPlain(browser, alex, configs)
    await testLegacyToken(alex, configs)
    await testRefusedLocally(configs)
    await testRotatedKey(configs, keys)
    assertNothingSecretWasSent(keys)
    assert.deepEqual(pageProblems, [], 'A page logged an error')
    for (const result of results) console.log(`PASS: ${result}`)
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
            .catch(() => {})
    }
    throw error
  } finally {
    await browser.close()
    await new Promise((resolve) => proxy.close(resolve))
    proxy.closeAllConnections?.()
    await prisma.$disconnect()
    await rm(workDirectory, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
