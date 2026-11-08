import { createElement } from 'react'

import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { UploadForm } from '@/components/file/upload-form'
import type { ButtonProps } from '@/components/ui/button'

import type { QueuedFile } from '@/lib/uploads/queue'

const queue = vi.hoisted(() => ({
  uploading: false,
  files: [] as QueuedFile[],
  activityUploading: false,
  upload: vi.fn(),
  primaryProps: null as (ButtonProps & { 'aria-describedby'?: string }) | null,
}))

vi.mock('@/components/ui/button', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('@/components/ui/button')>()
  return {
    ...original,
    Button: (props: ButtonProps & { 'data-upload-primary'?: string }) => {
      if (props['data-upload-primary'] !== undefined) queue.primaryProps = props
      return createElement(original.Button, props)
    },
  }
})
vi.mock('@/lib/uploads/queue', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/uploads/queue')>()),
  uploadActivity: {
    get: () => ({ file: null, uploading: queue.activityUploading }),
    subscribe: () => () => {},
  },
}))

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
    files: queue.files,
    uploading: queue.uploading,
    add: vi.fn(),
    remove: vi.fn(),
    clear: vi.fn(),
    upload: queue.upload,
  }),
}))
vi.mock(
  '@/components/upload-profiles/upload-selection',
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import('@/components/upload-profiles/upload-selection')
    >()),
    useUploadSelection: () => ({
      status: 'automatic',
      value: undefined,
      selectedValue: 'default',
      canManageProfiles: false,
      profiles: [],
      defaultProfileName: undefined,
      effective: null,
      summary: 'Private. Saved defaults apply automatically.',
    }),
  })
)
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
  queue.files = []
  queue.activityUploading = false
  queue.primaryProps = null
  queue.upload.mockReset().mockResolvedValue(null)
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

function selectedFiles() {
  return ['first.txt', 'second.txt', 'third.txt', 'fourth.txt'].map(
    (name, index) => ({
      key: index + 1,
      file: new File([new Uint8Array(index + 1)], name, { type: 'text/plain' }),
      uploaded: 0,
      progress: 0,
    })
  )
}

describe('upload queue presentation', () => {
  it('counts the complete batch while initially rendering two files and a named disclosure', () => {
    queue.files = selectedFiles()
    const html = render()
    expect([...html.matchAll(/<li\b/g)]).toHaveLength(2)
    expect(html).toContain('first.txt')
    expect(html).toContain('second.txt')
    expect(html).not.toContain('third.txt')
    expect(html).not.toContain('fourth.txt')
    expect(html).toContain('Show all 4 files')
    expect(html).toContain('aria-expanded="false"')
    expect(html).toContain('Upload 4 files')
    expect([...html.matchAll(/data-upload-primary=""/g)]).toHaveLength(1)
    const text = html.replace(/<!--.*?-->/g, '').replace(/<[^>]+>/g, '')
    expect(text).toContain('(4 · 10 B)')
  })

  it('renders every per-file progress entry during transfer without removal or collapse controls', () => {
    queue.files = selectedFiles()
    queue.uploading = true
    const html = render()
    expect([...html.matchAll(/<li\b/g)]).toHaveLength(4)
    for (const { file } of queue.files) {
      expect(html).toContain(`Upload progress for ${file.name}`)
      expect(html).not.toContain(`Remove ${file.name}`)
    }
    expect(html).not.toContain('Show all')
    expect(html).not.toContain('Show fewer files')
    expect([...html.matchAll(/data-upload-primary=""/g)]).toHaveLength(1)
  })

  it('keeps a waiting batch and explains its disabled action while another upload is running', async () => {
    queue.files = selectedFiles()
    queue.activityUploading = true
    const selected = queue.files
    const html = render()
    expect(queue.primaryProps!.disabled).toBe(true)
    expect(html).toContain('Another upload is running.')
    expect(html).toContain('Your files stay queued; start this')
    const descriptions = queue.primaryProps!['aria-describedby']!.split(/\s+/)
    expect(descriptions).toHaveLength(2)
    expect(html).toContain(
      `id="${descriptions.find((id) => id.endsWith('-waiting'))}" role="status"`
    )
    expect(html).toContain(
      `id="${descriptions.find((id) => id.endsWith('-summary'))}" aria-live="polite"`
    )
    await queue.primaryProps!.onClick?.({} as never)
    expect(queue.upload).not.toHaveBeenCalled()
    expect(queue.files).toBe(selected)
    expect(queue.files).toHaveLength(4)

    queue.activityUploading = false
    const ready = render()
    expect(queue.primaryProps!.disabled).toBe(false)
    expect(ready).not.toContain('Another upload is running.')
    expect(queue.upload).not.toHaveBeenCalled()
    await queue.primaryProps!.onClick?.({} as never)
    await vi.waitFor(() => expect(queue.upload).toHaveBeenCalledOnce())
  })

  it('checks fresh global activity when an earlier enabled action is invoked', async () => {
    queue.files = selectedFiles()
    render()
    expect(queue.primaryProps!.disabled).toBe(false)
    const onClick = queue.primaryProps!.onClick!
    queue.activityUploading = true
    await onClick({} as never)
    expect(queue.upload).not.toHaveBeenCalled()
    expect(queue.files).toHaveLength(4)
  })
})

describe('upload final-action description', () => {
  it('associates one complete summary without changing the inherited request options', async () => {
    queue.files = selectedFiles()
    const html = render()
    const description = queue.primaryProps!['aria-describedby']!
    expect(description).toMatch(/-summary$/)
    expect(html).toContain(`id="${description}" aria-live="polite"`)
    expect(
      html.match(/Private\. Saved defaults apply automatically\./g)
    ).toHaveLength(1)
    await queue.primaryProps!.onClick?.({} as never)
    await vi.waitFor(() => expect(queue.upload).toHaveBeenCalledOnce())
    expect(queue.upload).toHaveBeenCalledWith({
      profileId: undefined,
      folderId: null,
      visibility: undefined,
      password: '',
      expiresAt: undefined,
      expiryAction: undefined,
    })
  })
})
