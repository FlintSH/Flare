// @vitest-environment jsdom
import { createElement, useState } from 'react'

import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { FileFilters } from '@/components/dashboard/file-grid/file-filters'

const fileTypes = [
  'application/octet-stream',
  'application/pdf',
  'text/plain',
  'audio/mpeg',
  'video/mp4',
  'image/png',
]

function Fixture({ initialTypes = [] }: { initialTypes?: string[] }) {
  const [selectedTypes, onTypesChange] = useState(initialTypes)
  return createElement(FileFilters, {
    sortBy: 'newest',
    onSortChange: () => {},
    selectedTypes,
    onTypesChange,
    fileTypes,
    date: undefined,
    onDateChange: () => {},
    groupBy: 'none',
    onGroupChange: () => {},
    visibility: [],
    onVisibilityChange: () => {},
  })
}

function openPicker() {
  fireEvent.click(screen.getByRole('button', { name: 'File type' }))
  return screen.getByRole('textbox', { name: 'Find a file type' })
}

function search(value: string) {
  fireEvent.change(screen.getByRole('textbox', { name: 'Find a file type' }), {
    target: { value },
  })
}

function choices() {
  return within(screen.getByRole('group', { name: 'Filter files by type' }))
}

afterEach(cleanup)

describe('gallery file-type picker', () => {
  it('matches MIME values and readable labels without case sensitivity', () => {
    render(createElement(Fixture))
    openPicker()
    search('  IMAGE/Pn  ')
    expect(
      choices()
        .getAllByRole('button')
        .map((item) => item.textContent)
    ).toEqual(['PNG'])
    search('pLaIn TeXt')
    expect(
      choices()
        .getAllByRole('button')
        .map((item) => item.textContent)
    ).toEqual(['Plain text'])
    search('application/')
    expect(
      choices()
        .getAllByRole('button')
        .map((item) => item.textContent)
    ).toEqual(['PDF', 'Other file'])
  })

  it('preserves multiple selections through a nonmatching search and reopening', () => {
    // A selected type absent from the current suggestions must remain removable.
    render(createElement(Fixture, { initialTypes: ['image/jpeg'] }))
    const input = openPicker()
    fireEvent.click(choices().getByRole('button', { name: 'PDF' }))
    search('no-such-mime')
    expect(screen.getByText('No matching file types.')).toBeTruthy()
    expect(choices().queryAllByRole('button')).toHaveLength(0)
    fireEvent.keyDown(input, { key: 'Escape', code: 'Escape' })
    expect(
      screen.queryByRole('textbox', { name: 'Find a file type' })
    ).toBeNull()
    expect((openPicker() as HTMLInputElement).value).toBe('')
    expect(
      choices()
        .getByRole('button', { name: 'JPEG' })
        .getAttribute('aria-pressed')
    ).toBe('true')
    expect(
      choices()
        .getByRole('button', { name: 'PDF' })
        .getAttribute('aria-pressed')
    ).toBe('true')
    fireEvent.click(choices().getByRole('button', { name: 'JPEG' }))
    expect(choices().queryByRole('button', { name: 'JPEG' })).toBeNull()
    expect(
      choices()
        .getByRole('button', { name: 'PDF' })
        .getAttribute('aria-pressed')
    ).toBe('true')
  })

  it('lists named categories before Other files, regardless of MIME ordering', () => {
    render(createElement(Fixture))
    openPicker()
    const group = screen.getByRole('group', { name: 'Filter files by type' })
    const categoryNames = [
      'Images',
      'Videos',
      'Audio',
      'Documents',
      'Other files',
    ]
    const headings = categoryNames.map((name) => within(group).getByText(name))
    for (let index = 1; index < headings.length; index++) {
      expect(
        headings[index - 1].compareDocumentPosition(headings[index]) &
          Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy()
    }
    expect(choices().getAllByRole('button').at(-1)?.textContent).toBe(
      'Other file'
    )
  })
})
