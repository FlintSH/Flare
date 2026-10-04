import assert from 'node:assert/strict'
import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import test from 'node:test'
import {
  recoverDirectoryPublication,
  replaceDirectory,
} from './release-publish.mjs'

async function fixture(t) {
  const root = await mkdtemp(resolve(tmpdir(), 'flare-publication-fixture-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const source = resolve(root, 'assembled')
  const destination = resolve(root, 'docs/releases')
  await mkdir(source, { recursive: true })
  await mkdir(destination, { recursive: true })
  await writeFile(resolve(source, 'index.html'), 'new verified site')
  await writeFile(resolve(destination, 'index.html'), 'last good site')
  await writeFile(resolve(destination, 'obsolete.html'), 'old page')
  return {
    source,
    destination,
    staging: `${destination}.staging`,
    previous: `${destination}.previous`,
  }
}

const index = (directory) => readFile(resolve(directory, 'index.html'), 'utf8')
const absent = async (path) => assert.rejects(lstat(path), { code: 'ENOENT' })

test('a partial copy failure preserves the last good output', async (t) => {
  const { source, destination, staging, previous } = await fixture(t)
  await assert.rejects(
    replaceDirectory(source, destination, {
      operations: {
        cp: async (_source, target) => {
          await mkdir(target)
          await writeFile(resolve(target, 'partial.html'), 'incomplete')
          throw new Error('injected copy failure')
        },
      },
    }),
    /injected copy failure/
  )
  assert.equal(await index(destination), 'last good site')
  await absent(staging)
  await absent(previous)
})

test('a failed staging rename restores the previous output', async (t) => {
  const { source, destination, staging, previous } = await fixture(t)
  await assert.rejects(
    replaceDirectory(source, destination, {
      operations: {
        rename: async (from, to) => {
          if (from === staging) throw new Error('injected swap failure')
          await rename(from, to)
        },
      },
    }),
    /injected swap failure/
  )
  assert.equal(await index(destination), 'last good site')
  await absent(staging)
  await absent(previous)
})

test('successful replacement promotes the complete copy and removes old files', async (t) => {
  const { source, destination, staging, previous } = await fixture(t)
  await mkdir(resolve(source, 'rolling'))
  await writeFile(resolve(source, 'rolling/index.html'), 'rolling site')
  await replaceDirectory(source, destination)
  assert.equal(await index(destination), 'new verified site')
  assert.equal(await index(resolve(destination, 'rolling')), 'rolling site')
  assert.equal(await index(source), 'new verified site')
  await absent(resolve(destination, 'obsolete.html'))
  await absent(staging)
  await absent(previous)
})

test('the next run restores a backup after interruption between renames', async (t) => {
  const { source, destination, staging, previous } = await fixture(t)
  await cp(source, staging, { recursive: true })
  await rename(destination, previous)
  await recoverDirectoryPublication(destination)
  assert.equal(await index(destination), 'last good site')
  await absent(staging)
  await absent(previous)
})

test('the next run retains a promoted site after interruption before backup cleanup', async (t) => {
  const { source, destination, staging, previous } = await fixture(t)
  await cp(source, staging, { recursive: true })
  await rename(destination, previous)
  await rename(staging, destination)
  await recoverDirectoryPublication(destination)
  assert.equal(await index(destination), 'new verified site')
  await absent(staging)
  await absent(previous)
})

test('a failed rollback preserves the backup for next-run recovery', async (t) => {
  const { source, destination, staging, previous } = await fixture(t)
  await assert.rejects(
    replaceDirectory(source, destination, {
      operations: {
        rename: async (from, to) => {
          if (from === staging || from === previous)
            throw new Error('injected rename failure')
          await rename(from, to)
        },
      },
    }),
    AggregateError
  )
  assert.equal(await index(previous), 'last good site')
  await recoverDirectoryPublication(destination)
  assert.equal(await index(destination), 'last good site')
  await absent(staging)
  await absent(previous)
})
