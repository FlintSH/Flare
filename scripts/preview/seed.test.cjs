const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const path = require('node:path')
const test = require('node:test')

const { DEMO_PASSWORD, validateEnvironment, seed } = require('./seed.cjs')

const environment = {
  FLARE_PR_PREVIEW: 'true',
  DATABASE_URL:
    'postgresql://preview:public-test-password@127.0.0.1:5432/preview?schema=public',
  NEXTAUTH_URL: 'https://preview.example.test',
  NEXTAUTH_SECRET: 'synthetic-test-session-secret-not-used-in-previews',
}

test('fixtures reject external databases and unsafe or missing environment', () => {
  validateEnvironment(environment)
  for (const override of [
    { FLARE_PR_PREVIEW: 'false' },
    {
      DATABASE_URL: environment.DATABASE_URL.replace(
        '127.0.0.1',
        'db.example.test'
      ),
    },
    { DATABASE_URL: `${environment.DATABASE_URL}&host=db.example.test` },
    { DATABASE_URL: environment.DATABASE_URL.replace(':5432/', ':6543/') },
    {
      DATABASE_URL: environment.DATABASE_URL.replace(
        ':public-test-password',
        ''
      ),
    },
    { NEXTAUTH_URL: 'http://preview.example.test' },
    { NEXTAUTH_URL: 'https://user:password@preview.example.test' },
    { NEXTAUTH_SECRET: 'short' },
  ])
    assert.throws(() => validateEnvironment({ ...environment, ...override }))
})

test('public user is bounded and cannot authenticate as bootstrap administrator', async () => {
  const users = []
  let settings
  const tx = {
    $executeRaw: async () => 1,
    user: {
      count: async () => users.length,
      create: async ({ data }) => users.push(data),
    },
    config: {
      upsert: async ({ create }) => {
        settings = create.value.settings
      },
    },
  }
  const prisma = { $transaction: (callback) => callback(tx) }
  await seed(prisma, async (password, rounds) => {
    assert.equal(password, DEMO_PASSWORD)
    assert.equal(rounds, 10)
    return 'synthetic-bcrypt-hash'
  })
  assert.equal(users.length, 2)
  const admin = users.find(({ role }) => role === 'ADMIN')
  const demo = users.find(({ role }) => role === 'USER')
  assert.equal(admin.password, null)
  assert.equal(demo.email, 'demo@example.test')
  assert.equal(demo.password, 'synthetic-bcrypt-hash')
  assert.equal(demo.defaultFileExpiration, 'HOUR')
  assert.equal(demo.defaultFileExpirationAction, 'DELETE')
  assert.match(admin.uploadToken, /^[a-f0-9]{64}$/)
  assert.notEqual(admin.uploadToken, demo.uploadToken)
  assert.equal(settings.general.setup.completed, true)
  assert.equal(settings.general.registrations.enabled, false)
  assert.equal(settings.general.storage.provider, 'local')
  assert.deepEqual(settings.general.storage.quotas, {
    enabled: true,
    default: { value: 50, unit: 'MB' },
  })
  assert.deepEqual(settings.general.storage.maxUploadSize, {
    value: 5,
    unit: 'MB',
  })
  assert.equal(settings.general.oidc.enabled, false)
  assert.equal(settings.general.ocr.enabled, false)
  assert.equal(settings.email.enabled, false)
  assert.equal(settings.email.recovery.enabled, false)
  assert.equal(settings.email.changes.enabled, false)

  const before = JSON.stringify({ users, settings })
  await assert.rejects(
    seed(prisma, async () => 'unused'),
    /already contains users/
  )
  assert.equal(JSON.stringify({ users, settings }), before)
})

test('boot refuses missing, invalid and expired deadlines before starting PostgreSQL', () => {
  for (const expiry of ['', 'not-a-timestamp', '1000000000']) {
    const result = spawnSync('bash', [path.join(__dirname, 'boot.sh')], {
      env: { ...process.env, PREVIEW_EXPIRES_AT: expiry },
      encoding: 'utf8',
      timeout: 2000,
    })
    assert.equal(result.status, 1)
    assert.match(result.stderr, /PREVIEW_EXPIRES_AT|Preview has expired/)
  }
})
