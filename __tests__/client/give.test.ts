import { describe, expect, it } from 'vitest'

import {
  asLink,
  credentialIn,
  linkCarriesCredential,
  readGift,
  searchHold,
} from '@/lib/client/give'

// Assembled so this file doesn't itself look like it holds credentials.
const fake = (prefix: string, body: string) => `${prefix}${body}`
const token = fake('ghp_', 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8')

describe('readGift', () => {
  const file = new File(['x'], 'shot.png', { type: 'image/png' })

  it('takes files over the text that comes with them', () => {
    expect(readGift({ files: [file], text: 'shot.png' })).toEqual({
      kind: 'files',
      files: [file],
    })
  })

  it('reads a lone address as a link, adding the scheme', () => {
    expect(readGift({ files: [], text: '  example.com/a/b  ' })).toEqual({
      kind: 'link',
      url: 'https://example.com/a/b',
      carries: null,
    })
  })

  it('reads anything else as text, with its lines and any secret', () => {
    const gift = readGift({
      files: [],
      text: `const a = 1\nconst key = '${token}'\n`,
    })
    expect(gift).toMatchObject({ kind: 'text', lines: 2 })
    expect(gift?.kind === 'text' && gift.secret).toBe('a GitHub token')
  })

  it('ignores whitespace-only pastes', () => {
    expect(readGift({ files: [], text: ' \n ' })).toBeNull()
  })
})

describe('asLink', () => {
  it.each([
    ['https://example.com', 'https://example.com'],
    ['example.com/path?q=1', 'https://example.com/path?q=1'],
    ['http://localhost:3000/x', 'http://localhost:3000/x'],
    ['www.example.com', 'https://www.example.com'],
    ['example.com', 'https://example.com'],
    ['flare.dev', 'https://flare.dev'],
    ['example.com/', 'https://example.com/'],
  ])('%s is a link', (text, url) => expect(asLink(text)).toBe(url))

  it.each([
    'two words',
    'hello',
    'canyon.jpg',
    'notes.md',
    'deploy.sh',
    'archive.zip',
    'mailto:a@example.com',
    'ftp://example.com',
  ])('%s is not', (text) => expect(asLink(text)).toBeNull())
})

describe('linkCarriesCredential', () => {
  it.each([
    ['https://user:hunter2@example.com/', 'a password'],
    ['https://example.com/reset?token=abc123', 'a token'],
    // An app's route in the fragment, with a query of its own.
    ['https://example.com/#/reset?token=abc123', 'a token'],
    // Acronyms before the last word.
    ['https://example.com/?APIKey=abc123', 'a token'],
    ['https://example.com/?SSOToken=abc123', 'a token'],
    ['https://example.com/?MFACode=123456', 'a token'],
    ['https://example.com/?apikey=abc123', 'a token'],
    ['https://example.com/?sessionid=abc123', 'a token'],
    ['https://example.com/cb?code=4/0AY0e', 'a token'],
    ['https://bucket.s3.amazonaws.com/f?X-Amz-Signature=deadbeef', 'a token'],
    ['https://example.com/#access_token=abc', 'a token'],
    [`https://example.com/?q=${token}`, 'a GitHub token'],
    ['https://example.com/r?resetToken=abc123', 'a token'],
    ['https://example.com/#key=abc123', 'a token'],
    ['https://us02web.zoom.us/j/123?pwd=abc123', 'a token'],
    ['https://cas.example.edu/login?ticket=ST-1', 'a token'],
    [
      'https://example.com/go?redirect=https%3A%2F%2Fx.com%2Fr%3Ftoken%3Dabc1',
      'a token',
    ],
  ])('%s carries %s', (url, what) =>
    expect(linkCarriesCredential(url)).toBe(what)
  )

  it('leaves ordinary links alone', () => {
    expect(
      linkCarriesCredential(
        'https://github.com/FlintSH/Flare/releases?utm_source=x&page=2'
      )
    ).toBeNull()
  })
})

describe('internal and IP addresses', () => {
  it.each([
    'http://intranet/reset?token=disposable123',
    'http://[::1]:3000/a',
    'http://10.0.0.5/x',
  ])('%s is a link when typed with its scheme', (url) =>
    expect(asLink(url)).not.toBeNull()
  )

  it('keeps a scheme-less single word as text', () => {
    expect(asLink('intranet')).toBeNull()
  })
})

describe('searchHold', () => {
  it('searches plain words and file names', () => {
    expect(searchHold('canyon').reason).toBeNull()
    expect(searchHold('canyon.jpg').reason).toBeNull()
  })
  it('holds back a link, alone or with a credential', () => {
    expect(searchHold('example.com/page').reason).toBe('link')
    expect(searchHold('https://example.com/reset?token=abc123').reason).toBe(
      'link'
    )
  })
  it('holds back a bare credential address inside text', () => {
    expect(searchHold('Open example.com/reset?token=demo-only').reason).toBe(
      'secret'
    )
    expect(searchHold('[r](example.com/reset?token=demo-only)').reason).toBe(
      'secret'
    )
  })
  it('holds back a credential link inside markup', () => {
    expect(searchHold('<https://example.com/reset?token=abc123>').reason).toBe(
      'secret'
    )
    expect(
      searchHold('[reset](https://example.com/r?token=abc123)').reason
    ).toBe('secret')
  })
  it('holds back a credential link pasted beside other words', () => {
    expect(
      searchHold('reset https://example.com/reset?token=abc123').reason
    ).toBe('secret')
  })
  it('treats a long link as a link and a long or multi-line secret as a secret', () => {
    expect(searchHold(`https://example.com/${'a'.repeat(300)}`).reason).toBe(
      'link'
    )
    expect(searchHold(`${token}\n${token}`).reason).toBe('secret')
    expect(searchHold(`x ${'y'.repeat(300)}`).reason).toBe('long')
  })
  it('holds back secrets, long text and a single character', () => {
    expect(searchHold(token).reason).toBe('secret')
    expect(searchHold('a\nb').reason).toBe('long')
    expect(searchHold('a').reason).toBe('short')
  })
})

describe('credentialIn', () => {
  it('names what a link inside text carries', () => {
    expect(
      credentialIn('reset it at example.com/r?resetToken=abc1 today')
    ).toBe('a token')
    expect(credentialIn('see <https://example.com/#code=abc1>')).toBe('a token')
  })
  it('finds one in an address too long for a link', () => {
    expect(
      credentialIn(`https://example.com/${'a'.repeat(5000)}?token=abc1`)
    ).toBe('a token')
  })
  it('finds one deep in a long paste', () => {
    const log = `${'line of log\n'.repeat(2000)}https://example.com/r?token=abc1`
    expect(credentialIn(log)).toBe('a token')
  })
  it('treats Flare invite links as credentials, and logo.ai as a name', () => {
    expect(
      linkCarriesCredential(
        'https://files.example.com/auth/register?invite=abc1'
      )
    ).toBe('a token')
    expect(asLink('logo.ai')).toBeNull()
  })
  it('reads an app link with a path value without throwing', () => {
    expect(linkCarriesCredential('myapp://open?next=/home')).toBeNull()
    expect(linkCarriesCredential('mailto:a@b.c?body=/x')).toBeNull()
  })
  it('follows a relative redirect, and names keys by their last word', () => {
    expect(
      linkCarriesCredential('https://example.com/?next=/login?token=abc')
    ).toBe('a token')
    expect(
      linkCarriesCredential('https://example.com/?zipcode=90210')
    ).toBeNull()
    expect(linkCarriesCredential('https://example.com/?monkey=1')).toBeNull()
    expect(linkCarriesCredential('https://example.com/?apiKey=abc1')).toBe(
      'a token'
    )
  })
  it('finds one with parentheses in its path, or nested without a scheme', () => {
    expect(
      credentialIn('see https://example.com/a_(b)/login?token=abc1 here')
    ).toBe('a token')
    expect(
      linkCarriesCredential(
        'https://example.com/go?next=%2F%2Fx.com%2Fr%3Ftoken%3Dabc1'
      )
    ).toBe('a token')
  })
  it('finds one that starts inside a word', () => {
    expect(credentialIn('Reset:https://example.com/r?token=abc1')).toBe(
      'a token'
    )
    expect(searchHold('canyon https://example.com/r?token=abc1').reason).toBe(
      'secret'
    )
  })
  it('is null for ordinary text and links', () => {
    expect(credentialIn('see https://example.com/page and notes.md')).toBeNull()
  })
  it('makes pasted text holding such a link a secret', () => {
    const gift = readGift({
      files: [],
      text: 'login:\nhttps://example.com/r?token=abc123',
    })
    expect(gift?.kind === 'text' && gift.secret).toBe('a token')
  })
})
