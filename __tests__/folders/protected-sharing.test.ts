import SharedFolderFilePage, {
  metadata,
} from '@/app/(main)/s/folders/[token]/files/[fileId]/page'
import SharedFolderPage from '@/app/(main)/s/folders/[token]/page'
import { hashSync } from 'bcryptjs'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getSharedFolder } from '@/lib/folders/shared'

const mocks = vi.hoisted(() => ({
  folder: vi.fn(),
  file: vi.fn(),
  session: vi.fn(),
  redirect: vi.fn((url: string): never => {
    throw new Error(`REDIRECT:${url}`)
  }),
  notFound: vi.fn((): never => {
    throw new Error('NOT_FOUND')
  }),
}))

vi.mock('@/lib/database/prisma', () => ({
  prisma: {
    vaultFolder: { findUnique: mocks.folder },
    file: { findFirst: mocks.file },
  },
}))
vi.mock('@/lib/auth', () => ({ getAccessSession: mocks.session }))
vi.mock('next/navigation', () => ({
  redirect: mocks.redirect,
  notFound: mocks.notFound,
}))
vi.mock('@/lib/config', () => ({
  getConfig: async () => ({
    settings: {
      customization: {
        published: {
          sharing: { showFilename: true, showSize: true, showFooter: false },
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
vi.mock('@/components/layout/footer', () => ({ Footer: () => null }))

const token = 'unguessable-folder-share-token'
const fileId = 'opaque-file-id'
const password = 'folder pass &+'
const passwordHash = hashSync(password, 4)
const canonicalPath = '/recipient-slug/Quarterly Budget FY26.pdf'
const opaquePath = `/s/folders/${token}/files/${fileId}`
const file = {
  id: fileId,
  name: 'Quarterly Budget FY26.pdf',
  urlPath: canonicalPath,
  mimeType: 'application/pdf',
  size: 12.345,
  password: passwordHash,
  userId: 'owner-id',
  visibility: 'PUBLIC' as const,
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.session.mockResolvedValue(null)
  mocks.file.mockResolvedValue(file)
  mocks.folder.mockResolvedValue({
    name: 'Marketing assets',
    files: [file],
    _count: { files: 1 },
  })
})

function openFile(providedPassword?: string | string[], shareToken = token) {
  return SharedFolderFilePage({
    params: Promise.resolve({ token: shareToken, fileId }),
    searchParams: Promise.resolve(
      providedPassword === undefined ? {} : { password: providedPassword }
    ),
  })
}

function expectNoProtectedMetadata(serialized: string) {
  for (const secret of [
    file.name,
    encodeURIComponent(file.name),
    canonicalPath,
    'recipient-slug',
    'Quarterly',
    file.mimeType,
    String(file.size),
    passwordHash,
    file.userId,
  ])
    expect(serialized).not.toContain(secret)
}

describe('protected shared-folder links', () => {
  it('masks filename-derived paths in both serialized data and the rendered folder page', async () => {
    const data = await getSharedFolder(token)
    expect(data!.files[0]).toMatchObject({
      name: 'Password-protected file',
      urlPath: opaquePath,
      mimeType: null,
      size: null,
      hasPassword: true,
    })
    expectNoProtectedMetadata(JSON.stringify(data))
    const html = renderToStaticMarkup(
      await SharedFolderPage({
        params: Promise.resolve({ token }),
        searchParams: Promise.resolve({}),
      })
    )
    expect(html).toContain(`href="${opaquePath}"`)
    expect(html).toContain('Password-protected file')
    expect(html).not.toContain('<img')
    expectNoProtectedMetadata(html)
  })

  it.each([undefined, 'wrong-password'])(
    'keeps the prompt and form action opaque before verification (%s)',
    async (provided) => {
      const html = renderToStaticMarkup(await openFile(provided))
      expect(html).toContain(`action="${opaquePath}"`)
      expect(html).toContain(
        provided ? 'Incorrect Password' : 'Password Protected File'
      )
      expect(html).toContain('type="password"')
      expectNoProtectedMetadata(html)
      expectNoProtectedMetadata(JSON.stringify(metadata))
      expect(mocks.redirect).not.toHaveBeenCalled()
    }
  )

  it('rechecks the active share token, direct membership, and PUBLIC visibility before checking access', async () => {
    await openFile()
    expect(mocks.file).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: fileId,
          visibility: 'PUBLIC',
          folder: { shareToken: token },
        },
      })
    )
    mocks.file.mockResolvedValueOnce(null)
    // Even a correct password is insufficient if the file has moved, become
    // private, or the folder's link was disabled or replaced.
    await expect(openFile(password)).rejects.toThrow('NOT_FOUND')
    expect(mocks.redirect).not.toHaveBeenCalled()
  })

  it('reveals an encoded canonical URL only after the real password check succeeds', async () => {
    await expect(openFile(password)).rejects.toThrow('REDIRECT:')
    const destination = new URL(
      mocks.redirect.mock.calls[0][0],
      'https://flare.test'
    )
    expect(destination.pathname).toBe(
      '/recipient-slug/Quarterly%20Budget%20FY26.pdf'
    )
    expect(destination.searchParams.get('password')).toBe(password)
  })

  it('lets the existing owner access rule bypass the password', async () => {
    mocks.session.mockResolvedValue({ user: { id: file.userId, role: 'USER' } })
    await expect(openFile()).rejects.toThrow('REDIRECT:')
    expect(mocks.redirect).toHaveBeenCalledWith(
      '/recipient-slug/Quarterly%20Budget%20FY26.pdf'
    )
  })

  it('rejects malformed share tokens and non-scalar password submissions without a lookup', async () => {
    await expect(openFile(password, 'bad-token')).rejects.toThrow('NOT_FOUND')
    await expect(openFile([password, password])).rejects.toThrow('NOT_FOUND')
    expect(mocks.file).not.toHaveBeenCalled()
    expect(mocks.redirect).not.toHaveBeenCalled()
  })

  it('preserves canonical links for files deliberately published without a password', async () => {
    mocks.folder.mockResolvedValueOnce({
      name: 'Marketing assets',
      files: [{ ...file, password: null }],
      _count: { files: 1 },
    })
    const data = await getSharedFolder(token)
    expect(data!.files[0]).toMatchObject({
      name: file.name,
      urlPath: '/recipient-slug/Quarterly%20Budget%20FY26.pdf',
      hasPassword: false,
    })
  })
})
