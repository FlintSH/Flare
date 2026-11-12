// @vitest-environment jsdom
import { createElement, useState } from 'react'

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { EmbedCardFields } from '@/components/embeds/embed-fields'
import { EmbedPreview } from '@/components/embeds/embed-preview'
import { PersonalEmbedSettings } from '@/components/embeds/personal-embed-settings'

import { DEFAULT_APPEARANCE } from '@/lib/customization/schema'
import { renderEmbedCard } from '@/lib/embeds/card'
import {
  DEFAULT_EMBED_CARD,
  DEFAULT_PERSONAL_EMBED,
  type EmbedCardTemplates,
} from '@/lib/embeds/schema'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function Fields({
  initial,
  seen,
}: {
  initial: EmbedCardTemplates
  seen: (card: EmbedCardTemplates) => void
}) {
  const [card, setCard] = useState(initial)
  seen(card)
  return createElement(EmbedCardFields, {
    value: card,
    onChange: (key, value) =>
      setCard((previous) => ({ ...previous, [key]: value })),
  })
}

function mountFields(initial: EmbedCardTemplates = DEFAULT_EMBED_CARD) {
  let latest = initial
  render(createElement(Fields, { initial, seen: (card) => (latest = card) }))
  return () => latest
}

describe('placeholder chips', () => {
  it('appends to the title when no line has had focus, and focuses it', () => {
    const card = mountFields()
    fireEvent.click(screen.getByRole('button', { name: '{{views}}' }))
    expect(card().title).toBe('{{filename}} ({{size}}){{views}}')
    const title = screen.getByLabelText('Title') as HTMLInputElement
    expect(document.activeElement).toBe(title)
    expect(title.selectionStart).toBe(title.value.length)
  })

  it('inserts at the caret of the line that last had focus', () => {
    const card = mountFields()
    const description = screen.getByLabelText(
      'Description'
    ) as HTMLTextAreaElement
    act(() => description.focus())
    description.setSelectionRange(9, 9)
    const chip = screen.getByRole('button', { name: '{{date}}' })
    expect(fireEvent.mouseDown(chip)).toBe(false)
    fireEvent.click(chip)
    expect(card().description).toBe('Uploaded {{date}}by {{uploader}}')
    expect(document.activeElement).toBe(description)
    expect(description.selectionStart).toBe(9 + '{{date}}'.length)
    expect(screen.getByText('Add to description')).toBeTruthy()
  })

  it('replaces the selection', () => {
    const card = mountFields()
    const title = screen.getByLabelText('Title') as HTMLInputElement
    act(() => title.focus())
    title.setSelectionRange(0, '{{filename}}'.length)
    fireEvent.click(screen.getByRole('button', { name: '{{type}}' }))
    expect(card().title).toBe('{{type}} ({{size}})')
  })

  it('still hears the next edit when it undoes the insertion exactly', () => {
    const card = mountFields({ ...DEFAULT_EMBED_CARD, author: 'abc' })
    const author = screen.getByLabelText('Author') as HTMLInputElement
    act(() => author.focus())
    author.setSelectionRange(3, 3)
    fireEvent.click(screen.getByRole('button', { name: '{{uploader}}' }))
    expect(card().author).toBe('abc{{uploader}}')
    // As a person would: select the placeholder and delete it.
    author.setRangeText('', 3, author.value.length, 'end')
    fireEvent.input(author)
    expect(card().author).toBe('abc')
  })

  it('does not write past the line limit', () => {
    const card = mountFields({
      ...DEFAULT_EMBED_CARD,
      siteName: 'x'.repeat(95),
    })
    act(() => screen.getByLabelText('Site name').focus())
    fireEvent.click(screen.getByRole('button', { name: '{{instanceName}}' }))
    expect(card().siteName).toBe('x'.repeat(95))
  })

  it('flags a placeholder that does not exist', () => {
    mountFields({ ...DEFAULT_EMBED_CARD, title: '{{nope}}' })
    const title = screen.getByLabelText('Title')
    expect(title.getAttribute('aria-invalid')).toBe('true')
    const error = document.getElementById(
      title.getAttribute('aria-describedby')!
    )
    expect(error?.textContent).toMatch(
      /^Use only \{\{filename\}\}.* placeholders\.$/
    )
  })
})

