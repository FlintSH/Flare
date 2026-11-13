/* eslint-disable @typescript-eslint/no-require-imports */
// Times the same requests against two running Flare servers, alternating
// between them so drift and noise fall on both. Each server needs its own
// database seeded by scripts/perf/seed.cjs and FLARE_CLIENT_IP_HEADER set to
// `x-bench-ip`, so the upload limit counts the simulated clients apart.
//
//   node scripts/perf/api.cjs --before http://localhost:3311 \
//     --after http://localhost:3312 --runs 15 --out results/api.json
const { mkdirSync, readFileSync, statSync, writeFileSync } = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const args = Object.fromEntries(
  process.argv
    .slice(2)
    .map((value, index, all) =>
      value.startsWith('--') ? [value.slice(2), all[index + 1]] : null
    )
    .filter(Boolean)
)
const SIDES = { before: args.before, after: args.after }
if (!SIDES.before || !SIDES.after)
  throw new Error('Pass --before and --after server URLs.')
const RUNS = Number(args.runs || 15)
const ONLY = args.only ? args.only.split(',') : null
const TOKEN = 'flr_perf-public-disposable-benchmark-token'
const upload = readFileSync(
  path.join(process.cwd(), 'uploads/perf/source-screenshot-2.png')
)
const TIMEZONE = 'timezone=America%2FNew_York'
// A full month of the seeded library, as the dashboard asks for one.
const WINDOW =
  'snapshot=2026-11-02T00%3A00%3A00.000Z&dateFrom=2026-10-01T04%3A00%3A00.000Z&dateTo=2026-11-01T03%3A59%3A59.999Z'

async function signIn(base) {
  const jar = new Map()
  const keep = (response) => {
    for (const cookie of response.headers.getSetCookie()) {
      const [pair] = cookie.split(';')
      jar.set(
        pair.slice(0, pair.indexOf('=')),
        pair.slice(pair.indexOf('=') + 1)
      )
    }
  }
  const header = () =>
    [...jar].map(([key, value]) => `${key}=${value}`).join('; ')
  let response = await fetch(`${base}/api/auth/csrf`)
  keep(response)
  const { csrfToken } = await response.json()
  response = await fetch(`${base}/api/auth/callback/credentials`, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      cookie: header(),
    },
    body: new URLSearchParams({
      csrfToken,
      email: 'perf-owner@example.test',
      password: 'Perf-bench-only-2026!',
      json: 'true',
      callbackUrl: `${base}/dashboard`,
    }),
  })
  keep(response)
  if (!jar.has('next-auth.session-token'))
    throw new Error(`Could not sign in to ${base}`)
  return header()
}

let client = 0
const clientAddress = () =>
  `10.${(++client >> 16) & 255}.${(client >> 8) & 255}.${client & 255}`

/** One request: its time to the last byte, and what came back. */
async function request(
  side,
  { path: target, anonymous, method, headers, body }
) {
  const started = performance.now()
  const response = await fetch(side.base + target, {
    method,
    body,
    redirect: 'manual',
    headers: {
      ...(anonymous ? {} : { cookie: side.cookie }),
      origin: side.base,
      'x-bench-ip': clientAddress(),
      ...headers,
    },
  })
  const bytes = Buffer.from(await response.arrayBuffer())
  return {
    ms: performance.now() - started,
    status: response.status,
    bytes,
    headers: response.headers,
  }
}

function uploadForm(name) {
  const form = new FormData()
  form.append('file', new Blob([upload], { type: 'image/png' }), name)
  return form
}
const uploadOne = (side, name) =>
  request(side, {
    path: '/api/files',
    method: 'POST',
    anonymous: true,
    headers: { authorization: `Bearer ${TOKEN}` },
    body: uploadForm(name),
  })

const json = (result) => JSON.parse(result.bytes.toString() || 'null')
const listed = (result) => json(result)?.data?.length
const get = (target, extra = {}) => ({
  run: (side) => request(side, { path: target, ...extra }),
})

