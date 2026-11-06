// Import nothing here except types. docs/site/scripts/check-coverage.mjs strips
// the types and imports this module as a data: URL, where no other module can
// be resolved, to require every override in the configuration reference.

type Settings = Record<string, unknown>

// The verification policy transition records these, so an operator can't
// override them.
const SERVER_OWNED = [
  'verification.requiredSince',
  'verification.graceEndsAt',
  'verification.appliedMode',
]

/** `smtp.timeoutSeconds` is overridden by `FLARE_EMAIL_SMTP_TIMEOUT_SECONDS`. */
export function emailEnvironmentName(path: string): string {
  return `FLARE_EMAIL_${path
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/\./g, '_')
    .toUpperCase()}`
}

function leafEntries(value: Settings, prefix = ''): [string, unknown][] {
  return Object.entries(value).flatMap(([key, entry]) => {
    const path = prefix ? `${prefix}.${key}` : key
    return entry !== null && typeof entry === 'object'
      ? leafEntries(entry as Settings, path)
      : [[path, entry] as [string, unknown]]
  })
}

/** Every email setting an operator can override, with its value in `config`. */
export function emailOverrides(
  config: Settings
): { path: string; name: string; value: unknown }[] {
  return leafEntries(config)
    .filter(([path]) => !SERVER_OWNED.includes(path))
    .map(([path, value]) => ({ path, name: emailEnvironmentName(path), value }))
}
