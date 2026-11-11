import { E2eeError } from './errors'

/**
 * Every context string of protocol version 1, exactly as the specification
 * writes it. No other file may contain a context string literal.
 *
 * All contexts are ASCII and have no terminator (section 2.2). Most are the
 * `context` of `blake3_derive_key`. `signIn`, `unlock` and `request` are the
 * prefixes of signed messages instead (sections 6.2, 6.3 and 6.6).
 */
export const CONTEXTS = {
  /** Section 4.2 */
  sealCipher: 'flare e2ee v1 seal cipher',
  /** Section 4.2 */
  sealMac: 'flare e2ee v1 seal mac',
  /** Section 4.2.1 */
  oneTimeNonce: 'flare e2ee v1 one-time nonce',
  /** Section 5.1 */
  accountSeed: 'flare e2ee v1 account seed',
  /** Section 5.1 */
  auth: 'flare e2ee v1 auth',
  /** Section 5.1 */
  wrap: 'flare e2ee v1 wrap',
  /** Section 6.2. Prefix of the signed message, not a derivation context. */
  signIn: 'flare e2ee v1 sign-in',
  /** Section 6.3. Prefix of the signed message, not a derivation context. */
  unlock: 'flare e2ee v1 unlock',
  /** Section 6.6. Prefix of the signed message, not a derivation context. */
  request: 'flare e2ee v1 request',
  /** Section 7.1 */
  contentCipher: 'flare e2ee v1 content cipher',
  /** Section 7.1 */
  contentMac: 'flare e2ee v1 content mac',
  /** Section 7.1 */
  fileMetadata: 'flare e2ee v1 file metadata',
  /** Section 8.1 */
  accountStanza: 'flare e2ee v1 account stanza',
  /** Section 8.2 */
  passwordStanza: 'flare e2ee v1 password stanza',
  /** Section 8.2 */
  linkSecretCopy: 'flare e2ee v1 link secret copy',
  /** Section 8.3.3 */
  keyring: 'flare e2ee v1 keyring',
  /** Section 8.4.2 */
  folderMetadata: 'flare e2ee v1 folder metadata',
  /** Section 8.4.2 */
  folderOwner: 'flare e2ee v1 folder owner',
  /** Section 8.4.2 */
  parentFolderStanza: 'flare e2ee v1 parent folder stanza',
  /** Section 8.4.3 */
  folderFileStanza: 'flare e2ee v1 folder file stanza',
  /** Section 8.4.3 */
  folderLinkSecretStanza: 'flare e2ee v1 folder link secret stanza',
  /** Section 9.5.1 */
  tagMetadata: 'flare e2ee v1 tag metadata',
  /** Section 9.6.1 */
  ocrText: 'flare e2ee v1 ocr text',
  /** Section 12.1 */
  thumbnail: 'flare e2ee v1 thumbnail',
} as const

export type ContextName = keyof typeof CONTEXTS
export type Context = (typeof CONTEXTS)[ContextName]

/** The protocol version that this library writes (section 1.5). */
export const PROTOCOL_VERSION = 1

/**
 * Section 1.5.2, rule 3, for the `protocol_version` that the server returns
 * with the salt (section 6.1) or that an account record carries. A version
 * that this client does not know stops with `unknown_version`. The client
 * must tell the user to update, and must not try a different version.
 */
export function assertSupportedProtocolVersion(
  protocolVersion: unknown
): asserts protocolVersion is typeof PROTOCOL_VERSION {
  if (protocolVersion !== PROTOCOL_VERSION) {
    throw new E2eeError(
      'unknown_version',
      'Unknown protocol_version. Update the client.'
    )
  }
}
