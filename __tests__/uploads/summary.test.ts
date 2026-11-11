import { describe, expect, it } from 'vitest'

import { UPLOAD_DEFAULTS } from '@/lib/uploads/schema'
import { uploadSettingsSummary } from '@/lib/uploads/summary'

describe('visible upload settings', () => {
  it('honors explicit visibility and no-expiry overrides over a destructive profile', () => {
    const summary = uploadSettingsSummary(
      { ...UPLOAD_DEFAULTS, expiration: 'DAY' },
      true,
      { visibility: 'PRIVATE', expiresAt: null }
    )
    expect(summary).toContain('Private · no expiry')
    expect(summary).not.toContain('delete')
  })
  it('does not claim an invalid password is protecting an upload', () => {
    const summary = uploadSettingsSummary(UPLOAD_DEFAULTS, true, {
      password: true,
      passwordInvalid: true,
    })
    expect(summary).toContain('password needs attention')
    expect(summary).not.toContain('password protected')
  })

  it('names the inherited expiry action before someone uploads', () => {
    expect(
      uploadSettingsSummary({ ...UPLOAD_DEFAULTS, expiration: 'WEEK' }, true)
    ).toContain('1 week, then permanently delete')
    expect(
      uploadSettingsSummary(
        { ...UPLOAD_DEFAULTS, expiration: 'DAY', expiryAction: 'SET_PRIVATE' },
        true
      )
    ).toContain('1 day, then make private')
  })
  it('never advertises sharing or password protection for a restricted account', () => {
    const summary = uploadSettingsSummary(UPLOAD_DEFAULTS, false, {
      visibility: 'PUBLIC',
      password: true,
    })
    expect(summary).toMatch(/^Private/)
    expect(summary).not.toContain('password')
    expect(summary).not.toContain('Public')
  })
  it('shows password protection and the explicit expiry action without containing a secret', () => {
    const summary = uploadSettingsSummary(UPLOAD_DEFAULTS, true, {
      password: true,
      expiresAt: new Date('2027-01-01T12:00:00Z'),
      expiryAction: 'SET_PRIVATE',
    })
    expect(summary).toContain('password protected')
    expect(summary).toContain('2027')
    expect(summary).toContain('then make private')
  })
})
