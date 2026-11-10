import FilePage, {
  generateMetadata,
} from '@/app/(main)/[userUrlId]/[filename]/page'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { configureAuditWriter } from '@/lib/audit'
import { accountKeysFromPrivateKey, base64urlDecode } from '@/lib/e2ee'
import { newEncryptedFile } from '@/lib/e2ee/client/files'
import type { AccountPrivateKey } from '@/lib/e2ee/types'

const mocks = vi.hoisted(() => ({
  update: vi.fn(),
  notFound: vi.fn((): never => {
    throw new Error('NOT_FOUND')
  }),
  file: undefined as unknown,
  session: null as unknown,
  audits: [] as Array<Record<string, unknown>>,
  getPublicUrl: vi.fn(),
}))

const account = accountKeysFromPrivateKey(
  Uint8Array.from({ length: 32 }, (_, i) => i + 5) as AccountPrivateKey
)
const created = newEncryptedFile({
  name: 'surprise-party-plan.png',
  type: 'image/png',
  accountPublicKey: account.accountPublicKey,
})
const fileId = 'e_0123456789abcdefghijkl'
const file = {
  id: 'encrypted-file',
  name: '',
  urlPath: `/owner/${fileId}`,
  visibility: 'PUBLIC',
  password: null,
  userId: 'owner',
  mimeType: 'application/octet-stream',
  size: 1,
  uploadedAt: new Date('2026-11-10T00:00:00Z'),
  path: `uploads/owner/object/${fileId}`,
  uploadOptions: null,
  folderId: null,
  encrypted: true,
  header: base64urlDecode(created.records.header),
  sealedMetadata: base64urlDecode(created.records.sealedMetadata),
  accountStanza: base64urlDecode(created.records.accountStanza),
  stanzaAccountPublicKey: account.accountPublicKey,
  passwordStanza: null,
  user: { name: 'Owner Name', image: null, urlId: 'owner' },
}

vi.mock('next/headers', () => ({
  headers: async () =>
    new Headers({ host: 'flare.test', 'x-real-ip': '203.0.113.90' }),
}))
vi.mock('next/navigation', () => ({ notFound: mocks.notFound }))
vi.mock('@/lib/auth', () => ({ getAccessSession: async () => mocks.session }))
vi.mock('@/lib/database/prisma', () => ({
  prisma: {
    file: { findUnique: async () => mocks.file, update: mocks.update },
  },
}))
vi.mock('@/lib/storage', () => ({
  getStorageProvider: async () => ({ getPublicUrl: mocks.getPublicUrl }),
}))
vi.mock('@/lib/config', () => ({
  getConfig: async () => ({
    settings: {
      customization: {
        published: {
          brand: { name: 'Harbor Files', tagline: 'Fast file sharing' },
          sharing: {
            showFooter: false,
            showFilename: true,
            showSize: true,
            showUploader: true,
            metadataTitle: '{{filename}}',
            metadataDescription: '{{filename}} by {{uploader}}',
          },
        },
      },
      general: { credits: { showFooter: false } },
    },
  }),
}))

const props = {
  params: Promise.resolve({ userUrlId: 'owner', filename: fileId }),
  searchParams: Promise.resolve({}),
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.file = file
  mocks.session = null
  mocks.audits = []
  configureAuditWriter(async (event) => void mocks.audits.push(event))
})

describe('link preview of an encrypted file (section 11.3)', () => {
  it('is the same generic preview for every encrypted file', async () => {
    const metadata = await generateMetadata(props)
    expect(metadata).toEqual({
      title: 'Encrypted file - Harbor Files',
      description: 'Open the link to view this file.',
      metadataBase: new URL('http://flare.test'),
      robots: { index: false, follow: false },
      openGraph: {
        siteName: 'Harbor Files',
        title: 'Encrypted file',
        description: 'Open the link to view this file.',
        type: 'website',
        images: [{ url: 'http://flare.test/icon.svg', alt: 'Harbor Files' }],
      },
      twitter: {
        card: 'summary',
        title: 'Encrypted file',
        description: 'Open the link to view this file.',
      },
    })
  })

  it('names no file, type, uploader, raw address or storage address', async () => {
    const text = JSON.stringify(await generateMetadata(props))
    for (const leak of [
      'surprise',
      'png',
      'octet-stream',
      'Owner Name',
      '/raw',
      '/direct',
      fileId,
      'video',
    ])
      expect(text, leak).not.toContain(leak)
    expect(mocks.getPublicUrl).not.toHaveBeenCalled()
  })

  it('gives a stranger nothing about a private encrypted file', async () => {
    mocks.file = { ...file, visibility: 'PRIVATE' }
    expect(await generateMetadata(props)).toEqual({
      title: 'Protected file - Harbor Files',
      description: 'This file is protected.',
    })
    await expect(FilePage(props)).rejects.toThrow('NOT_FOUND')
  })

  it('records the view with the file ID and no name', async () => {
    await FilePage(props)
    expect(mocks.audits).toHaveLength(1)
    expect(mocks.audits[0]).toMatchObject({
      action: 'file.view',
      targetId: 'encrypted-file',
    })
    expect(mocks.audits[0].targetName ?? null).toBeNull()
    expect(mocks.update).toHaveBeenCalledOnce()
  })
})

describe('what the share page gives the browser', () => {
  const pageProps = async () => {
    const element = (await FilePage(props)) as {
      props: { children: { props: { file: Record<string, unknown> } } }
    }
    return element.props.children.props.file
  }

  it('sends a visitor the records without the account stanza', async () => {
    const sent = await pageProps()
    expect(sent).toMatchObject({
      id: 'encrypted-file',
      urlPath: `/owner/${fileId}`,
      sizeBytes: 1048576,
      isOwner: false,
      isModerator: false,
      records: {
        header: created.records.header,
        sealedMetadata: created.records.sealedMetadata,
        passwordStanza: null,
      },
    })
    expect(
      (sent.records as Record<string, unknown>).accountStanza
    ).toBeUndefined()
    expect(JSON.stringify(sent)).not.toContain('surprise')
  })

  it('sends the owner the account stanza, and a moderator only the mark', async () => {
    mocks.session = { user: { id: 'owner', permissions: ['files.read'] } }
    const owner = await pageProps()
    expect(owner.isOwner).toBe(true)
    expect((owner.records as Record<string, unknown>).accountStanza).toBe(
      created.records.accountStanza
    )
    mocks.session = { user: { id: 'mod', permissions: ['content.read'] } }
    const moderator = await pageProps()
    expect(moderator).toMatchObject({ isOwner: false, isModerator: true })
    expect(
      (moderator.records as Record<string, unknown>).accountStanza
    ).toBeUndefined()
  })
})
