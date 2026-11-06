import type { ProfileResponse, UpdateProfileSchema } from '@/types/dto/profile'
import type { z } from 'zod'

const UNEXPLAINED = 'Unable to complete this request. Please try again.'

/**
 * The server refused a request, or answered with something other than JSON;
 * the message is its reason, or the caller's fallback.
 */
export class RefusedRequest extends Error {}

/** The error for a response with an error status. */
export async function refusal(response: Response, fallback = UNEXPLAINED) {
  const body: unknown = await response.json().catch(() => null)
  return new RefusedRequest(
    (typeof body === 'object' &&
      body !== null &&
      'error' in body &&
      typeof body.error === 'string' &&
      body.error) ||
      fallback
  )
}

interface AnswerOptions {
  signal?: AbortSignal
  /** The message for a refusal that gives no reason. */
  fallback?: string
}

/**
 * The answer from one of Flare's account endpoints: its `data`, the whole
 * answer from endpoints without that envelope, or `{}` for an empty one. An
 * error status or an answer that isn't JSON rejects with a `RefusedRequest`.
 * Once `signal` aborts it rejects even if the answer has arrived, so an
 * abandoned action never goes on.
 */
export async function readAnswer<T>(
  response: Response,
  { signal, fallback = UNEXPLAINED }: AnswerOptions = {}
): Promise<T> {
  if (!response.ok) throw await refusal(response, fallback)
  const text = await response.text()
  signal?.throwIfAborted()
  if (!text) return {} as T
  try {
    const answer = JSON.parse(text)
    return (answer.data ?? answer) as T
  } catch {
    throw new RefusedRequest(fallback)
  }
}

export interface AccountRequestOptions extends AnswerOptions {
  /** Defaults to POST with a body and GET without one. */
  method?: string
  /** Sent as JSON. */
  body?: unknown
}

/** A JSON request to one of Flare's account endpoints, answered as `readAnswer` reads it. */
export async function accountRequest<T>(
  path: string,
  { method, body, signal, fallback }: AccountRequestOptions = {}
): Promise<T> {
  const response = await fetch(path, {
    method: method ?? (body === undefined ? 'GET' : 'POST'),
    signal,
    cache: 'no-store',
    headers:
      body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return readAnswer<T>(response, { signal, fallback })
}

/** The fields `PUT /api/profile` accepts. */
export type ProfilePatch = z.input<typeof UpdateProfileSchema>

/** Saves the given fields of your own account and returns the saved profile. */
export function updateProfile(patch: ProfilePatch, fallback?: string) {
  return accountRequest<ProfileResponse>('/api/profile', {
    method: 'PUT',
    body: patch,
    fallback,
  })
}
