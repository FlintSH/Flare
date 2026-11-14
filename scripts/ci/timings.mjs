// Reads how long GitHub Actions took for one or more commits, straight from
// the Actions API, so a claim about CI speed can be checked by anyone.
//
//   node scripts/ci/timings.mjs --before <sha>,<sha> --after <sha>,<sha> \
//     --out .github/assets/ci-speed/timings.json
//
// Each side is a comma-separated list of head commits of pull request pushes.
// Every attempt of every pull request workflow run for a commit is one
// sample, so re-running a workflow adds a sample. Needs the GitHub CLI,
// signed in with read access to the repository.
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

const args = Object.fromEntries(
  process.argv
    .slice(2)
    .map((value, index, all) =>
      value.startsWith('--') ? [value.slice(2), all[index + 1]] : null
    )
    .filter(Boolean)
)
if (!args.before || !args.after)
  throw new Error(
    'Usage: node scripts/ci/timings.mjs --before <sha,...> --after <sha,...> [--repo owner/name] [--out file.json]'
  )
const repo = args.repo || 'FlintSH/Flare'

function api(path) {
  return JSON.parse(
    execFileSync('gh', ['api', '--paginate', '--slurp', path], {
      encoding: 'utf8',
      maxBuffer: 1 << 28,
    })
  )
}
const seconds = (from, to) =>
  from && to ? Math.round((Date.parse(to) - Date.parse(from)) / 1000) : null
const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = sorted.length >> 1
  return sorted.length % 2
    ? sorted[middle]
    : Math.round((sorted[middle - 1] + sorted[middle]) / 2)
}

// Workflows that run on a schedule or react to other workflows are not part
// of what a push waits for.
const IGNORED_WORKFLOWS = new Set(['PR Preview Controller'])

function pushes(shas) {
  const result = []
  for (const short of shas.split(',').filter(Boolean)) {
    // The run filter only matches a full commit SHA.
    const sha = execFileSync(
      'gh',
      ['api', `repos/${repo}/commits/${short}`, '--jq', '.sha'],
      { encoding: 'utf8' }
    ).trim()
    const runs = api(`repos/${repo}/actions/runs?head_sha=${sha}&per_page=100`)
      .flatMap((page) => page.workflow_runs)
      .filter(
        (run) =>
          run.status === 'completed' && !IGNORED_WORKFLOWS.has(run.name)
      )
    if (!runs.length) throw new Error(`No completed workflow runs for ${sha}`)
    const attempts = Math.max(...runs.map((run) => run.run_attempt))
    // One sample per attempt number: the first attempt of every workflow is
    // what the push itself started, the second is the first re-run, and so on.
    for (let attempt = 1; attempt <= attempts; attempt++) {
      const jobs = []
      for (const run of runs) {
        if (run.run_attempt < attempt) continue
        for (const job of api(
          `repos/${repo}/actions/runs/${run.id}/attempts/${attempt}/jobs?per_page=100`
        ).flatMap((page) => page.jobs)) {
          if (job.conclusion === 'skipped') continue
          jobs.push({
            // GitHub names its own code scanning runs after the pull request.
            workflow: run.path?.startsWith('dynamic/') ? 'CodeQL' : run.name,
            name: job.name,
            conclusion: job.conclusion,
            created: job.created_at,
            started: job.started_at,
            completed: job.completed_at,
            seconds: seconds(job.started_at, job.completed_at),
            steps: (job.steps || [])
              .map((step) => ({
                name: step.name,
                seconds: seconds(step.started_at, step.completed_at),
              }))
              .filter((step) => step.seconds),
          })
        }
      }
      if (!jobs.length) continue
      const start = Math.min(...jobs.map((job) => Date.parse(job.created)))
      const end = Math.max(...jobs.map((job) => Date.parse(job.completed)))
      result.push({
        sha,
        attempt,
        failed: jobs
          .filter((job) => job.conclusion !== 'success')
          .map((job) => `${job.workflow} / ${job.name}: ${job.conclusion}`),
        // From the first job being queued to the last one finishing.
        wallSeconds: Math.round((end - start) / 1000),
        // What the runners spent, added over every job.
        runnerSeconds: jobs.reduce((total, job) => total + job.seconds, 0),
        jobs,
      })
    }
  }
  return result
}

function side(shas) {
  const samples = pushes(shas)
  const byJob = new Map()
  for (const sample of samples)
    for (const job of sample.jobs) {
      const key = `${job.workflow} / ${job.name}`
      if (!byJob.has(key)) byJob.set(key, [])
      byJob.get(key).push(job)
    }
  const spread = (values) => ({
    median: median(values),
    min: Math.min(...values),
    max: Math.max(...values),
    samples: values,
  })
  // The push whose total is the median, job by job, for a timeline.
  const typical = [...samples].sort((a, b) => a.wallSeconds - b.wallSeconds)[
    (samples.length - 1) >> 1
  ]
  const origin = Math.min(...typical.jobs.map((job) => Date.parse(job.created)))
  const offset = (time) => Math.round((Date.parse(time) - origin) / 1000)
  return {
    commits: shas.split(',').filter(Boolean),
    pushes: samples.length,
    typical: {
      sha: typical.sha,
      attempt: typical.attempt,
      jobs: typical.jobs
        .map((job) => ({
          name: `${job.workflow} / ${job.name}`,
          started: offset(job.started),
          completed: offset(job.completed),
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    },
    failed: samples.flatMap((sample) => sample.failed),
    wallSeconds: spread(samples.map((sample) => sample.wallSeconds)),
    runnerSeconds: spread(samples.map((sample) => sample.runnerSeconds)),
    jobs: Object.fromEntries(
      [...byJob].sort().map(([key, jobs]) => {
        const steps = new Map()
        for (const job of jobs)
          for (const step of job.steps) {
            if (!steps.has(step.name)) steps.set(step.name, [])
            steps.get(step.name).push(step.seconds)
          }
        return [
          key,
          {
            ...spread(jobs.map((job) => job.seconds)),
            // A step that some samples lack counts as zero there.
            steps: Object.fromEntries(
              [...steps].map(([name, values]) => [
                name,
                median([
                  ...values,
                  ...Array(Math.max(0, jobs.length - values.length)).fill(0),
                ]),
              ])
            ),
          },
        ]
      })
    ),
  }
}

const result = {
  repository: repo,
  collectedAt: new Date().toISOString(),
  before: side(args.before),
  after: side(args.after),
}
const text = JSON.stringify(result, null, 2) + '\n'
if (args.out) {
  mkdirSync(dirname(args.out), { recursive: true })
  writeFileSync(args.out, text)
}
const row = (label, before, after) =>
  console.log(
    `${label.padEnd(52)} ${String(before ?? '-').padStart(6)} s -> ${String(after ?? '-').padStart(5)} s${before && after ? `  ${(before / after).toFixed(1)}x` : ''}`
  )
console.log(
  `Median of ${result.before.pushes} pushes before and ${result.after.pushes} after`
)
row(
  'Push to every check finished',
  result.before.wallSeconds.median,
  result.after.wallSeconds.median
)
row(
  'Runner time per push',
  result.before.runnerSeconds.median,
  result.after.runnerSeconds.median
)
for (const key of new Set([
  ...Object.keys(result.before.jobs),
  ...Object.keys(result.after.jobs),
]))
  row(key, result.before.jobs[key]?.median, result.after.jobs[key]?.median)
// A failed job is often a fast one, so say when a sample includes any.
for (const name of ['before', 'after'])
  if (result[name].failed.length)
    console.log(
      `Jobs that did not succeed (${name}): ${result[name].failed.join('; ')}`
    )
