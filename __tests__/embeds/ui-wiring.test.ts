// @vitest-environment jsdom
import { createElement } from 'react'

import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { CustomizationStudio } from '@/components/customization/customization-studio'
import { ProfileClient } from '@/components/profile'

import {
  DEFAULT_APPEARANCE,
  DEFAULT_CUSTOMIZATION,
} from '@/lib/customization/schema'
import { DEFAULT_PERSONAL_EMBED, EMBED_LIMITS } from '@/lib/embeds/schema'

const session = vi.hoisted(() => ({ permissions: ['files.share'] as string[] }))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: () => {}, push: () => {}, replace: () => {} }),
  usePathname: () => '/dashboard/profile',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('next-auth/react', () => ({
  useSession: () => ({
    status: 'authenticated',
    data: {
      user: {
        id: 'u1',
        name: 'Ada',
        permissions: session.permissions,
        roles: [],
      },
    },
  }),
  signOut: async () => {},
}))
vi.mock('@/hooks/use-sign-out', () => ({ useSignOut: () => () => {} }))

afterEach(cleanup)

describe('appearance studio', () => {
  function mount() {
    render(
      createElement(CustomizationStudio, {
        initialState: DEFAULT_CUSTOMIZATION,
        creditsFooter: true,
      })
    )
    return within(
      screen.getByRole('navigation', { name: 'Appearance sections' })
    )
  }

  it('lists Embeds after Sharing and drops the old social preview fields', () => {
    const nav = mount()
    expect(
      nav.getAllByRole('button').map((button) => button.textContent)
    ).toEqual(['Identity', 'Theme', 'Sharing', 'Embeds', 'Appearance packs'])
    expect(nav.getByRole('button', { name: 'Embeds' }).title).toBe(
      'How links look where they are pasted'
    )
    fireEvent.click(nav.getByRole('button', { name: 'Sharing' }))
    expect(screen.queryByText(/Social preview/i)).toBeNull()
    expect(screen.queryByText(/social previews/i)).toBeNull()
    expect(screen.getByText(/attribution in embeds\./)).toBeTruthy()
    expect(
      screen.getByText('Display the name in the page heading and embeds.')
    ).toBeTruthy()
    expect(
      screen.getByRole('region', { name: 'Appearance preview' })
    ).toBeTruthy()
    expect(screen.queryByRole('region', { name: 'Embed preview' })).toBeNull()
  })

  it('edits the embed inside the draft and previews it', () => {
    const nav = mount()
    fireEvent.click(nav.getByRole('button', { name: 'Embeds' }))
    expect(screen.getByText('Decide how links unfold')).toBeTruthy()
    expect(
      screen.queryByRole('region', { name: 'Appearance preview' })
    ).toBeNull()
    const preview = within(
      screen.getByRole('region', { name: 'Embed preview' })
    )
    const chat = () =>
      within(preview.getByText('In a chat app').closest('figure')!)
    expect(screen.getByText('Published appearance')).toBeTruthy()

    expect(
      screen
        .getByRole('button', { name: /Direct media/ })
        .getAttribute('aria-pressed')
    ).toBe('true')
    expect(chat().queryByText('a-little-inspiration.png (1.8 MB)')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Rich embed/ }))
    expect(chat().getByText('a-little-inspiration.png (1.8 MB)')).toBeTruthy()
    expect(chat().getByText('Uploaded by you')).toBeTruthy()
    expect(screen.getByText('Unsaved changes')).toBeTruthy()

    const title = screen.getByLabelText('Title') as HTMLInputElement
    expect(title.value).toBe('{{filename}} ({{size}})')
    expect(title.maxLength).toBe(EMBED_LIMITS.title)
    expect(
      (screen.getByLabelText('Description') as HTMLTextAreaElement).maxLength
    ).toBe(EMBED_LIMITS.description)
    fireEvent.change(title, {
      target: { value: '{{filename}} on {{instanceName}}' },
    })
    expect(chat().getByText('a-little-inspiration.png on Flare')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Author'), {
      target: { value: '{{uploader}} · {{views}} views' },
    })
    expect(chat().getByText('you · 128 views')).toBeTruthy()

    const personal = screen.getByRole('switch', {
      name: 'Let people design their own',
    })
    expect(personal.getAttribute('aria-checked')).toBe('true')
    fireEvent.click(personal)
    expect(personal.getAttribute('aria-checked')).toBe('false')

    // The draft survives a visit to another section.
    fireEvent.click(nav.getByRole('button', { name: 'Identity' }))
    fireEvent.click(nav.getByRole('button', { name: 'Embeds' }))
    expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe(
      '{{filename}} on {{instanceName}}'
    )
    expect(
      screen
        .getByRole('switch', { name: 'Let people design their own' })
        .getAttribute('aria-checked')
    ).toBe('false')
  })
})

describe('profile', () => {
  const props = {
    user: {
      id: 'u1',
      name: 'Ada',
      email: 'ada@example.test',
      image: null,
      storageUsed: 0,
      roles: [],
      permissions: [],
      randomizeFileUrls: false,
      urlId: 'a1b2c',
      vanityId: null,
      fileCount: 0,
      shortUrlCount: 0,
      defaultFileExpiration: null,
      defaultFileExpirationAction: null,
    },
    quotasEnabled: false,
    formattedQuota: '',
    formattedUsed: '',
    usagePercentage: 0,
    initialSection: 'embeds' as const,
    initialPreference: { themeMode: 'inherit' as const },
    initialEmbed: DEFAULT_PERSONAL_EMBED,
    appearance: {
      brand: DEFAULT_APPEARANCE.brand,
      sharing: DEFAULT_APPEARANCE.sharing,
    },
  }

  it('offers Embeds after Uploads to someone who may share files', () => {
    session.permissions = ['files.share', 'files.upload']
    window.history.replaceState(null, '', '/dashboard/profile?section=embeds')
    render(createElement(ProfileClient, props))
    const nav = within(
      screen.getByRole('navigation', { name: 'Profile sections' })
    )
    const titles = nav
      .getAllByRole('button')
      .map((button) => button.textContent)
    expect(titles[1]).toContain('Uploads')
    expect(titles[2]).toBe('EmbedsHow your links preview')
    expect(screen.getByRole('heading', { name: 'Embeds' })).toBeTruthy()
    expect(
      screen.getByText(
        'Choose what apps show when you paste one of your links.'
      )
    ).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Save embed' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Rich embed/ }))
    expect(screen.getAllByText('Uploaded by Ada')).toHaveLength(2)
  })
})
