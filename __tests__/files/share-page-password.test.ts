import FilePage from '@/app/(main)/[userUrlId]/[filename]/page'
import { hashSync } from 'bcryptjs'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { configureAuditWriter } from '@/lib/audit'
import { FILE_PASSWORD_ATTEMPTS } from '@/lib/files/password-attempts'

const mocks = vi.hoisted(() => ({
  update: vi.fn(),
  notFound: vi.fn((): never => {
    throw new Error('NOT_FOUND')
  }),
  file: undefined as unknown,
}))

const password = 'share-page-password-1'
const file = {
  id: 'share-page-paused-file',
  name: 'contract.pdf',
  urlPath: '/owner/contract.pdf',
  visibility: 'PUBLIC',
  password: hashSync(password, 4),
  userId: 'owner',
  mimeType: 'application/pdf',
  size: 1,
  uploadedAt: new Date('2026-10-01T00:00:00Z'),
  path: 'uploads/owner/contract.pdf',
  uploadOptions: null,
  user: { name: 'Owner', image: null, urlId: 'owner' },
}

vi.mock('next/headers', () => ({
  headers: async () => new Headers({ 'x-real-ip': '203.0.113.90' }),
}))
vi.mock('next/navigation', () => ({ notFound: mocks.notFound }))
vi.mock('@/lib/auth', () => ({ getAccessSession: async () => null }))
vi.mock('@/lib/database/prisma', () => ({
  prisma: {
    file: { findUnique: async () => mocks.file, update: mocks.update },
  },
}))
vi.mock('@/lib/config', () => ({
  getConfig: async () => ({
    settings: {
      customization: {
        published: {
          brand: { name: 'Flare' },
          sharing: { showFooter: false, showFilename: true },
        },
      },
      general: { credits: { showFooter: false } },
    },
  }),
}))
vi.mock('@/components/customization/instance-brand', () => ({
  InstanceBrand: () => null,
}))
vi.mock('@/components/layout/dynamic-background', () => ({
  DynamicBackground: () => null,
}))

function open(guess: string) {
  return FilePage({
    params: Promise.resolve({ userUrlId: 'owner', filename: 'contract.pdf' }),
    searchParams: Promise.resolve({ password: guess }),
  })
}

beforeEach(() => {
  configureAuditWriter(async () => undefined)
  mocks.file = file
  mocks.update.mockReset()
})

describe('share page password pause', () => {
  it('shows a wait message instead of another wrong-password prompt', async () => {
    for (
      let attempt = 1;
      attempt <= FILE_PASSWORD_ATTEMPTS.perRequester;
      attempt++
    ) {
      const html = renderToStaticMarkup(await open(`wrong-${attempt}`))
      expect(html).toContain('That password didn’t match.')
    }

    const html = renderToStaticMarkup(await open(password))
    expect(html).toContain('Password-protected file')
    expect(html).toContain(
      'Too many incorrect passwords were entered for this file. Wait 15 min, then try again.'
    )
    expect(html).not.toContain('That password didn’t match.')
    expect(html).not.toContain(file.password)
  })
})

describe('share page views', () => {
  // Attempt limits are process-wide; use a file the pause test never touches.
  const viewed = { ...file, id: 'share-page-views-file' }
  beforeEach(() => {
    mocks.file = viewed
  })

  it('counts no view for the password form or a wrong password', async () => {
    renderToStaticMarkup(await open(''))
    renderToStaticMarkup(await open('not-the-password'))
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it('counts no view for a private file hidden from the visitor', async () => {
    mocks.file = { ...viewed, visibility: 'PRIVATE', password: null }
    await expect(open('')).rejects.toThrow('NOT_FOUND')
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it('counts one view once the visitor may see the file', async () => {
    await open(password)
    expect(mocks.update).toHaveBeenCalledOnce()
    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: viewed.id },
      data: { views: { increment: 1 } },
    })
  })
})
