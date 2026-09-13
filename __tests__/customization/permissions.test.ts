import { POST as uploadLogo } from '@/app/api/customization/assets/route'
import { PATCH as updatePreference } from '@/app/api/customization/preferences/route'
import { GET, POST } from '@/app/api/customization/route'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  DEFAULT_APPEARANCE,
  DEFAULT_CUSTOMIZATION,
} from '@/lib/customization/schema'

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  save: vi.fn(),
  config: vi.fn(),
}))
vi.mock('@/lib/auth', () => ({ getAccessSession: mocks.session }))
vi.mock('@/lib/config', () => ({ getConfig: mocks.config }))
vi.mock('@/lib/customization/store', () => ({ saveAppearance: mocks.save }))

beforeEach(() => {
  vi.clearAllMocks()
  mocks.config.mockResolvedValue({
    settings: {
      customization: {
        ...DEFAULT_CUSTOMIZATION,
        draft: {
          ...DEFAULT_APPEARANCE,
          brand: { ...DEFAULT_APPEARANCE.brand, name: 'Secret draft' },
        },
      },
    },
  })
})

describe('appearance permission boundary', () => {
  it('rejects cross-origin session writes on every appearance mutation endpoint', async () => {
    mocks.session.mockResolvedValue({ user: { id: 'admin', role: 'ADMIN' } })
    for (const [path, handler, contentType] of [
      ['/api/customization', POST, 'application/json'],
      ['/api/customization/preferences', updatePreference, 'application/json'],
      [
        '/api/customization/assets',
        uploadLogo,
        'multipart/form-data; boundary=test',
      ],
    ] as const) {
      const response = await handler(
        new Request(`http://flare.test${path}`, {
          method: path.includes('preferences') ? 'PATCH' : 'POST',
          headers: {
            Origin: 'http://untrusted.flare.test',
            'Content-Type': contentType,
          },
          body: '{}',
        })
      )
      expect(response.status).toBe(403)
    }
    expect(mocks.save).not.toHaveBeenCalled()
  })

  it('rejects simple text form writes even when no origin is supplied', async () => {
    mocks.session.mockResolvedValue({ user: { id: 'admin', role: 'ADMIN' } })
    const response = await POST(
      new Request('http://flare.test/api/customization', {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({
          action: 'publish',
          revision: 0,
          document: DEFAULT_APPEARANCE,
        }),
      })
    )
    expect(response.status).toBe(415)
    expect(mocks.save).not.toHaveBeenCalled()
  })
  it('requires a browser session even for a supplied upload bearer token', async () => {
    mocks.session.mockResolvedValue(null)
    const response = await POST(
      new Request('http://flare.test/api/customization', {
        method: 'POST',
        headers: { Authorization: 'Bearer upload-token' },
        body: '{}',
      })
    )
    expect(response.status).toBe(401)
    expect(mocks.save).not.toHaveBeenCalled()
  })

  it('lets users see only the published appearance and forbids writes', async () => {
    mocks.session.mockResolvedValue({ user: { id: 'user', role: 'USER' } })
    const visible = await (await GET()).json()
    expect(visible.data).toEqual({ published: DEFAULT_APPEARANCE })
    const response = await POST(
      new Request('http://flare.test/api/customization', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'publish',
          revision: 0,
          document: DEFAULT_APPEARANCE,
        }),
      })
    )
    expect(response.status).toBe(403)
    expect(mocks.save).not.toHaveBeenCalled()
  })

  it('rejects malformed administrator packs before any write', async () => {
    mocks.session.mockResolvedValue({ user: { id: 'admin', role: 'ADMIN' } })
    const response = await POST(
      new Request('http://flare.test/api/customization', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'import',
          revision: 0,
          pack: { kind: 'flare.appearance', version: 99 },
        }),
      })
    )
    expect(response.status).toBe(400)
    expect(mocks.save).not.toHaveBeenCalled()
  })

  it('passes validated administrator publications to the revision-checked store', async () => {
    mocks.session.mockResolvedValue({ user: { id: 'admin', role: 'ADMIN' } })
    mocks.save.mockResolvedValue(DEFAULT_CUSTOMIZATION)
    const command = {
      action: 'publish',
      revision: 0,
      document: DEFAULT_APPEARANCE,
    }
    const response = await POST(
      new Request('http://flare.test/api/customization', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(command),
      })
    )
    expect(response.status).toBe(200)
    expect(mocks.save).toHaveBeenCalledWith(command)
  })
})
