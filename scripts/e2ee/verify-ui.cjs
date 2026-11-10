/* eslint-disable @typescript-eslint/no-require-imports */
// Real browser checks of the account key flows (docs/e2ee-spec.md, sections
// 5, 6, 8.3 and 14.1) against a production build and an EMPTY disposable
// database: the run starts with first-run setup. Every request and upload
// is real. The two places that fake a server answer say so in their result,
// and so do the stand-ins for hardware and for an identity provider:
// Chromium's virtual authenticator, and the OIDC issuer of oidc-issuer.cjs.
//
// The run also proves what the browser never sends. It records every
// request of every page, derives each secret of each account again with
// independent code (Argon2id, BLAKE3, BIP39), and fails if a request URL,
// header or body holds a passphrase, a recovery phrase or any private key.
const assert = require('node:assert/strict')
const { mkdir } = require('node:fs/promises')
const net = require('node:net')
const path = require('node:path')
const {
  chromium,
  expect: baseExpect,
} = require('../../docs/site/node_modules/@playwright/test')
const { TOTP } = require('otpauth')
const { blake3 } = require('@noble/hashes/blake3.js')
const { sha512 } = require('@noble/hashes/sha2.js')
const { ed25519 } = require('@noble/curves/ed25519.js')
const { mnemonicToEntropy } = require('@scure/bip39')
const { wordlist } = require('@scure/bip39/wordlists/english.js')
const { argon2id } = require('hash-wasm')
const shared = require('../shared/passphrase-accounts.cjs')
const { startOidcIssuer } = require('./oidc-issuer.cjs')
const expect = baseExpect.configure({ timeout: 45000 })

const origin = process.env.FLARE_E2EE_TEST_ORIGIN || 'http://localhost:3091'
if (new URL(origin).hostname !== 'localhost')
  throw new Error('Use a disposable localhost instance, matching NEXTAUTH_URL.')
const screenshots = process.env.FLARE_E2EE_SCREENSHOTS
const mobile = process.env.FLARE_E2EE_VIEWPORT === 'mobile'
const theme = process.env.FLARE_E2EE_THEME === 'light' ? 'light' : 'dark'
// Handbook images hide the recovery phrase. Review captures show it: every
// phrase of this run belongs to a disposable account.
const conceal = process.env.FLARE_E2EE_CONCEAL === 'true'
const realStale = process.env.FLARE_E2EE_REAL_STALE === 'true'
const results = []
const timings = []

// Demonstration secrets. They are public and only for disposable fixtures.
const SECRETS = {
  admin: 'copper lantern walrus opera 58',
  adminNext: 'velvet harbor quartz ribbon 31',
  jamie: 'granite meadow violin comet 74',
  jamieRecovered: 'amber thistle voyage lagoon 26',
  jamieReset: 'crimson glacier pepper atlas 93',
  // A temporary password that passes the strength check, and one that fails it.
  legacyStrong: 'Maple-rocket-violet-harbor-17',
  legacyWeak: 'password123',
  legacyNew: 'orchid tundra beacon marble 42',
  staleLegacy: 'Cobalt-pioneer-saffron-dune-66',
  invited: 'walnut ember prairie signal 85',
  sso: 'juniper canyon velvet anchor 63',
}
const WEAK = 'sunshine2024'
const users = {
  admin: { name: 'Alex Admin', email: 'alex@flare-e2ee.test' },
  jamie: { name: 'Jamie', email: 'jamie@flare-e2ee.test' },
  legacyStrong: { name: 'Morgan', email: 'morgan@flare-e2ee.test' },
  legacyWeak: { name: 'Riley', email: 'riley@flare-e2ee.test' },
  stale: { name: 'Sam', email: 'sam@flare-e2ee.test' },
  invited: { name: 'Taylor', email: 'taylor@flare-e2ee.test' },
  sso: { name: 'Robin', email: 'robin@flare-e2ee.test' },
}

// ---------------------------------------------------------------- secrets

const hex = (bytes) => Buffer.from(bytes).toString('hex')
const fromBase64url = (text) => new Uint8Array(Buffer.from(text, 'base64url'))
const deriveKey = (context, material) =>
  blake3(material, { context: new Uint8Array(Buffer.from(context, 'ascii')) })

/** Each passphrase and recovery phrase a page showed or took, and each salt a request carried. */
const seen = { passphrases: new Set(), mnemonics: new Set(), salts: new Set() }
/** Every request of every page: `{ method, url, headers, body }`. */
const requests = []
/**
 * Passwords of accounts from before encryption. The password sign-in sends
 * such a password to the server, as it always did (section 14.1, step 1).
 * The value is the number of requests at the moment the password became a
 * passphrase: from then on no request may carry it. `Infinity` for a
 * password that never became one.
 */
const legacyPasswords = new Map()

function watch(ctx) {
  ctx.on('request', (request) => {
    const body = request.postDataBuffer()
    const text = body ? body.toString('latin1') : ''
    requests.push({
      method: request.method(),
      url: request.url(),
      headers: JSON.stringify(request.headers()),
      body: text,
    })
    for (const match of text.matchAll(
      /"passphraseSalt":"([A-Za-z0-9_-]{43})"/g
    ))
      seen.salts.add(match[1])
  })
  ctx.on('response', async (response) => {
    if (
      !/\/api\/auth\/e2ee\/(challenge|session-challenge)$/.test(response.url())
    )
      return
    const body = await response.json().catch(() => null)
    if (body?.passphraseSalt) seen.salts.add(body.passphraseSalt)
  })
}

/** Every text form in which a byte secret could travel. */
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