// `work` counts what a sample did, and `expect` is what that must come to on
// a database seeded with the default sizes: a full page, every tag, all 480
// pages of a burst of readers. A sample with another status or count is an
// error and its time is left out. Without `expect`, any work counts: a
// thumbnail's size differs between builds, and the upload burst reports how
// many uploads were stored.
const OWNER_FILES = 100_004
const PAGE = 48
const SCENARIOS = [
  {
    id: 'session',
    label: 'Check a signed-in session',
    ...get('/api/auth/session'),
    work: (result) => (json(result)?.user?.id ? 1 : 0),
    expect: 1,
  },
  {
    id: 'library-page',
    label: 'Load a library page, 100,000 files',
    ...get(`/api/files?search=&sortBy=newest&page=1&limit=48&${WINDOW}`),
    work: listed,
    expect: PAGE,
  },
  {
    id: 'library-first-page',
    label: 'List the newest files through the API',
    ...get('/api/files?page=1&limit=48'),
    work: listed,
    expect: PAGE,
  },
  {
    id: 'library-largest',
    label: 'Sort 100,000 files by size',
    ...get('/api/files?sortBy=largest&page=1&limit=48'),
    work: listed,
    expect: PAGE,
  },
  {
    id: 'timeline',
    label: 'Build the library timeline',
    ...get(
      `/api/files/timeline?search=&sortBy=newest&groupBy=none&${TIMEZONE}`
    ),
    work: (result) => json(result)?.data?.total,
    expect: OWNER_FILES,
  },
  ...[
    // The last column is how many of the seeded files match.
    ['search-name', 'Search 100,000 files by name', 'IMG_48', 156],
    [
      'search-text',
      'Search 100,000 files by text inside images',
      'boarding gate',
      440,
    ],
    [
      'search-miss',
      'Search 100,000 files, nothing matches',
      'quarterly-zebra',
      0,
    ],
  ].map(([id, label, term, matches]) => ({
    id,
    label,
    // What typing a search costs, as the library asks for it: the timeline,
    // then the first page of its newest month. Nothing matching ends at the
    // timeline.
    run: async (side) => {
      const search = `search=${encodeURIComponent(term)}`
      const timeline = await request(side, {
        path: `/api/files/timeline?${search}&sortBy=newest&groupBy=none&${TIMEZONE}`,
      })
      const found = json(timeline)?.data
      const newest = found?.buckets?.[0]
      if (timeline.status !== 200 || !newest)
        return { ...timeline, total: found?.total, rows: 0 }
      const window = new URLSearchParams({
        snapshot: found.snapshot,
        dateFrom: newest.from,
        dateTo: new Date(Date.parse(newest.to) - 1).toISOString(),
      })
      const page = await request(side, {
        path: `/api/files?${search}&sortBy=newest&page=1&limit=48&${window}`,
      })
      return {
        ...page,
        ms: timeline.ms + page.ms,
        total: found.total,
        rows: listed(page) ?? 0,
      }
    },
    // The timeline's total, provided the page it led to has rows exactly
    // when some file matches.
    work: (result) =>
      Boolean(result.rows) === result.total > 0 ? result.total : -1,
    expect: matches,
  })),
  {
    id: 'types',
    label: 'List the file types in a library',
    ...get('/api/files/types'),
    work: (result) => json(result)?.data?.types?.length,
    expect: 7,
  },
  {
    id: 'tags',
    label: 'List 200 tags with their file counts',
    ...get('/api/tags'),
    work: listed,
    expect: 200,
  },
  {
    id: 'folders',
    label: 'List 300 folders with their file counts',
    ...get('/api/folders'),
    work: listed,
    expect: 300,
  },
  {
    id: 'audit',
    label: 'Open the audit log, 300,000 events',
    ...get('/api/audit'),
    work: (result) => json(result)?.events?.length,
    expect: 50,
  },
  {
    id: 'thumbnail',
    label: 'Fetch the thumbnail of a private photo',
    // As a library card asks for it. Before, a width was ignored and the
    // original came back.
    ...get('/api/files/perf-private-photo/thumbnail?w=384'),
    work: (result) => result.bytes.length,
    report: 'bytes',
  },
  {
    id: 'raw',
    label: 'Serve a public image',
    ...get('/perf/perf-public-screenshot.png/raw', { anonymous: true }),
    work: (result) => result.bytes.length,
    expect: statSync(
      path.join(process.cwd(), 'uploads/perf/perf-public-screenshot.png')
    ).size,
  },
  {
    id: 'revisit',
    label: 'Revisit an image the browser already has',
    // A browser revalidating its copy: the validators of a first response
    // go back with the second.
    run: async (side) => {
      const target = '/api/files/perf/perf-public-screenshot.png'
      const first = await request(side, { path: target, anonymous: true })
      const validators = {}
      if (first.headers.get('etag'))
        validators['if-none-match'] = first.headers.get('etag')
      if (first.headers.get('last-modified'))
        validators['if-modified-since'] = first.headers.get('last-modified')
      return request(side, {
        path: target,
        anonymous: true,
        headers: validators,
      })
    },
    statuses: [200, 304],
    work: () => 1,
    expect: 1,
    report: 'bytes',
  },
  {
    id: 'share-page',
    label: 'Render a share page',
    ...get('/perf/perf-public-screenshot.png', { anonymous: true }),
    work: (result) => (result.bytes.includes('perf-public-screenshot') ? 1 : 0),
    expect: 1,
  },
  {
    id: 'short-link',
    label: 'Follow a short link',
    ...get('/u/p1', { anonymous: true }),
    statuses: [307, 308, 302],
    work: () => 1,
    expect: 1,
  },
  {
    id: 'upload',
    label: 'Upload a screenshot to a 100,000-file library',
    run: (side) =>
      uploadOne(side, `bench-upload-${Date.now()}-${++client}.png`),
    work: (result) => (json(result)?.data?.url ? 1 : 0),
    expect: 1,
  },
  {
    id: 'upload-burst',
    label: 'Upload 48 screenshots at once',
    runs: 5,
    run: async (side) => {
      const started = performance.now()
      const results = await Promise.all(
        Array.from({ length: 48 }, () =>
          uploadOne(side, `bench-upload-${Date.now()}-${++client}.png`)
        )
      )
      // A burst that loses uploads still reports its time; `work` is how
      // many of the 48 were stored.
      return {
        ms: performance.now() - started,
        status: 200,
        stored: results.filter((result) => result.status === 200).length,
        bytes: Buffer.alloc(0),
      }
    },
    work: (result) => result.stored,
    least: true,
  },
  {
    id: 'library-busy',
    label: 'Serve 480 library pages to 16 people at once',
    runs: 5,
    // Sixteen clients ask for thirty pages each; timed start to finish.
    run: async (side) => {
      const started = performance.now()
      let served = 0
      await Promise.all(
        Array.from({ length: 16 }, async (_, worker) => {
          for (let page = 1; page <= 30; page++) {
            const result = await request(side, {
              path: `/api/files?sortBy=newest&page=${1 + ((worker * 7 + page) % 20)}&limit=48&${WINDOW}`,
            })
            if (result.status === 200 && listed(result) === PAGE) served++
          }
        })
      )
      return {
        ms: performance.now() - started,
        status: 200,
        served,
        bytes: Buffer.alloc(0),
      }
    },
    work: (result) => result.served,
    expect: 16 * 30,
  },
]

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}
const round = (value) => Math.round(value * 100) / 100

