import { describe, expect, it } from 'vitest'

import { securityTestDatabaseUrl } from './security-database-guard'

describe('destructive security suite database guard', () => {
  it.each([
    'postgresql://tester@localhost/flare_security_test_local',
    'postgres://tester@127.0.0.1:55432/flare_security_test_ci?schema=public',
  ])('accepts the exact disposable database %s', (url) => {
    expect(securityTestDatabaseUrl(url).toString()).toBe(url)
  })
  it.each([
    'postgresql://tester@localhost/flare_security_test_local_backup',
    'postgresql://tester@localhost/flare_security_test_backup',
    'postgresql://tester@localhost/production?schema=flare_security_test_local',
    'postgresql://tester@remote.example/flare_security_test_ci',
    'https://localhost/flare_security_test_local',
    'postgresql://tester@localhost/flare_security_test_local?schema=backup',
    'postgresql://tester@localhost/flare_security_test_local?schema=public&schema=backup',
    'postgresql://tester@localhost/flare_security_test_local?options=-csearch_path%3Dbackup',
  ])('rejects ambiguous or nonlocal target %s', (url) => {
    expect(() => securityTestDatabaseUrl(url)).toThrow('disposable local')
  })
})
