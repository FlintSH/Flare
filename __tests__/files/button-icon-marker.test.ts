import { createElement } from 'react'

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { Button } from '@/components/ui/button'

describe('shared button presentation', () => {
  it('marks true icon controls without marking small textual controls', () => {
    expect(
      renderToStaticMarkup(
        createElement(Button, { size: 'icon', 'aria-label': 'Copy' })
      )
    ).toContain('data-flare-icon=""')
    for (const size of ['default', 'sm', 'lg'] as const)
      expect(
        renderToStaticMarkup(createElement(Button, { size }, 'Expiration'))
      ).not.toContain('data-flare-icon')
  })

  it.each([
    'default',
    'destructive',
    'outline',
    'secondary',
    'ghost',
    'link',
  ] as const)(
    'keeps disabled %s controls unavailable with a readable, distinct state',
    (variant) => {
      const html = renderToStaticMarkup(
        createElement(Button, { variant, disabled: true }, 'Save')
      )
      expect(html).toContain('disabled=""')
      expect(html).toContain('disabled:bg-muted')
      expect(html).toContain('disabled:border-transparent')
      expect(html).toContain('disabled:shadow-[inset_')
      expect(html).not.toContain('disabled:border-dashed')
      expect(html).toContain('disabled:text-muted-foreground')
      expect(html).toContain('disabled:opacity-100')
      expect(html).not.toContain('disabled:opacity-50')
      expect(html).not.toContain('disabled:grayscale')
    }
  )
})