describe('accent color', () => {
  it('passes on only whole colors, keeps unfinished text, and clears', () => {
    const card = mountFields()
    const text = screen.getByLabelText('Accent color') as HTMLInputElement
    expect(text.value).toBe('')
    expect(
      screen.queryByRole('button', { name: 'Clear accent color' })
    ).toBeNull()
    fireEvent.change(text, { target: { value: '#12' } })
    expect(card().color).toBe('')
    expect(text.value).toBe('#12')
    expect(text.getAttribute('aria-invalid')).toBeNull()
    fireEvent.blur(text)
    expect(text.getAttribute('aria-invalid')).toBe('true')
    fireEvent.change(text, { target: { value: 'FF8800' } })
    expect(card().color).toBe('#ff8800')
    expect(text.value).toBe('#ff8800')
    expect(text.getAttribute('aria-invalid')).toBeNull()
    fireEvent.change(text, { target: { value: '#ff880' } })
    expect(card().color).toBe('#ff8800')
    fireEvent.change(screen.getByLabelText('Pick an accent color'), {
      target: { value: '#00ff00' },
    })
    expect(card().color).toBe('#00ff00')
    expect(text.value).toBe('#00ff00')
    fireEvent.click(screen.getByRole('button', { name: 'Clear accent color' }))
    expect(card().color).toBe('')
    expect(text.value).toBe('')
  })
})

const appearance = {
  brand: DEFAULT_APPEARANCE.brand,
  sharing: DEFAULT_APPEARANCE.sharing,
}
const chat = () => within(screen.getByText('In a chat app').closest('figure')!)
const linkCard = () =>
  within(screen.getByText('As a link card').closest('figure')!)