/** Every text form in which a typed secret could travel. */
function textForms(text) {
  const utf8 = Buffer.from(text.normalize('NFKC'), 'utf8')
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

/**
 * The secrets of every account of this run, derived again here: the
 * sections 5.1 and 4.4 of the specification, with other libraries than the
 * application bundle uses for Argon2id.
 */
async function forbiddenValues() {
  const forbidden = new Map()
  const add = (label, forms, source) => {
    for (const form of forms)
      if (form.length >= 8) forbidden.set(form, { label, source })
  }
  for (const passphrase of seen.passphrases)
    add('a passphrase', textForms(passphrase), passphrase)
  for (const mnemonic of seen.mnemonics) {
    add('a recovery phrase', textForms(mnemonic))
    const words = mnemonic.split(' ')
    // Any three neighbouring words of a phrase, in any of the same forms.
    for (let index = 0; index + 3 <= words.length; index++)
      add(
        'words of a recovery phrase',
        textForms(words.slice(index, index + 3).join(' '))
      )
    const rootEntropy = mnemonicToEntropy(mnemonic, wordlist)
    const accountPrivateKey = deriveKey(
      'flare e2ee v1 account seed',
      rootEntropy
    )
    const exchangePrivateKey = sha512(accountPrivateKey).slice(0, 32)
    exchangePrivateKey[0] &= 248
    exchangePrivateKey[31] &= 127
    exchangePrivateKey[31] |= 64
    add('root_entropy', byteForms(rootEntropy))
    add('account_private_key', byteForms(accountPrivateKey))
    add('exchange_private_key', byteForms(exchangePrivateKey))
    add(
      'keyring_key',
      byteForms(deriveKey('flare e2ee v1 keyring', accountPrivateKey))
    )
  }
  let derivations = 0
  for (const passphrase of seen.passphrases)
    for (const salt of seen.salts) {
      const passphraseRoot = await argon2id({
        password: Buffer.from(passphrase.normalize('NFKC'), 'utf8'),
        salt: fromBase64url(salt),
        iterations: 3,
        parallelism: 4,
        memorySize: 65536,
        hashLength: 32,
        outputType: 'binary',
      })
      derivations++
      add('passphrase_root', byteForms(passphraseRoot))
      add(
        'auth_private_key',
        byteForms(deriveKey('flare e2ee v1 auth', passphraseRoot))
      )
      add(
        'wrap_key',
        byteForms(deriveKey('flare e2ee v1 wrap', passphraseRoot))
      )
    }
  return { forbidden, derivations }
}

async function assertNothingSecretWasSent() {
  const { forbidden, derivations } = await forbiddenValues()
  const leaks = []
  let passwordSignIns = 0
  requests.forEach((request, index) => {
    for (const [part, text] of [
      ['URL', request.url],
      ['URL', decodeURIComponent(request.url)],
      ['headers', request.headers],
      ['body', request.body],
    ])
      for (const [value, { label, source }] of forbidden) {
        if (!text.includes(value)) continue
        // The one request that sends a secret by design: the password
        // sign-in of an account that has no keys yet. It may carry that
        // account's password, in its body, until the password becomes a
        // passphrase. Everything else in it is searched like any request.
        if (
          part === 'body' &&
          request.url.endsWith('/api/auth/callback/credentials') &&
          legacyPasswords.has(source) &&
          index < legacyPasswords.get(source)
        ) {
          passwordSignIns++
          continue
        }
        leaks.push(
          `${request.method} ${new URL(request.url).pathname} sent ${label} in its ${part}`
        )
      }
  })
  assert.deepEqual([...new Set(leaks)], [], 'A request carried a secret')
  // The search can fail: it finds the passwords that the legacy sign-ins sent.
  assert.ok(
    passwordSignIns >= 3,
    'The search did not find the legacy passwords'
  )
  const bodies = requests.filter((request) => request.body).length
  results.push(
    `No request carried a secret: ${requests.length} requests (${bodies} with a body) searched in URL, headers and body for ${forbidden.size} forms of ${seen.passphrases.size} passphrases, ${seen.mnemonics.size} recovery phrases and their root_entropy, account, exchange and keyring keys, and of passphrase_root, auth_private_key and wrap_key from ${derivations} Argon2id derivations (every passphrase with every salt that was seen). The same search found ${passwordSignIns} password forms in the legacy password sign-ins, the one request that sends a secret by design, and none of them after that password became a passphrase`
  )
}

// ---------------------------------------------------------------- browser

let address = 10
async function context(browser) {
  const ctx = await browser.newContext({
    viewport: mobile
      ? { width: 390, height: 844 }
      : { width: 1440, height: 900 },
    colorScheme: theme,
    reducedMotion: 'reduce',
    permissions: ['clipboard-read', 'clipboard-write'],
    // Registration and email requests are limited per client address. These
    // reserved documentation addresses separate fixture visitors on localhost.
    extraHTTPHeaders: { 'X-Forwarded-For': `198.51.100.${address++}` },
  })
  await ctx.addInitScript(
    ({ theme, conceal }) => {
      try {
        localStorage.setItem('theme', theme)
      } catch {}
      const install = () => {
        if (!document.documentElement) return false
        const style = document.createElement('style')
        style.textContent =
          'nextjs-portal { display: none !important; }' +
          (conceal
            ? '[data-recovery-word] { color: transparent !important; background: #8884 !important; border-radius: 4px; }'
            : '')
        document.documentElement.appendChild(style)
        return true
      }
      if (!install()) {
        const observer = new MutationObserver(() => {
          if (install()) observer.disconnect()
        })
        observer.observe(document, { childList: true, subtree: true })
      }
    },
    { theme, conceal }
  )
  watch(ctx)
  const page = await ctx.newPage()
  page.setDefaultTimeout(45000)
  page.on('pageerror', (error) => {
    throw new Error(`Page error: ${error.message}`)
  })
  return { ctx, page }
}

async function shot(page, name, locator) {
  if (!screenshots) return
  // A new instance is dark until an administrator changes its appearance,
  // so first-run setup has no light form to capture.
  if (theme === 'light' && name.startsWith('setup-')) return
  await mkdir(screenshots, { recursive: true })
  await page.waitForTimeout(250)
  const file = path.join(
    screenshots,
    `${name}-${mobile ? 'mobile' : 'desktop'}-${theme}.png`
  )
  if (locator) await locator.screenshot({ path: file })
  else
    await page.screenshot({
      path: file,
      // A dialog is fixed to the viewport: a full-page capture would show it
      // at the top of a long page.
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

/** What IndexedDB holds for this origin: the records of the key store. */
const storedKeys = shared.storedKeys

/** Nothing but the key store record may hold a secret: no web storage, no other database. */
async function assertBrowserStorage(page, label) {
  const storage = await page.evaluate(async () => ({
    local: JSON.stringify({ ...localStorage }),
    session: JSON.stringify({ ...sessionStorage }),
    databases: (await indexedDB.databases()).map((database) => database.name),
  }))
  for (const secret of [...seen.passphrases, ...seen.mnemonics])
    for (const form of textForms(secret)) {
      assert.ok(
        !storage.local.includes(form),
        `${label}: localStorage holds a secret`
      )
      assert.ok(
        !storage.session.includes(form),
        `${label}: sessionStorage holds a secret`
      )
    }
  for (const mnemonic of seen.mnemonics) {
    const rootEntropy = mnemonicToEntropy(mnemonic, wordlist)
    const privateKey = deriveKey('flare e2ee v1 account seed', rootEntropy)
    for (const form of [...byteForms(rootEntropy), ...byteForms(privateKey)]) {
      assert.ok(
        !storage.local.includes(form),
        `${label}: localStorage holds a key`
      )
      assert.ok(
        !storage.session.includes(form),
        `${label}: sessionStorage holds a key`
      )
    }
  }
  assert.deepEqual(
    storage.databases.filter((name) => name !== 'flare-e2ee'),
    [],
    `${label}: an unexpected IndexedDB database exists`
  )
}

const keysOf = shared.keysOfMnemonic

/** The browser holds exactly the keys that `mnemonic` gives, and the old keys of `oldMnemonics`. */
async function assertUnlocked(page, mnemonic, oldMnemonics = []) {
  await expect
    .poll(async () => (await storedKeys(page)).length, { timeout: 20000 })
    .toBe(1)
  const [record] = await storedKeys(page)
  // The record has these four fields and no other: no passphrase, no
  // passphrase_root, no wrap_key, no root_entropy.
  assert.deepEqual(record.fields, [
    'accountPrivateKey',
    'accountPublicKey',
    'oldPrivateKeys',
    'userId',
  ])
  const expected = keysOf(mnemonic)
  assert.equal(record.accountPrivateKey, expected.accountPrivateKey)
  assert.equal(record.accountPublicKey, expected.accountPublicKey)
  assert.deepEqual(
    record.oldPrivateKeys,
    oldMnemonics.map((old) => keysOf(old).accountPrivateKey)
  )
  await expect(page.locator('[data-unlock-banner]')).toHaveCount(0)
  return record
}

async function assertNoStoredKeys(page) {
  await expect
    .poll(async () => (await storedKeys(page)).length, { timeout: 20000 })
    .toBe(0)
}

/** Fills the passphrase and its confirmation, and waits for the strength estimate. */
async function choosePassphrase(page, passphrase, prefix) {
  seen.passphrases.add(passphrase)
  await page.locator(`#${prefix}-passphrase`).fill(passphrase)
  await page.locator(`#${prefix}-confirmation`).fill(passphrase)
  await expect(page.locator(`#${prefix}-strength`)).toHaveAttribute(
    'data-strength-score',
    /\d/
  )
}

/**
 * Reads the recovery phrase that the page shows, checks its form, saves it
 * the way a person must (the acknowledgement, then three words typed back),
 * and returns it.
 */
function saveRecoveryPhrase(page, name, { wrongFirst = false } = {}) {
  return shared.saveRecoveryPhrase(page, expect, {
    wrongFirst,
    onPhrase: (mnemonic) => seen.mnemonics.add(mnemonic),
    capture: async (state) => {
      if (name) await shot(page, `${name}-${state}`)
    },
  })
}

/** Waits for the request that follows key derivation and records how long the page took to send it. */
async function timed(page, label, startPattern, endPattern, action) {
  const marks = {}
  const onFinished = (request) => {
    if (
      startPattern &&
      startPattern.test(request.url()) &&
      marks.start === undefined
    )
      marks.start = Date.now()
  }
  const onRequest = (request) => {
    if (endPattern.test(request.url()) && marks.end === undefined)
      marks.end = Date.now()
  }
  page.on('requestfinished', onFinished)
  page.on('request', onRequest)
  const clicked = Date.now()
  await action()
  await expect
    .poll(() => marks.end !== undefined, { timeout: 60000 })
    .toBe(true)
  page.off('requestfinished', onFinished)
  page.off('request', onRequest)
  timings.push({ label, ms: marks.end - (marks.start ?? clicked) })
}

async function openLogin(page) {
  await page.goto(`${origin}/auth/login`)
  await expect(
    page.getByRole('heading', { name: 'Welcome back' })
  ).toBeVisible()
}

/** The first step of sign-in: the address, then the form of that account's secret. */
async function enterIdentifier(page, email, secretLabel = 'Passphrase') {
  await page.getByLabel('Email address').fill(email)
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await expect(page.getByLabel(secretLabel, { exact: true })).toBeVisible()
}

async function signIn(
  page,
  email,
  passphrase,
  { expectDashboard = true } = {}
) {
  seen.passphrases.add(passphrase)
  await openLogin(page)
  await enterIdentifier(page, email)
  await page.getByLabel('Passphrase', { exact: true }).fill(passphrase)
  await timed(
    page,
    'sign-in',
    /\/api\/auth\/e2ee\/challenge$/,
    /\/api\/auth\/callback\/passphrase$/,
    () => page.getByRole('button', { name: 'Sign in', exact: true }).click()
  )
  if (expectDashboard) await page.waitForURL(/\/dashboard/)
}

async function signOut(page) {
  if (!new URL(page.url()).pathname.startsWith('/dashboard'))
    await page.goto(`${origin}/dashboard`)
  await page.getByRole('button', { name: 'Account menu' }).click()
  await page.getByRole('menuitem', { name: 'Sign out' }).click()
  await page.waitForURL(/\/auth\/login/)
  await assertNoStoredKeys(page)
}

function totp(secret) {
  return new TOTP({ secret, digits: 6, period: 30, algorithm: 'SHA1' })
}
let lastCounter = -1
/** A code of a time step that no earlier call used: the server refuses a step twice. */
async function freshCode(secret) {
  for (;;) {
    const counter = Math.floor(Date.now() / 30000)
    const left = 30000 - (Date.now() % 30000)
    if (counter > lastCounter && left > 4000) {
      lastCounter = counter
      return totp(secret).generate()
    }
    console.log('Waiting for a fresh authenticator time step…')
    await new Promise((resolve) =>
      setTimeout(resolve, Math.min(left + 300, 5000))
    )
  }
}

// ---------------------------------------------------------------- mail

/** A local SMTP sink. It accepts every message and keeps the text of each. */
function startMailSink() {
  const messages = []
  const server = net.createServer((socket) => {
    let buffer = ''
    let data = null
    socket.write('220 localhost ESMTP\r\n')
    socket.on('error', () => {})
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8')
      for (;;) {
        if (data !== null) {
          const end = buffer.indexOf('\r\n.\r\n')
          if (end === -1) return
          messages.push(data + buffer.slice(0, end))
          buffer = buffer.slice(end + 5)
          data = null
          socket.write('250 OK\r\n')
          continue
        }
        const line = buffer.indexOf('\r\n')
        if (line === -1) return
        const command = buffer.slice(0, line).toUpperCase()
        buffer = buffer.slice(line + 2)
        if (command.startsWith('EHLO') || command.startsWith('HELO'))
          socket.write('250-localhost\r\n250 8BITMIME\r\n')
        else if (command.startsWith('DATA')) {
          data = ''
          socket.write('354 End data with <CR><LF>.<CR><LF>\r\n')
        } else if (command.startsWith('QUIT')) {
          socket.write('221 Bye\r\n')
          socket.end()
        } else socket.write('250 OK\r\n')
      }
    })
  })
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () =>
      resolve({
        port: server.address().port,
        close: () => server.close(),
        /** The newest link to `route` in a message for `recipient` that arrived after `since` messages. */
        async link(recipient, route, since) {
          let found
          await expect
            .poll(
              () => {
                for (const raw of messages.slice(since)) {
                  const text = raw
                    .replace(/=\r\n/g, '')
                    .replace(/=([0-9A-F]{2})/g, (_, code) =>
                      String.fromCharCode(parseInt(code, 16))
                    )
                  if (!text.includes(recipient)) continue
                  const match = text.match(
                    new RegExp(
                      `http://localhost:\\d+${route}\\?token=[A-Za-z0-9_-]+`
                    )
                  )
                  if (match) found = match[0]
                }
                return found
              },
              { timeout: 90000, intervals: [1000] }
            )
            .toBeTruthy()
          return found
        },
        count: () => messages.length,
      })
    )
  )
}

