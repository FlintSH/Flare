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
  const part = ({
    children,
    ...props
  }: {
    children?: React.ReactNode
    [key: string]: unknown
  }) =>
    React.createElement(
      'div',
      Object.fromEntries(
        Object.entries(props).filter(([key]) => key.startsWith('data-'))
      ),
      children
    )
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
    expect(sharing).toContain('Copy link')
    expect(sharing).not.toContain('aria-label="Copy link to bundle.zip"')
    expect(sharing).toContain('Change visibility')
    expect(sharing).toContain('Add password')
    expect(card('files.update')).toContain('Manage expiration')
    expect(card('files.delete')).toContain('Delete file')
  })

  it('uses the complete generic filename as its only primary link and keeps actions in Manage', () => {
    session.permissions = ['files.read', 'files.share']
    const name =
      'Screenshot 2026-11-01 at 14.32.07 - onboarding flow redesign with updated empty states and mobile navigation.md'
    const html = renderToStaticMarkup(
      React.createElement(FileCard, {
        file: { ...file, name, mimeType: 'text/markdown' },
      })
    )
    const heading = html.match(
      /<a\b[^>]*data-file-name=""[^>]*>([\s\S]*?)<\/a>/
    )
    expect(heading?.[1]).toBe(name)
    expect(html.match(/data-file-primary=""/g)).toHaveLength(1)
    expect(html).not.toContain('data-file-preview=')
    expect(html).toContain(`aria-label="${name}"`)
    expect(html).toContain('Markdown')
    expect(html).toContain('Copy link')
    expect(html).toContain('Download file')
  })

  it('keeps permitted Delete after scrolling actions and hides its footer without permission', () => {
    const html = card('files.delete')
    const footer = html.indexOf('data-file-menu-delete=""')
    const belowCue = html.indexOf('data-file-menu-scroll-cue="below"')
    expect(footer).toBeGreaterThan(belowCue)
    expect(
      html.slice(html.indexOf('data-file-menu-scroll=""'), belowCue)
    ).not.toContain('Delete file')
    expect(html).toContain('Delete file')
    expect(card()).not.toContain('data-file-menu-delete=')
  })

  it('names a scheduled expiration explicitly where the role can manage it', () => {
    const render = (permissions: string[]) => {
      session.permissions = permissions
      return renderToStaticMarkup(
        React.createElement(FileCard, {
          file: { ...file, expiresAt: '2099-11-01T00:00:00.000Z' },
        })
      )
    }
    expect(render(['files.update'])).toContain('Expires ')
    expect(render([])).not.toContain('Expires ')
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
      'aria-label="+1: view all 3 tags"'
    )
    const viewer = render('files.read')
    expect(viewer).not.toContain('aria-label="+1: view all 3 tags"')
    expect(viewer).toContain('title="3 tags"')
  })

  it('exposes exact activity totals as text while keeping abbreviated numbers decorative', () => {
    session.permissions = []
    const views = 1499
    const downloads = 12345
    const html = renderToStaticMarkup(
      React.createElement(FileCard, { file: { ...file, views, downloads } })
    )
    const compact = new Intl.NumberFormat(undefined, { notation: 'compact' })
    for (const [count, noun] of [
      [views, 'views'],
      [downloads, 'downloads'],
    ] as const) {
      expect(html).toContain(`title="${count.toLocaleString()} ${noun}"`)
      expect(html).toContain(
        `<span class="sr-only">${count.toLocaleString()} ${noun}</span>`
      )
      expect(html).toContain(
        `<span aria-hidden="true">${compact.format(count)}</span>`
      )
    }
    expect(html).not.toMatch(/<span[^>]*aria-label="[^"]*(?:views|downloads)"/)
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
