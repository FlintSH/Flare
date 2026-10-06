import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

test('OpenAPI timeline boundary types accept real dated and undated responses', async () => {
  const spec = JSON.parse(
    await readFile(new URL('../public/openapi.json', import.meta.url), 'utf8')
  )
  const { cases } = JSON.parse(
    await readFile(
      new URL('./fixtures/timeline-responses.json', import.meta.url),
      'utf8'
    )
  )
  const resolveRef = ({ $ref }) => {
    assert.ok($ref.startsWith('#/'), 'Timeline schemas use local references')
    return $ref
      .slice(2)
      .split('/')
      .reduce((value, key) => value[key], spec)
  }
  const response = resolveRef(
    spec.paths['/api/files/timeline'].get.responses['200'].content[
      'application/json'
    ].schema
  )
  const bucket = resolveRef(response.properties.data.properties.buckets.items)

  // Focused JSON Schema type validation: OpenAPI 3.1's `nullable` annotation
  // cannot widen `type`. This deliberately does not claim full schema validation.
  const checkType = (schema, value) => {
    const actual = value === null ? 'null' : typeof value
    const allowed = Array.isArray(schema.type) ? schema.type : [schema.type]
    assert.ok(allowed.includes(actual), `${actual} is not allowed by type`)
  }
  const observed = new Set()
  for (const fixture of cases) {
    assert.equal(fixture.body.success, true)
    assert.ok(fixture.body.data.buckets.length > 0)
    for (const value of fixture.body.data.buckets) {
      for (const name of ['from', 'to']) {
        const schema = bucket.properties[name]
        checkType(schema, value[name])
        assert.equal(schema.format, 'date-time')
        observed.add(value[name] === null ? 'null' : typeof value[name])
        if (value[name] !== null)
          assert.ok(Number.isFinite(Date.parse(value[name])))
      }
    }
  }
  assert.deepEqual([...observed].sort(), ['null', 'string'])
  for (const name of ['from', 'to']) {
    const schema = bucket.properties[name]
    assert.equal('nullable' in schema, false)
    for (const invalid of [false, 42, {}, []])
      assert.throws(() => checkType(schema, invalid), /not allowed by type/)
    assert.throws(
      () => checkType({ ...schema, type: 'string', nullable: true }, null),
      /null is not allowed by type/,
      'The previous OpenAPI 3.0 spelling must reject the real null response'
    )
  }
})

test('coverage gate requires docs in the feature commit, not a later follow-up', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'flare-docs-policy-'))
  const git = (...args) =>
    execFileSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim()
  const commit = (message) => {
    git('add', '.')
    git('commit', '-m', message)
  }
  try {
    await mkdir(resolve(root, 'docs/site/scripts'), { recursive: true })
    await mkdir(resolve(root, 'docs/site/guide'), { recursive: true })
    await mkdir(resolve(root, 'lib/uploads'), { recursive: true })
    await copyFile(
      resolve(dirname(fileURLToPath(import.meta.url)), 'check-changes.mjs'),
      resolve(root, 'docs/site/scripts/check-changes.mjs')
    )
    git('init', '--quiet')
    git('config', 'user.name', 'Docs test')
    git('config', 'user.email', 'docs-test@example.test')
    commit('baseline')
    const base = git('rev-parse', 'HEAD')
    const check = () =>
      spawnSync(
        process.execPath,
        ['docs/site/scripts/check-changes.mjs', '--base', base],
        { cwd: root, encoding: 'utf8' }
      )
    await writeFile(
      resolve(root, 'lib/uploads/options.ts'),
      '// A changed upload behavior\n'
    )
    commit('feature without docs')
    assert.equal(check().status, 1)
    assert.match(
      check().stderr,
      /no corresponding handbook page changed in that commit/
    )
    await writeFile(
      resolve(root, 'docs/site/guide/uploading.md'),
      '# Updated upload behavior\n'
    )
    commit('docs after feature')
    assert.equal(
      check().status,
      1,
      'A later docs commit must not cover an undocumented feature commit'
    )
    git('reset', '--soft', base)
    commit('feature and docs together')
    assert.equal(check().status, 0)
    await mkdir(resolve(root, 'app/api/example'), { recursive: true })
    await writeFile(
      resolve(root, 'app/api/example/route.ts'),
      'export async function GET() {}\n'
    )
    await writeFile(
      resolve(root, 'docs/site/guide/uploading.md'),
      '# Still only a user guide\n'
    )
    commit('API change with wrong documentation area')
    assert.equal(check().status, 1)
    assert.match(check().stderr, /API\/integration reference/)
    const beforePermissions = git('rev-parse', 'HEAD')
    await mkdir(resolve(root, 'lib/permissions'), { recursive: true })
    await writeFile(
      resolve(root, 'lib/permissions/catalog.ts'),
      '// Changed a role permission\n'
    )
    commit('permission change without administration guidance')
    const checkPermissions = () =>
      spawnSync(
        process.execPath,
        ['docs/site/scripts/check-changes.mjs', '--base', beforePermissions],
        { cwd: root, encoding: 'utf8' }
      )
    assert.equal(checkPermissions().status, 1)
    assert.match(checkPermissions().stderr, /administration/)
    await mkdir(resolve(root, 'docs/site/admin'), { recursive: true })
    await writeFile(
      resolve(root, 'docs/site/admin/roles.md'),
      '# Role permission behavior\n'
    )
    git('add', '.')
    git('commit', '--amend', '--no-edit')
    assert.equal(checkPermissions().status, 0)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
