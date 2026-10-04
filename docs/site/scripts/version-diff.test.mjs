import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  changedFiles,
  compareFile,
} from '../.vitepress/theme/components/version-diff.mjs'

const file = (content, title = 'Example') => ({
  content,
  title,
  url: 'versions/v1.0.0/example.html',
})

test('changed files retain source metadata, classify additions and removals, and sort paths', () => {
  const before = {
    files: {
      'z-removed.md': file('removed\n'),
      'same.md': file('same\n'),
      'changed.md': file('before\n'),
      'renamed-title.md': file('same\n', 'Before title'),
    },
  }
  const after = {
    files: {
      'a-added.md': file('added\n'),
      'same.md': file('same\n'),
      'changed.md': file('after\n'),
      'renamed-title.md': file('same\n', 'After title'),
    },
  }
  const changes = changedFiles(before, after)
  assert.deepEqual(
    changes.map(({ path, status }) => ({ path, status })),
    [
      { path: 'a-added.md', status: 'Added' },
      { path: 'changed.md', status: 'Changed' },
      { path: 'z-removed.md', status: 'Removed' },
    ]
  )
  assert.equal(changes[0].before, undefined)
  assert.equal(changes[0].after, after.files['a-added.md'])
  assert.equal(changes[1].before, before.files['changed.md'])
  assert.equal(changes[1].after, after.files['changed.md'])
  assert.equal(changes[2].after, undefined)
  assert.deepEqual(changedFiles(before, before), [])
  assert.deepEqual(changedFiles({ files: {} }, { files: {} }), [])
})

test('empty files still count as additions and removals', () => {
  assert.equal(
    changedFiles({ files: {} }, { files: { 'empty.md': file('') } })[0].status,
    'Added'
  )
  assert.equal(
    changedFiles({ files: { 'empty.md': file('') } }, { files: {} })[0].status,
    'Removed'
  )
})

for (const [description, before, after] of [
  [
    'changed lines and context',
    'intro\nbefore\nfooter\n',
    'intro\nafter\nfooter\n',
  ],
  ['added file', undefined, '# New guide\n'],
  ['removed file', '# Old guide\n', undefined],
  ['unchanged file', 'same\n', 'same\n'],
  ['empty file', '', ''],
  ['final newline', 'same', 'same\n'],
  ['Windows line endings', 'one\r\ntwo\r\n', 'one\r\nthree\r\n'],
  [
    'Vue and HTML source text',
    '<script>throw new Error("before")</script>\n',
    '<img src=x onerror="alert(1)">\n{{ unsafe }}\n<VersionHistory />\n',
  ],
  ['Unicode source', '− 古い手順 🌙\n', '+ 新しい手順 🌞\n'],
  ['large rewrite', 'before\n'.repeat(5000), 'after\n'.repeat(5000)],
]) {
  test(`line diff reconstructs both sources: ${description}`, () => {
    const patch = compareFile(before, after)
    assert.equal(
      patch
        .filter((part) => !part.added)
        .map((part) => part.value)
        .join(''),
      before || ''
    )
    assert.equal(
      patch
        .filter((part) => !part.removed)
        .map((part) => part.value)
        .join(''),
      after || ''
    )
    assert.ok(patch.every((part) => !(part.added && part.removed)))
  })
}

test('reversing a comparison reverses additions and removals', () => {
  const before = {
    files: { 'old.md': file('old'), 'changed.md': file('before') },
  }
  const after = {
    files: { 'new.md': file('new'), 'changed.md': file('after') },
  }
  const forward = changedFiles(before, after)
  const reverse = changedFiles(after, before)
  const reversedStatus = {
    Added: 'Removed',
    Removed: 'Added',
    Changed: 'Changed',
  }
  assert.deepEqual(
    reverse.map(({ path, status }) => ({ path, status })),
    forward.map(({ path, status }) => ({
      path,
      status: reversedStatus[status],
    }))
  )
  for (let index = 0; index < forward.length; index++) {
    assert.equal(reverse[index].before, forward[index].after)
    assert.equal(reverse[index].after, forward[index].before)
  }
})
