export type SetupOptionalStep = 'appearance' | 'email' | 'ready'

/** Only setup stages may survive authentication; never accept a redirect URL. */
export function getSetupStep(value: unknown): SetupOptionalStep {
  return value === 'email' || value === 'ready' ? value : 'appearance'
}

export function getSetupResumePath(value: unknown) {
  return `/setup?step=${getSetupStep(value)}`
}

export function getSetupSignInPath(value: unknown) {
  return `/auth/login?local=1&setupEmail=1&setupStep=${getSetupStep(value)}`
}
