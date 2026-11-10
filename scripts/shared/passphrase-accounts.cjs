/* eslint-disable @typescript-eslint/no-require-imports */
// Account keys and passphrase sign-in for the browser suites under scripts/.
//
// Two halves. The first makes an account record in Node, for a seed that
// writes fixture accounts straight into a disposable database. It follows
// docs/e2ee-spec.md (sections 4.2, 5.1 and 5.4) with the primitive libraries
// directly, not with the application bundle: a record that it got wrong
// cannot sign in or unlock, so every suite run checks it against the real
// server and the real browser client.
//
// The second half drives the real pages: the two steps of sign-in, key setup
// for an account that still has a password, the recovery phrase, and the
// unlock prompt. It takes the Playwright `expect` of the calling suite, so
// each suite keeps its own timeouts.
const assert = require('node:assert/strict')
const { randomBytes } = require('node:crypto')
const { xchacha20 } = require('@noble/ciphers/chacha.js')
const { ed25519 } = require('@noble/curves/ed25519.js')
const { blake3 } = require('@noble/hashes/blake3.js')
const { entropyToMnemonic, mnemonicToEntropy } = require('@scure/bip39')
const { wordlist } = require('@scure/bip39/wordlists/english.js')
const { argon2id } = require('hash-wasm')

// ---------------------------------------------------------------- records

const ascii = (text) => new Uint8Array(Buffer.from(text, 'ascii'))
const deriveKey = (context, material) =>
  blake3(material, { context: ascii(context) })

/** `Argon2id(passphrase, salt)` with the fixed parameters of protocol version 1 (section 4.3). */
function passphraseRoot(passphrase, salt) {
  return argon2id({
    password: Buffer.from(passphrase.normalize('NFKC'), 'utf8'),
    salt,
    iterations: 3,
    parallelism: 4,
    memorySize: 65536,
    hashLength: 32,
    outputType: 'binary',
  })
}

/** `seal(key, nonce, associated_data, message)` of section 4.2: `nonce || ciphertext || tag`. */
function seal(key, nonce, associatedData, message) {
  const ciphertext = xchacha20(
    deriveKey('flare e2ee v1 seal cipher', key),
    nonce,
    message,
    undefined,
    0
  )
  const length = Buffer.alloc(8)
  length.writeBigUInt64LE(BigInt(associatedData.length))
  const tag = blake3
    .create({ key: deriveKey('flare e2ee v1 seal mac', key) })
    .update(length)
    .update(associatedData)
    .update(nonce)
    .update(ciphertext)
    .digest()
  return Buffer.concat([nonce, ciphertext, tag])
}

/** The account private and public key that a recovery phrase gives (section 5.1). */
function keysOfMnemonic(mnemonic) {
  const accountPrivateKey = deriveKey(
    'flare e2ee v1 account seed',
    mnemonicToEntropy(mnemonic, wordlist)
  )
  return {
    accountPrivateKey: Buffer.from(accountPrivateKey).toString('hex'),
    accountPublicKey: Buffer.from(
      ed25519.getPublicKey(accountPrivateKey)
    ).toString('hex'),
  }
}

/**
 * A new account record for `passphrase` (section 5.4, steps 1 to 6), as the
 * `User` columns that the server stores, with the recovery phrase of the
 * account, and as a request carries it. `wrappedRoot` has its
 * `record_version` byte in both.
 */
