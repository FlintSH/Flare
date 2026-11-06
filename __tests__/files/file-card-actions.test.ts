import React from 'react'

import type { FileType } from '@/types/components/file'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import { FileCard } from '@/components/dashboard/file-card'
import { FolderBrowser } from '@/components/folders/folder-browser'

const session = vi.hoisted(() => ({ permissions: [] as string[] }))
vi.mock('next-auth/react', () => ({
  useSession: () => ({
    data: { user: { id: 'owner', permissions: session.permissions } },
    status: 'authenticated',
  }),
}))
// Menus render their items as if open.
vi.mock('@/components/ui/dropdown-menu', () => {
  const part = ({ children }: { children?: React.ReactNode }) =>
    React.createElement('div', null, children)
  return {
    DropdownMenu: part,
    DropdownMenuTrigger: part,
    DropdownMenuContent: part,
    DropdownMenuItem: part,
    DropdownMenuLabel: part,
    DropdownMenuSeparator: part,
  }
})

const file: FileType = {
  id: 'cmfilecard0001',
  name: 'bundle.zip',
  urlPath: '/Ab3dE/bundle.zip',
  mimeType: 'application/zip',
  visibility: 'PUBLIC',
  hasPassword: false,
  size: 1,
  uploadedAt: '2026-10-01T00:00:00.000Z',
  views: 0,
  downloads: 0,
}
const noop = () => {}

function card(...permissions: string[]) {
  session.permissions = permissions
  return renderToStaticMarkup(
    React.createElement(FileCard, {
      file,
      onBrowseArchive: noop,
      onEditTags: noop,
      onMove: noop,
    })
  )
}

describe('file card actions', () => {
  it('offers each action only with the permissions it needs', () => {
    const none = card()
    for (const label of [
      'Browse archive',
      'Copy link',
      'Change visibility',
      'Add password',
      'Manage expiration',
      'Delete file',
      'Edit tags',
      'Move to folder',
    ])
      expect(none, label).not.toContain(label)
    expect(none).toContain('Open file')
    expect(none).toContain('Download file')

    expect(card('files.read')).toContain('Browse archive')
    const sharing = card('files.share')
    expect(sharing).toContain('aria-label="Copy link to bundle.zip"')
    expect(sharing).toContain('Change visibility')
    expect(sharing).toContain('Add password')
    expect(card('files.update')).toContain('Manage expiration')
    expect(card('files.delete')).toContain('aria-label="Delete bundle.zip"')
  })

  it('needs file editing as well as tags or folders to organize a file', () => {
    expect(card('tags.manage')).not.toContain('Edit tags')
    expect(card('folders.manage')).not.toContain('Move to folder')
    expect(card('files.update', 'tags.manage')).toContain('Edit tags')
    expect(card('files.update', 'folders.manage')).toContain('Move to folder')
  })

  it('opens the tag editor from the hidden-tag count only where the menu offers Edit tags', () => {
    const tagged = {
      ...file,
      tags: ['Work', 'Taxes', 'Receipts'].map((name) => ({ id: name, name })),
    }
    const render = (...permissions: string[]) => {
      session.permissions = permissions
      return renderToStaticMarkup(
        React.createElement(FileCard, { file: tagged, onEditTags: noop })
      )
    }
    expect(render('files.update', 'tags.manage')).toContain(
      'aria-label="View all 3 tags"'
    )
    const viewer = render('files.read')
    expect(viewer).not.toContain('View all 3 tags')
    expect(viewer).toContain('title="3 tags"')
  })
})

describe('folder actions that need folders.manage', () => {
  const browse = (...permissions: string[]) => {
    session.permissions = permissions
    return renderToStaticMarkup(
      React.createElement(FolderBrowser, {
        folders: [
          {
            id: 'cmfolder0001',
            name: 'Projects',
            parentId: null,
            fileCount: 0,
            shareToken: null,
          },
        ] as never,
        value: 'cmfolder0001',
        onChange: noop,
        loading: false,
        error: false,
        onRetry: noop,
      })
    )
  }

  it('offers Upload here only to roles the server lets save into folders', () => {
    expect(browse('files.read', 'files.upload')).not.toContain('Upload here')
    for (const permissions of [
      ['files.upload', 'folders.manage'],
      ['administrator'],
    ])
      expect(browse(...permissions)).toContain(
        'href="/dashboard/upload?folder=cmfolder0001"'
      )
  })

  it('offers Share only to roles that can create or disable the link', () => {
    for (const permissions of [['folders.share'], ['folders.manage']])
      expect(browse(...permissions)).not.toMatch(/Share(?! the)/)
    for (const permissions of [
      ['folders.share', 'folders.manage'],
      ['administrator'],
    ]) {
      const html = browse(...permissions)
      expect(html).toContain('>Share<')
      expect(html).toContain('Share folder')
    }
  })
})
