import { describe, expect, it } from 'vitest'

import { uploadDisplayName } from '@/lib/uploads/display-name'

describe('upload display names', () => {
  it.each([
    ['report.pdf', 'report.pdf'],
    ['My Report (final).PDF', 'My Report (final).PDF'],
    ['../../../public/audit-proof.html', 'audit-proof.html'],
    ['C:\\Users\\me\\Pictures\\shot.png', 'shot.png'],
    ['mixed\\path/to/file.txt', 'file.txt'],
    ['re\u0000port\n\u001f.txt\u007f', 'report.txt'],
    ['...hidden', '...hidden'],
    ['日本語.png', '日本語.png'],
  ])('keeps %j as %j', (input, expected) => {
    expect(uploadDisplayName(input)).toBe(expected)
  })

  it.each(['', '.', '..', 'folder/', 'a/..', 'C:\\Users\\.', '\u0000\u001f'])(
    'rejects %j',
    (input) => {
      expect(uploadDisplayName(input)).toBeNull()
    }
  )
})