async function removeUploads(side) {
  let removed = 0
  for (;;) {
    const page = json(
      await request(side, {
        path: '/api/files?search=bench-upload-&page=1&limit=100',
      })
    )
    if (!page?.data?.length) return removed
    for (const file of page.data) {
      const result = await request(side, {
        path: `/api/files/${file.id}`,
        method: 'DELETE',
      })
      if (result.status !== 200)
        throw new Error(`Could not remove ${file.name}: ${result.status}`)
      removed++
    }
  }
}

async function main() {
  // Before the run adds its own load.
  const loadAverageAtStart = os.loadavg().map(round)
  const sides = {}
  for (const [name, base] of Object.entries(SIDES))
    sides[name] = { name, base, cookie: await signIn(base) }
  const results = []
  for (const scenario of SCENARIOS) {
    if (ONLY && !ONLY.includes(scenario.id)) continue
    const runs = scenario.runs ?? RUNS
    const samples = { before: [], after: [] }
    const errors = { before: 0, after: 0 }
    const work = { before: null, after: null }
    const bytes = { before: 0, after: 0 }
    const statuses = scenario.statuses ?? [200]
    for (const side of Object.values(sides)) await scenario.run(side)
    for (let run = 0; run < runs; run++) {
      // Alternate which side goes first.
      const order = run % 2 ? ['after', 'before'] : ['before', 'after']
      for (const name of order) {
        const result = await scenario.run(sides[name])
        const count = scenario.work(result)
        const done =
          statuses.includes(result.status) &&
          (scenario.expect === undefined
            ? count > 0
            : count === scenario.expect)
        if (!done) errors[name]++
        else {
          samples[name].push(result.ms)
          // `least` scenarios report their worst run, the rest their last.
          work[name] =
            scenario.least && work[name] !== null
              ? Math.min(work[name], count)
              : count
          bytes[name] = result.bytes.length
        }
      }
    }
    const summary = (name) => ({
      median: samples[name].length ? round(median(samples[name])) : null,
      min: samples[name].length ? round(Math.min(...samples[name])) : null,
      max: samples[name].length ? round(Math.max(...samples[name])) : null,
      runs,
      errors: errors[name],
      work: work[name],
      bytes: bytes[name],
    })
    const row = {
      id: scenario.id,
      label: scenario.label,
      unit: scenario.unit ?? 'ms',
      report: scenario.report ?? 'time',
      before: summary('before'),
      after: summary('after'),
    }
    results.push(row)
    const show = (side) =>
      row.report === 'bytes'
        ? `${side.bytes} B`
        : `${side.median} ${row.unit} (${side.min}-${side.max})`
    console.log(
      `${row.id.padEnd(20)} before ${show(row.before).padEnd(30)} after ${show(row.after).padEnd(30)} errors ${errors.before}/${errors.after} work ${work.before}/${work.after}`
    )
  }
  const removed = {}
  for (const side of Object.values(sides))
    removed[side.name] = await removeUploads(side)
  console.log(`removed uploads ${removed.before}/${removed.after}`)
  const report = {
    kind: 'api',
    measuredAt: new Date().toISOString(),
    host: {
      cpus: os.cpus().length,
      memoryGiB: Math.round(os.totalmem() / 1024 ** 3),
      loadAverageAtStart,
      node: process.version,
    },
    runs: RUNS,
    results,
  }
  if (args.out) {
    mkdirSync(path.dirname(args.out), { recursive: true })
    writeFileSync(args.out, `${JSON.stringify(report, null, 2)}\n`)
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
