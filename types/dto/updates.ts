export type ReleaseChannel = 'stable' | 'rolling'

export interface BuildInfo {
  version: string
  channel: ReleaseChannel
  commitSha: string | null
  commitUrl: string | null
}

export interface UpdateInfo {
  currentVersion: string
  channel: ReleaseChannel
  /** null means the update status could not be determined. */
  hasUpdate: boolean | null
  latestVersion?: string
  releaseUrl?: string
  latestCommitSha?: string
  latestCommitUrl?: string
  message: string
}
