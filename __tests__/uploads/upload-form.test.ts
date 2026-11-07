import { createElement } from 'react'

import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { UploadForm } from '@/components/file/upload-form'

const queue = vi.hoisted(() => ({ uploading: false }))

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('@/hooks/use-permissions', () => ({
  usePermissions: () => ({
    user: { id: 'demo-user', permissions: ['files.upload'] },
  }),
}))
vi.mock('@/hooks/use-folders', () => ({
  useFolders: () => ({ folders: [], loading: false, error: false }),
}))
vi.mock('@/hooks/use-upload-queue', () => ({
  copyUploadLinks: vi.fn(),
  useUploadQueue: () => ({
    files: [],
    uploading: queue.uploading,
    add: vi.fn(),
    remove: vi.fn(),
    clear: vi.fn(),
    upload: vi.fn(),
  }),
}))
vi.mock('@/components/upload-profiles/profile-picker', () => ({
  ProfilePicker: () => null,
}))
vi.mock('@/components/shared/expiry-modal', () => ({
  ExpiryModal: () => null,
}))

function render() {
  return renderToStaticMarkup(
    createElement(UploadForm, {
      maxSize: 1024,
      formattedMaxSize: '1 KB',
      user: {
        defaultFileExpiration: null,
        defaultFileExpirationAction: null,
      },
    })
  )
}

function attribute(tag: string, name: string) {
  return tag.match(new RegExp(`(?:^|\\s)${name}="([^"]*)"`))?.[1]
}

function picker(html: string) {
  const region = html.match(/<div\b[^>]*role="region"[^>]*>/)?.[0]
  const input = html.match(/<input\b[^>]*type="file"[^>]*>/)?.[0]
  const button = [
    ...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g),
  ].find((entry) => attribute(entry[1], 'aria-labelledby'))
  expect(region, 'The drag target is a named region').toBeDefined()
  expect(input, 'The native file input remains present').toBeDefined()
  expect(button, 'The picker is a native named button').toBeDefined()
  return { region: region!, input: input!, button: button! }
}

beforeEach(() => {
  queue.uploading = false
})

describe('upload file-selection accessibility', () => {
  it('separates the native picker button, labeled multiple-file input, and hints', () => {
    // Render the actual installed dropzone hook: its native input props must
    // remain intact while the form gives each control its own semantics.
    const html = render()
    const { region, input, button } = picker(html)
    expect(attribute(region, 'aria-label')).toBe('File selection')
    expect(attribute(region, 'tabindex')).toBeUndefined()
    expect(attribute(button[1], 'type')).toBe('button')
    expect(attribute(button[1], 'role')).toBeUndefined()
    expect(button[2]).not.toMatch(/<(?:input|button|a|select|textarea)\b/)
    expect(attribute(input, 'aria-label')).toBe('Files to upload')
    expect(input).toMatch(/\smultiple(?:="")?(?:\s|\/>)/)
    expect(attribute(input, 'tabindex')).toBe('-1')
    expect(attribute(input, 'aria-hidden')).toBeUndefined()

    const titleId = attribute(button[1], 'aria-labelledby')!
    const hintId = attribute(button[1], 'aria-describedby')!
    expect(attribute(input, 'aria-describedby')).toBe(hintId)
    expect(attribute(region, 'aria-describedby')).toBe(hintId)
    const paragraphs = [...html.matchAll(/<p\b([^>]*)>([\s\S]*?)<\/p>/g)]
    const title = paragraphs.find(
      (entry) => attribute(entry[1], 'id') === titleId
    )
    const hint = paragraphs.find(
      (entry) => attribute(entry[1], 'id') === hintId
    )
    expect(title).toBeDefined()
    expect(hint).toBeDefined()
    expect(title![2].replace(/<[^>]*>/g, '')).toBe('Choose files to upload')
    expect(hint![2]).toContain('Maximum file size: 1 KB')
    expect(hint![2]).toContain('Or drag and drop files here.')
  })

  it('disables both picker controls and marks the drop region while uploading', () => {
    queue.uploading = true
    const { region, input, button } = picker(render())
    expect(attribute(region, 'aria-disabled')).toBe('true')
    expect(input).toMatch(/\sdisabled(?:="")?(?:\s|\/>)/)
    expect(button[1]).toMatch(/\sdisabled(?:="")?(?:\s|$)/)
  })
})
