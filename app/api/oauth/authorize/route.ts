import { getServerSession } from 'next-auth'

import { setAuditTarget } from '@/lib/audit'
import { authOptions } from '@/lib/auth'
import { SIGN_IN_PATH } from '@/lib/auth/sign-in'
import { requireSession } from '@/lib/http/access'
import { readJson } from '@/lib/http/request'
import { routes } from '@/lib/http/route'
import {
  TOO_LONG,
  consentDecision,
  decideConsent,
  errorPage,
  signConsentRequest,
  validateAuthorize,
} from '@/lib/oauth/authorize'
import {
  AUDIT_CATEGORY,
  CONSENT_PATH,
  MAX_AUTHORIZE_QUERY,
} from '@/lib/oauth/constants'
import {
  clearedCookies,
  fitsCookie,
  hasPendingCookies,
  pendingCookies,
  storedQuery,
} from '@/lib/oauth/cookies'
import { browserRoutes, redirectTo, whileOn } from '@/lib/oauth/http'
import { issuer } from '@/lib/oauth/urls'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Where an account that must confirm its email address is sent, as every page sends it. */
const VERIFY_EMAIL_PATH = '/auth/verify-email'

const pages = routes('/api/oauth/authorize', {
  ...browserRoutes,
  audit: { action: 'oauth.authorize', category: AUDIT_CATEGORY },
})

/**
 * Where a client sends the person's browser to sign in. The request is
 * checked first, and anything wrong with it is said on a page: nothing here
 * ever redirects to a client's address. The ways out are three of Flare's
 * own pages: the login page, the email confirmation page, and the consent
 * screen. Only the consent decision below, made by a signed-in person, sends
 * a browser back to the client.
 */
export const GET = whileOn(
  pages(async (request) => {
    const url = new URL(request.url)
    // The query without its question mark.
    if (url.search.length - 1 > MAX_AUTHORIZE_QUERY)
      return errorPage(TOO_LONG.page)
    const checked = await validateAuthorize(url.searchParams, request)
    if ('page' in checked) return errorPage(checked.page)
    setAuditTarget({
      type: 'oauth_client',
      id: checked.client.id,
      name: checked.client.name,
    })
    const secure = issuer(request).startsWith('https:')
    const user = (await getServerSession(authOptions))?.user
    if (user && !user.emailAccessRequired)
      return redirectTo(
        `${CONSENT_PATH}?request=${encodeURIComponent(signConsentRequest(checked, user.id))}`,
        // Cookies left by an earlier attempt would resume it later.
        hasPendingCookies(request) ? clearedCookies(secure) : []
      )
    // Signed out, or signed in but still to confirm an email address: the
    // request waits in a cookie and is checked again from scratch afterwards.
    const stored = storedQuery(url.searchParams)
    if (!fitsCookie(stored)) return errorPage(TOO_LONG.page)
    return redirectTo(
      user ? VERIFY_EMAIL_PATH : SIGN_IN_PATH,
      pendingCookies(stored, secure)
    )
  })
)

/**
 * The person's answer on the consent screen. Only Flare's own pages may send
 * it: it needs the session cookie, the same origin and a JSON body, none of
 * which a form on another site can supply. It answers where to send the
 * browser, which is always the client's registered redirect address: with a
 * code when the person approved, with `access_denied` when they cancelled.
 */
export const POST = whileOn(
  pages(async (request) => {
    // The account's row is read as well: the session must be of the version
    // the account is on now, and that version goes with the decision, which
    // checks it again under the account's lock before any code exists.
    const { user, account } = await requireSession(request, undefined, {
      fresh: true,
    })
    const decision = await readJson(request, consentDecision, {
      limit: 16 * 1024,
    })
    return decideConsent(
      {
        id: user.id,
        permissions: user.permissions,
        sessionVersion: account.sessionVersion,
      },
      decision,
      request
    )
  })
)
