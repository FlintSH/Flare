// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'

import { namePastedFile, pasteBelongsElsewhere } from '@/lib/uploads/clipboard'

const at = new Date(2026, 10, 22, 9, 5, 7)

describe('a pasted file’s name', () => {
  it('dates a screenshot the browser called image.png', () => {
    const file = namePastedFile(
      new File(['x'], 'image.png', { type: 'image/png' }),
      at
    )
    expect(file.name).toBe('Pasted image 2026-11-22 09.05.07.png')
    expect(file.type).toBe('image/png')
  })

  it.each(['Image.JPEG', 'image.webp'])('dates %s too', (name) => {
    expect(namePastedFile(new File(['x'], name), at).name).toMatch(
      /^Pasted image 2026-11-22 09\.05\.07\.(jpeg|webp)$/
    )
  })

  it.each(['report.pdf', 'image-1.png', 'image.png.zip'])(
    'keeps a copied file’s own name: %s',
    (name) => {
      const file = new File(['x'], name)
      expect(namePastedFile(file, at)).toBe(file)
    }
  )
})

describe('where a paste belongs', () => {
  it.each([
    ['<input />', true],
    ['<textarea></textarea>', true],
    ['<div contenteditable="true"><span>x</span></div>', true],
    ['<div role="dialog"><button>x</button></div>', true],
    ['<div role="menu"><div>x</div></div>', true],
    ['<main><button>x</button></main>', false],
  ])('%s belongs elsewhere: %s', (html, expected) => {
    document.body.innerHTML = html
    const target =
      document.body.querySelector('span, button, div > div, input, textarea') ??
      document.body.firstElementChild
    expect(pasteBelongsElsewhere(target)).toBe(expected)
  })

  it('is the page’s when the target is the document', () => {
    expect(pasteBelongsElsewhere(document)).toBe(false)
    expect(pasteBelongsElsewhere(null)).toBe(false)
  })
})
