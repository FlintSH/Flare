import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')

export function getBuildInfo() {
  const { version } = JSON.parse(
    readFileSync(resolve(repo, 'package.json'), 'utf8')
  )
  let commit = null
  let dirty = null
  try {
    commit = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: repo,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    dirty = Boolean(
      execFileSync(
        'git',
        ['status', '--porcelain', '--untracked-files=normal'],
        { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
      ).trim()
    )
  } catch {
    // Source archives may not include Git metadata. Do not invent a revision.
    if (/^[a-f0-9]{40}$/i.test(process.env.GITHUB_SHA || ''))
      commit = process.env.GITHUB_SHA
  }
  return {
    version,
    commit,
    shortCommit: commit?.slice(0, 8) || null,
    dirty,
    builtAt: new Date().toISOString(),
  }
}
