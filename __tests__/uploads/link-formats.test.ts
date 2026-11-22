import { describe, expect, it } from 'vitest'

import { directLink, formatLink } from '@/lib/uploads/link-formats'

const photo = {
  link: 'https://files.example.com/alex/lake.jpg',
  name: 'lake.jpg',
  type: 'image/jpeg',
}
const report = {
  link: 'https://files.example.com/alex/report%20(final).pdf',
  name: 'report [final].pdf',
  type: 'application/pdf',
}

describe('upload link formats', () => {
  it('copies the share page as the link', () => {
    expect(formatLink('link', photo)).toBe(photo.link)
  })

  it('copies the file itself as the direct link', () => {
    expect(formatLink('direct', photo)).toBe(
      'https://files.example.com/alex/lake.jpg/raw'
    )
    expect(directLink('https://files.example.com/alex/a.png/')).toBe(
      'https://files.example.com/alex/a.png/raw'
    )
  })

  it('shows images in Markdown and links everything else to its page', () => {
    expect(formatLink('markdown', photo)).toBe(
      '![lake.jpg](https://files.example.com/alex/lake.jpg/raw)'
    )
    expect(formatLink('markdown', report)).toBe(
      '[report \\[final\\].pdf](https://files.example.com/alex/report%20%28final%29.pdf)'
    )
  })
})
