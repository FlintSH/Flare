import type { FileType } from '@/types/components/file'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { LibraryFilters } from '@/lib/library/contract'
import type { GalleryPage } from '@/lib/library/gallery'

import { useImageGallery } from '@/hooks/use-image-gallery'

const harness = vi.hoisted(() => ({
  slots: [] as unknown[],
  cursor: 0,
  dirty: false,
  effects: [] as (() => void)[],
  fetch: vi.fn(),
  toast: vi.fn(),
}))

// Match dependency-aware effects and callbacks so data refreshes and explicit
// filter changes exercise the hook's real cleanup and request ownership.
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
  useCallback: (callback: unknown, dependencies: unknown[]) => {
    const index = harness.cursor++
    const previous = harness.slots[index] as
      { callback: unknown; dependencies: unknown[] } | undefined
    if (
      !previous ||
      dependencies.some(
        (value, i) => !Object.is(value, previous.dependencies[i])
      )
    ) {
      harness.slots[index] = { callback, dependencies }
      return callback
    }
    return previous.callback
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

vi.mock('@/hooks/use-toast', () => ({ toast: harness.toast }))

const filters: LibraryFilters = {
  folder: null,
  // Not a default, so the neighbor request shows whether it carries the filters.
  tag: 'trips',
  search: '',
  types: [],
  visibility: [],
  index: [],
  minSize: null,
  maxSize: null,
  dateFrom: null,
  dateTo: null,
  sortBy: 'newest',
  groupBy: 'none',
  page: 1,
  limit: 2,
}

function file(id: string): FileType {
  return {
    id,
    name: id,
    mimeType: 'image/jpeg',
    urlPath: `/${id}`,
    size: 100,
    uploadedAt: '2026-09-16T12:00:00Z',
    visibility: 'PRIVATE',
    hasPassword: false,
    views: 0,
    downloads: 0,
  }
}

const files = [file('first'), file('second')]
const pagination = { page: 1, pageCount: 3, total: 6, limit: 2 }
type HookProps = {
  filters: LibraryFilters
  files: FileType[]
  refreshKey: number
}
const initialProps: HookProps = { filters, files, refreshKey: 0 }

function render(props: HookProps = initialProps) {
  let result!: ReturnType<typeof useImageGallery>
  do {
    harness.dirty = false
    harness.cursor = 0
    harness.effects = []
    // Each iteration models one explicit render; React is mocked above.
    // eslint-disable-next-line react-hooks/rules-of-hooks
    result = useImageGallery(props.filters, props.files, props.refreshKey)
    harness.effects.forEach((effect) => effect())
  } while (harness.dirty)
  return result
}

const pageResponse = ({ files, pagination }: GalleryPage) =>
  Response.json({ data: files, pagination })

/** Answers the next neighbor request as `GET /api/files` does; null is a 404. */
function answer(page: GalleryPage | null) {
  harness.fetch.mockResolvedValueOnce(
    page ? pageResponse(page) : new Response(null, { status: 404 })
  )
}

function pendingPage() {
  let resolve!: (page: GalleryPage) => void
  harness.fetch.mockReturnValueOnce(
    new Promise<Response>((complete) => {
      resolve = (page) => complete(pageResponse(page))
    })
  )
  return { resolve }
}

function neighborRequest(call: number) {
  const [url, init] = harness.fetch.mock.calls[call] as [string, RequestInit]
  const query = new URL(url, 'http://localhost').searchParams
  return {
    anchor: query.get('galleryAnchor'),
    direction: query.get('galleryDirection'),
    tag: query.get('tag'),
    signal: init.signal as AbortSignal,
  }
}

beforeEach(() => {
  harness.slots = []
  vi.clearAllMocks()
  vi.stubGlobal('fetch', harness.fetch)
})

afterEach(() => vi.unstubAllGlobals())

describe('image gallery refresh lifecycle', () => {
  it('opens on the chosen image alone and finds its neighbors by its ID', async () => {
    render().open(files[1])
    expect(render().gallery).toMatchObject({
      files: [files[1]],
      index: 0,
      pagination: null,
      atStart: false,
      atEnd: false,
    })
    answer({
      files: [file('third')],
      pagination: { ...pagination, page: 2, offset: 2 },
    })
    await render().move(1)
    expect(neighborRequest(0)).toMatchObject({
      anchor: 'second',
      direction: 'next',
    })
    expect(render().gallery?.files[0].id).toBe('third')
    expect(render().gallery?.pagination?.offset).toBe(2)
  })

  it('preserves the same current image and session when uploads shift the grid', () => {
    render().open(files[1])
    const before = render().gallery
    const refreshed = render({
      ...initialProps,
      files: [file('new-upload'), file('first')],
    })

    expect(refreshed.gallery).toBe(before)
    expect(refreshed.gallery?.files[refreshed.gallery.index]).toBe(files[1])
    expect(refreshed.navigationPending).toBe(false)
    expect(refreshed.navigationStale).toBe(true)
  })

  it('anchors a shifted page boundary to the current image instead of its old page number', async () => {
    render().open(files[1])
    const props = { ...initialProps, refreshKey: 1 }
    answer({
      files: [file('third'), file('fourth')],
      pagination: { ...pagination, total: 7, pageCount: 4, page: 2, offset: 3 },
    })

    await render(props).move(1)
    expect(neighborRequest(0)).toMatchObject({
      anchor: 'second',
      direction: 'next',
      tag: 'trips',
    })
    expect(render(props).gallery?.files[0].id).toBe('third')
    expect(render(props).gallery?.pagination?.offset).toBe(3)
    expect(render(props).navigationStale).toBe(false)
  })

  it('re-anchors even within a loaded window when refresh removes the next image', async () => {
    answer({
      files: [file('second'), file('third')],
      pagination: { ...pagination, offset: 1 },
    })
    render().open(files[0])
    await render().move(1)
    const props = {
      ...initialProps,
      files: [files[0], file('second')],
      refreshKey: 1,
    }
    answer({
      files: [file('fourth')],
      pagination: { ...pagination, offset: 2 },
    })
    await render(props).move(1)
    expect(neighborRequest(1).anchor).toBe('second')
    expect(render(props).gallery?.files[0].id).toBe('fourth')
  })

  it('allows a refreshed start boundary to discover newly uploaded predecessors', async () => {
    answer({
      files: [],
      pagination: { ...pagination, offset: 0 },
    })
    render().open(files[0])
    await render().move(-1)
    expect(render().gallery?.atStart).toBe(true)
    await render().move(-1)
    expect(harness.fetch).toHaveBeenCalledTimes(1)

    const props = { ...initialProps, refreshKey: 1 }
    answer({
      files: [file('newer'), file('new')],
      pagination: { ...pagination, offset: 0 },
    })
    await render(props).move(-1)
    const gallery = render(props).gallery!
    expect(gallery.files[gallery.index].id).toBe('new')
    expect(gallery.atStart).toBe(true)
    expect(gallery.atEnd).toBe(false)
  })

  it('keeps local navigation immediate while the library is unchanged', async () => {
    answer({
      files: [file('second'), file('third')],
      pagination: { ...pagination, offset: 1 },
    })
    render().open(files[0])
    await render().move(1)
    await render().move(1)
    expect(render().gallery?.files[render().gallery!.index].id).toBe('third')
    expect(harness.fetch).toHaveBeenCalledTimes(1)
  })

  it.each([-1, 1] as const)(
    'keeps the active image at a refreshed empty boundary (%s)',
    async (direction) => {
      render().open(files[1])
      const props = { ...initialProps, refreshKey: 1 }
      answer({
        files: [],
        pagination: { ...pagination, total: 1, pageCount: 1, offset: 0 },
      })
      await render(props).move(direction)
      const gallery = render(props).gallery!
      expect(gallery.files).toEqual([files[1]])
      expect(gallery.index).toBe(0)
      expect(gallery.atStart).toBe(true)
      expect(gallery.atEnd).toBe(true)
      expect(render(props).navigationStale).toBe(false)
      await render(props).move(direction)
      expect(harness.fetch).toHaveBeenCalledTimes(1)
    }
  )

  it('closes if a refreshed active image is no longer in the filtered results', async () => {
    render().open(files[0])
    const props = { ...initialProps, refreshKey: 1 }
    answer(null)
    await render(props).move(1)
    expect(render(props).gallery).toBeNull()
    expect(render(props).navigationPending).toBe(false)
    expect(harness.toast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'This image is no longer in these results',
      })
    )
  })

  it('does not replace a later gallery page with a refreshed first grid page', async () => {
    const third = file('third')
    answer({
      files: [third, file('fourth')],
      pagination: { ...pagination, page: 2, offset: 2 },
    })
    render().open(files[1])
    await render().move(1)
    const before = render().gallery
    const refreshed = render({
      ...initialProps,
      files: [file('new-upload'), file('first')],
    })

    expect(refreshed.gallery).toBe(before)
    expect(refreshed.gallery?.pagination?.page).toBe(2)
    expect(refreshed.gallery?.files[refreshed.gallery.index]).toEqual(third)
  })

  it('lets explicit image navigation complete through a background grid refresh', async () => {
    const next = pendingPage()
    render().open(files[1])
    const navigation = render().move(1)
    const { signal } = neighborRequest(0)
    const refreshedProps = {
      ...initialProps,
      files: [file('new-upload'), file('first')],
      refreshKey: 1,
    }
    const refreshed = render(refreshedProps)

    expect(signal.aborted).toBe(false)
    expect(refreshed.navigationPending).toBe(true)
    expect(refreshed.gallery?.files[refreshed.gallery.index]).toBe(files[1])
    next.resolve({
      files: [file('third'), file('fourth')],
      pagination: { ...pagination, page: 2, offset: 2 },
    })
    await navigation
    expect(render(refreshedProps).gallery?.files[0].id).toBe('third')
    expect(render(refreshedProps).navigationPending).toBe(false)
    expect(render(refreshedProps).navigationStale).toBe(true)
    answer({
      files: [file('inserted-between')],
      pagination: { ...pagination, page: 2, offset: 3 },
    })
    await render(refreshedProps).move(1)
    expect(neighborRequest(1).anchor).toBe('third')
    expect(render(refreshedProps).gallery?.files[0].id).toBe('inserted-between')
    expect(render(refreshedProps).navigationStale).toBe(false)
  })

  it('closes and aborts navigation when the selected filters change', async () => {
    const next = pendingPage()
    render().open(files[1])
    const navigation = render().move(1)
    const { signal } = neighborRequest(0)
    const filteredProps = {
      ...initialProps,
      filters: { ...filters, search: 'holiday' },
    }

    expect(render(filteredProps).gallery).toBeNull()
    expect(signal.aborted).toBe(true)
    next.resolve({
      files: [file('stale')],
      pagination: { ...pagination, page: 2, offset: 2 },
    })
    await navigation
    expect(render(filteredProps).gallery).toBeNull()
    expect(render(filteredProps).navigationPending).toBe(false)
    expect(harness.toast).not.toHaveBeenCalled()
  })

  it('ignores a closed session response without clearing a replacement session request', async () => {
    const old = pendingPage()
    render().open(files[1])
    const oldNavigation = render().move(1)
    render().close()
    expect(render().gallery).toBeNull()

    const replacement = pendingPage()
    render().open(files[1])
    const replacementNavigation = render().move(1)
    old.resolve({
      files: [file('stale')],
      pagination: { ...pagination, page: 2, offset: 2 },
    })
    await oldNavigation
    expect(render().navigationPending).toBe(true)
    expect(render().gallery?.files[0].id).toBe('second')
    replacement.resolve({
      files: [file('current')],
      pagination: { ...pagination, page: 2, offset: 2 },
    })
    await replacementNavigation
    expect(render().gallery?.files[0].id).toBe('current')
    expect(render().navigationPending).toBe(false)
  })
})
