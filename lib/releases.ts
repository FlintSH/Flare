import pkg from '@/package.json'
import type { BuildInfo, UpdateInfo } from '@/types/dto/updates'
import { z } from 'zod'

const REPOSITORY_URL = 'https://github.com/FlintSH/flare'
const GITHUB_API_URL = 'https://api.github.com/repos/FlintSH/flare'

const releaseSchema = z.object({
  tag_name: z.string(),
  html_url: z.string().url(),
  prerelease: z.boolean(),
  draft: z.boolean(),
  body: z.string().nullable().optional(),
})

function normalizeCommitSha(value: string | undefined): string | null {
  return value && /^[a-f0-9]{40}$/i.test(value) ? value.toLowerCase() : null
}

export function getBuildInfo(): BuildInfo {
  const commitSha = normalizeCommitSha(process.env.FLARE_COMMIT_SHA)

  return {
    version: pkg.version,
    channel:
      process.env.FLARE_RELEASE_CHANNEL === 'rolling' ? 'rolling' : 'stable',
    commitSha,
    commitUrl: commitSha ? `${REPOSITORY_URL}/commit/${commitSha}` : null,
  }
}

async function fetchGitHub<T>(
  path: string,
  schema: z.ZodType<T>
): Promise<T | null> {
  const response = await fetch(`${GITHUB_API_URL}${path}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'Flare-Update-Checker',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    next: { revalidate: 300 },
    signal: AbortSignal.timeout(10_000),
  })

  if (response.status === 404) return null
  if (!response.ok) {
    throw new Error(`GitHub update check failed (${response.status})`)
  }

  return schema.parse(await response.json())
}

function parseStableVersion(version: string): number[] | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:\+[\da-z.-]+)?$/i.exec(version)
  if (!match) return null
  const parts = match.slice(1, 4).map(Number)
  return parts.every(Number.isSafeInteger) ? parts : null
}

function compareVersions(first: number[], second: number[]): number {
  for (let i = 0; i < 3; i++) {
    if (first[i] > second[i]) return 1
    if (first[i] < second[i]) return -1
  }
  return 0
}

async function checkStableUpdates(build: BuildInfo): Promise<UpdateInfo> {
  const result = { currentVersion: build.version, channel: build.channel }
  const currentVersion = parseStableVersion(build.version)
  if (!currentVersion) {
    return {
      ...result,
      hasUpdate: null,
      message:
        'This build has an unknown version, so updates cannot be checked.',
    }
  }

  const releases = await fetchGitHub(
    '/releases?per_page=100',
    z.array(releaseSchema)
  )
  const latestRelease = (releases ?? [])
    .filter((release) => !release.prerelease && !release.draft)
    .flatMap((release) => {
      const version = parseStableVersion(release.tag_name)
      return version ? [{ release, version }] : []
    })
    .sort((a, b) => compareVersions(b.version, a.version))[0]

  if (!latestRelease) {
    return { ...result, hasUpdate: null, message: 'No stable releases found.' }
  }

  const hasUpdate = compareVersions(latestRelease.version, currentVersion) > 0
  return {
    ...result,
    hasUpdate,
    latestVersion: latestRelease.release.tag_name,
    releaseUrl: latestRelease.release.html_url,
    message: hasUpdate
      ? `Update available: ${latestRelease.release.tag_name}`
      : 'Your instance is up to date',
  }
}

async function checkRollingUpdates(build: BuildInfo): Promise<UpdateInfo> {
  const result = { currentVersion: build.version, channel: build.channel }
  if (!build.commitSha) {
    return {
      ...result,
      hasUpdate: null,
      message:
        'This rolling build does not include its commit, so updates cannot be checked.',
    }
  }

  const release = await fetchGitHub('/releases/tags/rolling', releaseSchema)
  if (!release || release.draft || release.tag_name !== 'rolling') {
    return {
      ...result,
      hasUpdate: null,
      message: 'No published rolling release found.',
    }
  }

  // The workflow records the commit only after the Docker images are published.
  // An existing rolling tag can leave target_commitish pointing at an older build.
  const marker = release.body?.match(
    /<!-- flare-commit-sha: ([a-f0-9]{40}) -->/i
  )
  const latestCommitSha = normalizeCommitSha(marker?.[1])
  const releaseInfo = {
    ...result,
    latestVersion: 'rolling',
    releaseUrl: release.html_url,
  }
  if (!latestCommitSha) {
    return {
      ...releaseInfo,
      hasUpdate: null,
      message:
        'The published rolling release does not identify its commit, so updates cannot be checked.',
    }
  }

  const commitInfo = {
    ...releaseInfo,
    latestCommitSha,
    latestCommitUrl: `${REPOSITORY_URL}/commit/${latestCommitSha}`,
  }
  if (latestCommitSha === build.commitSha) {
    return {
      ...commitInfo,
      hasUpdate: false,
      message: 'You are running the latest rolling release.',
    }
  }

  const comparison = await fetchGitHub(
    `/compare/${build.commitSha}...${latestCommitSha}?per_page=1`,
    z.object({ status: z.enum(['ahead', 'behind', 'identical', 'diverged']) })
  )
  switch (comparison?.status) {
    case 'ahead':
      return {
        ...commitInfo,
        hasUpdate: true,
        message: `New rolling release available: ${latestCommitSha.slice(0, 7)}`,
      }
    case 'identical':
      return {
        ...commitInfo,
        hasUpdate: false,
        message: 'You are running the latest rolling release.',
      }
    case 'behind':
      return {
        ...commitInfo,
        hasUpdate: false,
        message: 'This build is ahead of the published rolling release.',
      }
    default:
      return {
        ...commitInfo,
        hasUpdate: null,
        message:
          'This build could not be compared with the published rolling release.',
      }
  }
}

export async function checkForUpdates(build: BuildInfo): Promise<UpdateInfo> {
  return build.channel === 'rolling'
    ? checkRollingUpdates(build)
    : checkStableUpdates(build)
}
