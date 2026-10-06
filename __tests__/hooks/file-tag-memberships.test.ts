import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useFileTagMemberships } from '@/hooks/use-file-tag-memberships'

const harness = vi.hoisted(() => ({
  slots: [] as unknown[],
  cursor: 0,
  dirty: false,
  effects: [] as (() => void)[],
}))

// Dependency-aware effects preserve real asynchronous request ownership, as in
// the gallery/timeline hook tests; fresh array props still model a React render.
vi.mock('react', () => ({
  useState: (initial: unknown) => {
    const index = harness.cursor++
    if (!(index in harness.slots)) harness.slots[index] = initial
    return [
      harness.slots[index],
      (value: unknown) => {
        const next =
          typeof value === 'function' ? value(harness.slots[index]) : value
        if (!Object.is(harness.slots[index], next)) harness.dirty = true
        harness.slots[index] = next
      },
    ]
  },
  useRef: (initial: unknown) => {
    const index = harness.cursor++
    if (!(index in harness.slots)) harness.slots[index] = { current: initial }
    return harness.slots[index]
  },
  useEffect: (effect: () => void | (() => void), dependencies: unknown[]) => {
    const index = harness.cursor++
    const previous = harness.slots[index] as
      { dependencies: unknown[]; cleanup?: () => void } | undefined
    if (
      previous &&
      dependencies.every((value, i) =>
        Object.is(value, previous.dependencies[i])
      )
    )
      return
    harness.effects.push(() => {
      previous?.cleanup?.()
      harness.slots[index] = { dependencies, cleanup: effect() }
    })
  },
}))

type PendingRequest = {
  url: URL
  options: RequestInit
  resolve: (response: Response) => void
}
let requests: PendingRequest[] = []
const favorite = { id: 'favorite', name: 'Favorites' }
const work = { id: 'work', name: 'Work' }
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify({ data }), { status })
async function flush() {
  await new Promise<void>((resolve) => setImmediate(resolve))
}
function render(ids = ['first', 'second']) {
  let result!: ReturnType<typeof useFileTagMemberships>
  do {
    harness.dirty = false
    harness.cursor = 0
    harness.effects = []
    // Each iteration models one explicit render; React is mocked above.
    // eslint-disable-next-line react-hooks/rules-of-hooks
    result = useFileTagMemberships(ids)
    harness.effects.forEach((effect) => effect())
  } while (harness.dirty)
  return result
}
function unmount() {
  for (const slot of harness.slots) {
    if (slot && typeof slot === 'object' && 'cleanup' in slot)
      (slot as { cleanup?: () => void }).cleanup?.()
  }
  harness.slots = []
}
async function loaded() {
  render()
  requests[0].resolve(
    json({
      files: [
        { id: 'first', tags: [work] },
        { id: 'second', tags: [favorite] },
      ],
    })
  )
  await flush()
  return render()
}

beforeEach(() => {
  harness.slots = []
  requests = []
  vi.stubGlobal(
    'fetch',
    vi.fn(
      (url: string, options: RequestInit) =>
        new Promise<Response>((resolve) => {
          requests.push({
            url: new URL(url, 'http://localhost'),
            options,
            resolve,
          })
        })
    )
  )
})
afterEach(() => {
  unmount()
  vi.unstubAllGlobals()
})

