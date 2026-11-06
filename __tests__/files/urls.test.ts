import { describe, expect, it } from 'vitest'

import {
  canOptimizeThumbnail,
  fileUrls,
  sharedFolderFileUrl,
  sharedFolderUrl,
  withPassword,
} from '@/lib/files/urls'

const file = { id: 'cmfile0123456789abcdef', urlPath: '/Ab3dE/my-report.pdf' }

describe('file URLs', () => {
  it('builds every address of a file Flare names today unchanged', () => {
    expect(fileUrls(file)).toEqual({
      page: '/Ab3dE/my-report.pdf',
      raw: '/Ab3dE/my-report.pdf/raw',
      content: '/api/files/Ab3dE/my-report.pdf',
      direct: '/Ab3dE/my-report.pdf/direct',
      thumbnail: '/api/files/cmfile0123456789abcdef/thumbnail',
      download: '/api/files/cmfile0123456789abcdef/download',
      ocr: '/api/files/cmfile0123456789abcdef/ocr',
    })
    // Randomized names and collision suffixes use these characters too.
    expect(fileUrls({ ...file, urlPath: '/Ab3dE/x7K_p2-a.png' }).page).toBe(
      '/Ab3dE/x7K_p2-a.png'
    )
  })

  it('makes every address absolute under the given origin', () => {
    const urls = fileUrls(file, { origin: 'https://files.example/flare' })
    for (const url of Object.values(urls))
      expect(url).toMatch(/^https:\/\/files\.example\/flare\/(Ab3dE|api)\//)
  })

  it('uses the vanity ID for the share page only', () => {
    const owner = { urlId: 'Ab3dE', vanityId: 'orbit' }
    const urls = fileUrls(file, { owner })
    expect(urls.page).toBe('/orbit/my-report.pdf')
    // `/api/files/{urlPath}` has never accepted vanity IDs.
    expect(urls.content).toBe('/api/files/Ab3dE/my-report.pdf')
    expect(urls.raw).toBe('/Ab3dE/my-report.pdf/raw')
    expect(fileUrls(file, { owner: { ...owner, vanityId: null } }).page).toBe(
      '/Ab3dE/my-report.pdf'
    )
  })

  it('sends a password with every address but the share page', () => {
    const password = 'watch+share&safe?<>#100% ok'
    const urls = fileUrls(file, { password })
    expect(urls.page).toBe('/Ab3dE/my-report.pdf')
    for (const [name, url] of Object.entries(urls)) {
      if (name === 'page') continue
      const parsed = new URL(url, 'https://flare.test')
      expect([...parsed.searchParams], name).toEqual([['password', password]])
      expect(parsed.hash).toBe('')
    }
    // The same spelling the password form and the folder redirect send.
    expect(urls.raw).toBe(
      `/Ab3dE/my-report.pdf/raw?${new URLSearchParams({ password })}`
    )
    expect(fileUrls(file, { password: '' }).raw).toBe(
      '/Ab3dE/my-report.pdf/raw'
    )
    expect(withPassword('/Ab3dE/my-report.pdf', null)).toBe(
      '/Ab3dE/my-report.pdf'
    )
  })

  it('spells names from earlier builds as a browser spells their path', () => {
    // Earlier builds could keep the original name in a URL, such as a second
    // `My Report.PDF` stored as `My Report-1.PDF`. Links copied from the
    // library were written by the browser, so they read the same now.
    for (const name of [
      'My Report-1.PDF',
      'image (1)-1.png',
      'Tom & Jerry, Q&A+notes @2x;v=1:final $5 [draft] a|b-1.png',
      "it's ~done!*-1.txt",
      'Grüße "quoted" <tag> `code` {x} ^-1.txt',
      'café 日本語-1.png',
    ]) {
      const urlPath = `/Ab3dE/${name}`
      const browser = new URL(urlPath, 'https://flare.test').pathname
      expect(fileUrls({ ...file, urlPath }).page, name).toBe(browser)
    }
  })

  it('escapes the characters that broke links to names from earlier builds', () => {
    // A browser reads these as a fragment, a query, an escape, a separator, or
    // drops them, so links written without escaping opened the wrong path.
    expect(fileUrls({ ...file, urlPath: '/Ab3dE/notes.h#ml' }).page).toBe(
      '/Ab3dE/notes.h%23ml'
    )
    expect(fileUrls({ ...file, urlPath: '/Ab3dE/what?-1.txt' }).raw).toBe(
      '/Ab3dE/what%3F-1.txt/raw'
    )
    expect(fileUrls({ ...file, urlPath: '/Ab3dE/50% off-1.png' }).content).toBe(
      '/api/files/Ab3dE/50%25%20off-1.png'
    )
    expect(fileUrls({ ...file, urlPath: '/Ab3dE/a\\b-1.png' }).direct).toBe(
      '/Ab3dE/a%5Cb-1.png/direct'
    )
    expect(fileUrls({ ...file, urlPath: '/Ab3dE/tab\there' }).page).toBe(
      '/Ab3dE/tab%09here'
    )
  })

  it('reaches the stored name for every character, as Next decodes route params', () => {
    const characters = Array.from({ length: 0x7f - 0x09 }, (_, index) =>
      String.fromCharCode(index + 0x09)
    ).filter((character) => character !== '/')
    for (const character of [...characters, 'é', '日', '😀']) {
      const name = `a${character}b.txt`
      const { page } = fileUrls({ ...file, urlPath: `/Ab3dE/${name}` })
      const url = new URL(page, 'https://flare.test')
      expect(url.search + url.hash, JSON.stringify(character)).toBe('')
      const [, urlId, segment] = url.pathname.split('/')
      expect(urlId).toBe('Ab3dE')
      expect(decodeURIComponent(segment), JSON.stringify(character)).toBe(name)
    }
  })

  it('never builds a link to another host', () => {
    expect(fileUrls({ ...file, urlPath: '//evil.test/x.png' }).page).toBe(
      '/evil.test/x.png'
    )
    expect(fileUrls({ ...file, urlPath: 'Ab3dE/x.png' }).page).toBe(
      '/Ab3dE/x.png'
    )
    expect(fileUrls({ ...file, urlPath: '/Ab3dE/javascript:x' }).page).toBe(
      '/Ab3dE/javascript:x'
    )
  })

  it('escapes file IDs in their path segment', () => {
    expect(fileUrls({ ...file, id: 'a/b?c' }).download).toBe(
      '/api/files/a%2Fb%3Fc/download'
    )
  })
})

describe('shared folder URLs', () => {
  const token = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-xy'

  it('adds a page number only past the first page', () => {
    expect(sharedFolderUrl(token)).toBe(`/s/folders/${token}`)
    expect(sharedFolderUrl(token, { page: 1 })).toBe(`/s/folders/${token}`)
    expect(sharedFolderUrl(token, { page: 3 })).toBe(
      `/s/folders/${token}?page=3`
    )
    expect(sharedFolderUrl(token, { origin: 'https://files.example' })).toBe(
      `https://files.example/s/folders/${token}`
    )
  })

  it('leads a locked tile to the password check, not the file', () => {
    expect(sharedFolderFileUrl(token, 'cmfile01')).toBe(
      `/s/folders/${token}/files/cmfile01`
    )
  })
})

describe('thumbnail optimization', () => {
  const image = { visibility: 'PUBLIC', hasPassword: false }

  it('lets the optimizer fetch only what anyone may read', () => {
    expect(canOptimizeThumbnail({ ...image, mimeType: 'image/png' })).toBe(true)
    expect(
      canOptimizeThumbnail({
        ...image,
        visibility: 'PRIVATE',
        mimeType: 'image/png',
      })
    ).toBe(false)
    expect(
      canOptimizeThumbnail({
        ...image,
        hasPassword: true,
        mimeType: 'image/png',
      })
    ).toBe(false)
  })

  it('keeps GIFs animated', () => {
    expect(canOptimizeThumbnail({ ...image, mimeType: 'image/gif' })).toBe(
      false
    )
  })
})