async function createAccountRecord(passphrase) {
  const passphraseSalt = randomBytes(32)
  const root = await passphraseRoot(passphrase, passphraseSalt)
  const rootEntropy = randomBytes(32)
  const accountPublicKey = ed25519.getPublicKey(
    deriveKey('flare e2ee v1 account seed', rootEntropy)
  )
  const columns = {
    accountPublicKey: Buffer.from(accountPublicKey),
    passphraseSalt,
    authPublicKey: Buffer.from(
      ed25519.getPublicKey(deriveKey('flare e2ee v1 auth', root))
    ),
    wrappedRoot: Buffer.concat([
      Buffer.of(0x01),
      seal(
        deriveKey('flare e2ee v1 wrap', root),
        randomBytes(24),
        accountPublicKey,
        rootEntropy
      ),
    ]),
    e2eeProtocolVersion: 1,
    // An account that has keys has no password hash (section 14.1, step 4).
    password: null,
  }
  const text = (bytes) => bytes.toString('base64url')
  return {
    mnemonic: entropyToMnemonic(rootEntropy, wordlist),
    columns,
    /** The same record as a request carries it (`account` of registration and setup). */
    wire: {
      accountPublicKey: text(columns.accountPublicKey),
      passphraseSalt: text(columns.passphraseSalt),
      protocolVersion: 1,
      authPublicKey: text(columns.authPublicKey),
      wrappedRoot: text(columns.wrappedRoot),
    },
  }
}

// ---------------------------------------------------------------- pages

/** What IndexedDB holds for this origin: the records of the key store. */
function storedKeys(page) {
  return page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const opening = indexedDB.open('flare-e2ee', 1)
        opening.onupgradeneeded = () =>
          opening.result.createObjectStore('account-keys')
        opening.onerror = () => reject(opening.error)
        opening.onsuccess = () => {
          const database = opening.result
          const reading = database
            .transaction('account-keys', 'readonly')
            .objectStore('account-keys')
            .getAll()
          reading.onerror = () => reject(reading.error)
          reading.onsuccess = () => {
            database.close()
            const toHex = (bytes) =>
              Array.from(bytes, (byte) =>
                byte.toString(16).padStart(2, '0')
              ).join('')
            resolve(
              reading.result.map((record) => ({
                fields: Object.keys(record).sort(),
                userId: record.userId,
                accountPublicKey: toHex(record.accountPublicKey),
                accountPrivateKey: toHex(record.accountPrivateKey),
                oldPrivateKeys: record.oldPrivateKeys.map(toHex),
              }))
            )
          }
        }
      })
  )
}

/**
 * Reads the recovery phrase that the page shows, checks its form, saves it
 * the way a person must (the acknowledgement, then three words typed back),
 * and returns it. `wrongFirst` types three wrong words before the right
 * ones. `capture(suffix)` is called at each state that a suite may want a
 * picture of.
 */
async function saveRecoveryPhrase(
  page,
  expect,
  { wrongFirst = false, capture = async () => {}, onPhrase = () => {} } = {}
) {
  const list = page.locator('[data-recovery-phrase]')
  await expect(list).toBeVisible()
  const words = await list.locator('[data-recovery-word]').allTextContents()
  assert.equal(words.length, 24, 'The recovery phrase has 24 words')
  const mnemonic = words.join(' ')
  mnemonicToEntropy(mnemonic, wordlist) // Throws unless the checksum is valid.
  onPhrase(mnemonic)
  const next = page.getByRole('button', { name: 'Continue', exact: true })
  await expect(next).toBeDisabled()
  await capture('recovery-phrase')
  await page.getByLabel(/I saved my recovery phrase/).check()
  await next.click()
  const inputs = page.locator('input[id^="recovery-word-"]')
  await expect(inputs).toHaveCount(3)
  await capture('recovery-phrase-check')
  const positions = await inputs.evaluateAll((elements) =>
    elements.map((element) => Number(element.id.replace('recovery-word-', '')))
  )
  const submit = page.locator('form button[type="submit"]').last()
  if (wrongFirst) {
    for (let index = 0; index < 3; index++)
      await inputs.nth(index).fill(words[(positions[index] + 1) % 24] + 'x')
    await submit.click()
    await expect(page.getByText('Those words do not match')).toBeVisible()
    await capture('recovery-phrase-check-wrong')
  }
  for (let index = 0; index < 3; index++)
    await inputs.nth(index).fill(words[positions[index]])
  await submit.click()
  return mnemonic
}

/**
 * The two steps of the sign-in form on the page as it is: the address, then
 * the secret of that account. Returns `'passphrase'` or `'password'`, the
 * form that the server chose for the address. It does not wait for what
 * follows the second step: the dashboard, a code, key setup or an error.
 */
