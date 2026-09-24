// Run this complete example in a signed-in Flare page's developer console.
// It creates, updates, and deletes only its own temporary saved view.
// No token, copied session cookie, or dependency is needed.
;(async () => {
  async function request(path, method = 'GET', body) {
    const response = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: body ? { 'Content-Type': 'application/json' } : {},
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
    const result = await response.json()
    if (!response.ok) {
      throw new Error(`${method} ${path}: ${response.status} ${result.error}`)
    }
    return result.data
  }

  const before = await request('/api/saved-views')
  console.log(`This account has ${before.length} saved views.`)

  let temporaryView
  try {
    temporaryView = await request('/api/saved-views', 'POST', {
      name: `Example ${crypto.randomUUID().slice(0, 8)}`,
      pinned: true,
      filters: {
        types: ['image/png', 'image/jpeg'],
        sortBy: 'newest',
        groupBy: 'month',
      },
    })
    console.log('Created temporary view:', temporaryView)

    temporaryView = await request(
      `/api/saved-views/${encodeURIComponent(temporaryView.id)}`,
      'PATCH',
      { revision: temporaryView.revision, pinned: false }
    )
    console.log('Updated temporary view:', temporaryView)
  } finally {
    if (temporaryView) {
      try {
        await request(
          `/api/saved-views/${encodeURIComponent(temporaryView.id)}`,
          'DELETE',
          { revision: temporaryView.revision }
        )
        console.log('Deleted temporary view:', temporaryView.id)
      } catch (error) {
        console.error(
          'Cleanup failed. Review this temporary view in Saved views:',
          temporaryView.id
        )
        throw error
      }
    }
  }
})()