describe('embed preview', () => {
  const card: EmbedCardTemplates = {
    siteName: '{{instanceName}}',
    author: '{{uploader}}',
    title: '{{filename}} ({{size}})',
    description: 'Line one\n{{type}} · {{views}} views',
    color: '#ff8800',
  }

  it('direct mode: image alone, video as title and player, file as the card', () => {
    render(createElement(EmbedPreview, { mode: 'direct', card, appearance }))
    expect(chat().getByRole('img', { name: 'Sample picture' })).toBeTruthy()
    expect(chat().queryByText('a-little-inspiration.png (1.8 MB)')).toBeNull()
    expect(
      chat().getByText('https://flare.example/a1b2c/a-little-inspiration.png')
    ).toBeTruthy()
    // The link card always shows the card.
    expect(
      linkCard().getByText('a-little-inspiration.png (1.8 MB)')
    ).toBeTruthy()
    expect(linkCard().getByRole('img', { name: 'Sample picture' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Video' }))
    expect(chat().getByText('launch-recap.mp4 (24 MB)')).toBeTruthy()
    expect(chat().getByRole('img', { name: 'Sample video' })).toBeTruthy()
    expect(chat().queryByText('Flare')).toBeNull()
    expect(chat().queryByText('you')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'File' }))
    expect(chat().getByText('quarterly-report.pdf (420 KB)')).toBeTruthy()
    expect(chat().getByText('Flare')).toBeTruthy()
    expect(chat().getByText('you')).toBeTruthy()
    expect(chat().queryByRole('img')).toBeNull()
    expect(linkCard().queryByRole('img')).toBeNull()
  })

  it('rich mode: every sample shows the card, filled in as crawlers get it', () => {
    const { container } = render(
      createElement(EmbedPreview, {
        mode: 'rich',
        card,
        appearance,
        uploader: 'Ada',
      })
    )
    const expected = renderEmbedCard(
      card,
      {
        name: 'a-little-inspiration.png',
        size: '1.8 MB',
        mimeType: 'image/png',
        uploader: 'Ada',
        uploadedAt: new Date(),
        views: 128,
      },
      appearance
    )
    expect(chat().getByText(expected.title)).toBeTruthy()
    expect(chat().getByText('Ada')).toBeTruthy()
    const description = chat().getByText(/Line one/)
    expect(description.textContent).toBe(expected.description)
    expect(description.className).toContain('whitespace-pre-line')
    expect(chat().getByRole('img', { name: 'Sample picture' })).toBeTruthy()
    const bar = container.querySelector(
      '[style*="background-color"]'
    ) as HTMLElement
    expect(bar.style.backgroundColor).toBe('rgb(255, 136, 0)')
    fireEvent.click(screen.getByRole('button', { name: 'Video' }))
    expect(chat().getByText('Flare')).toBeTruthy()
    expect(chat().getByRole('img', { name: 'Sample video' })).toBeTruthy()
  })

  it('leaves empty lines off and falls back to the host', () => {
    const { container } = render(
      createElement(EmbedPreview, {
        mode: 'rich',
        card: {
          siteName: '',
          author: '',
          title: '',
          description: '',
          color: '',
        },
        appearance: {
          ...appearance,
          sharing: { ...appearance.sharing, showFilename: false },
        },
      })
    )
    expect(chat().getByText('Shared file')).toBeTruthy()
    expect(linkCard().getByText('flare.example')).toBeTruthy()
    expect(container.querySelector('[style*="background-color"]')).toBeNull()
    expect(container.querySelector('.bg-border')).toBeTruthy()
  })
})

describe('personal embed settings', () => {
  function mount(
    sharing = DEFAULT_APPEARANCE.sharing,
    initial = DEFAULT_PERSONAL_EMBED
  ) {
    render(
      createElement(PersonalEmbedSettings, {
        initial,
        appearance: { brand: DEFAULT_APPEARANCE.brand, sharing },
        uploader: 'Ada',
      })
    )
  }

  it('shows only the instance embed when accounts may not choose', () => {
    mount(
      {
        ...DEFAULT_APPEARANCE.sharing,
        personalEmbeds: false,
        embedMode: 'rich',
      },
      {
        ...DEFAULT_PERSONAL_EMBED,
        mode: 'direct',
        design: 'custom',
        title: 'Mine',
      }
    )
    expect(
      screen.getByText('This instance uses one embed for every account.')
    ).toBeTruthy()
    expect(screen.queryByRole('switch')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Save embed' })).toBeNull()
    expect(chat().getByText('a-little-inspiration.png (1.8 MB)')).toBeTruthy()
    expect(chat().queryByText('Mine')).toBeNull()
  })

  it('names the instance mode, seeds the card, previews and saves', async () => {
    const fetch = vi.fn(
      async (_path: string, init: RequestInit) =>
        new Response(JSON.stringify({ data: JSON.parse(String(init.body)) }), {
          headers: { 'Content-Type': 'application/json' },
        })
    )
    vi.stubGlobal('fetch', fetch)
    mount()
    const save = screen.getByRole('button', {
      name: 'Save embed',
    }) as HTMLButtonElement
    expect(save.disabled).toBe(true)
    const inherit = screen.getByRole('button', { name: /Use the instance’s/ })
    expect(inherit.getAttribute('aria-pressed')).toBe('true')
    expect(inherit.textContent).toContain('Currently direct media.')
    // The instance is direct: the image shows alone.
    expect(chat().queryByText('a-little-inspiration.png (1.8 MB)')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /Rich embed/ }))
    expect(chat().getByText('a-little-inspiration.png (1.8 MB)')).toBeTruthy()
    expect(save.disabled).toBe(false)

    expect(screen.queryByLabelText('Title')).toBeNull()
    fireEvent.click(screen.getByRole('switch', { name: 'Use my own card' }))
    const title = screen.getByLabelText('Title') as HTMLInputElement
    expect(title.value).toBe('{{filename}} ({{size}})')
    expect((screen.getByLabelText('Site name') as HTMLInputElement).value).toBe(
      '{{instanceName}}'
    )

    fireEvent.change(title, { target: { value: 'Mine: {{filename}' } })
    expect(save.disabled).toBe(true)
    fireEvent.change(title, { target: { value: 'Mine: {{filename}}' } })
    expect(chat().getByText('Mine: a-little-inspiration.png')).toBeTruthy()
    expect(save.disabled).toBe(false)

    fireEvent.click(save)
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
    const [path, init] = fetch.mock.calls[0]
    expect(path).toBe('/api/profile/embed')
    expect(init.method).toBe('PATCH')
    expect(JSON.parse(String(init.body))).toEqual({
      mode: 'rich',
      design: 'custom',
      siteName: '{{instanceName}}',
      author: '',
      title: 'Mine: {{filename}}',
      description: 'Uploaded by {{uploader}}',
      color: '',
    })
    await waitFor(() => expect(save.disabled).toBe(true))
    expect(save.textContent).toBe('Save embed')

    // Turning it off and on again keeps the lines already written.
    fireEvent.click(screen.getByRole('switch', { name: 'Use my own card' }))
    expect(screen.queryByLabelText('Title')).toBeNull()
    fireEvent.click(screen.getByRole('switch', { name: 'Use my own card' }))
    expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe(
      'Mine: {{filename}}'
    )
  })

  it('does not offer to save a card that was switched on and off again', () => {
    mount()
    const save = screen.getByRole('button', {
      name: 'Save embed',
    }) as HTMLButtonElement
    const own = screen.getByRole('switch', { name: 'Use my own card' })
    fireEvent.click(own)
    expect(save.disabled).toBe(false)
    fireEvent.click(own)
    expect(save.disabled).toBe(true)
  })

  it('does not let a hidden line that cannot be saved block Save', () => {
    mount()
    const own = screen.getByRole('switch', { name: 'Use my own card' })
    fireEvent.click(own)
    fireEvent.change(screen.getByLabelText('Title'), {
      target: { value: '{{nope}}' },
    })
    fireEvent.click(own)
    fireEvent.click(screen.getByRole('button', { name: /Rich embed/ }))
    const save = screen.getByRole('button', {
      name: 'Save embed',
    }) as HTMLButtonElement
    expect(save.disabled).toBe(false)
  })

  it('shows why a save was refused', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              error: 'This instance uses one embed for every account.',
            }),
            {
              status: 403,
              headers: { 'Content-Type': 'application/json' },
            }
          )
      )
    )
    mount()
    fireEvent.click(screen.getByRole('button', { name: /Rich embed/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Save embed' }))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe(
      'This instance uses one embed for every account.'
    )
    expect(
      (screen.getByRole('button', { name: 'Save embed' }) as HTMLButtonElement)
        .disabled
    ).toBe(false)
  })
})
