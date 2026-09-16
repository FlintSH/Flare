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
}
const initialProps: HookProps = { filters, files, pagination }

function render(props: HookProps = initialProps) {
  let result!: ReturnType<typeof useImageGallery>
  do {
    harness.dirty = false
    harness.cursor = 0
    harness.effects = []
    // Each iteration models one explicit render; React is mocked above.
    // eslint-disable-next-line react-hooks/rules-of-hooks
    result = useImageGallery(props.filters, props.files, props.pagination)
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
  })

  it('does not replace a later gallery page with a refreshed first grid page', async () => {
    const third = file('third')
    harness.adjacentImagePage.mockResolvedValueOnce({
      files: [third, file('fourth')],
      pagination: { ...pagination, page: 2 },
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
    }
    const refreshed = render(refreshedProps)

    expect(signal.aborted).toBe(false)
    expect(refreshed.navigationPending).toBe(true)
    expect(refreshed.gallery?.files[refreshed.gallery.index]).toBe(files[1])
    next.resolve({
      files: [file('third')],
      pagination: { ...pagination, page: 2 },
    })
    await navigation
    expect(render(refreshedProps).gallery?.files[0].id).toBe('third')
    expect(render(refreshedProps).navigationPending).toBe(false)
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
      pagination: { ...pagination, page: 2 },
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
      pagination: { ...pagination, page: 2 },
    })
    await oldNavigation
    expect(render().navigationPending).toBe(true)
    expect(render().gallery?.files[1].id).toBe('second')
    replacement.resolve({
      files: [file('current')],
      pagination: { ...pagination, page: 2 },
    })
    await replacementNavigation
    expect(render().gallery?.files[0].id).toBe('current')
    expect(render().navigationPending).toBe(false)
  })
})
