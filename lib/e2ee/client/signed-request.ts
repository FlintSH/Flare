import { signRequest } from '../account'
import { base64urlEncode, utf8 } from '../primitives'
import type { AccountPrivateKey } from '../types'
import { challengeFromWire } from './wire'

/** The request headers of a signed request, as `lib/auth/e2ee/signed-request.ts` reads them. */
export const SIGNED_REQUEST_CHALLENGE_HEADER = 'X-Flare-E2EE-Challenge'
export const SIGNED_REQUEST_SIGNATURE_HEADER = 'X-Flare-E2EE-Signature'

export interface SignedRequest {
  method: string
  /** `pathname + search`, as the browser sends it. */
  path: string
  /** The exact text that is sent and signed. */
  body: string
  headers: Record<string, string>
}

/**
 * A signed request (docs/e2ee-spec.md, section 6.6). The body is serialized
 * one time here: the signature covers these bytes, so the caller must send
 * `body` as it is and must not serialize the JSON a second time.
 *
 * `path` must be the path and the query that the browser puts in the request
 * line. A relative URL without characters that `fetch` would percent-encode
 * has that form already.
 */
export function buildSignedRequest(input: {
  accountPrivateKey: AccountPrivateKey
  /** The challenge in base64url, as the server returned it. */
  challenge: string
  method: string
  path: string
  body: unknown
}): SignedRequest {
  const body = JSON.stringify(input.body)
  const method = input.method.toUpperCase()
  const { signature } = signRequest({
    accountPrivateKey: input.accountPrivateKey,
    challenge: challengeFromWire(input.challenge),
    method,
    path: input.path,
    body: utf8(body),
  })
  return {
    method,
    path: input.path,
    body,
    headers: {
      'Content-Type': 'application/json',
      [SIGNED_REQUEST_CHALLENGE_HEADER]: input.challenge,
      [SIGNED_REQUEST_SIGNATURE_HEADER]: base64urlEncode(signature),
    },
  }
}
