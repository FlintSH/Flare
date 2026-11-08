import { describe, expect, it } from 'vitest'

import { UPLOAD_DEFAULTS } from '@/lib/uploads/schema'
import {
  type UploadSelectionData,
  ordinaryUploadSelection,
} from '@/lib/uploads/selection'

const data: UploadSelectionData = {
  profiles: [
    {
      id: 'temporary',
      name: 'Temporary',
      options: {
        visibility: 'PRIVATE',
        expiration: 'MONTH',
        randomizeFileUrls: true,
      },
    },
  ],
  defaultProfileId: 'temporary',
  accountOptions: { expiration: 'WEEK', expiryAction: 'DELETE' },
  effective: {
    ...UPLOAD_DEFAULTS,
    visibility: 'PRIVATE',
    expiration: 'MONTH',
    randomizeFileUrls: true,
  },
}
const input = {
  data,
  error: '',
  accountKnown: true,
  canManageProfiles: true,
  canShare: true,
}

describe('ordinary Upload and Paste selection', () => {
  it('uses the server-resolved default, while Account settings only bypasses it', () => {
    const inherited = ordinaryUploadSelection(input)
    expect(inherited.value).toBeUndefined()
    expect(inherited.summary).toContain(
      'Private · 1 month, then permanently delete · random filenames'
    )
    const account = ordinaryUploadSelection({ ...input, value: null })
    expect(account.value).toBeNull()
    expect(account.summary).toContain(
      'Public (anyone with the link) · 1 week, then permanently delete · original filenames'
    )
  })

  it('merges explicit profile fields over account defaults, retaining inherited action', () => {
    const selected = ordinaryUploadSelection({ ...input, value: 'temporary' })
    expect(selected.summary).toContain(
      'Private · 1 month, then permanently delete · random filenames'
    )
    expect(selected.selectedValue).toBe('temporary')
  })

  it('keeps explicit no-expiry, visibility and invalid-password status above the profile', () => {
    const selected = ordinaryUploadSelection({
      ...input,
      value: 'temporary',
      overrides: {
        visibility: 'PUBLIC',
        expiresAt: null,
        password: true,
        passwordInvalid: true,
      },
    })
    expect(selected.summary).toBe(
      'Public (anyone with the link) · password needs attention · no expiry · random filenames'
    )
    expect(selected.summary).not.toContain('protected')
    expect(selected.summary).not.toContain('delete')
  })

  it('uses an absolute deadline and explicit make-private action without a relative countdown', () => {
    const selected = ordinaryUploadSelection({
      ...input,
      overrides: {
        expiresAt: new Date('2030-01-01T12:00:00Z'),
        expiryAction: 'SET_PRIVATE',
        password: true,
      },
    })
    expect(selected.summary).toContain('password protected')
    expect(selected.summary).toContain('2030')
    expect(selected.summary).toContain('then make private')
    expect(selected.summary).not.toContain('1 month')
  })

  it('describes permission-forced Private and omits password claims without sharing permission', () => {
    const selected = ordinaryUploadSelection({
      ...input,
      canShare: false,
      overrides: { visibility: 'PUBLIC', password: true },
    })
    expect(selected.summary).toMatch(/^Private/)
    expect(selected.summary).not.toContain('Public')
    expect(selected.summary).not.toContain('password')
  })

  it.each([undefined, null, 'temporary'])(
    'never substitutes base public/no-expiry settings while loading %s',
    (value) => {
      const selected = ordinaryUploadSelection({ ...input, value, data: null })
      expect(selected.status).toBe('loading')
      expect(selected.effective).toBeNull()
      expect(selected.summary).not.toMatch(/Public|no expiry/)
      expect(selected.value).toBe(value)
    }
  )

  it('does not expose cached profile names/settings before an account is known', () => {
    const selected = ordinaryUploadSelection({ ...input, accountKnown: false })
    expect(selected.status).toBe('loading')
    expect(selected.profiles).toEqual([])
    expect(selected.defaultProfileName).toBeUndefined()
    expect(selected.summary).not.toContain('month')
  })

  it('keeps automatic limited-role defaults unknown instead of advertising cached profile settings', () => {
    const selected = ordinaryUploadSelection({
      ...input,
      canManageProfiles: false,
      canShare: false,
    })
    expect(selected.status).toBe('automatic')
    expect(selected.profiles).toEqual([])
    expect(selected.summary).toContain('Private.')
    expect(selected.summary).toContain('Saved defaults apply automatically')
    expect(selected.summary).not.toMatch(
      /Public|no expiry|month|random filenames/
    )
  })

  it('does not infer public visibility or expiry for a sharing-capable role that cannot read defaults', () => {
    const selected = ordinaryUploadSelection({
      ...input,
      canManageProfiles: false,
      canShare: true,
    })
    expect(selected.status).toBe('automatic')
    expect(selected.effective).toBeNull()
    expect(selected.profiles).toEqual([])
    expect(selected.summary).toContain(
      'full settings are unavailable for this role'
    )
    expect(selected.summary).not.toMatch(
      /Public|Private|no expiry|month|random filenames/
    )
  })

  it('keeps a failed read explicit even when older data exists', () => {
    const selected = ordinaryUploadSelection({
      ...input,
      error: 'Could not load upload profiles.',
    })
    expect(selected.status).toBe('error')
    expect(selected.effective).toBeNull()
    expect(selected.summary).toContain('could not be previewed')
    expect(selected.summary).not.toMatch(/Public|no expiry|month/)
  })

  it('does not silently replace an unavailable explicit profile with weaker account settings', () => {
    const selected = ordinaryUploadSelection({ ...input, value: 'removed' })
    expect(selected.status).toBe('unavailable')
    expect(selected.value).toBe('removed')
    expect(selected.effective).toBeNull()
    expect(selected.summary).toContain('no longer available')
    expect(selected.summary).not.toContain('Public')
  })
})
