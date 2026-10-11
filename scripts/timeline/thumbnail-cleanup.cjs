/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict')

async function cleanupThumbnailFixtures({
  browser,
  owner,
  fixtures,
  origin,
  failures = /** @type {unknown[]} */ ([]),
}) {
  const errors = [...failures]
  try {
    if (owner) {
      for (const file of fixtures) {
        try {
          const response = await owner.context.request.delete(
            origin + `/api/files/${file.id}`,
            { headers: { Origin: origin } }
          )
          assert.ok(response.ok(), `HTTP ${response.status()}`)
        } catch (cause) {
          errors.push(new Error(`Cleanup failed for ${file.name}`, { cause }))
        }
      }
    }
  } finally {
    try {
      await browser.close()
    } catch (cause) {
      errors.push(
        new Error('Could not close the thumbnail check browser', { cause })
      )
    }
  }
  if (errors.length === 1) throw errors[0]
  if (errors.length > 1)
    throw new AggregateError(errors, 'Thumbnail verification or cleanup failed')
}

module.exports = { cleanupThumbnailFixtures }
