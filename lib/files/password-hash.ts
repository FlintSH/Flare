import { hash } from 'bcryptjs'

/**
 * The stored form of a file password: its bcrypt hash, or null for no
 * password. An empty password counts as none, so it removes an existing one.
 * Separate from `password-policy.ts`, which the browser bundles.
 */
export async function hashFilePassword(
  password: string | null | undefined
): Promise<string | null> {
  return password ? hash(password, 10) : null
}
