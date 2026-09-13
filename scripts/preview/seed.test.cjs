const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const { readFileSync } = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

const { validateEnvironment } = require('./seed.cjs')

const environment = {
  DATABASE_URL:
    'postgresql://preview:public-test-password@127.0.0.1:5432/preview?schema=public',
  NEXTAUTH_URL: 'https://preview.example.test',
  NEXTAUTH_SECRET: 'synthetic-test-session-secret-not-used-in-previews',
}

test('startup rejects external databases and unsafe or missing environment', () => {
  validateEnvironment(environment)
  for (const override of [
    { DATABASE_URL: '' },
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
    { NEXTAUTH_URL: '' },
    { NEXTAUTH_URL: 'http://preview.example.test' },
    { NEXTAUTH_URL: 'https://user:password@preview.example.test' },
    { NEXTAUTH_URL: 'https://preview.example.test/setup' },
    { NEXTAUTH_URL: 'https://preview.example.test?setup=1' },
    { NEXTAUTH_URL: 'https://preview.example.test#setup' },
    { NEXTAUTH_SECRET: 'short' },
  ])
    assert.throws(() => validateEnvironment({ ...environment, ...override }))
})

test('legacy seed invocations only validate and cannot create accounts or write configuration', () => {
  const script = readFileSync(path.join(__dirname, 'seed.cjs'), 'utf8')
  for (const args of [[], ['--check-environment'], ['--check-empty']]) {
    const imports = []
    const messages = []
    const module = { exports: {} }
    const process = {
      env: { ...environment },
      argv: ['node', 'seed.cjs', ...args],
    }
    // There is no database, filesystem or network capability in this sandbox.
    // Any attempt to load the old Prisma fixtures fails and is recorded.
    const require = Object.assign(
      (id) => {
        imports.push(id)
        throw new Error('The environment guard must not load dependencies.')
      },
      { main: module }
    )
    vm.runInNewContext(script, {
      module,
      process,
      require,
      URL,
      console: { error: (...args) => messages.push(args) },
    })
    assert.equal(process.exitCode, undefined)
    assert.deepEqual(imports, [])
    assert.deepEqual(messages, [])
    assert.deepEqual(process.env, environment)
  }
})

test('CLI rejects unsafe environment without leaking database credentials', () => {
  const result = spawnSync(
    process.execPath,
    [path.join(__dirname, 'seed.cjs')],
    {
      env: {
        ...environment,
        DATABASE_URL:
          'postgresql://private-user:never-print-this-password@db.example.test:5432/production',
      },
      encoding: 'utf8',
      timeout: 2000,
    }
  )
  assert.equal(result.status, 1)
  assert.match(result.stderr, /isolated local database/)
  assert.doesNotMatch(result.stderr, /private-user|never-print|db\.example/)
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
