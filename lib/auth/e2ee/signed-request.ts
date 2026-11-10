import type { z } from 'zod'

import { SecurityError } from '@/lib/auth/security/shared'
import { prisma } from '@/lib/database/prisma'
import {
  type Challenge,
  base64urlDecode,
  isSignedRequestMethod,
  verifySignedRequest,
} from '@/lib/e2ee'
import { HttpError } from '@/lib/http/errors'
import { parseInput, readJsonBytes } from '@/lib/http/request'

import { type E2eeChallengePurpose, consumeE2eeChallenge } from './challenges'
import { asAccountPublicKey } from './records'

/** The request headers of a signed request (docs/e2ee-spec.md, section 6.6, step 4). */
export const SIGNED_REQUEST_CHALLENGE_HEADER = 'x-flare-e2ee-challenge'
export const SIGNED_REQUEST_SIGNATURE_HEADER = 'x-flare-e2ee-signature'

const REFUSAL =
  'The request signature is not valid, or its challenge expired or was already used. Start again.'

function headerBytes(request: Request, name: string, length: number) {
  const text = request.headers.get(name)
  if (text === null)
    throw new HttpError(400, 'This request needs an account key signature.')
  try {
    const bytes = base64urlDecode(text)
    if (bytes.length === length) return bytes
  } catch {
    /* Answered below. */
  }
  throw new HttpError(400, `Invalid ${name} header.`)
}

/**
 * Reads a signed request (section 6.6): the challenge and the signature from
 * their headers, and the JSON body one time, as the bytes that the signature
 * covers.
 *
 * `verify` deletes the challenge and checks the signature with the
 * `account_public_key` of the account. It throws unless the signature is
 * valid. Some routes learn the account from the body, so `verify` is a
 * separate step, but no route may act on the body before it.
 *
 * `method` and `path` (section 4.4, rule 8) are the ones of the request that
 * this process received: the method as it is, and the path and the query of
 * `request.url` in their percent-encoded form. Next.js builds `request.url`
 * from the request line and does not decode it. Flare has no `basePath` and
 * its proxy file does not run for `/api`, so nothing in the application
 * changes the path. A browser signs `pathname + search` of the URL that it
 * fetches, which is the same text.
 *
 * A reverse proxy must pass the path to Flare as the client sent it. A proxy
 * that adds or removes a path prefix, or that decodes and encodes the path
 * again, makes the two sides sign different text, and every signed request
 * then fails closed. The server does not read a forwarded-prefix header: a
 * client could set one, and a path that the client controls must not be part
 * of what the server verifies.
 */
export async function readSignedRequest(
  request: Request,
  options: { limit?: number } = {}
) {
  const challenge = headerBytes(request, SIGNED_REQUEST_CHALLENGE_HEADER, 32)
  const signature = headerBytes(request, SIGNED_REQUEST_SIGNATURE_HEADER, 64)
  const { bytes, value } = await readJsonBytes(request, options)
  const url = new URL(request.url)
  const method = request.method
  const path = url.pathname + url.search
  return {
    /** The body as `schema` reads it. Not authenticated until `verify` returns. */
    body<Schema extends z.ZodType>(schema: Schema): z.output<Schema> {
      return parseInput(schema, value)
    },
    async verify(
      purpose: E2eeChallengePurpose,
      account: {
        id: string
        accountPublicKey: Uint8Array | null
        sessionVersion?: number
      } | null,
      db: Parameters<typeof consumeE2eeChallenge>[3] = prisma
    ): Promise<void> {
      const fresh = await consumeE2eeChallenge(
        challenge as Challenge,
        purpose,
        account && {
          userId: account.id,
          sessionVersion: account.sessionVersion,
        },
        db
      )
      if (
        !fresh ||
        !account?.accountPublicKey ||
        !isSignedRequestMethod(method) ||
        !verifySignedRequest({
          accountPublicKey: asAccountPublicKey(account.accountPublicKey),
          challenge: challenge as Challenge,
          method,
          path,
          body: bytes,
          signature,
        })
      )
        throw new SecurityError(REFUSAL)
    },
  }
}
