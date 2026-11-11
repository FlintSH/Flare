import React from 'react'

import { renderToStaticMarkup } from 'react-dom/server'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { ImageLightbox } from '@/components/file/image-lightbox'

// Radix portals render nothing on the server; render the dialog parts inline.
vi.mock('@radix-ui/react-dialog', () => {
  const part =
    (tag: string) =>
    ({ children }: { children?: React.ReactNode }) =>
      React.createElement(tag, null, children)
  return {
    Root: part('div'),
    Portal: part('div'),
    Overlay: part('div'),
    Content: part('div'),
    Title: part('h2'),
    Close: part('button'),
  }
})

const image = {
  id: 'one',
  name: 'Alpine morning.webp',
  src: '/thumb/one',
  shareUrl: '/alex/one.webp',
  downloadUrl: '/alex/one.webp?download=1',
}

const render = (props: { canCopyLink?: boolean; shareUrl?: string }) =>
  renderToStaticMarkup(
    React.createElement(ImageLightbox, {
      images: [{ ...image, shareUrl: props.shareUrl }],
      index: 0,
      onIndexChange: () => {},
      onClose: () => {},
      ...('canCopyLink' in props ? { canCopyLink: props.canCopyLink } : {}),
    })
  )

describe('ImageLightbox share actions', () => {
  // The viewer remembers the focused element when it mounts.
  beforeAll(() => {
    vi.stubGlobal('document', { activeElement: null })
    vi.stubGlobal('HTMLElement', class {})
  })
  afterAll(() => vi.unstubAllGlobals())

  it('offers Copy link only when the viewer may share', () => {
    const allowed = render({ canCopyLink: true, shareUrl: image.shareUrl })
    expect(allowed).toContain('aria-label="Copy link"')
    expect(allowed).toContain('aria-label="Open share page"')

    for (const props of [
      { canCopyLink: false, shareUrl: image.shareUrl },
      { shareUrl: image.shareUrl },
    ]) {
      const html = render(props)
      expect(html).not.toContain('aria-label="Copy link"')
      expect(html).toContain('aria-label="Open share page"')
      expect(html).toContain(`href="${image.shareUrl}"`)
    }
  })

  it('shows neither share action without a share URL', () => {
    const html = render({ canCopyLink: true })
    expect(html).not.toContain('aria-label="Copy link"')
    expect(html).not.toContain('aria-label="Open share page"')
    expect(html).toContain('aria-label="Download image"')
  })
})