// ---------------------------------------------------------------- scenarios

const phrases = {}

async function testSetup(browser) {
  const { ctx, page } = await context(browser)
  await page.goto(`${origin}/setup`)
  await expect(
    page.getByRole('heading', { name: 'Your space starts with you.' })
  ).toBeVisible()
  await page.getByLabel('Username').fill(users.admin.name)
  await page.getByLabel('Email address').fill(users.admin.email)
  await shot(page, 'setup-account-empty')

  // A weak passphrase stops the step, with the reason next to the field.
  await choosePassphrase(page, WEAK, 'setup-admin')
  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(
    page.getByText('This passphrase is too easy to guess.')
  ).toBeVisible()
  await shot(page, 'setup-account-weak')
  seen.passphrases.delete(WEAK)

  // The address of the account is no passphrase either.
  await page.locator('#setup-admin-passphrase').fill('alex@flare-e2ee.test')
  await expect(page.locator('#setup-admin-strength')).toHaveAttribute(
    'data-strength-score',
    /[012]/
  )

  await choosePassphrase(page, SECRETS.admin, 'setup-admin')
  await shot(page, 'setup-account-strong')
  await page.locator('#setup-admin-confirmation').fill(SECRETS.admin + 'x')
  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(
    page.getByText('The two passphrases do not match.')
  ).toBeVisible()
  await page.locator('#setup-admin-confirmation').fill(SECRETS.admin)
  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(
    page.getByRole('heading', { name: 'Give your files a home.' })
  ).toBeVisible()
  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(
    page.getByRole('heading', { name: 'Just you, or your people.' })
  ).toBeVisible()
  const create = page.getByRole('button', { name: 'Create my instance' })
  const deriving = expect(
    page.getByRole('button', { name: 'Deriving your keys…' })
  ).toBeVisible()
  await timed(page, 'first-run setup', null, /\/api\/setup$/, () =>
    create.click()
  )
  await deriving
  await expect(
    page.getByRole('heading', { name: 'Save your recovery phrase.' })
  ).toBeVisible()
  phrases.admin = await saveRecoveryPhrase(page, 'setup', { wrongFirst: true })
  await expect(
    page.getByRole('heading', { name: 'A little more you.' })
  ).toBeVisible()
  // The setup request carried the account record and nothing else of the account.
  const setup = requests.find((request) => request.url.endsWith('/api/setup'))
  const sent = JSON.parse(setup.body)
  assert.deepEqual(Object.keys(sent.admin).sort(), ['account', 'email', 'name'])
  assert.deepEqual(Object.keys(sent.admin.account).sort(), [
    'accountPublicKey',
    'authPublicKey',
    'passphraseSalt',
    'protocolVersion',
    'wrappedRoot',
  ])
  assert.equal(
    hex(fromBase64url(sent.admin.account.accountPublicKey)),
    keysOf(phrases.admin).accountPublicKey,
    'The recovery phrase gives the account public key that was sent'
  )
  await page.goto(`${origin}/dashboard`)
  await expect(page.getByRole('button', { name: 'Account menu' })).toBeVisible()
  await assertUnlocked(page, phrases.admin)
  await assertBrowserStorage(page, 'after setup')
  results.push(
    'First-run setup refuses a weak passphrase and a mismatch, makes the account record in the browser, signs the administrator in with the keys in memory, shows 24 valid words, refuses three wrong words, and stores exactly the account key that those words give'
  )
  return { ctx, page }
}

/** The instance appearance decides the theme of every page. Light captures publish a light default. */
async function useLightTheme(admin) {
  const { data } = await api(admin.ctx, '/api/customization')
  const document = structuredClone(data.draft ?? data.published)
  document.theme = { ...document.theme, enabled: true, defaultMode: 'light' }
  await api(admin.ctx, '/api/customization', 'POST', {
    action: 'publish',
    revision: data.revision,
    document,
  })
  await admin.page.reload()
}

async function testSignOutAndIn(admin) {
  const { page } = admin
  await signOut(page)
  results.push('Sign-out erases the key store before the session ends')

  // The identifier comes first. An unknown address gets the same form.
  await openLogin(page)
  await shot(page, 'sign-in-identifier')
  await enterIdentifier(page, 'nobody@flare-e2ee.test')
  await page.getByLabel('Passphrase', { exact: true }).fill(SECRETS.admin)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page.getByText('Invalid email or passphrase')).toBeVisible()

  await page.getByRole('button', { name: 'Change' }).click()
  await enterIdentifier(page, users.admin.email)
  await shot(page, 'sign-in-passphrase')
  seen.passphrases.add('not the right passphrase 9')
  await page
    .getByLabel('Passphrase', { exact: true })
    .fill('not the right passphrase 9')
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(
    page.getByRole('button', { name: 'Deriving your keys…' })
  ).toBeVisible()
  await shot(page, 'sign-in-deriving')
  await expect(page.getByText('Invalid email or passphrase')).toBeVisible()
  await shot(page, 'sign-in-wrong-passphrase')
  await assertNoStoredKeys(page)
  assert.equal((await api(admin.ctx, '/api/auth/session')).user, undefined)

  await signIn(page, ` ${users.admin.email.toUpperCase()} `, SECRETS.admin)
  await assertUnlocked(page, phrases.admin)
  await shot(page, 'dashboard-unlocked')
  results.push(
    'Sign-in asks for the address first, answers an unknown address and a wrong passphrase the same way, and with the right passphrase (address typed in upper case with spaces) creates the session and unlocks the keys'
  )
}

async function testRegister(browser) {
  const { ctx, page } = await context(browser)
  await page.goto(`${origin}/auth/register`)
  await page.getByLabel('Username').fill(users.jamie.name)
  await page.getByLabel('Email address').fill(users.jamie.email)
  await shot(page, 'register-empty')
  await choosePassphrase(page, WEAK, 'register')
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(
    page.getByText('This passphrase is too easy to guess.')
  ).toBeVisible()
  await shot(page, 'register-weak')
  seen.passphrases.delete(WEAK)
  await choosePassphrase(page, SECRETS.jamie, 'register')
  await shot(page, 'register-strong')
  await timed(page, 'registration', null, /\/api\/auth\/register$/, () =>
    page.getByRole('button', { name: 'Create account' }).click()
  )
  phrases.jamie = await saveRecoveryPhrase(page, 'register')
  await page.waitForURL(/\/dashboard/)
  await assertUnlocked(page, phrases.jamie)
  const body = JSON.parse(
    requests.find((request) => request.url.endsWith('/api/auth/register')).body
  )
  assert.deepEqual(Object.keys(body).sort(), ['account', 'email', 'name'])
  results.push(
    'Registration refuses a weak passphrase, sends only the name, the address and the account record, signs in without a second derivation, and shows the recovery phrase before the dashboard'
  )
  return { ctx, page }
}

