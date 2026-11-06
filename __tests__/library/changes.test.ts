import { QueryClient, QueryObserver } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  LIBRARY_LISTS,
  libraryChanged,
  onLibraryChange,
} from '@/lib/library/changes'

const client = new QueryClient()
const stops: (() => void)[] = []

/** An open list that has loaded; `read` counts how often it is read. */
async function openList(name: string) {
  const read = vi.fn(async () => [name])
  const observer = new QueryObserver(client, {
    queryKey: [name, 'alice', 'alice-browser'],
    queryFn: read,
    staleTime: 0,
  })
  stops.push(observer.subscribe(() => {}))
  await vi.waitFor(() =>
    expect(observer.getCurrentResult().isSuccess).toBe(true)
  )
  return read
}

afterEach(() => {
  stops.splice(0).forEach((stop) => stop())
  client.clear()
})

describe('library changes', () => {
  it('reload every open list and every open library once each', async () => {
    const lists = await Promise.all(Object.values(LIBRARY_LISTS).map(openList))
    const other = await openList('upload-profiles')
    const reload = vi.fn()
    stops.push(onLibraryChange(reload))

    await libraryChanged(client)

    expect(reload).toHaveBeenCalledTimes(1)
    for (const read of lists) expect(read).toHaveBeenCalledTimes(2)
    expect(other).toHaveBeenCalledTimes(1)
  })

  it('stop reaching a library once it unsubscribes', async () => {
    const reload = vi.fn()
    onLibraryChange(reload)()
    await libraryChanged(client)
    expect(reload).not.toHaveBeenCalled()
  })
})
