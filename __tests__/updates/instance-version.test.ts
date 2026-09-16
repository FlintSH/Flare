import { createElement } from 'react'

import type { BuildInfo, UpdateInfo } from '@/types/dto/updates'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import { InstanceVersion } from '@/components/settings/instance-version'

const state = vi.hoisted(() => ({ values: [] as unknown[] }))

// Render the completed update response with React's real server renderer.
// Only hook state is supplied here; link markup comes from the component.
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  useState: () => [state.values.shift(), vi.fn()],
  useCallback: (callback: unknown) => callback,
  useEffect: vi.fn(),
}))

const installedSha = '1111111aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const latestSha = '2222222bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
const repositoryUrl = 'https://github.com/FlintSH/Flare'
const installedCommitUrl = `${repositoryUrl}/commit/${installedSha}`
const latestCommitUrl = `${repositoryUrl}/commit/${latestSha}`
const rollingReleaseUrl = `${repositoryUrl}/releases/tag/rolling`

const rollingBuild: BuildInfo = {
  version: '2.0.0',
  channel: 'rolling',
  commitSha: installedSha,
  commitUrl: installedCommitUrl,
}

const rollingUpdate: UpdateInfo = {
  currentVersion: '2.0.0',
  channel: 'rolling',
  hasUpdate: true,
  latestVersion: 'rolling',
  releaseUrl: rollingReleaseUrl,
  latestCommitSha: latestSha,
  latestCommitUrl,
  message: 'A new rolling release is available.',
}

function render(buildInfo: BuildInfo, updateInfo: UpdateInfo) {
  state.values = [false, updateInfo, null]
  const html = renderToStaticMarkup(
    createElement(InstanceVersion, { buildInfo })
  )
  const links = [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)].map(
    ([, attributes, content]) => ({
      href: attributes.match(/\bhref="([^"]*)"/)?.[1],
      content,
    })
  )
  return { html, links }
}

describe('instance version update links', () => {
  it('links both the installed and incoming rolling commits separately from the release', () => {
    const { links } = render(rollingBuild, rollingUpdate)

    expect(links).toEqual([
      { href: installedCommitUrl, content: installedSha.slice(0, 7) },
      {
        href: rollingReleaseUrl,
        content: expect.stringMatching(/^Update available(?:<|$)/),
      },
      { href: latestCommitUrl, content: latestSha.slice(0, 7) },
    ])
  })

  it('shows only the installed commit when the rolling release is current', () => {
    const { html, links } = render(rollingBuild, {
      ...rollingUpdate,
      hasUpdate: false,
      latestCommitSha: installedSha,
      latestCommitUrl: installedCommitUrl,
      message: 'You are running the latest rolling release.',
    })

    expect(links).toEqual([
      { href: installedCommitUrl, content: installedSha.slice(0, 7) },
    ])
    expect(html).toContain('You are running the latest rolling release.')
  })

  it('keeps the rolling release link usable when the incoming commit is unavailable', () => {
    const { links } = render(rollingBuild, {
      ...rollingUpdate,
      latestCommitSha: undefined,
      latestCommitUrl: undefined,
    })

    expect(links).toEqual([
      { href: installedCommitUrl, content: installedSha.slice(0, 7) },
      {
        href: rollingReleaseUrl,
        content: expect.stringMatching(/^Update available(?:<|$)/),
      },
    ])
  })

  it('preserves the stable release version and download link', () => {
    const releaseUrl = `${repositoryUrl}/releases/tag/v2.1.0`
    const { html, links } = render(
      { ...rollingBuild, channel: 'stable' },
      {
        currentVersion: '2.0.0',
        channel: 'stable',
        hasUpdate: true,
        latestVersion: '2.1.0',
        releaseUrl,
        message: 'A new version is available.',
      }
    )

    expect(links).toEqual([
      {
        href: releaseUrl,
        content: expect.stringMatching(/^Update available: 2\.1\.0(?:<|$)/),
      },
    ])
    expect(html).not.toContain('Pre-release.')
  })
})
