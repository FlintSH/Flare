import React from 'react'

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import { TagFilter } from '@/components/tags/tag-filter'

import { UNTAGGED } from '@/lib/library/contract'

vi.mock('@/hooks/use-tags', () => ({
  useTags: () => ({
    tags: [{ id: 'receipts', name: 'Invoices & receipts', fileCount: 2 }],
    loading: false,
    error: null,
    reload: vi.fn(),
  }),
}))

describe('tag filter accessible label', () => {
  it.each([
    { value: null, visible: 'Tags', name: 'Tags: filter files' },
    { value: UNTAGGED, visible: 'Untagged', name: 'Tags: Untagged' },
    {
      value: 'receipts',
      visible: 'Invoices &amp; receipts',
      name: 'Tags: Invoices &amp; receipts',
    },
  ])(
    'includes the visible $visible label in its name',
    ({ value, visible, name }) => {
      const html = renderToStaticMarkup(
        React.createElement(TagFilter, {
          value,
          onChange: vi.fn(),
          onManage: vi.fn(),
        })
      )
      expect(html).toContain(`aria-label="${name}"`)
      expect(html).toContain(`>${visible}</span>`)
    }
  )
})
