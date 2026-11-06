import React from 'react'

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import { AppearancePreview } from '@/components/customization/appearance-preview'
import { CustomizationStudio } from '@/components/customization/customization-studio'

import {
  type AppearanceDocument,
  DEFAULT_APPEARANCE,
  DEFAULT_CUSTOMIZATION,
} from '@/lib/customization/schema'
import { showsShareFooter } from '@/lib/customization/sharing'

const session = vi.hoisted(() => ({ permissions: [] as string[] }))
vi.mock('next-auth/react', () => ({
  useSession: () => ({
    data: { user: { id: 'designer', permissions: session.permissions } },
    status: 'authenticated',
  }),
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))

const footer = (showFooter: boolean | null): AppearanceDocument => ({
  ...DEFAULT_APPEARANCE,
  sharing: { ...DEFAULT_APPEARANCE.sharing, showFooter },
})

describe('share-page footer', () => {
  it.each([
    [null, true, true],
    [null, false, false],
    [true, false, true],
    [false, true, false],
  ])(
    'with the appearance choosing %s and credits %s, shows it: %s',
    (choice, credits, shown) => {
      expect(showsShareFooter(footer(choice), credits)).toBe(shown)
    }
  )

  it('previews an inherited footer only when the instance shows credits', () => {
    const preview = (creditsFooter: boolean) =>
      renderToStaticMarkup(
        React.createElement(AppearancePreview, {
          document: footer(null),
          creditsFooter,
          mode: 'dark',
          onModeChange: () => {},
          protectedPreview: false,
          onProtectedChange: () => {},
        })
      )
    const text = DEFAULT_APPEARANCE.brand.footerText
    expect(preview(true)).toContain(text)
    expect(preview(false)).not.toContain(text)
  })
})

describe('appearance studio links', () => {
  const studio = (permissions: string[]) => {
    session.permissions = permissions
    return renderToStaticMarkup(
      React.createElement(CustomizationStudio, {
        initialState: DEFAULT_CUSTOMIZATION,
        creditsFooter: true,
        recovery: true,
      })
    )
  }

  it('links Custom CSS and HTML for administrators, who see the editors', () => {
    const html = studio(['administrator'])
    expect(html).toContain('href="#advanced-styles"')
    expect(html).toContain('recovery=1#advanced-styles')
  })

  it('gives delegated designers no link to editors they cannot see', () => {
    const html = studio(['settings.read', 'appearance.manage'])
    expect(html).not.toContain('advanced-styles')
    expect(html).toContain('Restore a previous appearance below.')
    expect(html).toContain('Your favicon is below.</p>')
  })
})
