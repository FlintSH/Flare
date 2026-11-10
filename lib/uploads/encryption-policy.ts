import type { AuthenticatedUser } from '@/lib/auth/api-auth'
import type { FlareConfig } from '@/lib/config'
import { PROTOCOL_VERSION } from '@/lib/e2ee/contexts'
import { HttpError } from '@/lib/http/errors'

import type { UploadEncryption } from './schema'

/**
 * Which uploads the server takes as encrypted and which as plain
 * (docs/e2ee-spec.md, sections 11.1, 11.2 and 14.4). The server cannot
 * encrypt, so it only refuses the upload that a setting does not allow.
 */

/**
 * The protocol versions this server accepts from a script client (section
 * 1.5.3, rule 5). The public settings send the list, and a client checks it
 * before it uploads.
 */
export const ACCEPTED_PROTOCOL_VERSIONS: readonly number[] = [PROTOCOL_VERSION]

/**
 * The `code` of an error body that a script client acts on.
 * `clients/flare-upload/SERVER-CONTRACT.md` lists what each one means.
 */
export const UPLOAD_ERROR_CODES = {
  accountKeyNotCurrent: 'account_key_not_current',
  accountKeysMissing: 'account_keys_missing',
  profileRequiresEncrypted: 'profile_requires_encrypted',
  profileRequiresPlain: 'profile_requires_plain',
  plainUploadsForbidden: 'plain_uploads_forbidden',
  tokenPredatesEncryption: 'token_predates_encryption',
  protocolVersionNotAccepted: 'protocol_version_not_accepted',
} as const

export type UploadErrorCode =
  (typeof UPLOAD_ERROR_CODES)[keyof typeof UPLOAD_ERROR_CODES]

/** An upload that a setting refuses. The body carries a machine-readable `code`. */
export class UploadPolicyError extends HttpError {
  constructor(
    message: string,
    readonly code: UploadErrorCode
  ) {
    super(403, message, { body: { code } })
    this.name = 'UploadPolicyError'
  }
}

/** Whether the administrator forbids plain uploads for the instance (section 11.1). */
export function plainUploadsForbidden(config: {
  settings: {
    general: { encryption?: FlareConfig['settings']['general']['encryption'] }
  }
}) {
  // Settings that were saved before this one existed read as "allowed".
  return config.settings.general.encryption?.forbidPlainUploads === true
}

/**
 * Whether the credential is from before end-to-end encryption: the account
 * upload token, or a named token that the migration marked. A tool that
 * holds one cannot encrypt (section 14.4).
 */
export function credentialPredatesEncryption(
  user: Pick<AuthenticatedUser, 'credential' | 'apiToken'>
) {
  return (
    user.credential === 'upload-token' ||
    Boolean(user.apiToken?.predatesEncryption)
  )
}

/**
 * Refuses the upload that the settings do not allow.
 *
 * - If plain uploads are forbidden, each plain upload is refused, whatever
 *   sent it.
 * - A token from before encryption sends plain files only. Its profile does
 *   not decide.
 * - A token from after it must agree with the `encryption` setting of its
 *   upload profile. An upload without a profile takes the default,
 *   `encrypted`: a plain upload from a token needs a profile that says so.
 * - In the application the choice in the upload dialog is explicit and
 *   wins. The profile only sets what the dialog shows first.
 */
export function assertUploadEncryption({
  user,
  encrypted,
  profileEncryption,
  config,
}: {
  user: Pick<AuthenticatedUser, 'credential' | 'apiToken'>
  /** Whether the request is an encrypted upload. */
  encrypted: boolean
  /** The `encryption` setting of the profile that the upload resolved to. */
  profileEncryption: UploadEncryption
  config: Parameters<typeof plainUploadsForbidden>[0]
}) {
  if (!encrypted && plainUploadsForbidden(config))
    throw new UploadPolicyError(
      'This server accepts encrypted uploads only. Its administrator turned plain uploads off.',
      UPLOAD_ERROR_CODES.plainUploadsForbidden
    )
  if (user.credential === 'session') return
  if (credentialPredatesEncryption(user)) {
    if (encrypted)
      throw new UploadPolicyError(
        'This token is from before encryption and uploads plain files only. Create a new configuration in Profile, Upload tools.',
        UPLOAD_ERROR_CODES.tokenPredatesEncryption
      )
    return
  }
  if (encrypted && profileEncryption === 'plain')
    throw new UploadPolicyError(
      'This upload profile takes plain uploads, and this upload is encrypted. Use a configuration made for this profile, or set the profile to Encrypted.',
      UPLOAD_ERROR_CODES.profileRequiresPlain
    )
  if (!encrypted && profileEncryption === 'encrypted')
    throw new UploadPolicyError(
      'This upload profile takes encrypted uploads, and this upload is not encrypted. Upload with flare-upload, or use a token whose upload profile is set to Plain.',
      UPLOAD_ERROR_CODES.profileRequiresEncrypted
    )
}
