import { GET } from '@/app/api/updates/check/route'
import pkg from '@/package.json'
import type { BuildInfo } from '@/types/dto/updates'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { checkForUpdates, getBuildInfo } from '@/lib/releases'

const mocks = vi.hoisted(() => ({
  getAccessSession: vi.fn(),
  loggerError: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ getAccessSession: mocks.getAccessSession }))
vi.mock('@/lib/logger', () => ({
  loggers: { api: { error: mocks.loggerError } },
}))

const currentCommit = 'a'.repeat(40)
const publishedCommit = 'b'.repeat(40)
const repositoryUrl = 'https://github.com/FlintSH/flare'
const fetchMock = vi.fn<typeof fetch>()

const stableBuild: BuildInfo = {
  version: '2.0.0',
  channel: 'stable',
  commitSha: null,
  commitUrl: null,
}
const rollingBuild: BuildInfo = {
  ...stableBuild,
  channel: 'rolling',
  commitSha: currentCommit,
  commitUrl: `${repositoryUrl}/commit/${currentCommit}`,
}

function release(overrides: Record<string, unknown> = {}) {
  return {
    tag_name: 'rolling',
    html_url: `${repositoryUrl}/releases/tag/rolling`,
    prerelease: true,
    draft: false,
    target_commitish: publishedCommit,
    body: `<!-- flare-commit-sha: ${publishedCommit} -->`,
    ...overrides,
  }
}

function stableRelease(
  version: string,
  overrides: Record<string, unknown> = {}
) {
  return release({
    tag_name: version,
    html_url: `${repositoryUrl}/releases/tag/${version}`,
    prerelease: false,
    ...overrides,
  })
}

function respond(body: unknown, status = 200) {
  fetchMock.mockResolvedValueOnce(Response.json(body, { status }))
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.stubGlobal('fetch', fetchMock)
  vi.stubEnv('FLARE_RELEASE_CHANNEL', '')
  vi.stubEnv('FLARE_COMMIT_SHA', '')
  mocks.getAccessSession.mockResolvedValue({ user: { role: 'ADMIN' } })
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('build identification', () => {
  it('defaults unmarked builds to the package version and stable channel', () => {
    expect(getBuildInfo()).toEqual({ ...stableBuild, version: pkg.version })
  })

  it('reads rolling metadata at runtime and links the full normalized commit', () => {
    expect(getBuildInfo().channel).toBe('stable')
    vi.stubEnv('FLARE_RELEASE_CHANNEL', 'rolling')
    vi.stubEnv('FLARE_COMMIT_SHA', currentCommit.toUpperCase())
    expect(getBuildInfo()).toEqual({ ...rollingBuild, version: pkg.version })
  })

  it.each(['abc1234', 'main', `${currentCommit}/other`, 'g'.repeat(40)])(
    'does not expose an invalid commit as a link: %s',
    (commit) => {
      vi.stubEnv('FLARE_RELEASE_CHANNEL', 'rolling')
      vi.stubEnv('FLARE_COMMIT_SHA', commit)
      expect(getBuildInfo()).toMatchObject({
        channel: 'rolling',
        commitSha: null,
        commitUrl: null,
      })
    }
  )
})

describe('stable updates', () => {
  it('selects the highest semantic version and excludes drafts, rolling, and prereleases', async () => {
    respond([
      stableRelease('v2.9.0'),
      release(),
      stableRelease('v3.0.0', { draft: true }),
      stableRelease('v4.0.0', { prerelease: true }),
      stableRelease('v5.0.0-beta.1'),
      stableRelease('release-notes'),
      stableRelease('v2.10.0'),
    ])
    expect(await checkForUpdates(stableBuild)).toMatchObject({
      channel: 'stable',
      currentVersion: '2.0.0',
      hasUpdate: true,
      latestVersion: 'v2.10.0',
      releaseUrl: `${repositoryUrl}/releases/tag/v2.10.0`,
    })
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.github.com/repos/FlintSH/flare/releases?per_page=100',
      expect.objectContaining({ next: { revalidate: 300 } })
    )
  })

  it.each(['v2.0.0', 'v1.9.9'])(
    'does not offer an equal or older version: %s',
    async (version) => {
      respond([stableRelease(version)])
      expect(await checkForUpdates(stableBuild)).toMatchObject({
        hasUpdate: false,
      })
    }
  )

  it('reports unknown when only prereleases exist', async () => {
    respond([release()])
    expect(await checkForUpdates(stableBuild)).toMatchObject({
      hasUpdate: null,
      message: 'No stable releases found.',
    })
  })
})

