/**
 * What the Paste page notices about text before it is shared: a credential
 * that shouldn't be public, and a lone link that wants shortening. All of it
 * runs in the browser; the text goes nowhere until the paste is created.
 * Browser-safe.
 */

/** How much text is searched for credentials: more than any paste holds. */
const SCAN_LIMIT = 4 * 1024 * 1024

/**
 * Credential shapes and what to call them. Each pattern is a fixed prefix
 * and bounded character runs, so a long paste can't make one slow.
 */
const SECRETS: readonly [RegExp, string][] = [
  [
    /-----BEGIN (?:[A-Z]{1,12} ){0,3}PRIVATE KEY(?: BLOCK)?-----/,
    'a private key',
  ],
  [/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/, 'an AWS access key'],
  [/\bgh[pousr]_[A-Za-z0-9]{36,255}/, 'a GitHub token'],
  [/\bgithub_pat_[A-Za-z0-9_]{60,255}/, 'a GitHub token'],
  [/\bglpat-[A-Za-z0-9_-]{20,255}/, 'a GitLab token'],
  [/\bxox[abposr]-[A-Za-z0-9-]{10,255}/, 'a Slack token'],
  [/\b[rs]k_live_[A-Za-z0-9]{20,255}/, 'a Stripe secret key'],
  [/\bAIza[0-9A-Za-z_-]{35}(?![0-9A-Za-z_-])/, 'a Google API key'],
  [/\bsk-(?:proj-|ant-)?[A-Za-z0-9_-]{32,255}/, 'an API key'],
  [/\bfl[raf]_[A-Za-z0-9_-]{20,255}/, 'a Flare token'],
  [
    /\b[MN][A-Za-z0-9]{23,25}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{27,64}/,
    'a Discord token',
  ],
  [
    /\beyJ[A-Za-z0-9_-]{10,2048}\.eyJ[A-Za-z0-9_-]{10,4096}\.[A-Za-z0-9_-]{10,1024}/,
    'a sign-in token',
  ],
  [
    /\b[a-z][a-z0-9+.-]{1,20}:\/\/[^\s:/@]{1,128}:[^\s/@]{3,128}@/i,
    'a password in an address',
  ],
]

/**
 * `PASSWORD=…`, `"api_key": "…"`, `secret: …` at the start of a line, as in
 * `.env` files, JSON and YAML. Code such as `const token = getToken()` is not
 * at the start of its line and isn't matched.
 */
const ASSIGNMENT =
  /^[ \t]{0,32}(?:export[ \t]{1,8})?["']?[A-Za-z0-9_.-]{0,48}(?:password|passwd|pwd|secret|token|api[_-]?key|private[_-]?key|access[_-]?key|credentials?)["']?[ \t]{0,8}[:=][ \t]{0,8}["']?([^\s"'#,]{6,256})/gim

/** Values that stand for a secret rather than being one. */
const STAND_IN =
  /^(?:\$|\{|<|%|\*{3}|x{4}|\.{3}|process\.env|os\.environ|env\(|getenv|true$|false$|null$|none$|undefined$|changeme|example|placeholder|your[-_]|redacted|secret$|password$)/i

/**
 * What kind of credential the text seems to hold, in words for a sentence
 * ("a GitHub token"), or null. A hint, not a scanner: it only has to catch
 * the common slip of pasting a key into a public paste.
 */
export function findSecret(text: string): string | null {
  const sample = text.length > SCAN_LIMIT ? text.slice(0, SCAN_LIMIT) : text
  for (const [pattern, name] of SECRETS) if (pattern.test(sample)) return name
  for (const match of sample.matchAll(ASSIGNMENT)) {
    const value = match[1] ?? ''
    if (!STAND_IN.test(value)) return 'a password or secret'
  }
  return null
}

/** The address when the whole text is one web link, which Links shortens. */
export function loneLink(text: string): string | null {
  const value = text.trim()
  if (value.length > 4096 || !/^https?:\/\/\S+$/i.test(value)) return null
  try {
    new URL(value)
    return value
  } catch {
    return null
  }
}
