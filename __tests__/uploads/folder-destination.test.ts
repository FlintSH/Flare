import React from 'react'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { dropFolder } from '@/components/dashboard/global-drop-zone'
import { UploadForm } from '@/components/file/upload-form'

const harness = vi.hoisted(() => ({
  permissions: null as string[] | null,
  search: '',
}))

vi.mock('next-auth/react', () => ({
  useSession: () =>
    harness.permissions
      ? {
          data: { user: { id: 'owner', permissions: harness.permissions } },
          status: 'authenticated',
        }
      : { data: undefined, status: 'loading' },
}))
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(harness.search),
  useRouter: () => ({ refresh: vi.fn() }),
}))
vi.mock('@/hooks/use-folders', () => ({
  useFolders: () => ({
    folders: [
      {
        id: 'folder-1',
        name: 'Projects',
        parentId: null,
        fileCount: 0,
        shareToken: null,
      },
    ],
    loading: false,
    error: false,
  }),
}))

const renderForm = () =>
  renderToStaticMarkup(
    React.createElement(
      QueryClientProvider,
      { client: new QueryClient() },
      React.createElement(UploadForm, {
        maxSize: 100,
        formattedMaxSize: '100 B',
        user: {
          defaultFileExpiration: null,
          defaultFileExpirationAction: null,
        },
      })
    )
  )

beforeEach(() => {
  harness.search = '?folder=folder-1'
})

describe('the upload form’s folder destination', () => {
  it('is offered to roles that can organize folders', () => {
    harness.permissions = ['files.upload', 'folders.manage']
    expect(renderForm()).toContain('Save to')
  })

  it('is hidden from roles without folder management, even for a folder link', () => {
    harness.permissions = ['files.upload', 'files.read', 'files.share']
    const html = renderForm()
    expect(html).not.toContain('Save to')
    expect(html).not.toContain('no longer available')
  })

  it('keeps a requested folder while the session loads', () => {
    harness.permissions = null
    expect(renderForm()).toContain('Save to')
  })
})

describe('the drop zone’s folder destination', () => {
  const files = (search: string) => ({ pathname: '/dashboard', search })
  const organizer = { permissions: ['files.upload', 'folders.manage'] }

  it('is the folder open in Files when the role can organize folders', () => {
    expect(dropFolder(files('?folder=folder-1'), organizer)).toBe('folder-1')
    expect(
      dropFolder(files('?folder=folder-1'), { permissions: ['administrator'] })
    ).toBe('folder-1')
  })

  it.each([{ permissions: ['files.upload', 'files.read'] }, null, undefined])(
    'is never preselected for roles without folder management: %j',
    (user) => {
      expect(dropFolder(files('?folder=folder-1'), user)).toBeNull()
    }
  )

  it.each([
    files('?folder=unfiled'),
    files('?folder='),
    files(''),
    { pathname: '/dashboard/urls', search: '?folder=folder-1' },
  ])('is unfiled outside a folder: %j', (location) => {
    expect(dropFolder(location, organizer)).toBeNull()
  })
})
