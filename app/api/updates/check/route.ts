import { NextResponse } from 'next/server'

import pkg from '@/package.json'
import { getServerSession } from 'next-auth'

import { authOptions } from '@/lib/auth'

interface GitHubRelease {
  tag_name: string
  html_url: string
  prerelease: boolean
  draft: boolean
}

function compareVersions(v1: string, v2: string): number {
  const v1Parts = v1.replace(/^v/, '').split('.').map(Number)
  const v2Parts = v2.replace(/^v/, '').split('.').map(Number)

  for (let i = 0; i < 3; i++) {
    if (v1Parts[i] > v2Parts[i]) return 1
    if (v1Parts[i] < v2Parts[i]) return -1
  }
  return 0
}

export async function GET() {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user || session.user.role !== 'ADMIN') {
      return new NextResponse('Unauthorized', { status: 401 })
    }

    const currentVersion = pkg.version
    const response = await fetch(
      'https://api.github.com/repos/FlintSH/flare/releases',
      {
        headers: {
          Accept: 'application/vnd.github.v3+json',
          'User-Agent': 'Flare-Update-Checker',
        },
      }
    )

    if (!response.ok) {
      throw new Error('Failed to fetch releases')
    }

    const releases: GitHubRelease[] = await response.json()

    const stableReleases = releases
      .filter((release) => !release.prerelease && !release.draft)
      .sort((a, b) => compareVersions(b.tag_name, a.tag_name))

    const latestRelease = stableReleases[0]

    if (!latestRelease) {
      return NextResponse.json({
        currentVersion,
        hasUpdate: false,
        message: 'No releases found',
      })
    }

    const hasUpdate =
      compareVersions(latestRelease.tag_name, currentVersion) > 0

    return NextResponse.json({
      currentVersion,
      hasUpdate,
      latestVersion: latestRelease.tag_name,
      releaseUrl: latestRelease.html_url,
      message: hasUpdate
        ? `Update available: ${latestRelease.tag_name}`
        : 'Your instance is up to date',
    })
  } catch (error) {
    console.error('Update check error:', error)
    return NextResponse.json(
      { error: 'Failed to check for updates' },
      { status: 500 }
    )
  }
}
