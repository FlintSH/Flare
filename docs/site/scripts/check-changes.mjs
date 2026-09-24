import { execFileSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const baseIndex = process.argv.indexOf('--base')
const base = baseIndex >= 0 ? process.argv[baseIndex + 1] : null
if (!base || !/^[a-f0-9]{7,40}$/i.test(base))
  throw new Error(
    'Pass --base <commit SHA> to check documentation coverage for a change.'
  )
const git = (args) =>
  execFileSync('git', args, { cwd: repo, encoding: 'utf8' })
    .trim()
    .split('\n')
    .filter(Boolean)
// Check each non-merge commit: docs in a later commit do not cover an earlier feature.
const commits = git(['rev-list', '--reverse', '--no-merges', `${base}..HEAD`])
const rules = [
  {
    name: 'user guidance',
    code: /^(components\/(dashboard|file|profile|tags|folders)|lib\/(files|folders|tags|uploads)|app\/\(.*\)\/dashboard)/,
    docs: /^docs\/site\/guide\/.*\.md$/,
  },
  {
    name: 'administration',
    code: /^(components\/(settings|setup|customization|auth)|lib\/(setup|customization|email|auth)|app\/api\/settings)/,
    docs: /^docs\/site\/admin\/.*\.md$/,
  },
  {
    name: 'hosting/configuration',
    code: /^(Dockerfile$|docker-compose\.yml$|\.env\.example$|lib\/(config|storage|startup)|prisma\/|scripts\/(start|entrypoint|migrate)|instrumentation\.ts$)/,
    docs: /^docs\/site\/hosting\/.*\.md$/,
  },
  {
    name: 'API/integration reference',
    code: /^(app\/api\/|lib\/integrations\/|types\/dto\/)/,
    docs: /^docs\/site\/api\/.*\.md$/,
  },
]
const errors = []
let checked = 0
for (const commit of commits) {
  // Adoption is forward-looking: do not retroactively reject older feature history.
  try {
    execFileSync(
      'git',
      ['cat-file', '-e', `${commit}:docs/site/scripts/check-changes.mjs`],
      { cwd: repo, stdio: 'ignore' }
    )
  } catch {
    continue
  }
  checked++
  const changed = git([
    'diff-tree',
    '--root',
    '--no-commit-id',
    '--name-only',
    '-r',
    commit,
  ])
  for (const rule of rules) {
    const affected = changed.filter((path) => rule.code.test(path))
    if (affected.length && !changed.some((path) => rule.docs.test(path)))
      errors.push(
        `${commit.slice(0, 8)} ${rule.name}: ${affected.slice(0, 4).join(', ')} changed, but no corresponding handbook page changed in that commit.`
      )
  }
  const implementation = changed.some((path) =>
    /^(app\/|components\/|lib\/|hooks\/|types\/|prisma\/|Dockerfile|docker-compose|\.env\.example)/.test(
      path
    )
  )
  if (
    implementation &&
    !changed.some((path) => /^docs\/site\/.*\.md$/.test(path))
  )
    errors.push(
      `${commit.slice(0, 8)} Implementation changed without a handbook update. Follow AGENTS.md and update all affected pages in the same commit.`
    )
}
if (errors.length) {
  console.error(errors.join('\n'))
  process.exit(1)
}
console.log(
  `Documentation change gate passed for ${checked} commits (${commits.length - checked} pre-policy commits skipped). Semantic completeness still requires the AGENTS.md review.`
)