async function testInvite(browser, admin) {
  const { invite } = await api(admin.ctx, '/api/invites', 'POST', {}, 201)
  const link = `${origin}/auth/register?invite=${invite.token}`
  const { ctx, page } = await context(browser)
  await page.goto(link)
  await expect(
    page.getByRole('heading', { name: 'You’re invited' })
  ).toBeVisible()
  await page.getByLabel('Username').fill(users.invited.name)
  await page.getByLabel('Email address').fill(users.invited.email)
  await choosePassphrase(page, SECRETS.invited, 'register')
  await shot(page, 'register-invite')
  await page.getByRole('button', { name: 'Create account' }).click()
  phrases.invited = await saveRecoveryPhrase(page)
  await page.waitForURL(/\/dashboard/)
  await assertUnlocked(page, phrases.invited)
  const body = JSON.parse(
    requests
      .filter((request) => request.url.endsWith('/api/auth/register'))
      .pop().body
  )
  assert.deepEqual(Object.keys(body).sort(), [
    'account',
    'email',
    'invite',
    'name',
  ])
  await ctx.close()
  results.push(
    'An invite link registers an account with a passphrase the same way'
  )
}

/** Accounts from before encryption: an administrator creates them with a temporary password. */
async function testLegacy(browser, admin) {
  for (const [key, password] of [
    ['legacyStrong', SECRETS.legacyStrong],
    ['legacyWeak', SECRETS.legacyWeak],
    ['stale', SECRETS.staleLegacy],
  ])
    await api(admin.ctx, '/api/users', 'POST', { ...users[key], password })

  // The password sign-in sends these three passwords, as it always did.
  for (const key of ['legacyStrong', 'legacyWeak', 'staleLegacy']) {
    seen.passphrases.add(SECRETS[key])
    legacyPasswords.set(SECRETS[key], Infinity)
  }

  // A strong temporary password can stay as the passphrase.
  let { ctx, page } = await context(browser)
  await openLogin(page)
  await enterIdentifier(page, users.legacyStrong.email, 'Password')
  await shot(page, 'sign-in-legacy-password')
  await page.getByLabel('Password', { exact: true }).fill(SECRETS.legacyStrong)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await page.waitForURL(/\/auth\/encryption/)
  await expect(
    page.getByRole('heading', { name: 'Set up encryption' })
  ).toBeVisible()
  await expect(page.getByLabel(/Keep my current password/)).toBeChecked()
  await shot(page, 'key-setup-keep-password')
  // The dashboard is closed until the account has keys.
  await page.goto(`${origin}/dashboard`)
  await page.waitForURL(/\/auth\/encryption/)
  // The password is gone from memory after a reload: only a new passphrase is offered.
  await expect(page.locator('#key-setup-passphrase')).toBeVisible()
  await expect(page.getByLabel(/Keep my current password/)).toHaveCount(0)
  await shot(page, 'key-setup-new-passphrase')
  await ctx.close()

  ;({ ctx, page } = await context(browser))
  await openLogin(page)
  await enterIdentifier(page, users.legacyStrong.email, 'Password')
  await page.getByLabel('Password', { exact: true }).fill(SECRETS.legacyStrong)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await page.waitForURL(/\/auth\/encryption/)
  await expect(page.getByLabel(/Keep my current password/)).toBeChecked()
  seen.passphrases.add(SECRETS.legacyStrong)
  await timed(page, 'key setup', null, /\/api\/auth\/e2ee\/keys$/, () =>
    page.getByRole('button', { name: 'Set up encryption' }).click()
  )
  // From the key setup request on, this password is a passphrase: nothing
  // may send it again.
  legacyPasswords.set(
    SECRETS.legacyStrong,
    requests.findLastIndex((request) =>
      request.url.endsWith('/api/auth/e2ee/keys')
    )
  )
  phrases.legacyStrong = await saveRecoveryPhrase(page, 'key-setup')
  await page.waitForURL(/\/dashboard/)
  await assertUnlocked(page, phrases.legacyStrong)
  const setupBody = JSON.parse(
    requests
      .filter(
        (r) => r.url.endsWith('/api/auth/e2ee/keys') && r.method === 'POST'
      )
      .pop().body
  )
  assert.deepEqual(Object.keys(setupBody), ['account'])
  await signOut(page)
  // The password sign-in is gone: the same secret now signs in as a passphrase.
  assert.deepEqual(
    await api(ctx, '/api/auth/e2ee/challenge', 'POST', {
      identifier: users.legacyStrong.email,
    }).then((answer) => answer.method),
    'passphrase'
  )
  await signIn(page, users.legacyStrong.email, SECRETS.legacyStrong)
  await assertUnlocked(page, phrases.legacyStrong)
  await ctx.close()

  // A weak temporary password cannot stay.
  ;({ ctx, page } = await context(browser))
  await openLogin(page)
  await enterIdentifier(page, users.legacyWeak.email, 'Password')
  await page.getByLabel('Password', { exact: true }).fill(SECRETS.legacyWeak)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await page.waitForURL(/\/auth\/encryption/)
  await expect(
    page.getByText('Your current password is too easy to guess')
  ).toBeVisible()
  await expect(page.getByLabel(/Keep my current password/)).toHaveCount(0)
  await shot(page, 'key-setup-weak-password')
  await choosePassphrase(page, SECRETS.legacyWeak, 'key-setup')
  await page.getByRole('button', { name: 'Set up encryption' }).click()
  await expect(
    page.getByText('This passphrase is too easy to guess.')
  ).toBeVisible()
  await choosePassphrase(page, SECRETS.legacyNew, 'key-setup')
  await page.getByRole('button', { name: 'Set up encryption' }).click()
  phrases.legacyWeak = await saveRecoveryPhrase(page)
  await page.waitForURL(/\/dashboard/)
  await assertUnlocked(page, phrases.legacyWeak)
  await ctx.close()
  results.push(
    'An account with a temporary password signs in with the password form, cannot open the dashboard before key setup, may keep a strong password as its passphrase, must replace a weak one, and signs in with the passphrase afterwards'
  )

  // Key setup needs a sign-in of the last five minutes.
  ;({ ctx, page } = await context(browser))
  await openLogin(page)
  await enterIdentifier(page, users.stale.email, 'Password')
  await page.getByLabel('Password', { exact: true }).fill(SECRETS.staleLegacy)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await page.waitForURL(/\/auth\/encryption/)
  await expect(page.getByLabel(/Keep my current password/)).toBeChecked()
  seen.passphrases.add(SECRETS.staleLegacy)
  if (realStale) {
    console.log('Waiting five minutes for the sign-in to become stale…')
    await page.waitForTimeout(5 * 60_000 + 5000)
  } else {
    // SIMULATION: the server's answer to a stale session, without the wait.
    // `__tests__/auth/e2ee-database.test.ts` covers the real rule.
    await page.route('**/api/auth/e2ee/keys', (route) =>
      route.request().method() === 'POST'
        ? route.fulfill({
            status: 403,
            contentType: 'application/json',
            body: JSON.stringify({
              error:
                'Sign in again, then set up encryption within five minutes.',
              code: 'recent_sign_in_required',
            }),
          })
        : route.continue()
    )
  }
  await page.getByRole('button', { name: 'Set up encryption' }).click()
  await expect(
    page.getByText('Your sign-in is more than five minutes old')
  ).toBeVisible()
  await shot(page, 'key-setup-stale-session')
  await page.unroute('**/api/auth/e2ee/keys')
  await page.getByRole('button', { name: 'Sign in again' }).click()
  await page.waitForURL(/\/auth\/login/)
  assert.equal((await api(ctx, '/api/auth/session')).user, undefined)
  await ctx.close()
  results.push(
    `Key setup with a stale sign-in changes nothing and sends the person back to sign in (${realStale ? 'real five-minute wait' : 'SIMULATED server answer; the database suite covers the real rule'})`
  )
}

