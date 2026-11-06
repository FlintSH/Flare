import { describe, expect, it } from 'vitest'

import {
  getSetupResumePath,
  getSetupResumePathAfterSignIn,
  getSetupSignInPath,
  getSetupStep,
  isSetupPath,
} from '@/lib/setup/navigation'

describe('setup continuation through authentication', () => {
  it('preserves each optional stage through the fixed local sign-in flow', () => {
    for (const stage of ['appearance', 'email', 'ready']) {
      const login = new URL(getSetupSignInPath(stage), 'https://flare.example')
      expect(login.pathname).toBe('/auth/login')
      expect(login.searchParams.get('local')).toBe('1')
      expect(login.searchParams.get('setupEmail')).toBe('1')
      expect(getSetupResumePathAfterSignIn(login.searchParams)).toBe(
        `/setup?step=${stage}`
      )
    }
  })

  it('cannot turn an untrusted stage into an external or arbitrary callback', () => {
    for (const input of [
      undefined,
      null,
      'account',
      'storage',
      '/dashboard/settings',
      '//attacker.example',
      'https://attacker.example',
      'javascript:alert(1)',
      'email&callbackUrl=https://attacker.example',
      ['email'],
      { step: 'email', password: 'never-copy-credentials' },
    ]) {
      const login = new URL(getSetupSignInPath(input), 'https://flare.example')
      expect(login.origin).toBe('https://flare.example')
      expect([...login.searchParams.keys()]).toEqual([
        'local',
        'setupEmail',
        'setupStep',
      ])
      expect(getSetupResumePath(input)).toBe('/setup?step=appearance')
      expect(getSetupResumePathAfterSignIn(login.searchParams)).toBe(
        '/setup?step=appearance'
      )
    }
  })

  it('reads a step from the sign-in page only when setup started the sign-in', () => {
    for (const query of [
      '',
      'setupStep=email',
      'setupEmail=0&setupStep=email',
      'setupEmail=true&setupStep=email',
      'callbackUrl=%2Fsetup%3Fstep%3Demail',
    ])
      expect(getSetupResumePathAfterSignIn(new URLSearchParams(query))).toBe(
        null
      )
    expect(
      getSetupResumePathAfterSignIn(
        new URLSearchParams('setupEmail=1&setupStep=https://attacker.example')
      )
    ).toBe('/setup?step=appearance')
    expect(
      getSetupResumePathAfterSignIn(new URLSearchParams('setupEmail=1'))
    ).toBe('/setup?step=appearance')
  })
})

describe('setup steps', () => {
  it('lets only the steps after the instance exists be resumed', () => {
    for (const step of ['appearance', 'email', 'ready'])
      expect(getSetupStep(step)).toBe(step)
    for (const step of ['account', 'storage', 'access'])
      expect(getSetupStep(step)).toBe('appearance')
  })

  it('treats the setup page and its legacy email page as setup', () => {
    for (const path of ['/setup', '/setup/email'])
      expect(isSetupPath(path)).toBe(true)
    for (const path of ['/', '/dashboard', '/auth/login', '/abc12/setup'])
      expect(isSetupPath(path)).toBe(false)
  })
})
