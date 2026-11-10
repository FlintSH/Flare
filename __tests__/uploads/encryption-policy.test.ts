import { describe, expect, it } from 'vitest'

import type { AuthenticatedUser } from '@/lib/auth/api-auth'
import { DEFAULT_CONFIG } from '@/lib/config'
import { publicSettings } from '@/lib/config/views'
import { settingsPatchAllowed } from '@/lib/permissions/settings'
import {
  ACCEPTED_PROTOCOL_VERSIONS,
  UploadPolicyError,
  assertUploadEncryption,
  credentialPredatesEncryption,
  plainUploadsForbidden,
} from '@/lib/uploads/encryption-policy'
import {
  UPLOAD_DEFAULTS,
  mergeUploadOptions,
  uploadProfileInputSchema,
  uploadProfileOptionsSchema,
  uploadRequestOptionsSchema,
} from '@/lib/uploads/schema'

type Credentials = Pick<AuthenticatedUser, 'credential' | 'apiToken'>
const session: Credentials = { credential: 'session' }
const legacyToken: Credentials = { credential: 'upload-token' }
const namedToken = (predatesEncryption: boolean): Credentials => ({
  credential: 'token',
  apiToken: {
    id: 'token',
    scopes: ['files:upload'],
    profileId: 'profile',
    predatesEncryption,
  },
})
const forbidding = {
  ...DEFAULT_CONFIG,
  settings: {
    ...DEFAULT_CONFIG.settings,
    general: {
      ...DEFAULT_CONFIG.settings.general,
      encryption: { forbidPlainUploads: true },
    },
  },
}

function outcome(
  user: Credentials,
  encrypted: boolean,
  profileEncryption: 'encrypted' | 'plain',
  config = DEFAULT_CONFIG
) {
  try {
    assertUploadEncryption({ user, encrypted, profileEncryption, config })
    return 'accepted'
  } catch (error) {
    if (!(error instanceof UploadPolicyError)) throw error
    expect(error.status).toBe(403)
    expect(error.body).toEqual({ code: error.code })
    return error.code
  }
}

describe('which uploads the server takes (spec sections 11.1, 11.2 and 14.4)', () => {
  it('a token from after the upgrade must agree with its upload profile', () => {
    const token = namedToken(false)
    expect(outcome(token, true, 'encrypted')).toBe('accepted')
    expect(outcome(token, false, 'plain')).toBe('accepted')
    expect(outcome(token, true, 'plain')).toBe('profile_requires_plain')
    expect(outcome(token, false, 'encrypted')).toBe(
      'profile_requires_encrypted'
    )
  })

  it('a token from before the upgrade uploads plain files only, whatever its profile says', () => {
    for (const token of [legacyToken, namedToken(true)]) {
      expect(credentialPredatesEncryption(token)).toBe(true)
      expect(outcome(token, false, 'encrypted')).toBe('accepted')
      expect(outcome(token, false, 'plain')).toBe('accepted')
      expect(outcome(token, true, 'encrypted')).toBe(
        'token_predates_encryption'
      )
      expect(outcome(token, true, 'plain')).toBe('token_predates_encryption')
    }
    expect(credentialPredatesEncryption(namedToken(false))).toBe(false)
    expect(credentialPredatesEncryption(session)).toBe(false)
  })

  it('in the application the choice in the dialog wins over the profile', () => {
    for (const profile of ['encrypted', 'plain'] as const)
      for (const encrypted of [true, false])
        expect(outcome(session, encrypted, profile)).toBe('accepted')
  })

  it('refuses each plain upload when the administrator forbids them, also from an old token', () => {
    expect(plainUploadsForbidden(DEFAULT_CONFIG)).toBe(false)
    expect(plainUploadsForbidden(forbidding)).toBe(true)
    for (const user of [
      session,
      legacyToken,
      namedToken(true),
      namedToken(false),
    ])
      for (const profile of ['encrypted', 'plain'] as const)
        expect(outcome(user, false, profile, forbidding)).toBe(
          'plain_uploads_forbidden'
        )
    // Encrypted uploads go on.
    expect(outcome(session, true, 'encrypted', forbidding)).toBe('accepted')
    expect(outcome(namedToken(false), true, 'encrypted', forbidding)).toBe(
      'accepted'
    )
    // An old token cannot encrypt, so it has no upload left.
    expect(outcome(legacyToken, true, 'encrypted', forbidding)).toBe(
      'token_predates_encryption'
    )
  })

  it('reads settings saved before the switch existed as "plain uploads allowed"', () => {
    expect(plainUploadsForbidden({ settings: { general: {} } } as never)).toBe(
      false
    )
  })

  it('no message names a key, a token or a file', () => {
    for (const [user, encrypted, profile, config] of [
      [namedToken(false), true, 'plain', DEFAULT_CONFIG],
      [namedToken(false), false, 'encrypted', DEFAULT_CONFIG],
      [legacyToken, true, 'encrypted', DEFAULT_CONFIG],
      [session, false, 'plain', forbidding],
    ] as const) {
      try {
        assertUploadEncryption({
          user,
          encrypted,
          profileEncryption: profile,
          config,
        })
        throw new Error('accepted')
      } catch (error) {
        expect((error as Error).message).toMatch(/^[A-Z][^{}]+\.$/)
      }
    }
  })
})

describe('the instance setting', () => {
  it('is off by default, and settings.security changes it', () => {
    expect(DEFAULT_CONFIG.settings.general.encryption).toEqual({
      forbidPlainUploads: false,
    })
    const patch = { general: { encryption: { forbidPlainUploads: true } } }
    expect(
      settingsPatchAllowed({ permissions: ['settings.security'] }, patch)
    ).toBe(true)
    expect(
      settingsPatchAllowed({ permissions: ['settings.general'] }, patch)
    ).toBe(false)
  })

  it('has no switch that turns encryption off', () => {
    expect(Object.keys(DEFAULT_CONFIG.settings.general.encryption)).toEqual([
      'forbidPlainUploads',
    ])
  })

  it('the public settings tell a script client which protocol versions the server accepts', () => {
    expect(ACCEPTED_PROTOCOL_VERSIONS).toEqual([1])
    expect(publicSettings(DEFAULT_CONFIG).encryption).toEqual({
      protocolVersions: [1],
      forbidPlainUploads: false,
    })
    expect(publicSettings(forbidding).encryption.forbidPlainUploads).toBe(true)
  })
})

describe('the encryption setting of an upload profile', () => {
  it('is encrypted unless the profile says plain', () => {
    expect(UPLOAD_DEFAULTS.encryption).toBe('encrypted')
    expect(uploadProfileOptionsSchema.parse({})).toEqual({})
    expect(mergeUploadOptions({}, {}, {}).encryption).toBe('encrypted')
    expect(mergeUploadOptions({}, { encryption: 'plain' }, {}).encryption).toBe(
      'plain'
    )
  })

  it('is saved with a profile and refused with any other value', () => {
    expect(
      uploadProfileInputSchema.parse({
        name: 'Chat',
        options: { encryption: 'plain' },
      }).options
    ).toEqual({ encryption: 'plain' })
    expect(
      uploadProfileInputSchema.safeParse({
        name: 'Chat',
        options: { encryption: 'none' },
      }).success
    ).toBe(false)
  })

  it('cannot be set by an upload request: the request is encrypted or it is not', () => {
    expect(
      uploadRequestOptionsSchema.safeParse({ encryption: 'plain' }).success
    ).toBe(false)
    expect(
      mergeUploadOptions({}, { encryption: 'plain' }, { visibility: 'PRIVATE' })
        .encryption
    ).toBe('plain')
  })
})