/** Turns the authenticator on through the real dialog, then signs in with it. */
async function testTotp(jamie) {
  const { ctx, page } = jamie
  await page.goto(`${origin}/dashboard/profile`)
  await page.getByRole('button', { name: 'Set up authenticator' }).click()
  const dialog = page.getByRole('dialog')
  // The sign-in was minutes ago at most: it is the proof, and no password field exists.
  await expect(
    dialog.getByText('Your recent passphrase sign-in confirms')
  ).toBeVisible()
  await expect(dialog.locator('input[type="password"]')).toHaveCount(0)
  await shot(page, 'security-proof-recent-passphrase')
  const setupResponse = page.waitForResponse((response) =>
    response.url().endsWith('/api/auth/security/totp/setup')
  )
  await dialog.getByRole('button', { name: 'Continue' }).click()
  const { secret } = await (await setupResponse).json()
  await dialog.locator('#setup-code').fill(await freshCode(secret))
  await dialog
    .getByRole('button', { name: 'Enable two-factor authentication' })
    .click()
  await expect(
    dialog.getByText('These codes are shown only once')
  ).toBeVisible()
  await dialog.getByLabel(/I have saved my recovery codes/).check()
  await dialog.getByRole('button', { name: 'Done' }).click()
  await dialog.getByRole('button', { name: /Sign in again/ }).click()
  await page.waitForURL(/\/auth\/login/)
  await assertNoStoredKeys(page)

  await openLogin(page)
  await enterIdentifier(page, users.jamie.email)
  await page.getByLabel('Passphrase', { exact: true }).fill(SECRETS.jamie)
  const before = requests.length
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(
    page.getByRole('heading', { name: 'Verify your identity' })
  ).toBeVisible()
  await shot(page, 'sign-in-two-factor')
  // A wrong code keeps the step open.
  await page.getByLabel('Authenticator code').fill('000000')
  await page.getByRole('button', { name: 'Verify and sign in' }).click()
  await expect(page.getByText('Unable to verify this code')).toBeVisible()
  const code = await freshCode(secret)
  await page.getByLabel('Authenticator code').fill(code)
  const submitted = Date.now()
  let sentAt
  const onRequest = (request) => {
    if (request.url().endsWith('/api/auth/callback/passphrase'))
      sentAt ??= Date.now()
  }
  page.on('request', onRequest)
  await page.getByRole('button', { name: 'Verify and sign in' }).click()
  await page.waitForURL(/\/dashboard/)
  page.off('request', onRequest)
  await assertUnlocked(page, phrases.jamie)
  const attempts = requests
    .slice(before)
    .filter((request) => request.url.endsWith('/api/auth/callback/passphrase'))
    .map((request) => new URLSearchParams(request.body))
  assert.equal(
    attempts.length,
    3,
    'One attempt without a code and two with one'
  )
  assert.equal(
    new Set(attempts.map((a) => a.get('challenge'))).size,
    3,
    'Each attempt signs a new challenge'
  )
  assert.equal(new Set(attempts.map((a) => a.get('signature'))).size, 3)
  assert.equal(attempts[0].get('code'), null)
  assert.equal(attempts[2].get('code'), code)
  const retry = sentAt - submitted
  const derivation = Math.min(...timings.map((timing) => timing.ms))
  assert.ok(
    retry < Math.max(250, derivation / 2),
    `The attempt with the code took ${retry} ms, a derivation takes ${derivation} ms`
  )
  results.push(
    `An account with an authenticator gets the code step after its passphrase; each attempt signs a new challenge with the keys in memory (the attempt with the code left ${retry} ms after the click, against ${derivation} ms for the fastest derivation), and the sign-in ends unlocked`
  )
  return secret
}

async function testUnlock(admin) {
  const { page } = admin
  // Another device's cookie, cleared site data, a new browser profile: a session without keys.
  await page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const deleting = indexedDB.deleteDatabase('flare-e2ee')
        deleting.onsuccess = resolve
        deleting.onerror = () => reject(deleting.error)
      })
  )
  await page.goto(`${origin}/dashboard`)
  const banner = page.locator('[data-unlock-banner]')
  await expect(banner).toBeVisible()
  // Minutes after a sign-in the prompt opens by itself, one time. It can be
  // put off, and the page behind it is not blocked.
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByText('Unlock your encryption keys')).toBeVisible()
  await dialog.getByRole('button', { name: 'Not now' }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Account menu' })).toBeVisible()
  await shot(page, 'locked-banner')
  await page.reload()
  await expect(banner).toBeVisible()
  await expect(dialog).toHaveCount(0)
  await banner.getByRole('button', { name: 'Unlock' }).click()
  await shot(page, 'unlock-dialog')
  await dialog.locator('#unlock-passphrase').fill('not the right passphrase 9')
  await dialog.getByRole('button', { name: 'Unlock', exact: true }).click()
  await expect(
    dialog.getByText('That passphrase is not correct.')
  ).toBeVisible()
  await shot(page, 'unlock-dialog-wrong')
  await assertNoStoredKeys(page)
  await dialog.locator('#unlock-passphrase').fill(SECRETS.admin)
  await timed(
    page,
    'unlock',
    /\/api\/auth\/e2ee\/session-challenge$/,
    /\/api\/auth\/e2ee\/unlock$/,
    () => dialog.getByRole('button', { name: 'Unlock', exact: true }).click()
  )
  await expect(dialog).toHaveCount(0)
  await assertUnlocked(page, phrases.admin)
  // A second tab reads the same store.
  const second = await admin.ctx.newPage()
  await second.goto(`${origin}/dashboard`)
  await expect(
    second.getByRole('button', { name: 'Account menu' })
  ).toBeVisible()
  await assertUnlocked(second, phrases.admin)
  await second.close()
  results.push(
    'A signed-in browser without keys shows a notice that does not block the page, refuses a wrong passphrase, unlocks with the right one, and shares the keys with a second tab'
  )
}

async function testRotation(admin) {
  const { ctx, page } = admin
  await page.goto(`${origin}/dashboard/profile`)
  const card = page.locator('#password')
  await expect(card.getByText('Passphrase and recovery')).toBeVisible()
  await card.scrollIntoViewIfNeeded()
  await shot(page, 'profile-passphrase-card')

  // The recovery phrase is shown again only for the passphrase.
  await card.getByRole('button', { name: 'Show recovery phrase' }).click()
  let dialog = page.getByRole('dialog')
  await dialog.locator('#reveal-passphrase').fill('not the right passphrase 9')
  await dialog.getByRole('button', { name: 'Show recovery phrase' }).click()
  await expect(
    dialog.getByText('That passphrase is not correct.')
  ).toBeVisible()
  await dialog.locator('#reveal-passphrase').fill(SECRETS.admin)
  await shot(page, 'show-recovery-phrase-prompt')
  await dialog.getByRole('button', { name: 'Show recovery phrase' }).click()
  await expect(dialog.locator('[data-recovery-phrase]')).toBeVisible()
  assert.equal(
    (await dialog.locator('[data-recovery-word]').allTextContents()).join(' '),
    phrases.admin
  )
  await shot(page, 'show-recovery-phrase')
  await dialog.getByRole('button', { name: 'Done' }).click()

  // A named API token and the upload token, to see the rotation cancel them.
  const created = await api(ctx, '/api/integrations', 'POST', {
    action: 'create-token',
    name: 'rotation check',
    scopes: ['files:read'],
  })
  assert.equal((await api(ctx, '/api/integrations')).tokens.length, 1)
  const bearer = created.secret
  assert.ok(bearer, `The new token is returned once: ${Object.keys(created)}`)
  const withToken = (token) =>
    fetch(`${origin}/api/files?limit=1`, {
      headers: { Authorization: `Bearer ${token}` },
    }).then((response) => response.status)
  assert.equal(await withToken(bearer), 200)

  await card.getByRole('button', { name: 'Change passphrase' }).click()
  dialog = page.getByRole('dialog')
  await expect(dialog.getByText('Every session ends')).toBeVisible()
  await expect(dialog.getByText('Every API token is deleted')).toBeVisible()
  await expect(dialog.getByText('You get a new recovery phrase.')).toBeVisible()
  await shot(page, 'change-passphrase-warning')
  await dialog.getByRole('button', { name: 'Continue' }).click()
  await dialog.locator('#current-passphrase').fill('not the right passphrase 9')
  await choosePassphrase(page, SECRETS.adminNext, 'change')
  await shot(page, 'change-passphrase-form')
  await dialog
    .getByRole('button', { name: 'Change passphrase and sign out' })
    .click()
  await expect(
    dialog.getByText('Your current passphrase is not correct.')
  ).toBeVisible()
  await shot(page, 'change-passphrase-wrong-current')
  // The same passphrase again is no change.
  await dialog.locator('#current-passphrase').fill(SECRETS.admin)
  await choosePassphrase(page, SECRETS.admin, 'change')
  await dialog
    .getByRole('button', { name: 'Change passphrase and sign out' })
    .click()
  await expect(
    dialog.getByText('must be different from the current one')
  ).toBeVisible()
  await choosePassphrase(page, SECRETS.adminNext, 'change')
  const before = requests.length
  await dialog
    .getByRole('button', { name: 'Change passphrase and sign out' })
    .click()
  await expect(dialog.getByText('Save your new recovery phrase')).toBeVisible()
  const rotation = requests
    .slice(before)
    .find((request) => request.url.endsWith('/api/auth/e2ee/rotation'))
  const sent = JSON.parse(rotation.body)
  assert.deepEqual(Object.keys(sent).sort(), [
    'account',
    'passphraseProof',
    'sealedKeyring',
  ])
  const headers = JSON.parse(rotation.headers)
  assert.ok(
    headers['x-flare-e2ee-challenge'] && headers['x-flare-e2ee-signature']
  )
  assert.notEqual(
    headers['x-flare-e2ee-challenge'],
    sent.passphraseProof.challenge
  )
  // The session is over on the server, and the keys of this browser are gone.
  assert.equal((await api(ctx, '/api/auth/session')).user, undefined)
  await assertNoStoredKeys(page)
  phrases.adminNext = await saveRecoveryPhrase(page, 'change-passphrase')
  assert.notEqual(phrases.adminNext, phrases.admin)
  await page.waitForURL(/\/auth\/login/)

  // The old passphrase signs nobody in. The new one does, and the keyring holds the old key.
  await signIn(page, users.admin.email, SECRETS.admin, {
    expectDashboard: false,
  })
  await expect(page.getByText('Invalid email or passphrase')).toBeVisible()
  await signIn(page, users.admin.email, SECRETS.adminNext)
  await assertUnlocked(page, phrases.adminNext, [phrases.admin])
  assert.equal((await api(ctx, '/api/integrations')).tokens.length, 0)
  assert.equal(await withToken(bearer), 401, 'The API token stopped working')
  results.push(
    `Profile shows the recovery phrase only for the passphrase; a passphrase change explains what it cancels, refuses a wrong current passphrase and an unchanged one, sends a signed request with a second proof on its own challenge, ends the session, shows a new recovery phrase, and the next sign-in holds the old key in the keyring, with the API token of the account deleted and refused`
  )
}

