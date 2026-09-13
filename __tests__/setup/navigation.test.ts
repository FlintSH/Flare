import { describe, expect, it } from 'vitest'

import { getSetupResumePath, getSetupSignInPath } from '@/lib/setup/navigation'

describe('setup continuation through authentication', () => {
  it('preserves each optional stage through the fixed local sign-in flow', () => {
    for (const stage of ['appearance', 'email', 'ready']) {
      const login = new URL(getSetupSignInPath(stage), 'https://flare.example')
      expect(login.pathname).toBe('/auth/login')
      expect(login.searchParams.get('local')).toBe('1')
      expect(login.searchParams.get('setupEmail')).toBe('1')
      expect(getSetupResumePath(login.searchParams.get('setupStep'))).toBe(
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
      expect(getSetupResumePath(login.searchParams.get('setupStep'))).toBe(
        '/setup?step=appearance'
      )
    }
  })
})