describe('authoritative file tag memberships', () => {
  it('loads the entire selection in one uncached request, without accepting retained metadata', async () => {
    expect(render()).toMatchObject({ loading: true, files: null, error: '' })
    expect(requests).toHaveLength(1)
    expect(requests[0].url.pathname).toBe('/api/files/tags')
    expect(requests[0].url.searchParams.get('fileIds')).toBe('first,second')
    expect(requests[0].options.cache).toBe('no-store')
    const hook = await loaded()
    expect(hook.loading).toBe(false)
    expect(hook.files).toEqual([
      { id: 'first', tags: [work] },
      { id: 'second', tags: [favorite] },
    ])
    expect(render(['second', 'first']).files).toBe(hook.files)
    expect(requests).toHaveLength(1)
  })

  it('preserves fresh unrelated tags after edits and does not refetch when onChanged replaces objects', async () => {
    const hook = await loaded()
    const update = hook.update(favorite, 'add')
    expect(requests).toHaveLength(2)
    expect(JSON.parse(requests[1].options.body as string)).toEqual({
      fileIds: ['first', 'second'],
      tagId: favorite.id,
      action: 'add',
    })
    requests[1].resolve(json({ count: 2 }))
    expect(await update).toEqual([
      { id: 'first', tags: [work, favorite] },
      { id: 'second', tags: [favorite] },
    ])
    expect(render(['first', 'second']).files?.[0].tags).toEqual([
      work,
      favorite,
    ])
    const remove = render().update(favorite, 'remove')
    requests[2].resolve(json({ count: 2 }))
    await remove
    expect(render().files).toEqual([
      { id: 'first', tags: [work] },
      { id: 'second', tags: [] },
    ])
    expect(
      requests.filter((request) => request.options.method !== 'PATCH')
    ).toHaveLength(1)
  })

  it('aborts superseded selections and ignores their late responses', async () => {
    render()
    const old = requests[0]
    expect(render(['replacement'])).toMatchObject({
      loading: true,
      files: null,
    })
    expect(old.options.signal?.aborted).toBe(true)
    old.resolve(json({ files: [{ id: 'first', tags: [favorite] }] }))
    requests[1].resolve(json({ files: [{ id: 'replacement', tags: [] }] }))
    await flush()
    expect(render(['replacement']).files).toEqual([
      { id: 'replacement', tags: [] },
    ])
  })

  it('aborts on close and requests a fresh snapshot when reopened with the same IDs', async () => {
    render()
    const old = requests[0]
    unmount()
    expect(old.options.signal?.aborted).toBe(true)
    render()
    old.resolve(json({ files: [{ id: 'first', tags: [favorite] }] }))
    await flush()
    expect(render()).toMatchObject({ loading: true, files: null, error: '' })
    expect(requests).toHaveLength(2)
  })

  it('offers recovery for unavailable files, retries, and never accepts partial selections', async () => {
    render()
    requests[0].resolve(json({}, 404))
    await flush()
    const failed = render()
    expect(failed).toMatchObject({ loading: false, files: null })
    expect(failed.error).toContain('Close this dialog and reselect your files')
    expect(await failed.update(work, 'add')).toBeNull()
    failed.reload()
    expect(render().loading).toBe(true)
    requests[1].resolve(json({ files: [{ id: 'first', tags: [] }] }))
    await flush()
    expect(render().files).toBeNull()
    expect(render().error).toContain('reselect')
    render().reload()
    render()
    requests[2].resolve(
      json({
        files: [
          { id: 'first', tags: [] },
          { id: 'second', tags: [work] },
        ],
      })
    )
    await flush()
    expect(render().error).toBe('')
    expect(render().files?.[1].tags).toEqual([work])
  })

  it('ignores mutation completions and callbacks from a closed dialog', async () => {
    const hook = await loaded()
    const update = hook.update(work, 'remove')
    const pending = requests[1]
    unmount()
    expect(pending.options.signal?.aborted).toBe(true)
    render()
    pending.resolve(json({ count: 2 }))
    expect(await update).toBeNull()
    expect(await hook.update(favorite, 'add')).toBeNull()
    expect(requests).toHaveLength(3)
    expect(render().files).toBeNull()
  })

  it.each([
    [503, 'Try again.'],
    [404, 'Tag not found.'],
    [404, 'One or more files are unavailable.'],
  ])(
    'keeps memberships and the server error after a rejected mutation (%s, %s)',
    async (status, message) => {
      const hook = await loaded()
      const update = hook.update(work, 'remove')
      requests[1].resolve(
        new Response(JSON.stringify({ error: message }), { status })
      )
      await expect(update).rejects.toThrow(message)
      expect(render().files?.[0].tags).toEqual([work])
    }
  )

  it('bounds membership requests and state to a selection of at most 100 files', async () => {
    expect(render([]).error).toContain('between 1 and 100')
    expect(
      render(Array.from({ length: 101 }, (_, i) => String(i))).error
    ).toContain('between 1 and 100')
    expect(requests).toHaveLength(0)
    const ids = Array.from({ length: 100 }, (_, i) => String(i))
    render(ids)
    expect(requests).toHaveLength(1)
    requests[0].resolve(json({ files: ids.map((id) => ({ id, tags: [] })) }))
    await flush()
    expect(render(ids).files).toHaveLength(100)
  })
})