async function configureEmail(admin, mail) {
  const current = await api(admin.ctx, '/api/settings/email')
  const config = current.data?.config || current.config
  await api(admin.ctx, '/api/settings/email', 'PUT', {
    config: {
      ...config,
      enabled: true,
      smtp: {
        ...config.smtp,
        host: '127.0.0.1',
        port: mail.port,
        security: 'none',
        authentication: false,
        username: '',
        password: '',
      },
      fromAddress: 'flare@flare-e2ee.test',
      publicUrl: origin,
      recovery: { ...config.recovery, enabled: true },
      limits: {
        ...config.limits,
        resendSeconds: 30,
        addressPerHour: 100,
        ipPerHour: 1000,
      },
      verification: { ...config.verification, mode: 'optional' },
    },
  })
}

/** Recovery needs a verified address. Jamie verifies it with the emailed link, with the identity check of a passphrase account. */
async function verifyEmail(jamie, mail, totpSecret) {
  const { page } = jamie
  await page.goto(`${origin}/dashboard/profile`)
  const enroll = page.getByRole('button', { name: 'Verify my email' })
  await expect(enroll).toBeVisible()
  // SIMULATION of the five-minute window running out: the status answer says
  // that the passphrase sign-in is no longer recent. The confirmation that
  // follows is a real passphrase sign-in in place.
  let expired = true
  await page.route('**/api/auth/security', async (route) => {
    const response = await route.fetch()
    const body = await response.json()
    await route.fulfill({
      response,
      json: expired ? { ...body, canUseRecentPassphrase: false } : body,
    })
  })
  await page.reload()
  const confirmation = page.locator('[data-passphrase-confirmation]').first()
  await expect(confirmation).toBeVisible()
  await expect(page.locator('input#email-enroll-password')).toHaveCount(0)
  await confirmation.scrollIntoViewIfNeeded()
  await shot(page, 'identity-check-passphrase')
  await confirmation
    .locator('#email-passphrase')
    .fill('not the right passphrase 9')
  await confirmation
    .locator('#email-passphrase-code')
    .fill(await freshCode(totpSecret))
  await confirmation.getByRole('button', { name: 'Confirm passphrase' }).click()
  await expect(confirmation.getByRole('alert')).toBeVisible()
  await shot(page, 'identity-check-passphrase-wrong')
  await confirmation.locator('#email-passphrase').fill(SECRETS.jamie)
  await confirmation
    .locator('#email-passphrase-code')
    .fill(await freshCode(totpSecret))
  expired = false
  await confirmation.getByRole('button', { name: 'Confirm passphrase' }).click()
  await expect(
    page
      .getByText('Your recent passphrase sign-in confirms your identity')
      .first()
  ).toBeVisible()
  await page.unroute('**/api/auth/security')
  await assertUnlocked(page, phrases.jamie)
  const since = mail.count()
  await page.getByRole('button', { name: 'Verify my email' }).click()
  const link = await mail.link(users.jamie.email, '/auth/verify-email', since)
  await page.goto(link)
  await page.getByRole('button', { name: 'Confirm email' }).click()
  await expect(page.getByText(/confirmed|verified/i).first()).toBeVisible()
  results.push(
    'An identity check of a passphrase account shows no password field: it signs the open account in again in place with the passphrase and an authenticator code, refuses a wrong passphrase, and the change then goes through (the expiry of the five-minute window is SIMULATED in the status answer; the confirmation is a real sign-in)'
  )
}

async function requestResetLink(browser, mail, email) {
  const { ctx, page } = await context(browser)
  await page.goto(`${origin}/auth/forgot-password`)
  await expect(
    page.getByRole('heading', { name: 'Forgot your passphrase?' })
  ).toBeVisible()
  await page.getByLabel('Email address').fill(email)
  await shot(page, 'forgot-passphrase')
  const since = mail.count()
  // One email request per address every 30 seconds at the least: the limit
  // holds the request back after the mail that came before it.
  for (;;) {
    await page.getByRole('button', { name: 'Send reset link' }).click()
    const outcome = page
      .getByText('If this address is eligible')
      .or(page.getByText('Too many email requests'))
    await expect(outcome).toBeVisible()
    if (await page.getByText('If this address is eligible').count()) break
    await page.waitForTimeout(5000)
  }
  const link = await mail.link(email, '/auth/reset-password', since)
  await page.goto(link)
  return { ctx, page, link }
}

/** A link that a recovery or a reset used up says so and offers a new one. */
async function assertLinkUsed(page, link, name) {
  await page.goto(link)
  await expect(page.getByText(/invalid or expired/)).toBeVisible()
  await expect(
    page.getByRole('link', { name: 'Request a new link' })
  ).toBeVisible()
  if (name) await shot(page, name)
}

async function testRecovery(browser, jamie, mail, totpSecret) {
  await signOut(jamie.page)
  const { ctx, page, link } = await requestResetLink(
    browser,
    mail,
    users.jamie.email
  )
  await expect(
    page.getByRole('button', { name: /I have my recovery phrase/ })
  ).toBeVisible()
  await shot(page, 'reset-choose')
  await page.getByRole('button', { name: /I have my recovery phrase/ }).click()
  await page
    .getByLabel('Recovery phrase')
    .fill('these are not the words of anything')
  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(page.getByText('That is not a recovery phrase.')).toBeVisible()
  // A valid phrase of a different account.
  await page.getByLabel('Recovery phrase').fill(phrases.invited)
  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(
    page.getByText('not the current one of this account')
  ).toBeVisible()
  await shot(page, 'recovery-wrong-phrase')
  await page
    .getByLabel('Recovery phrase')
    .fill(phrases.jamie.toUpperCase().replace(/ /g, '  '))
  await shot(page, 'recovery-phrase-entry')
  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(
    page.getByText('Your recovery phrase matches this account.')
  ).toBeVisible()
  await choosePassphrase(page, SECRETS.jamieRecovered, 'reset')
  await shot(page, 'recovery-new-passphrase')
  const before = requests.length
  await page.getByRole('button', { name: 'Set new passphrase' }).click()
  phrases.jamieRecovered = await saveRecoveryPhrase(page, 'recovery')
  await page.waitForURL(/\/auth\/login/)
  const recovery = requests
    .slice(before)
    .find((request) => request.url.endsWith('/api/auth/e2ee/recovery'))
  assert.deepEqual(Object.keys(JSON.parse(recovery.body)).sort(), [
    'account',
    'sealedKeyring',
    'token',
  ])
  await assertLinkUsed(page, link)
  await ctx.close()

  // The old passphrase is dead; the new one unlocks, and the old key stays in the keyring.
  await signInWithCode(
    jamie.page,
    users.jamie.email,
    SECRETS.jamie,
    totpSecret,
    false
  )
  await signInWithCode(
    jamie.page,
    users.jamie.email,
    SECRETS.jamieRecovered,
    totpSecret,
    true
  )
  await assertUnlocked(jamie.page, phrases.jamieRecovered, [phrases.jamie])
  results.push(
    'Recovery from an emailed link refuses text that is no phrase and the phrase of another account, accepts the right phrase in upper case, sets a new passphrase with a request signed by the old account key, shows a new recovery phrase, keeps the authenticator, and the next sign-in holds the old key in the keyring'
  )
}

async function signInWithCode(page, email, passphrase, secret, succeeds) {
  seen.passphrases.add(passphrase)
  await openLogin(page)
  await enterIdentifier(page, email)
  await page.getByLabel('Passphrase', { exact: true }).fill(passphrase)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  if (!succeeds) {
    await expect(page.getByText('Invalid email or passphrase')).toBeVisible()
    return
  }
  await expect(
    page.getByRole('heading', { name: 'Verify your identity' })
  ).toBeVisible()
  await page.getByLabel('Authenticator code').fill(await freshCode(secret))
  await page.getByRole('button', { name: 'Verify and sign in' }).click()
  await page.waitForURL(/\/dashboard/)
}

async function testReset(browser, jamie, mail, totpSecret) {
  await signOut(jamie.page)
  const { ctx, page, link } = await requestResetLink(
    browser,
    mail,
    users.jamie.email
  )
  await page.getByRole('button', { name: /I lost my recovery phrase/ }).click()
  await expect(page.getByText('They stay unreadable for good.')).toBeVisible()
  await choosePassphrase(page, SECRETS.jamieReset, 'reset')
  await shot(page, 'reset-warning')
  // Nothing happens before the person confirms what a reset costs.
  await page.getByRole('button', { name: 'Reset account keys' }).click()
  await expect(page.getByText('Confirm that you understand')).toBeVisible()
  await page.getByLabel(/can never be\s+opened again/).check()
  const before = requests.length
  await page.getByRole('button', { name: 'Reset account keys' }).click()
  phrases.jamieReset = await saveRecoveryPhrase(page, 'reset')
  await page.waitForURL(/\/auth\/login/)
  const reset = requests
    .slice(before)
    .find((request) => request.url.endsWith('/api/auth/e2ee/reset'))
  assert.deepEqual(Object.keys(JSON.parse(reset.body)).sort(), [
    'account',
    'token',
  ])
  await assertLinkUsed(page, link, 'reset-link-used')
  await ctx.close()

  await signInWithCode(
    jamie.page,
    users.jamie.email,
    SECRETS.jamieRecovered,
    totpSecret,
    false
  )
  await signInWithCode(
    jamie.page,
    users.jamie.email,
    SECRETS.jamieReset,
    totpSecret,
    true
  )
  // New keys from a new root secret, and no keyring: the old keys are gone.
  await assertUnlocked(jamie.page, phrases.jamieReset, [])
  results.push(
    'A reset without the recovery phrase needs an explicit confirmation, sends only the link token and a new account record, uses the link up, keeps the authenticator, and leaves the account with new keys and no keyring'
  )
}

