/**
 * The Content-Security-Policy of every page (docs/e2ee-spec.md, section 13,
 * requirement 1). The browser holds account keys and file keys, so the
 * policy lets script and WebAssembly come only from the application:
 *
 * - A script runs only if it carries the nonce of this response.
 *   `'strict-dynamic'` lets such a script load the application's own chunks.
 *   Next.js puts the nonce on its scripts, and Flare puts it on each script
 *   of the "Custom head" setting (section 13.1). Every other inline script,
 *   an injected one included, is blocked.
 * - `'wasm-unsafe-eval'` compiles the Argon2id module. It does not permit
 *   `eval` of text.
 * - No plug-ins, and no `<base>` that points the page's addresses elsewhere.
 *
 * Images, media, fonts, styles and connections stay open to other sites,
 * because administrators load those from storage, a CDN or the "Custom
 * head" setting, and none of them can run script. `blob:` and `data:` are
 * where the viewers of decrypted files put their content.
 *
 * Pure, and safe for the proxy: no Node.js imports.
 */
export const NONCE_HEADER = 'x-nonce'
export const CSP_HEADER = 'Content-Security-Policy'

const REMOTE = 'https: http:'

export function contentSecurityPolicy(
  nonce: string,
  { development = false }: { development?: boolean } = {}
): string {
  if (!/^[A-Za-z0-9+/_-]{16,}={0,2}$/.test(nonce))
    throw new Error('A nonce is base64 text of at least 16 characters')
  return [
    `default-src 'self'`,
    // React needs `eval` only in development, to rebuild server error
    // stacks. Production never gets it.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' 'wasm-unsafe-eval'${development ? " 'unsafe-eval'" : ''}`,
    `style-src 'self' 'unsafe-inline' ${REMOTE}`,
    `img-src 'self' data: blob: ${REMOTE}`,
    `media-src 'self' blob: ${REMOTE}`,
    `font-src 'self' data: ${REMOTE}`,
    `connect-src 'self' ${REMOTE} ws: wss:`,
    `frame-src 'self' blob:`,
    `worker-src 'self' blob:`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `frame-ancestors 'self'`,
  ].join('; ')
}

/** 128 random bits, base64. A new one for every response. */
export function newNonce(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}
