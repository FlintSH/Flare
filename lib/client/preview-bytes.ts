/** Bound memory even when a response omits or misreports Content-Length. */
export async function readPreviewBytes(response: Response, limit: number) {
  const reader = response.body?.getReader()
  if (!reader) throw new Error('This entry has no content to preview.')
  const chunks: Uint8Array[] = []
  let length = 0
  let truncated = false
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      const remaining = limit - length
      chunks.push(value.slice(0, Math.max(0, remaining)))
      length += Math.min(value.length, remaining)
      if (value.length > remaining) {
        truncated = true
        await reader.cancel()
        break
      }
    }
  } finally {
    reader.releaseLock()
  }
  const bytes = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.length
  }
  return { bytes, truncated }
}