async function testAdmin(admin) {
  const { page } = admin
  await page.goto(`${origin}/dashboard/users`)
  await page
    .getByRole('button', { name: `Edit ${users.jamie.name}` })
    .first()
    .click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.locator('[data-user-passphrase-note]')).toBeVisible()
  await expect(dialog.locator('#newPassword')).toHaveCount(0)
  await shot(page, 'admin-edit-user-passphrase')
  await page.keyboard.press('Escape')
  // The server refuses it too.
  const list = await api(admin.ctx, '/api/users')
  const jamie = (list.data || list.users || list).find(
    (user) => user.email === users.jamie.email
  )
  assert.equal(jamie.hasPassphrase, true)
  assert.ok(!('authPublicKey' in jamie))
  const refused = await admin.ctx.request.fetch(`${origin}/api/users`, {
    method: 'PUT',
    data: { id: jamie.id, password: 'A-new-password-2026!' },
    headers: { Origin: origin },
  })
  assert.equal(refused.status(), 409)
  assert.equal((await refused.json()).code, 'passphrase_account')

  // An account that still has its temporary password keeps the field.
  await page
    .getByRole('button', { name: `Edit ${users.stale.name}` })
    .first()
    .click()
  await expect(dialog.locator('#newPassword')).toBeVisible()
  await expect(dialog.locator('[data-user-passphrase-note]')).toHaveCount(0)
  await page.keyboard.press('Escape')

  await page.goto(`${origin}/dashboard/profile`)
  // The sign-in history names the method of each attempt.
  const attempt = page.getByText(/^Passphrase · /).first()
  await expect(attempt).toBeVisible()
  await attempt.scrollIntoViewIfNeeded()
  await shot(page, 'sessions-passphrase-method')
  results.push(
    'The user dialog of an administrator shows no password field for an account with a passphrase and says why, the server refuses the same change with passphrase_account, and the sign-in history names the passphrase method'
  )
}

/** Chromium's virtual authenticator: the WebAuthn ceremonies are real, the device is not. */
async function addVirtualAuthenticator(ctx, page) {
  const cdp = await ctx.newCDPSession(page)
  await cdp.send('WebAuthn.enable')
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  })
}

/**
 * The state after a sign-in that gave the browser no secret (a passkey, a
 * passkey recovery code, SSO): a session, the locked notice, the unlock
 * prompt open by itself, and an empty key store. Then the passphrase opens
 * the keys of `account.mnemonic`.
 */
async function assertLockedThenUnlock(page, ctx, account, capture) {
  await page.waitForURL(/\/dashboard/)
  const banner = page.locator('[data-unlock-banner]')
  await expect(banner).toBeVisible()
  await expect(banner).toContainText(
    'Your encryption keys are locked in this browser.'
  )
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByText('Unlock your encryption keys')).toBeVisible()
  assert.equal(
    (await api(ctx, '/api/auth/session')).user.email,
    account.email,
    'The sign-in made a session'
  )
  const keys = await api(ctx, '/api/auth/e2ee/keys')
  assert.equal((keys.data ?? keys).hasKeys, true, 'The account has keys')
  await assertNoStoredKeys(page)
  if (capture) await shot(page, capture)
  seen.passphrases.add('not the right passphrase 9')
  await dialog.locator('#unlock-passphrase').fill('not the right passphrase 9')
  await dialog.getByRole('button', { name: 'Unlock', exact: true }).click()
  await expect(
    dialog.getByText('That passphrase is not correct.')
  ).toBeVisible()
  await assertNoStoredKeys(page)
  seen.passphrases.add(account.passphrase)
  await dialog.locator('#unlock-passphrase').fill(account.passphrase)
  await timed(
    page,
    'unlock',
    /\/api\/auth\/e2ee\/session-challenge$/,
    /\/api\/auth\/e2ee\/unlock$/,
    () => dialog.getByRole('button', { name: 'Unlock', exact: true }).click()
  )
  await expect(dialog).toHaveCount(0)
  await assertUnlocked(page, account.mnemonic, account.oldMnemonics ?? [])
}

/** Sections 6.3 and 6.4 after a passkey: the sign-in proves who it is and opens no key. */
async function testPasskey(browser) {
  const account = {
    email: users.invited.email,
    passphrase: SECRETS.invited,
    mnemonic: phrases.invited,
  }
  const { ctx, page } = await context(browser)
  await addVirtualAuthenticator(ctx, page)
  await signIn(page, account.email, account.passphrase)
  await assertUnlocked(page, account.mnemonic)

  // Register a passkey. The passphrase sign-in of a moment ago is the proof.
  const security = `${origin}/dashboard/profile#sign-in-security`
  await page.goto(security)
  await page.getByRole('button', { name: 'Add a passkey', exact: true }).click()
  let dialog = page.getByRole('dialog')
  await dialog.getByLabel('Passkey name', { exact: true }).fill('Taylor’s key')
  await expect(
    dialog.getByText('Your recent passphrase sign-in confirms')
  ).toBeVisible()
  await expect(dialog.locator('input[type="password"]')).toHaveCount(0)
  await dialog
    .getByRole('button', { name: 'Create passkey', exact: true })
    .click()
  await expect(
    page.getByRole('heading', { name: 'Your security settings are updated' })
  ).toBeVisible()
  await page.getByRole('button', { name: 'Sign in again', exact: true }).click()
  await page.waitForURL(/\/auth\/login/)
  await assertNoStoredKeys(page)

  // Sign in with the passkey: a session, and no key.
  let before = requests.length
  await page
    .getByRole('button', { name: 'Sign in with a passkey', exact: true })
    .click()
  await assertLockedThenUnlock(page, ctx, account, 'passkey-sign-in-locked')
  const afterPasskey = requests.slice(before).map((request) => request.url)
  assert.ok(
    afterPasskey.some((url) => url.endsWith('/api/auth/callback/passkey')),
    'The sign-in used the passkey provider'
  )
  assert.ok(
    !afterPasskey.some((url) => url.endsWith('/api/auth/callback/passphrase')),
    'The unlock is no second sign-in'
  )
  // The unlock is no sign-in: the session still says passkey, which is what
  // the identity checks read.
  assert.equal((await api(ctx, '/api/auth/security')).canUseRecentPasskey, true)
  // A second tab reads the keys that the first one unlocked.
  const second = await ctx.newPage()
  await second.goto(`${origin}/dashboard`)
  await expect(
    second.getByRole('button', { name: 'Account menu' })
  ).toBeVisible()
  await assertUnlocked(second, account.mnemonic)
  await second.close()
  results.push(
    'A passkey of Chromium’s virtual authenticator, registered with the recent passphrase sign-in as proof, signs in without a passphrase: the session exists, the key store is empty, the locked notice shows and the unlock prompt opens by itself; a wrong passphrase leaves it locked, the right one stores exactly the account key, with no second sign-in, and a second tab reads it'
  )

  // Require the passkey. The recent passkey sign-in confirms it.
  await page.goto(security)
  await page
    .getByRole('button', { name: 'Require passkey to sign in', exact: true })
    .click()
  dialog = page.getByRole('dialog')
  await expect(dialog).toContainText(
    'Passphrase, authenticator, and SSO sign-in will stop.'
  )
  await dialog
    .getByRole('button', { name: 'Require passkey', exact: true })
    .click()
  const codesDialog = page.getByRole('dialog', {
    name: 'Save your passkey recovery codes',
  })
  const codeItems = codesDialog
    .getByRole('list', { name: 'Passkey recovery codes' })
    .locator('li')
  await expect(codeItems).toHaveCount(10)
  const codes = await codeItems.allTextContents()
  await codesDialog.getByRole('checkbox').check()
  await codesDialog.getByRole('button', { name: 'Done', exact: true }).click()
  await page.getByRole('button', { name: 'Sign in again', exact: true }).click()
  await page.waitForURL(/\/auth\/login/)
  await assertNoStoredKeys(page)

  // The right passphrase is refused, and the form returns to the step that
  // has the passkey button and the recovery code link.
  await openLogin(page)
  await enterIdentifier(page, account.email)
  await page.getByLabel('Passphrase', { exact: true }).fill(account.passphrase)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page.locator('form [role="alert"]')).toContainText(
    'This account requires a passkey.'
  )
  await expect(
    page.getByRole('button', { name: 'Sign in with a passkey', exact: true })
  ).toBeVisible()
  await expect(page.getByLabel('Passphrase', { exact: true })).toHaveCount(0)
  await shot(page, 'passkey-required-passphrase-refused')
  assert.equal((await api(ctx, '/api/auth/session')).user, undefined)
  await assertNoStoredKeys(page)

  // A passkey recovery code signs in with the address alone. It opens no key either.
  const recover = async (code) => {
    await openLogin(page)
    await page
      .getByRole('button', { name: 'Use a passkey recovery code', exact: true })
      .click()
    await page.getByLabel('Email', { exact: true }).fill(account.email)
    await page.getByLabel('Passkey recovery code', { exact: true }).fill(code)
    await page
      .getByRole('button', { name: 'Sign in with recovery code', exact: true })
      .click()
  }
  before = requests.length
  await recover(codes[0])
  await assertLockedThenUnlock(page, ctx, account, 'passkey-recovery-locked')
  assert.ok(
    requests
      .slice(before)
      .some((request) =>
        request.url.endsWith('/api/auth/callback/passkey-recovery')
      )
  )
  let status = await api(ctx, '/api/auth/security')
  assert.equal(status.passkeyRequired, true)
  assert.equal(status.hasPassphrase, true)
  assert.equal(status.passkeyRecoveryCodesRemaining, 9)
  assert.equal(status.canUseRecentPasskeyRecovery, true)
  await signOut(page)
  // A used code signs nobody in.
  await recover(codes[0])
  await expect(page.locator('form [role="alert"]')).toContainText(
    /invalid|unable/i
  )
  assert.equal((await api(ctx, '/api/auth/session')).user, undefined)

  // The passkey still signs in while it is required, and the passphrase
  // still unlocks. Then the requirement is lifted and the passphrase signs in.
  await openLogin(page)
  await page
    .getByRole('button', { name: 'Sign in with a passkey', exact: true })
    .click()
  await assertLockedThenUnlock(page, ctx, account)
  await page.goto(security)
  await page
    .getByRole('button', { name: 'Allow other sign-in methods', exact: true })
    .click()
  dialog = page.getByRole('dialog')
  await dialog
    .getByRole('button', { name: 'Allow other methods', exact: true })
    .click()
  await page.getByRole('button', { name: 'Sign in again', exact: true }).click()
  await page.waitForURL(/\/auth\/login/)
  await signIn(page, account.email, account.passphrase)
  await assertUnlocked(page, account.mnemonic)
  status = await api(ctx, '/api/auth/security')
  assert.equal(status.passkeyRequired, false)
  assert.equal(status.passkeyRecoveryCodesRemaining, 0)
  await ctx.close()
  results.push(
    'With a passkey required, the right passphrase is refused and the form returns to the passkey step; a passkey recovery code signs in once with the address alone and leaves the browser locked until the passphrase unlocks it; the passkey keeps signing in; and passphrase sign-in works again only after the requirement is turned off'
  )
}

