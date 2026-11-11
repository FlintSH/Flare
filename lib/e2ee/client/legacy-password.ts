/**
 * Hands the password of a legacy sign-in to the key setup page, which offers
 * to keep it as the passphrase if it is strong enough (docs/e2ee-spec.md,
 * section 14.1, step 3).
 *
 * The value lives in the memory of this page only: no storage, no URL. It is
 * given out one time and dropped after five minutes, which is how long the
 * server accepts key setup after a sign-in.
 */
const LIFETIME_MS = 5 * 60_000

let held: { password: string; timer: ReturnType<typeof setTimeout> } | null =
  null

export function offerLegacyPassword(password: string): void {
  dropLegacyPassword()
  held = { password, timer: setTimeout(dropLegacyPassword, LIFETIME_MS) }
}

export function takeLegacyPassword(): string | null {
  const password = held?.password ?? null
  dropLegacyPassword()
  return password
}

export function dropLegacyPassword(): void {
  if (held) clearTimeout(held.timer)
  held = null
}