describe('rolling updates', () => {
  it('compares with the published release commit even if target_commitish is stale', async () => {
    respond(release({ target_commitish: currentCommit }))
    respond({ status: 'ahead' })
    expect(await checkForUpdates(rollingBuild)).toMatchObject({
      channel: 'rolling',
      currentVersion: '2.0.0',
      hasUpdate: true,
      latestVersion: 'rolling',
      latestCommitSha: publishedCommit,
      latestCommitUrl: `${repositoryUrl}/commit/${publishedCommit}`,
      releaseUrl: `${repositoryUrl}/releases/tag/rolling`,
    })
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://api.github.com/repos/FlintSH/flare/releases/tags/rolling',
      expect.objectContaining({ next: { revalidate: 300 } })
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      `https://api.github.com/repos/FlintSH/flare/compare/${currentCommit}...${publishedCommit}?per_page=1`,
      expect.any(Object)
    )
  })

  it('does not make a comparison request when the installed commit is current', async () => {
    respond(release({ body: `<!-- flare-commit-sha: ${currentCommit} -->` }))
    expect(await checkForUpdates(rollingBuild)).toMatchObject({
      hasUpdate: false,
      latestCommitSha: currentCommit,
      message: 'You are running the latest rolling release.',
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('does not offer a downgrade for a build ahead of the published release', async () => {
    respond(release())
    respond({ status: 'behind' })
    expect(await checkForUpdates(rollingBuild)).toMatchObject({
      hasUpdate: false,
      message: 'This build is ahead of the published rolling release.',
    })
  })

  it('reports unknown when histories have diverged', async () => {
    respond(release())
    respond({ status: 'diverged' })
    expect(await checkForUpdates(rollingBuild)).toMatchObject({
      hasUpdate: null,
    })
  })

  it('reports unknown when the current commit cannot be compared', async () => {
    respond(release())
    respond({ message: 'Not Found' }, 404)
    expect(await checkForUpdates(rollingBuild)).toMatchObject({
      hasUpdate: null,
    })
  })

  it('does not trust a potentially stale target_commitish in legacy release metadata', async () => {
    respond(release({ body: null }))
    expect(await checkForUpdates(rollingBuild)).toMatchObject({
      hasUpdate: null,
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it.each(['main', 'rolling', 'abc1234'])(
    'never resolves a mutable or ambiguous release target: %s',
    async (target) => {
      respond(release({ body: null, target_commitish: target }))
      expect(await checkForUpdates(rollingBuild)).toMatchObject({
        hasUpdate: null,
      })
      expect(fetchMock).toHaveBeenCalledTimes(1)
    }
  )

  it('reports unknown without checking GitHub when the build commit is missing', async () => {
    expect(
      await checkForUpdates({ ...rollingBuild, commitSha: null })
    ).toMatchObject({ hasUpdate: null })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('reports unknown if no rolling release has been published', async () => {
    respond({ message: 'Not Found' }, 404)
    expect(await checkForUpdates(rollingBuild)).toMatchObject({
      hasUpdate: null,
      message: 'No published rolling release found.',
    })
  })

  it('does not report an unpublished draft as an available update', async () => {
    respond(release({ draft: true }))
    expect(await checkForUpdates(rollingBuild)).toMatchObject({
      hasUpdate: null,
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('update API', () => {
  it.each([null, { user: { role: 'USER' } }])(
    'requires an administrator before making external requests',
    async (session) => {
      mocks.getAccessSession.mockResolvedValue(session)
      const response = await GET()
      expect(response.status).toBe(401)
      expect(fetchMock).not.toHaveBeenCalled()
    }
  )

  it('selects rolling updates from the running build metadata', async () => {
    vi.stubEnv('FLARE_RELEASE_CHANNEL', 'rolling')
    vi.stubEnv('FLARE_COMMIT_SHA', currentCommit)
    respond(release({ body: `<!-- flare-commit-sha: ${currentCommit} -->` }))
    const response = await GET()
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      channel: 'rolling',
      hasUpdate: false,
    })
  })

  it.each([403, 429, 500])(
    'reports GitHub HTTP %s failures without claiming the build is current',
    async (status) => {
      respond({ message: 'Unavailable' }, status)
      const response = await GET()
      expect(response.status).toBe(500)
      expect(await response.json()).toEqual({
        error: 'Failed to check for updates',
      })
      expect(mocks.loggerError).toHaveBeenCalled()
    }
  )

  it('reports malformed GitHub responses as errors', async () => {
    respond([{ tag_name: 'v3.0.0' }])
    const response = await GET()
    expect(response.status).toBe(500)
  })

  it('reports a network failure as an error', async () => {
    fetchMock.mockRejectedValueOnce(new Error('Network unavailable'))
    const response = await GET()
    expect(response.status).toBe(500)
  })
})
