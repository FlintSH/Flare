import { describe, expect, it } from 'vitest'

import {
  sameDestination,
  suggestEnding,
  trackingParameters,
  withScheme,
} from '@/lib/links/compose'

describe('withScheme', () => {
  it.each([
    ['example.com', 'https://example.com'],
    ['example.com/page?x=1#top', 'https://example.com/page?x=1#top'],
    ['docs.example.co.uk/a', 'https://docs.example.co.uk/a'],
    ['localhost:3000/path', 'https://localhost:3000/path'],
    ['  github.com/FlintSH/Flare  ', 'https://github.com/FlintSH/Flare'],
  ])('adds https:// to %s', (typed, expected) => {
    expect(withScheme(typed)).toBe(expected)
  })

  it.each([
    'https://example.com',
    'http://example.com',
    'mailto:alex@example.com',
    'not a link',
    'hello',
    'file.txt is here',
    '',
  ])('leaves %j for validation to judge', (typed) => {
    expect(withScheme(typed)).toBe(typed.trim())
  })
})

describe('trackingParameters', () => {
  it('finds campaign and click IDs and keeps everything else as written', () => {
    expect(
      trackingParameters(
        'https://example.com/a?id=7&utm_source=news&utm_medium=email&q=a%20b&fbclid=xyz#part'
      )
    ).toEqual({
      names: ['utm_source', 'utm_medium', 'fbclid'],
      cleaned: 'https://example.com/a?id=7&q=a%20b#part',
    })
  })

  it('leaves the rest of the address byte for byte', () => {
    expect(
      trackingParameters(
        'https://Example.com/a%2Fb/../c?q=a+b&utm_campaign=x&sig=AbC%3D%3D&&x=1#frag?utm_source=y'
      )
    ).toEqual({
      names: ['utm_campaign'],
      cleaned:
        'https://Example.com/a%2Fb/../c?q=a+b&sig=AbC%3D%3D&&x=1#frag?utm_source=y',
    })
    expect(
      trackingParameters('https://example.com/?utm_source=a&utm_source=b')
    ).toEqual({ names: ['utm_source'], cleaned: 'https://example.com/' })
  })

  it('leaves generic names such as ref alone', () => {
    expect(
      trackingParameters('https://example.com/?ref=home&s=1&t=2')
    ).toBeNull()
  })

  it('removes the share tag from YouTube and Spotify links only', () => {
    expect(
      trackingParameters('https://youtu.be/dQw4w9WgXcQ?si=abc123')
    ).toEqual({ names: ['si'], cleaned: 'https://youtu.be/dQw4w9WgXcQ' })
    expect(
      trackingParameters('https://www.youtube.com/watch?v=dQw4w9WgXcQ&si=x')
    ).toEqual({
      names: ['si'],
      cleaned: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    })
    expect(trackingParameters('https://example.com/search?si=en')).toBeNull()
  })

  it('answers null when there is nothing to remove', () => {
    expect(trackingParameters('https://example.com/?page=2')).toBeNull()
    expect(trackingParameters('https://example.com/')).toBeNull()
    expect(trackingParameters('not a url')).toBeNull()
  })
})

describe('suggestEnding', () => {
  it.each([
    [
      'https://github.com/FlintSH/Flare/releases/tag/v3.1.0',
      'flare-releases-v3-1-0',
    ],
    ['https://github.com/FlintSH/Flare', 'flintsh-flare'],
    [
      'https://flintsh.github.io/Flare/guide/uploading',
      'flare-guide-uploading',
    ],
    [
      'https://www.figma.com/design/7Hq2xK/Flare-brand-kit?node-id=12-4083',
      'flare-brand-kit',
    ],
    [
      'https://en.wikipedia.org/wiki/Rust_(programming_language)',
      'rust-programming-language',
    ],
    [
      'https://news.example.com/2026/11/22/city-council-approves-new-bike-lanes-on-main-street',
      'city-council-approves-new-bike',
    ],
    ['https://example.com/', 'example'],
    ['https://www.example.com', 'example'],
    ['https://example.com/report.html', 'report'],
  ])('suggests a readable ending for %s', (address, expected) => {
    expect(suggestEnding(address)).toBe(expected)
  })

  it.each([
    'https://docs.google.com/document/d/1x9Fq0bL4rN2T8vYp3wZ/edit',
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    'https://example.com/123456',
    'https://example.com/3f2504e0-4f89-11d3-9a0c-0305e82c3301',
    'https://example.com/a1b2c3d4e5f6a7b8',
    'not a url',
  ])('suggests nothing when only IDs are left: %s', (address) => {
    expect(suggestEnding(address)).toBeNull()
  })

  it('keeps every suggestion within the ending rules', () => {
    const ending = suggestEnding(
      `https://example.com/${'word-'.repeat(40)}end/ünïcödé`
    )
    expect(ending).toMatch(/^[a-z0-9-]{1,32}$/)
  })
})

describe('sameDestination', () => {
  it('ignores the case of the scheme and host only', () => {
    expect(
      sameDestination(
        'https://GitHub.com/FlintSH/Flare',
        'HTTPS://github.com/FlintSH/Flare'
      )
    ).toBe(true)
    expect(
      sameDestination(
        'https://github.com/FlintSH/Flare/',
        'https://github.com/FlintSH/Flare'
      )
    ).toBe(false)
  })

  it('matches a link made without the tracking the new one carries', () => {
    expect(
      sameDestination(
        'https://example.com/post?id=7',
        'https://example.com/post?id=7&utm_source=news'
      )
    ).toBe(true)
  })

  it('keeps a user name and password exactly as written', () => {
    expect(
      sameDestination(
        'https://Alice:Secret@example.com/x',
        'https://alice:secret@example.com/x'
      )
    ).toBe(false)
    expect(
      sameDestination(
        'https://Alice:Secret@Example.com/x',
        'HTTPS://Alice:Secret@example.COM/x'
      )
    ).toBe(true)
  })

  it('keeps paths, queries and schemes apart', () => {
    expect(
      sameDestination('https://example.com/a', 'https://example.com/A')
    ).toBe(false)
    expect(
      sameDestination('https://example.com/?a=1', 'https://example.com/?a=2')
    ).toBe(false)
    expect(sameDestination('http://example.com', 'https://example.com')).toBe(
      false
    )
  })
})
