import { describe, expect, it } from 'vitest'

import { DEFAULT_EMAIL_CONFIG } from '@/lib/email/schema'
import { renderFileRequestEmail } from '@/lib/email/templates'

const config = {
  ...DEFAULT_EMAIL_CONFIG,
  enabled: true,
  publicUrl: 'https://files.example',
}

describe('file request notification email', () => {
  it('summarizes arrivals and links to the request', () => {
    const email = renderFileRequestEmail(config, {
      username: 'Alex',
      title: 'Tax documents',
      fileCount: 3,
      totalSize: '12 MB',
      url: 'https://files.example/dashboard/requests?id=abc',
    })
    expect(email.subject).toBe('New files for “Tax documents”')
    expect(email.text).toContain(
      'Your file request “Tax documents” received 3 files (12 MB).'
    )
    expect(email.text).toContain(
      'https://files.example/dashboard/requests?id=abc'
    )
    expect(email.html).toContain('Review files')
  })

  it('keeps the owner’s title on one line and escapes it', () => {
    const email = renderFileRequestEmail(config, {
      title: '<b>Line</b>\r\nBreak',
      fileCount: 1,
      totalSize: '1 KB',
      url: 'https://files.example/dashboard/requests?id=abc',
    })
    expect(email.subject).not.toMatch(/[\r\n]/)
    expect(email.text).toContain('received 1 file (1 KB).')
    expect(email.html).not.toContain('<b>Line</b>')
    expect(email.html).toContain('&lt;b&gt;Line&lt;/b&gt;')
  })

  it('refuses links that are not HTTP', () => {
    expect(() =>
      renderFileRequestEmail(config, {
        title: 'Files',
        fileCount: 1,
        totalSize: '1 KB',
        url: 'javascript:alert(1)',
      })
    ).toThrow()
  })
})