/**
 * SSO with a stand-in provider (oidc-issuer.cjs). Flare's side is real:
 * discovery, the code flow with PKCE, the ID token check, the account that
 * the first sign-in creates. The provider gives the browser no secret, so a
 * new account must set up encryption and an account with keys must unlock.
 */
async function testSso(browser, admin, issuer) {
  const before = await api(admin.ctx, '/api/settings')
  await api(admin.ctx, '/api/settings', 'PATCH', {
    settings: {
      general: {
        oidc: {
          ...before.data.settings.general.oidc,
          enabled: true,
          issuer: issuer.url,
          clientId: issuer.clientId,
          clientSecret: issuer.clientSecret,
          buttonText: 'Sign in with SSO',
          autoProvision: true,
          requireEmailVerified: true,
          enforceSso: false,
        },
      },
    },
  })
  const claims = {
    sub: 'robin-at-the-stand-in-provider',
    email: users.sso.email,
    email_verified: true,
    name: users.sso.name,
  }
  issuer.signInAs(claims)
  const { ctx, page } = await context(browser)
  const signInWithSso = async () => {
    await openLogin(page)
    await shot(page, 'sign-in-with-sso')
    await page.getByRole('button', { name: 'Sign in with SSO' }).click()
  }

  // The first sign-in creates the account. It has no keys: key setup is the
  // only page that opens.
  await signInWithSso()
  await page.waitForURL(/\/auth\/encryption/)
  await expect(
    page.getByRole('heading', { name: 'Set up encryption' })
  ).toBeVisible()
  assert.equal(
    (await api(ctx, '/api/auth/session')).user.email,
    users.sso.email
  )
  const keyStatus = await api(ctx, '/api/auth/e2ee/keys')
  assert.equal((keyStatus.data ?? keyStatus).hasKeys, false)
  await page.goto(`${origin}/dashboard`)
  await page.waitForURL(/\/auth\/encryption/)
  // The account never had a password: there is none to keep.
  await expect(page.locator('#key-setup-passphrase')).toBeVisible()
  await expect(page.getByLabel(/Keep my current password/)).toHaveCount(0)
  await expect(
    page.getByText('Your passphrase unlocks your encryption keys')
  ).toBeVisible()
  await shot(page, 'key-setup-sso')
  await choosePassphrase(page, WEAK, 'key-setup')
  await page.getByRole('button', { name: 'Set up encryption' }).click()
  await expect(
    page.getByText('This passphrase is too easy to guess.')
  ).toBeVisible()
  seen.passphrases.delete(WEAK)
  await choosePassphrase(page, SECRETS.sso, 'key-setup')
  await timed(page, 'key setup', null, /\/api\/auth\/e2ee\/keys$/, () =>
    page.getByRole('button', { name: 'Set up encryption' }).click()
  )
  phrases.sso = await saveRecoveryPhrase(page)
  await page.waitForURL(/\/dashboard/)
  await assertUnlocked(page, phrases.sso)
  assert.equal(
    (
      await api(ctx, '/api/auth/e2ee/challenge', 'POST', {
        identifier: users.sso.email,
      })
    ).method,
    'passphrase'
  )
  results.push(
    'The first SSO sign-in (stand-in provider inside the script; Flare’s OIDC flow is real) creates an account without keys that can open only key setup, offers no password to keep, refuses a weak passphrase, and ends with a recovery phrase and exactly the account key that it gives'
  )

  // The same person again: the account has keys, the provider opens none.
  await signOut(page)
  await signInWithSso()
  await assertLockedThenUnlock(
    page,
    ctx,
    { email: users.sso.email, passphrase: SECRETS.sso, mnemonic: phrases.sso },
    'sso-sign-in-locked'
  )
  assert.deepEqual(issuer.authorizations, [claims.sub, claims.sub])
  // For an account with a passphrase the provider's word is no identity
  // check, and neither is the unlock: a change asks for the passphrase.
  const status = await api(ctx, '/api/auth/security')
  assert.equal(status.hasPassphrase, true)
  assert.equal(status.canUseRecentSso, false)
  assert.equal(status.canUseRecentPassphrase, false)
  await page.goto(`${origin}/dashboard/profile#sign-in-security`)
  await page
    .getByRole('button', { name: 'Set up authenticator', exact: true })
    .click()
  await expect(
    page.getByRole('dialog').locator('[data-passphrase-confirmation]')
  ).toBeVisible()
  await shot(page, 'sso-identity-check-passphrase')
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Cancel', exact: true })
    .click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  // The passphrase of the account signs in on the local form as well.
  await signOut(page)
  await signIn(page, users.sso.email, SECRETS.sso)
  await assertUnlocked(page, phrases.sso)
  await ctx.close()

  await api(admin.ctx, '/api/settings', 'PATCH', {
    settings: {
      general: {
        oidc: { ...before.data.settings.general.oidc, enabled: false },
      },
    },
  })
  results.push(
    'A later SSO sign-in of that account gives a session and a locked browser with the unlock prompt open; a wrong passphrase leaves it locked, the right one stores the account key; an identity check then asks for the passphrase, because neither the provider nor the unlock is one; and the same passphrase signs the account in on the local form'
  )
}

async function main() {
  const browser = await chromium.launch({ headless: true })
  const mail = await startMailSink()
  const issuer = await startOidcIssuer({
    redirectUri: `${origin}/api/auth/callback/oidc`,
  })
  try {
    assert.equal(
      (await (await fetch(`${origin}/api/setup/check`)).json()).completed,
      false,
      'Start with an empty database: this run begins with first-run setup.'
    )
    const admin = await testSetup(browser)
    if (theme === 'light') await useLightTheme(admin)
    await testSignOutAndIn(admin)
    const jamie = await testRegister(browser)
    await testInvite(browser, admin)
    await testLegacy(browser, admin)
    await testUnlock(admin)
    const totpSecret = await testTotp(jamie)
    await testRotation(admin)
    await configureEmail(admin, mail)
    await verifyEmail(jamie, mail, totpSecret)
    await testRecovery(browser, jamie, mail, totpSecret)
    await testReset(browser, jamie, mail, totpSecret)
    await testAdmin(admin)
    await testPasskey(browser)
    await testSso(browser, admin, issuer)
    await assertBrowserStorage(admin.page, 'at the end')
    await assertBrowserStorage(jamie.page, 'at the end')
    await assertNothingSecretWasSent()
    for (const result of results) console.log(`PASS: ${result}`)
    const byLabel = {}
    for (const { label, ms } of timings) (byLabel[label] ||= []).push(ms)
    for (const [label, values] of Object.entries(byLabel))
      console.log(
        `TIME: ${label}: ${values.join(', ')} ms from the request before key derivation (or the click) to the request after it`
      )
  } finally {
    mail.close()
    issuer.close()
    await browser.close()
  }
}
main().catch((error) => {
  console.error(error.stack || error.message)
  process.exitCode = 1
})
