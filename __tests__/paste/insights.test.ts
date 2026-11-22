import { describe, expect, it } from 'vitest'

import { findSecret, loneLink } from '@/lib/paste/insights'

// Assembled so this file doesn't itself look like it holds credentials.
const fake = (prefix: string, body: string) => `${prefix}${body}`

describe('findSecret', () => {
  it.each([
    [
      '-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAAA\n-----END OPENSSH PRIVATE KEY-----',
      'a private key',
    ],
    ['-----BEGIN RSA PRIVATE KEY-----\nMIIE', 'a private key'],
    ['-----BEGIN PRIVATE KEY-----\nMIIE', 'a private key'],
    [
      `aws_access_key_id = ${fake('AKIA', 'Z7QWERTYUIOPASDF')}`,
      'an AWS access key',
    ],
    [`token ${fake('ghp_', 'a'.repeat(36))}`, 'a GitHub token'],
    [fake('github_pat_', `11ABC${'x'.repeat(70)}`), 'a GitHub token'],
    [fake('glpat-', 'abcdefghijklmnopqrstu'), 'a GitLab token'],
    [fake('xoxb-', '1234567890-abcdefghij'), 'a Slack token'],
    [fake('sk_live_', 'a1b2c3d4e5f6g7h8i9j0k1'), 'a Stripe secret key'],
    [fake('AIza', 'SyA1234567890abcdefghijklmnopqrstuv'), 'a Google API key'],
    [fake('sk-proj-', 'a'.repeat(40)), 'an API key'],
    [fake('flr_', 'a'.repeat(32)), 'a Flare token'],
    [
      `Authorization: Bearer ${fake('eyJ', 'hbGciOiJIUzI1NiJ9')}.${fake('eyJ', 'zdWIiOiIxMjM0NTY3ODkwIn0')}.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U`,
      'a sign-in token',
    ],
    [
      'DATABASE_URL=postgres://flare:hunter2hunter2@db:5432/flare',
      'a password in an address',
    ],
    ['DB_PASSWORD=correct-horse-battery', 'a password or secret'],
    ['export API_KEY="9f8e7d6c5b4a"', 'a password or secret'],
    ['{\n  "client_secret": "s3cr3t-value-here"\n}', 'a password or secret'],
    ['smtp:\n  password: Tr0ub4dor&3\n', 'a password or secret'],
  ])('notices %j', (text, expected) => {
    expect(findSecret(text)).toBe(expected)
  })

  it.each([
    'Just some notes about the release.',
    'const token = await getToken()\nconst apiKey = process.env.API_KEY',
    'DB_PASSWORD=\nAPI_KEY=${API_KEY}\nSECRET=changeme\nTOKEN=<your-token>',
    'password: ""\ntoken: null\napi_key: ***',
    'https://example.com/docs?token=abc',
    'Use ghp_ tokens with the repo scope.',
    '-----BEGIN PUBLIC KEY-----\nMIIB',
    'sk-short',
  ])('stays quiet for %j', (text) => {
    expect(findSecret(text)).toBeNull()
  })

  it('scans a long paste quickly', () => {
    const text = 'lorem ipsum dolor sit amet: a = b\n'.repeat(8000)
    const start = performance.now()
    expect(findSecret(text)).toBeNull()
    expect(performance.now() - start).toBeLessThan(200)
  })
})

describe('loneLink', () => {
  it('finds a paste that is only a web link', () => {
    expect(loneLink('  https://example.com/a?b=c  \n')).toBe(
      'https://example.com/a?b=c'
    )
  })

  it.each([
    'https://example.com and more',
    'see https://example.com',
    'example.com',
    'ftp://example.com/file',
    'https://example.com\nhttps://example.org',
  ])('ignores %j', (text) => {
    expect(loneLink(text)).toBeNull()
  })
})
