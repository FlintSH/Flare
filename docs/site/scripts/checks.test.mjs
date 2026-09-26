import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

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
