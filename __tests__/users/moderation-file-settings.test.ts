import { type ReactNode, createElement } from 'react'

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import {
  FileSettingsDialog,
  fileSettingsChanges,
  fileSettingsForm,
} from '@/components/dashboard/user-list'

import { type AccountFile, fileSettingsSchema } from '@/lib/files/manage'

const { passThrough } = vi.hoisted(() => ({
  passThrough: ({ children }: { children?: ReactNode }) => children,
}))

vi.mock('@/lib/database/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/storage', () => ({ getStorageProvider: vi.fn() }))
// Radix renders dialogs and menus into a portal, which has no place on the
// server; plain elements show what they hold.
vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ open, children }: { open: boolean; children: ReactNode }) =>
    open ? children : null,
  DialogContent: passThrough,
  DialogHeader: passThrough,
  DialogTitle: passThrough,
  DialogDescription: passThrough,
  DialogFooter: passThrough,
}))
vi.mock('@/components/ui/select', () => ({
  Select: ({ value, children }: { value: string; children: ReactNode }) =>
    createElement('div', { 'data-value': value }, children),
  SelectItem: ({ value, children }: { value: string; children: ReactNode }) =>
    createElement('div', { 'data-item': value }, children),
  SelectTrigger: passThrough,
  SelectValue: () => null,
  SelectContent: passThrough,
}))

const file: AccountFile = {
  id: 'file',
  name: 'notes.txt',
  mimeType: 'text/plain',
  size: 5,
  visibility: 'PUBLIC',
  uploadedAt: '2026-11-06T00:00:00.000Z',
  urlPath: '/abcde/notes.txt',
  isPaste: false,
}
const protectedFile: AccountFile = { ...file, visibility: 'PROTECTED' }
const strict = fileSettingsSchema.strict()

function render(target: AccountFile) {
  return renderToStaticMarkup(
    createElement(FileSettingsDialog, {
      file: target,
      isOpen: true,
      onClose: () => {},
      onSave: async () => {},
    })
  )
}

describe('moderation file settings', () => {
  it('opens a password-protected file on keeping its visibility', () => {
    expect(fileSettingsForm(protectedFile).visibility).toBe('KEEP')
    const html = render(protectedFile)
    expect(html).toContain('data-value="KEEP"')
    expect(html).toContain('Keep current visibility')
    expect(html).toContain('Leave empty to keep the current password')
    expect(html).toContain('Remove password')
    // Nothing to save until something changes.
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*disabled/)
  })

  it('opens any other file on its own visibility, with nothing to remove', () => {
    for (const visibility of ['PUBLIC', 'PRIVATE'] as const) {
      expect(fileSettingsForm({ visibility }).visibility).toBe(visibility)
      const html = render({ ...file, visibility })
      expect(html).toContain(`data-value="${visibility}"`)
      expect(html).not.toContain('data-item="KEEP"')
      expect(html).not.toContain('Remove password')
    }
  })

  it('sends only what changed, in a form the server accepts', () => {
    const start = fileSettingsForm(protectedFile)
    const cases = [
      [protectedFile, start, {}],
      [
        protectedFile,
        { ...start, visibility: 'PRIVATE' },
        { visibility: 'PRIVATE' },
      ],
      [
        protectedFile,
        { ...start, password: 'new secret' },
        { password: 'new secret' },
      ],
      [protectedFile, { ...start, removePassword: true }, { password: null }],
      [file, fileSettingsForm(file), {}],
      [
        file,
        { ...fileSettingsForm(file), visibility: 'PRIVATE' },
        { visibility: 'PRIVATE' },
      ],
      [
        file,
        { ...fileSettingsForm(file), password: 'new secret' },
        { password: 'new secret' },
      ],
    ] as const
    for (const [target, form, sent] of cases) {
      const changes = fileSettingsChanges(target, form)
      expect(changes).toEqual(sent)
      expect(strict.safeParse(changes).success).toBe(true)
    }
  })
})