async function fillSignInForm(page, expect, { email, secret }) {
  await page.getByLabel('Email address', { exact: true }).fill(email)
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  const passphrase = page.getByLabel('Passphrase', { exact: true })
  const password = page.getByLabel('Password', { exact: true })
  await expect(passphrase.or(password)).toBeVisible()
  const method = (await passphrase.count()) ? 'passphrase' : 'password'
  await (method === 'passphrase' ? passphrase : password).fill(secret)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  return method
}

/** Opens the sign-in page, then `fillSignInForm`. */
async function submitSignIn(
  page,
  expect,
  { origin, path = '/auth/login?local=1', ...account }
) {
  await page.goto(origin + path)
  return fillSignInForm(page, expect, account)
}

/**
 * Key setup at /auth/encryption for an account that just signed in with a
 * password (section 14.1). A strong password stays as the passphrase. A weak
 * one cannot, and `passphrase` replaces it. Returns the secret that signs
 * the account in from now on, and its recovery phrase.
 */
async function completeKeySetup(page, expect, { password, passphrase }) {
  await page.waitForURL(/\/auth\/encryption/)
  await expect(
    page.getByRole('heading', { name: 'Set up encryption' })
  ).toBeVisible()
  // The form measures the password that the sign-in page handed over before
  // it offers a choice. This sentence is shown only once that is done.
  await expect(
    page.getByText('From now on you sign in with this passphrase.')
  ).toBeVisible()
  const keep = page.getByLabel(/Keep my current password/)
  const field = page.locator('#key-setup-passphrase')
  let secret = password
  if (!(await keep.count())) {
    assert.ok(
      passphrase,
      'The password is too weak to keep. Give a passphrase for key setup.'
    )
    secret = passphrase
    await field.fill(secret)
    await page.locator('#key-setup-confirmation').fill(secret)
    await expect(page.locator('#key-setup-strength')).toHaveAttribute(
      'data-strength-score',
      /\d/
    )
  }
  await page.getByRole('button', { name: 'Set up encryption' }).click()
  const mnemonic = await saveRecoveryPhrase(page, expect)
  return { secret, mnemonic }
}

/**
 * Signs in through the real form and waits for the dashboard. An account
 * with a passphrase arrives there with its keys unlocked. An account that an
 * administrator created with a temporary password goes through key setup
 * first. Returns the secret that signs the account in from now on.
 */
async function signIn(page, expect, { passphrase, ...options }) {
  const method = await submitSignIn(page, expect, options)
  let secret = options.secret
  if (method === 'password')
    ({ secret } = await completeKeySetup(page, expect, {
      password: options.secret,
      passphrase,
    }))
  await page.waitForURL(/\/dashboard/, { timeout: 90000 })
  return secret
}

/**
 * Signs a browser context in with a page of its own, then closes that page.
 * For a suite that used to post the password to the sign-in route: the
 * session cookie and the unlocked keys stay in the context, so the pages
 * that it opens next show no unlock prompt.
 */
async function signInContext(ctx, expect, options) {
  const page = await ctx.newPage()
  try {
    return await signIn(page, expect, options)
  } finally {
    // A context that records video would keep one of this page too.
    const video = page.video()
    await page.close()
    if (video) await video.delete()
  }
}

/**
 * A sign-in with a passkey, a passkey recovery code or SSO gives a session
 * without keys: the page shows the locked notice, and the unlock prompt
 * opens by itself one time. Waits for both and puts the prompt off, so that
 * it cannot cover what the suite does next.
 */
async function dismissUnlockPrompt(page, expect) {
  await expect(page.locator('[data-unlock-banner]')).toBeVisible()
  const dialog = page.getByRole('dialog', {
    name: 'Unlock your encryption keys',
  })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Not now', exact: true }).click()
  await expect(dialog).toHaveCount(0)
}

module.exports = {
  completeKeySetup,
  createAccountRecord,
  dismissUnlockPrompt,
  fillSignInForm,
  keysOfMnemonic,
  saveRecoveryPhrase,
  signIn,
  signInContext,
  storedKeys,
  submitSignIn,
}
