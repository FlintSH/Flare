const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { createRequire } = require('node:module')
const { dirname, join } = require('node:path')

async function main() {
  const next = require('next/package.json')
  const react = require('react/package.json')
  const reactDom = require('react-dom/package.json')
  // Resolve from Next itself, rather than assuming the root package is used.
  const optimizerPath = require.resolve('next/dist/server/image-optimizer.js')
  const fromNext = createRequire(optimizerPath)
  const sharpPackage = JSON.parse(readFileSync(join(dirname(fromNext.resolve('sharp')), '..', 'package.json'), 'utf8'))
  const sharp = fromNext('sharp')
  assert.equal(require(optimizerPath).getSharp(), sharp)
  const runtime = process.report.getReport().header

  assert.equal(process.platform, 'linux')
  assert.equal(process.arch, 'x64')
  assert.equal(process.version, 'v24.17.0')
  assert.ok(runtime.glibcVersionRuntime)
  assert.equal(next.version, '15.5.28')
  assert.equal(react.version, '18.3.1')
  assert.equal(reactDom.version, '18.3.1')
  assert.equal(sharpPackage.version, '0.35.5')
  assert.equal(sharp.versions.sharp, '0.35.5')

  const svg = Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><rect width="2" height="2" fill="blue"/></svg>'
  )
  const png = await sharp(svg).png().toBuffer()
  const metadata = await sharp(png).metadata()
  assert.equal(metadata.format, 'png')
  assert.equal(metadata.width, 2)
  assert.equal(metadata.height, 2)

  console.log(JSON.stringify({
    node: process.version,
    next: next.version,
    react: react.version,
    reactDom: reactDom.version,
    nextResolvedSharp: sharpPackage.version,
    nativeSharp: sharp.versions.sharp,
    glibc: runtime.glibcVersionRuntime,
    benignSvgToPng: 'passed',
  }))
}

main().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
