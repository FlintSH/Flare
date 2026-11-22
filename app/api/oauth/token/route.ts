import { routes } from '@/lib/http/route'
import { AUDIT_CATEGORY } from '@/lib/oauth/constants'
import {
  OAuthError,
  POST_HEADERS,
  clientRoutes,
  openPreflight,
  readOAuthForm,
  whileOn,
} from '@/lib/oauth/http'
import { exchangeCode, refreshTokens } from '@/lib/oauth/tokens'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const api = routes('/api/oauth/token', clientRoutes)

/** The request's form, or what reading it threw, for the handler to raise. */
type Form = { fields: URLSearchParams } | { error: unknown }

async function grant(request: Request, form: Form) {
  if ('error' in form) throw form.error
  switch (form.fields.get('grant_type')) {
    case 'authorization_code':
      return exchangeCode(form.fields, request)
    case 'refresh_token':
      return refreshTokens(form.fields, request)
    default:
      throw new OAuthError(
        'unsupported_grant_type',
        'grant_type must be authorization_code or refresh_token.'
      )
  }
}

const audit = { action: 'oauth.token', category: AUDIT_CATEGORY }
const exchange = api(grant, { audit })
// A connection refreshes about once an hour for as long as it is used. Only
// a refresh that is refused is worth a line in the log.
const refresh = api(grant, { audit: { ...audit, skipSuccess: true } })

/**
 * RFC 6749: an authorization code or a refresh token in, a token pair out.
 * Clients are public, so there is no client secret to check, and no cookie
 * is read.
 */
export const POST = whileOn(async (request: Request) => {
  // Read here, because the grant decides how the request is recorded.
  const form: Form = await readOAuthForm(request).then(
    (fields) => ({ fields }),
    (error: unknown) => ({ error })
  )
  const refreshing =
    'fields' in form && form.fields.get('grant_type') === 'refresh_token'
  return (refreshing ? refresh : exchange)(request, form)
})

export const OPTIONS = openPreflight('POST, OPTIONS', POST_HEADERS)
