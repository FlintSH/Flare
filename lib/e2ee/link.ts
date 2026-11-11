import { base64urlDecode, base64urlEncode } from './primitives'
import {
  type FileKey,
  type FolderPrivateKey,
  type LinkSecret,
  asFileKey,
  asFolderPrivateKey,
  asLinkSecret,
} from './types'

/**
 * The part of a share link after `#` (docs/e2ee-spec.md, section 10.3).
 *
 * A file without a password: `base64url(file_key)`.
 * A file with a password: `p.` and `base64url(link_secret)`.
 *
 * The base64url alphabet has no `.`, so the text before the first `.` is a
 * prefix. No prefix means a `file_key` of protocol version 1. A prefix that
 * this client does not know means a later version: the client must tell the
 * user to update and must not try other rules (section 1.5.2, rule 3).
 *
 * The browser does not send this part to the server. No function here
 * builds a path or a query.
 */
export type ShareSecret =
  | { readonly kind: 'file_key'; readonly fileKey: FileKey }
  | { readonly kind: 'link_secret'; readonly linkSecret: LinkSecret }

export type ParsedShareFragment =
  | ShareSecret
  /** The link has no part after `#`. It cannot open an encrypted file. */
  | { readonly kind: 'missing' }
  /** A prefix of a later protocol version. Tell the user to update. */
  | { readonly kind: 'unknown_version' }
  /** Not 32 bytes of base64url. The link was cut or changed. */
  | { readonly kind: 'malformed' }

/** The prefix of a link that carries a `link_secret`. */
export const PASSWORD_LINK_PREFIX = 'p'

/** 32 bytes in base64url without padding: 43 characters. */
const SECRET_TEXT = /^[A-Za-z0-9_-]{43}$/

function secretBytes(text: string): Uint8Array | null {
  if (!SECRET_TEXT.test(text)) return null
  try {
    const bytes = base64urlDecode(text)
    return bytes.length === 32 ? bytes : null
  } catch {
    return null
  }
}

/** The text after `#`, without the `#`. */
export function shareFragment(secret: ShareSecret): string {
  return secret.kind === 'file_key'
    ? base64urlEncode(asFileKey(secret.fileKey))
    : `${PASSWORD_LINK_PREFIX}.${base64urlEncode(asLinkSecret(secret.linkSecret))}`
}

/** Reads the text after `#`. A leading `#` is accepted. Never throws. */
export function parseShareFragment(fragment: string): ParsedShareFragment {
  const text = fragment.startsWith('#') ? fragment.slice(1) : fragment
  if (!text) return { kind: 'missing' }
  const dot = text.indexOf('.')
  if (dot === -1) {
    const fileKey = secretBytes(text)
    return fileKey
      ? { kind: 'file_key', fileKey: fileKey as FileKey }
      : { kind: 'malformed' }
  }
  if (text.slice(0, dot) !== PASSWORD_LINK_PREFIX)
    return { kind: 'unknown_version' }
  const linkSecret = secretBytes(text.slice(dot + 1))
  return linkSecret
    ? { kind: 'link_secret', linkSecret: linkSecret as LinkSecret }
    : { kind: 'malformed' }
}

/**
 * The path and query of an address, for use on the origin of the page
 * itself. A client puts a key only into an address of its own origin: the
 * script of another origin would read the part after `#`. An address from
 * the server is data that a compromised server controls, so the client
 * keeps its path and drops its origin (section 10.3).
 */
export function ownOriginPath(address: string, origin: string): string {
  let url: URL
  try {
    url = new URL(address, origin)
  } catch {
    return '/'
  }
  // A path that starts with `//` would name another host when it is used
  // as a relative address.
  const path = `/${url.pathname.replace(/^\/+/, '')}`
  return `${path}${url.search}`
}

/**
 * `{page address}#{fragment}`. `pageUrl` is an address of this origin (see
 * `ownOriginPath`). A fragment it already has is replaced.
 */
export function shareLink(pageUrl: string, secret: ShareSecret): string {
  const hash = pageUrl.indexOf('#')
  return `${hash === -1 ? pageUrl : pageUrl.slice(0, hash)}#${shareFragment(secret)}`
}

/**
 * Whether the part after `#` of an address has the form of a Flare key: a
 * `file_key`, a `link_secret`, or a secret behind a prefix of a later
 * version. A client must not send such an address to a server, for example
 * as the target of a short link (section 12.6).
 */
export function fragmentCarriesShareSecret(address: string): boolean {
  const hash = address.indexOf('#')
  if (hash === -1) return false
  const text = address.slice(hash + 1)
  const parsed = parseShareFragment(text)
  if (parsed.kind === 'file_key' || parsed.kind === 'link_secret') return true
  if (parsed.kind !== 'unknown_version') return false
  return SECRET_TEXT.test(text.slice(text.indexOf('.') + 1))
}

// --- Shared folder link (section 9.4.3) ---

/**
 * The part of a shared folder link after `#`: `base64url(folder_private_key)`.
 * The key is 32 bytes as they are, without clamping (section 4.4, rule 3b).
 * As for a file link, text before a `.` is the prefix of a later protocol
 * version, which this client does not try to read.
 */
export type ParsedFolderFragment =
  | { readonly kind: 'folder_key'; readonly folderPrivateKey: FolderPrivateKey }
  /** The link has no part after `#`. It opens no folder that has keys. */
  | { readonly kind: 'missing' }
  | { readonly kind: 'unknown_version' }
  | { readonly kind: 'malformed' }

/** The text after `#`, without the `#`. */
export function folderShareFragment(
  folderPrivateKey: FolderPrivateKey
): string {
  return base64urlEncode(asFolderPrivateKey(folderPrivateKey))
}

/** Reads the text after `#`. A leading `#` is accepted. Never throws. */
export function parseFolderFragment(fragment: string): ParsedFolderFragment {
  const text = fragment.startsWith('#') ? fragment.slice(1) : fragment
  if (!text) return { kind: 'missing' }
  if (text.includes('.')) return { kind: 'unknown_version' }
  const key = secretBytes(text)
  return key
    ? { kind: 'folder_key', folderPrivateKey: key as FolderPrivateKey }
    : { kind: 'malformed' }
}

/** `{page address}#{folder_private_key}`. A fragment the address already has is replaced. */
export function folderShareLink(
  pageUrl: string,
  folderPrivateKey: FolderPrivateKey
): string {
  const hash = pageUrl.indexOf('#')
  return `${hash === -1 ? pageUrl : pageUrl.slice(0, hash)}#${folderShareFragment(folderPrivateKey)}`
}
