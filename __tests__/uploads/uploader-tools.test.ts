import React from 'react'

import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { UploaderToolRows } from '@/components/profile/tools/profile-tools'

import { saveResponseAsFile } from '@/lib/client/save-file'
import {
  SPECTACLE_CAPTURE_MODES,
  SPECTACLE_RECORDING_MODES,
  UPLOADER_CLIENT_IDS,
  UPLOAD_PROGRAM_RELEASES_URL,
  uploaderClients,
} from '@/lib/uploads/uploader-clients'
import type { UploaderConfiguration } from '@/lib/uploads/uploader-clients/render'

const rows = (configuration: UploaderConfiguration | null) =>
  renderToStaticMarkup(React.createElement(UploaderToolRows, { configuration }))
const titles = (html: string) =>
  [...html.matchAll(/<h3[^>]*>([^<]*)<\/h3>/g)].map((match) => match[1])
/** Each button with its text, and whether it is disabled. */
const buttons = (html: string) =>
  [
    ...html.matchAll(/<button([^>]*)>(?:<svg.*?<\/svg>)?([^<]*)<\/button>/g),
  ].map(
    (match) => `${match[2]}${/\sdisabled=""/.test(match[1]) ? ' (off)' : ''}`
  )

const plain: UploaderConfiguration = {
  origin: 'https://flare.test',
  token: 'flr_configuration-token',
  profile: { id: 'screens', name: 'Chat screenshots' },
  encryption: 'plain',
  accountPublicKey: null,
  folder: null,
}
const encrypted: UploaderConfiguration = {
  ...plain,
  encryption: 'encrypted',
  accountPublicKey: new Uint8Array(32),
}

describe('the Screenshot tools card', () => {
  it('lists the helper program first, then the clients in registry order', () => {
    expect(titles(rows(null))).toEqual([
      'flare-upload',
      'ShareX',
      'iTake',
      'Flameshot',
      'Spectacle',
      'Bash script',
    ])
    expect(titles(rows(null)).slice(1)).toHaveLength(UPLOADER_CLIENT_IDS.length)
  })

  it('keeps every download off until a configuration exists: a file needs a token', () => {
    expect(buttons(rows(null))).toEqual([
      'Download configuration (off)',
      'Download config (off)',
      'Set up iTake (off)',
      'Download script (off)',
      'Download script (off)',
      'Download script (off)',
    ])
  })

  it('offers each declarative configuration for a plain profile, as before', () => {
    const html = rows(plain)
    expect(buttons(html)).toEqual([
      'Download configuration',
      'Download config',
      'Set up iTake',
      'Download script',
      'Download script',
      'Download script',
    ])
    expect(html).not.toContain('cannot encrypt')
  })

  it('offers no format that cannot encrypt for an encrypted profile, and says why', () => {
    const html = rows(encrypted)
    expect(buttons(html)).toEqual([
      'Download configuration',
      'Set up ShareX',
      'Set up iTake (off)',
      'Download script',
      'Download script',
      'Download script',
    ])
    expect(html).toContain(
      'A ShareX uploader file describes one web request and cannot encrypt'
    )
    expect(html).toContain(
      'an iTake uploader file describes one web request and cannot encrypt'
    )
    // The token is in the files, never in the page.
    expect(html).not.toContain(plain.token)
  })

  it('links to the release assets and never to a program file', () => {
    const html = rows(encrypted)
    expect(html).toContain(`href="${UPLOAD_PROGRAM_RELEASES_URL}"`)
    expect(html).not.toMatch(/href="[^"]*\.(exe|msi|dmg|sh)"/)
  })
})

describe('saveResponseAsFile', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  async function save(response: Response, fallbackName: string) {
    const anchor = { href: '', download: '', click: vi.fn(), remove: vi.fn() }
    vi.useFakeTimers()
    vi.stubGlobal('document', {
      createElement: () => anchor,
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
    expect(anchor.click).toHaveBeenCalled()
    expect(revoke).not.toHaveBeenCalled()
    vi.runAllTimers()
    expect(revoke).toHaveBeenCalledWith('blob:download')
    return anchor.download
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

describe('Spectacle choices', () => {
  const flags = (modes: Record<string, { flag: string }>) =>
    Object.values(modes).map(({ flag }) => flag)

  it.each([
    ['capture', SPECTACLE_CAPTURE_MODES],
    ['recording', SPECTACLE_RECORDING_MODES],
  ])('each %s choice makes a different capture', (_, modes) => {
    expect(new Set(flags(modes)).size).toBe(flags(modes).length)
  })

  it('records a whole screen through one choice', () => {
    const options = (recordingMode: string) =>
      uploaderClients.spectacle.options.safeParse({
        ...uploaderClients.spectacle.defaults,
        scriptType: 'recording',
        recordingMode,
      }).success
    expect(options('current')).toBe(true)
    expect(options('fullscreen')).toBe(false)
  })
})
