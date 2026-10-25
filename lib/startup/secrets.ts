// Example values from earlier versions of docker-compose.yml and .env.example.
// Anyone can sign session tokens with a published value.
const PUBLISHED_SECRETS = new Set(['your-secret-key-here'])

/**
 * Startup warnings for a weak NEXTAUTH_SECRET. These never stop startup:
 * refusing to boot would lock an upgraded instance out until its operator
 * reads the logs. NextAuth reports a missing secret itself.
 */
export function sessionSecretWarnings(secret: string | undefined): string[] {
  if (!secret) return []
  if (PUBLISHED_SECRETS.has(secret))
    return [
      'NEXTAUTH_SECRET is still the published example value from an earlier docker-compose.yml or .env.example, so anyone can sign session tokens for this instance. Generate a new value (for example with: openssl rand -hex 32) and recreate the container. Everyone has to sign in again once.',
    ]
  if (secret.length < 32)
    return [
      'NEXTAUTH_SECRET is shorter than 32 characters. Authenticator setup needs at least 32, and so do invite links, webhooks and saved SMTP passwords unless FLARE_EMAIL_ENCRYPTION_KEY is set. Set a stable random value of at least 32 characters.',
    ]
  return []
}
