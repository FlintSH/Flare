// The numbers and names of agent sign-in. Import nothing here: the pages that
// resume a sign-in read the cookie name and the path in the browser.

/** An access token from a sign-in. Accepted on the MCP endpoint only. */
export const ACCESS_TOKEN_PREFIX = 'fla_'
/** A refresh token, used once and then replaced. */
export const REFRESH_TOKEN_PREFIX = 'flf_'
/** A registered client's `client_id`. */
export const CLIENT_ID_PREFIX = 'flc_'

export const CODE_SECONDS = 60
export const ACCESS_TOKEN_SECONDS = 60 * 60
/** A refresh token nobody used for this long expires, and its connection with it. */
export const REFRESH_TOKEN_DAYS = 90
/**
 * How long a refresh token that was already used may be used again: a
 * response that never arrived, or two windows sharing one stored token.
 */
export const ROTATION_LEEWAY_SECONDS = 60
/** The token pairs one refresh token may be exchanged for within the leeway. */
export const MAX_SUCCESSORS = 5
/**
 * Once a connection was issued this many token pairs within an hour, its
 * first included, a refresh token that was not used before is refused until
 * there is room. A pair is kept until its refresh token expires, so this
 * bounds what a client that refreshes in a loop can leave behind. A client
 * that refreshes when its access token runs out needs one an hour. A retry
 * inside the leeway is not refused for it; `MAX_SUCCESSORS` bounds those.
 */
export const PAIRS_PER_HOUR = 30
/** How long a sign-in waits for the person: the cookie and the consent request. */
export const PENDING_SECONDS = 10 * 60

/** Agents one account may have signed in at once. */
export const MAX_CONNECTIONS = 50

export const REGISTRATIONS_PER_HOUR = 10
export const REGISTRATION_BODY_BYTES = 8 * 1024
export const MAX_REDIRECT_URIS = 10
export const MAX_REDIRECT_URI_LENGTH = 512
export const MAX_CLIENT_NAME_LENGTH = 80
/** A registration nobody approved is removed after this long. */
export const UNUSED_CLIENT_HOURS = 24
/** Beyond this many unapproved registrations the oldest are removed. */
export const MAX_UNUSED_CLIENTS = 500

/** The longest authorize query, which is also what the cookie must hold. */
export const MAX_AUTHORIZE_QUERY = 4096
export const MAX_STATE_LENGTH = 512

/** Holds the authorize query while the person signs in. Not readable by scripts. */
export const REQUEST_COOKIE = 'flare_oauth_request'
/** Says only that a sign-in is waiting, so a page can resume it. */
export const PENDING_COOKIE = 'flare_oauth_pending'

export const AUTHORIZE_PATH = '/api/oauth/authorize'
/** Where a signed-in browser goes to continue a waiting sign-in. */
export const RESUME_PATH = '/api/oauth/authorize/resume'
export const CONSENT_PATH = '/auth/connect'

/** Sign-in events sit beside the sign-ins of people in the audit log. */
export const AUDIT_CATEGORY = 'authentication'
