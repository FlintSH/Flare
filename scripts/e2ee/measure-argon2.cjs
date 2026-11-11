/* eslint-disable @typescript-eslint/no-require-imports */
// Measures the time of Argon2id with the parameters of protocol version 1
// (docs/e2ee-spec.md, section 4.3: 64 MiB, 3 passes, 4 lanes, 32 bytes) in
// headless Chromium, with the WebAssembly code that the browser client uses
// (`hash-wasm`, see lib/e2ee/client/argon2-wasm.ts).
//
// Chromium can slow down the processor of a page by a factor. This script
// runs the function at each factor in FLARE_E2EE_ARGON2_RATES (default
// 1,2,4,6). A factor is an estimate of a slower device, not a measurement
// on one: it does not change the speed of the memory, and a real phone can
// refuse or swap 64 MiB. The function runs on the thread of the page here,
// because the slowdown applies to that thread. The application runs it in a
// worker, which takes the same time at factor 1.
//
// No application and no database are necessary:
//
//   node scripts/e2ee/measure-argon2.cjs
//
// FLARE_E2EE_MEASURE_RESULTS names a file for the numbers as JSON.
const { writeFileSync } = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { chromium } = require('../../docs/site/node_modules/@playwright/test')

const RATES = (process.env.FLARE_E2EE_ARGON2_RATES || '1,2,4,6')
  .split(',')
  .map(Number)
  .filter((rate) => rate >= 1)
const RUNS = 5

async function main() {
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage()
    await page.goto('about:blank')
    await page.addScriptTag({
      path: path.resolve(
        __dirname,
        '../../node_modules/hash-wasm/dist/argon2.umd.min.js'
      ),
    })
    const devtools = await page.context().newCDPSession(page)
    const results = {
      parameters: { memoryKib: 65536, passes: 3, lanes: 4, outputLength: 32 },
      runs: RUNS,
      rates: [],
      processor: os.cpus()[0].model,
    }
    for (const rate of RATES) {
      await devtools.send('Emulation.setCPUThrottlingRate', { rate })
      const times = await page.evaluate(async (runs) => {
        const times = []
        for (let run = 0; run < runs; run++) {
          const salt = crypto.getRandomValues(new Uint8Array(32))
          const started = performance.now()
          await globalThis.hashwasm.argon2id({
            password: `a passphrase for a measurement ${run}`,
            salt,
            iterations: 3,
            parallelism: 4,
            memorySize: 65536,
            hashLength: 32,
            outputType: 'binary',
          })
          times.push(performance.now() - started)
        }
        return times
      }, RUNS)
      // The first run of the first factor also compiles the WebAssembly code.
      const sorted = [...times].sort((a, b) => a - b)
      results.rates.push({
        slowdown: rate,
        firstMs: Math.round(times[0]),
        medianMs: Math.round(sorted[Math.floor(sorted.length / 2)]),
        slowestMs: Math.round(sorted[sorted.length - 1]),
      })
    }
    console.log(JSON.stringify(results, null, 2))
    if (process.env.FLARE_E2EE_MEASURE_RESULTS)
      writeFileSync(
        process.env.FLARE_E2EE_MEASURE_RESULTS,
        `${JSON.stringify(results, null, 2)}\n`
      )
  } finally {
    await browser.close()
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
