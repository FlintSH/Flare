import type { BuildInfo } from '@/types/dto/updates'

const DOCUMENTATION_URL = 'https://flintsh.github.io/Flare/'
const STABLE_VERSION =
  /^v?((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/

export function getDocumentationUrl(
  build: Pick<BuildInfo, 'version' | 'channel'>,
  page?: 'setup'
): string {
  const suffix = page === 'setup' ? 'admin/setup.html' : ''

  if (build.channel === 'rolling') {
    return `${DOCUMENTATION_URL}rolling/${suffix}`
  }

  const version = STABLE_VERSION.exec(build.version)
  if (build.channel === 'stable' && version?.[0] === build.version) {
    const [major, minor] = version[1].split('.').map(Number)
    // The handbook starts at 2.1.0. Earlier archives keep their setup
    // instructions in the original README at the archive's homepage.
    const hasHandbook = major > 2 || (major === 2 && minor >= 1)
    return `${DOCUMENTATION_URL}versions/v${version[1]}/${hasHandbook ? suffix : ''}`
  }

  return `${DOCUMENTATION_URL}versions.html`
}
