import { LOCAL_SIGN_IN_PATH } from '@/lib/auth/sign-in'

export const SETUP_PATH = '/setup'

/**
 * Setup pages need no session: before setup there is no account to sign in
 * with, and afterwards the setup page checks for an administrator itself.
 */
export function isSetupPath(pathname: string) {
  return pathname.startsWith(SETUP_PATH)
}

/** Setup's steps in order. Submitting the access step creates the instance. */
export const SETUP_STEPS = [
  'account',
  'storage',
  'access',
  'appearance',
  'email',
  'ready',
] as const

export type SetupStep = (typeof SETUP_STEPS)[number]

// The steps after the instance exists. Only these may be named in a URL, so a
// reload or a sign-in can return to one.
const RESUMABLE_STEPS = [
  'appearance',
  'email',
  'ready',
] as const satisfies readonly SetupStep[]

export type SetupResumeStep = (typeof RESUMABLE_STEPS)[number]

export function isSetupResumeStep(value: unknown): value is SetupResumeStep {
  return (RESUMABLE_STEPS as readonly unknown[]).includes(value)
}

/** Only setup stages may survive authentication; never accept a redirect URL. */
export function getSetupStep(value: unknown): SetupResumeStep {
  return isSetupResumeStep(value) ? value : RESUMABLE_STEPS[0]
}

export function getSetupResumePath(value: unknown) {
  return `${SETUP_PATH}?step=${getSetupStep(value)}`
}

// Sign-in returns to setup only through these two parameters. The first is
// named for the email step it was added for; it now resumes any step.
const RESUME_SETUP = 'setupEmail'
const RESUME_STEP = 'setupStep'

export function getSetupSignInPath(value: unknown) {
  return `${LOCAL_SIGN_IN_PATH}&${RESUME_SETUP}=1&${RESUME_STEP}=${getSetupStep(value)}`
}

/** Where a sign-in started by `getSetupSignInPath` continues; null for any other sign-in. */
export function getSetupResumePathAfterSignIn(
  searchParams: Pick<URLSearchParams, 'get'>
) {
  return searchParams.get(RESUME_SETUP) === '1'
    ? getSetupResumePath(searchParams.get(RESUME_STEP))
    : null
}
