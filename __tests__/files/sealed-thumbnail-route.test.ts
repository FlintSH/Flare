import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  grant: null as unknown,
  findUnique: vi.fn(),
  authorizeFile: vi.fn(),
}))

vi.mock('@/lib/database/prisma', () => ({
  prisma: { fileSealedData: { findUnique: state.findUnique } },
}))
vi.mock('@/lib/files/delivery', () => ({
  authorizeFile: state.authorizeFile,
}))

const get = async (id = 'file-1') => {
  const { GET } = await import('@/app/api/files/[id]/sealed-thumbnail/route')
  return GET(new Request(`http://localhost/api/files/${id}/sealed-thumbnail`), {
    params: Promise.resolve({ id }),
  })
}

describe('GET /api/files/[id]/sealed-thumbnail', () => {
  beforeEach(() => {
    state.findUnique.mockReset()
    state.authorizeFile.mockReset()
    state.authorizeFile.mockImplementation(async () => state.grant)
  })

  it('asks the rules of the file itself, and answers what they refuse', async () => {
    state.grant = new Response(null, { status: 404 })
    const response = await get('private-file')
    expect(response.status).toBe(404)
    expect(state.authorizeFile).toHaveBeenCalledWith(
      expect.any(Request),
      { id: 'private-file' },
      'thumbnail'
    )
    // A refused visitor learns nothing about the record.
    expect(state.findUnique).not.toHaveBeenCalled()
  })

  it('serves the sealed bytes as they are stored, for the reader only', async () => {
    const sealed = Uint8Array.from({ length: 80 }, (_, index) => index)
    state.grant = { file: { id: 'file-1', encrypted: true } }
    state.findUnique.mockResolvedValue({ sealedThumbnail: Buffer.from(sealed) })
    const response = await get()
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe(
      'application/octet-stream'
    )
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(response.headers.get('cache-control')).toBe('private, max-age=300')
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(sealed)
    expect(state.findUnique).toHaveBeenCalledWith({
      where: { fileId: 'file-1' },
      select: { sealedThumbnail: true },
    })
  })

  it('answers 204 for a file without a thumbnail, and never reads one for a plain file', async () => {
    state.grant = { file: { id: 'file-1', encrypted: true } }
    state.findUnique.mockResolvedValue({ sealedThumbnail: null })
    expect((await get()).status).toBe(204)
    state.findUnique.mockResolvedValue(null)
    expect((await get()).status).toBe(204)

    state.findUnique.mockClear()
    state.grant = { file: { id: 'file-2', encrypted: false } }
    const plain = await get('file-2')
    expect(plain.status).toBe(204)
    expect(await plain.text()).toBe('')
    expect(state.findUnique).not.toHaveBeenCalled()
  })
})
