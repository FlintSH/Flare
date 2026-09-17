import type {
  FileFilterOptions,
  FileType,
  PaginationInfo,
} from '@/types/components/file'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { GalleryPage } from '@/lib/files/gallery'

import { useImageGallery } from '@/hooks/use-image-gallery'

const harness = vi.hoisted(() => ({
  slots: [] as unknown[],
  cursor: 0,
  dirty: false,
  effects: [] as (() => void)[],
  adjacentImagePage: vi.fn(),
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
      | { callback: unknown; dependencies: unknown[] }
      | undefined
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
      | { dependencies: unknown[]; cleanup?: () => void }
      | undefined
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

vi.mock('@/lib/files/gallery', () => ({
  adjacentImagePage: harness.adjacentImagePage,
}))
vi.mock('@/hooks/use-toast', () => ({ toast: harness.toast }))

const filters: FileFilterOptions = {
  search: '',
  types: [],
  visibility: [],
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
const pagination: PaginationInfo = { page: 1, pageCount: 3, total: 6, limit: 2 }
type HookProps = {
  filters: FileFilterOptions
  files: FileType[]
  pagination: PaginationInfo
  refreshKey: number
}
const initialProps: HookProps = { filters, files, pagination, refreshKey: 0 }

function render(props: HookProps = initialProps) {
  let result!: ReturnType<typeof useImageGallery>
  do {
    harness.dirty = false
    harness.cursor = 0
    harness.effects = []
    // Each iteration models one explicit render; React is mocked above.
    // eslint-disable-next-line react-hooks/rules-of-hooks
    result = useImageGallery(
      props.filters,
      props.files,
      props.pagination,
      props.refreshKey
    )
    harness.effects.forEach((effect) => effect())
  } while (harness.dirty)
  return result
}

function pendingPage() {
  let resolve!: (page: GalleryPage) => void
  const promise = new Promise<GalleryPage>((complete) => {
    resolve = complete
  })
  harness.adjacentImagePage.mockReturnValueOnce(promise)
  return { resolve }
}

beforeEach(() => {
  harness.slots = []
  vi.clearAllMocks()
})

describe('image gallery refresh lifecycle', () => {
  it('preserves the same current image and session when uploads shift the grid', () => {
    render().open(files[1])
    const before = render().gallery
    const refreshed = render({
      ...initialProps,
      files: [file('new-upload'), file('first')],
      pagination: { ...pagination, total: 7, pageCount: 4 },
    })

    expect(refreshed.gallery).toBe(before)
    expect(refreshed.gallery?.files[refreshed.gallery.index]).toBe(files[1])
    expect(refreshed.navigationPending).toBe(false)
    expect(refreshed.navigationStale).toBe(true)
  })

  it('anchors a shifted page boundary to the current image instead of its old page number', async () => {
    render().open(files[1])
    const props = { ...initialProps, refreshKey: 1 }
    harness.adjacentImagePage.mockResolvedValueOnce({
      files: [file('third'), file('fourth')],
      pagination: { ...pagination, total: 7, pageCount: 4, page: 2, offset: 3 },
    })

    await render(props).move(1)
    expect(harness.adjacentImagePage.mock.calls[0][0]).toMatchObject({
      anchorId: 'second',
      direction: 1,
      filters,
    })
    expect(render(props).gallery?.files[0].id).toBe('third')
    expect(render(props).gallery?.pagination.offset).toBe(3)
    expect(render(props).navigationStale).toBe(false)
  })

  it('re-anchors even within a cached window when refresh removes the next image', async () => {
    render().open(files[0])
    const props = {
      ...initialProps,
      files: [files[0], file('third')],
      refreshKey: 1,
    }
    harness.adjacentImagePage.mockResolvedValueOnce({
      files: [file('third')],
      pagination: { ...pagination, offset: 1 },
    })
    await render(props).move(1)
    expect(harness.adjacentImagePage.mock.calls[0][0].anchorId).toBe('first')
    expect(render(props).gallery?.files[0].id).toBe('third')
  })

  it('allows a refreshed start boundary to discover newly uploaded predecessors', async () => {
    render().open(files[0])
    const props = { ...initialProps, refreshKey: 1 }
    harness.adjacentImagePage.mockResolvedValueOnce({
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
    render().open(files[0])
    await render().move(1)
    expect(render().gallery?.index).toBe(1)
    expect(harness.adjacentImagePage).not.toHaveBeenCalled()
  })

  it.each([-1, 1] as const)(
    'keeps the active image at a refreshed empty boundary (%s)',
    async (direction) => {
      render().open(files[1])
      const props = { ...initialProps, refreshKey: 1 }
      harness.adjacentImagePage.mockResolvedValueOnce({
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
      expect(harness.adjacentImagePage).toHaveBeenCalledTimes(1)
    }
  )

  it('closes if a refreshed active image is no longer in the filtered results', async () => {
    render().open(files[0])
    const props = { ...initialProps, refreshKey: 1 }
    harness.adjacentImagePage.mockResolvedValueOnce(null)
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
    harness.adjacentImagePage.mockResolvedValueOnce({
      files: [third, file('fourth')],
      pagination: { ...pagination, page: 2, offset: 2 },
    })
    render().open(files[1])
    await render().move(1)
    const before = render().gallery
    const refreshed = render({
      ...initialProps,
      files: [file('new-upload'), file('first')],
      pagination: { ...pagination, total: 7, pageCount: 4 },
    })

    expect(refreshed.gallery).toBe(before)
    expect(refreshed.gallery?.pagination.page).toBe(2)
    expect(refreshed.gallery?.files[refreshed.gallery.index]).toBe(third)
  })

  it('lets explicit image navigation complete through a background grid refresh', async () => {
    const next = pendingPage()
    render().open(files[1])
    const navigation = render().move(1)
    const signal = harness.adjacentImagePage.mock.calls[0][0]
      .signal as AbortSignal
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
    harness.adjacentImagePage.mockResolvedValueOnce({
      files: [file('inserted-between')],
      pagination: { ...pagination, page: 2, offset: 3 },
    })
    await render(refreshedProps).move(1)
    expect(harness.adjacentImagePage.mock.calls[1][0].anchorId).toBe('third')
    expect(render(refreshedProps).gallery?.files[0].id).toBe('inserted-between')
    expect(render(refreshedProps).navigationStale).toBe(false)
  })

  it('closes and aborts navigation when the selected filters change', async () => {
    const next = pendingPage()
    render().open(files[1])
    const navigation = render().move(1)
    const signal = harness.adjacentImagePage.mock.calls[0][0]
      .signal as AbortSignal
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
    expect(render().gallery?.files[1].id).toBe('second')
    replacement.resolve({
      files: [file('current')],
      pagination: { ...pagination, page: 2, offset: 2 },
    })
    await replacementNavigation
    expect(render().gallery?.files[0].id).toBe('current')
    expect(render().navigationPending).toBe(false)
  })
})
