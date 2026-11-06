import React from 'react'

import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  ProfileToolDownloads,
  ProfileTools,
} from '@/components/profile/tools/profile-tools'

import { saveResponseAsFile } from '@/lib/client/save-file'
import {
  UPLOADER_CLIENT_IDS,
  uploaderClients,
} from '@/lib/uploads/uploader-clients'

const session = vi.hoisted(() => ({ permissions: [] as string[] }))
vi.mock('next-auth/react', () => ({
  useSession: () => ({
    data: { user: { id: 'owner', permissions: session.permissions } },
    status: 'authenticated',
  }),
}))

const buttons = (html: string) =>
  [...html.matchAll(/<button[^>]*>([^<]*)<\/button>/g)].map((match) => match[1])

describe('uploader tools in the profile editor', () => {
  const render = (permissions: string[]) => {
    session.permissions = permissions
    return renderToStaticMarkup(
      React.createElement(ProfileToolDownloads, {
        profileId: 'screenshots',
        profileName: 'Screenshots',
      })
    )
  }

  it.each([
    [['uploadProfiles.manage']],
    [['uploadProfiles.manage', 'tokens.manage']],
    [['uploadProfiles.manage', 'files.upload']],
  ])('are hidden from roles that cannot use them: %j', (permissions) => {
    expect(render(permissions)).toBe('')
  })

  it('offer every client, like the Screenshot tools card', () => {
    const html = render([
      'uploadProfiles.manage',
      'files.upload',
      'tokens.manage',
    ])
    expect(html).toContain('Use this profile in your tools')
    expect(buttons(html)).toEqual([
      'ShareX',
      'Bash',
      'Flameshot',
      'Spectacle',
      'iTake',
    ])
    expect(buttons(html).toSorted()).toEqual(
      UPLOADER_CLIENT_IDS.map((id) => uploaderClients[id].label).toSorted()
    )
  })

  it('the Screenshot tools card lists the clients in registry order', () => {
    session.permissions = ['files.upload', 'tokens.manage']
    const html = renderToStaticMarkup(React.createElement(ProfileTools))
    const titles = [...html.matchAll(/<h3[^>]*>([^<]*)<\/h3>/g)].map(
      (match) => match[1]
    )
    expect(titles).toEqual([
      'ShareX',
      'iTake',
      'Flameshot',
      'Spectacle',
      'Bash script',
    ])
    expect(buttons(html).slice(0, 5)).toEqual([
      'Download config',
      'Set up iTake',
      'Download script',
      'Download script',
      'Download script',
    ])
  })
})

describe('saveResponseAsFile', () => {
  const saved = vi.hoisted(() => ({
    anchor: { href: '', download: '', click: vi.fn(), remove: vi.fn() },
  }))

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  async function save(response: Response, fallbackName: string) {
    vi.useFakeTimers()
    vi.stubGlobal('document', {
      createElement: () => saved.anchor,
      body: { appendChild: vi.fn() },
    })
    const revoke = vi.fn()
    vi.stubGlobal(
      'URL',
      Object.assign(class extends URL {}, {
        createObjectURL: () => 'blob:download',
        revokeObjectURL: revoke,
      })
    )
    await saveResponseAsFile(response, fallbackName)
    expect(saved.anchor.click).toHaveBeenCalled()
    expect(revoke).not.toHaveBeenCalled()
    vi.runAllTimers()
    expect(revoke).toHaveBeenCalledWith('blob:download')
    return saved.anchor.download
  }

  it.each([
    [
      'attachment; filename="screenshot-user-itake.itup"',
      'screenshot-user-itake.itup',
    ],
    ['attachment; filename=plain-name.sh', 'plain-name.sh'],
    [
      `attachment; filename="r%C3%A9sum%C3%A9.pdf"; filename*=UTF-8''r%C3%A9sum%C3%A9.pdf`,
      'résumé.pdf',
    ],
  ])('uses the name the server sent in %s', async (header, name) => {
    const response = new Response('file', {
      headers: { 'Content-Disposition': header },
    })
    expect(await save(response, 'flare-itake.itup')).toBe(name)
  })

  it('falls back when the server sent no name', async () => {
    expect(await save(new Response('file'), 'flare-upload.sh')).toBe(
      'flare-upload.sh'
    )
  })
})
