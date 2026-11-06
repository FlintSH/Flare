import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useDataExport } from '@/hooks/use-data-export'

// Keeps hook state across explicit renders without a browser renderer.
const harness = vi.hoisted(() => ({
  slots: [] as unknown[],
  cursor: 0,
  fetch: vi.fn(),
  toast: vi.fn(),
}))

vi.mock('react', () => ({
  useState: (initial: unknown) => {
    const index = harness.cursor++
    if (!(index in harness.slots)) harness.slots[index] = initial
    return [
      harness.slots[index],
      (next: unknown) => {
        harness.slots[index] =
          typeof next === 'function' ? next(harness.slots[index]) : next
      },
    ]
  },
}))
vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: harness.toast }),
}))

class FakeEventSource {
  static opened: FakeEventSource[] = []
  onmessage: ((event: { data: string }) => void) | null = null
  onerror: (() => void) | null = null
  closed = false

  constructor(readonly url: string) {
    FakeEventSource.opened.push(this)
  }

  close() {
    this.closed = true
  }

  send(progress: number) {
    if (!this.closed) this.onmessage?.({ data: JSON.stringify({ progress }) })
  }
}

const link = { href: '', download: '', click: vi.fn() }

function render() {
  harness.cursor = 0
  // eslint-disable-next-line react-hooks/rules-of-hooks
  return useDataExport()
}

/** A streamed ZIP response whose body the test finishes. */
function zipResponse() {
  let body!: ReadableStreamDefaultController<Uint8Array>
  const response = new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        body = controller
      },
    }),
    {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition':
          'attachment; filename="flare-data-export-1767225600000.zip"',
      },
    }
  )
  return { response, body }
}

const url = (value: string) => new URL(value, 'https://flare.test')

beforeEach(() => {
  vi.clearAllMocks()
  harness.slots = []
  FakeEventSource.opened = []
  link.href = ''
  link.download = ''
  vi.stubGlobal('fetch', harness.fetch)
  vi.stubGlobal('EventSource', FakeEventSource)
  vi.stubGlobal('document', {
    createElement: () => link,
    body: { appendChild: vi.fn(), removeChild: vi.fn() },
  })
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:flare-export')
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('account data export in the browser', () => {
  it('names one export on both requests and follows it once the download starts', async () => {
    const { response, body } = zipResponse()
    harness.fetch.mockResolvedValue(response)

    const running = render().handleExport()
    expect(render()).toMatchObject({ isExporting: true, progress: 0 })
    await vi.waitFor(() => expect(FakeEventSource.opened).toHaveLength(1))

    const download = url(harness.fetch.mock.calls[0][0])
    const progress = url(FakeEventSource.opened[0].url)
    expect(download.pathname).toBe('/api/profile/export')
    expect(progress.pathname).toBe('/api/profile/export/progress')
    expect(download.searchParams.get('id')).toMatch(/^[0-9a-f]{32}$/)
    expect(progress.searchParams.get('id')).toBe(
      download.searchParams.get('id')
    )

    body.enqueue(new Uint8Array([80, 75, 5, 6]))
    body.close()
    await running
    await vi.waitFor(() => expect(URL.revokeObjectURL).toHaveBeenCalled())
  })

  it('shows the server percentage as the only progress while the ZIP arrives', async () => {
    const { response, body } = zipResponse()
    harness.fetch.mockResolvedValue(response)

    const running = render().handleExport()
    await vi.waitFor(() => expect(FakeEventSource.opened).toHaveLength(1))
    const events = FakeEventSource.opened[0]

    events.send(40)
    // Bytes without a Content-Length never move the progress on their own.
    body.enqueue(new Uint8Array(64 * 1024))
    body.enqueue(new Uint8Array(64 * 1024))
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(render()).toMatchObject({ isExporting: true, progress: 40 })

    events.send(100)
    expect(render()).toMatchObject({ isExporting: true, progress: 100 })

    body.close()
    await running

    expect(link.download).toBe('flare-data-export-1767225600000.zip')
    expect(link.click).toHaveBeenCalledOnce()
    expect(harness.toast).toHaveBeenCalledWith({
      title: 'Success',
      description: 'Your data has been exported successfully',
      variant: 'default',
    })
    expect(events.closed).toBe(true)
    expect(render()).toMatchObject({ isExporting: false, progress: 0 })
    await vi.waitFor(() =>
      expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:flare-export')
    )
  })

  it('stops following progress when its stream ends, and keeps downloading', async () => {
    const { response, body } = zipResponse()
    harness.fetch.mockResolvedValue(response)

    const running = render().handleExport()
    await vi.waitFor(() => expect(FakeEventSource.opened).toHaveLength(1))
    const events = FakeEventSource.opened[0]

    events.send(50)
    events.onerror?.()
    expect(events.closed).toBe(true)
    expect(render()).toMatchObject({ isExporting: true, progress: 50 })

    body.enqueue(new Uint8Array([80, 75, 5, 6]))
    body.close()
    await running

    expect(FakeEventSource.opened).toHaveLength(1)
    expect(harness.toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Success' })
    )
    await vi.waitFor(() => expect(URL.revokeObjectURL).toHaveBeenCalled())
  })

  it('reports a download that brings no data', async () => {
    const { response, body } = zipResponse()
    harness.fetch.mockResolvedValue(response)

    const running = render().handleExport()
    await vi.waitFor(() => expect(FakeEventSource.opened).toHaveLength(1))
    body.close()
    await running

    expect(harness.toast).toHaveBeenCalledWith({
      title: 'Error',
      description: 'No data received from server',
      variant: 'destructive',
    })
    expect(FakeEventSource.opened[0].closed).toBe(true)
    expect(URL.createObjectURL).not.toHaveBeenCalled()
    expect(render()).toMatchObject({ isExporting: false, progress: 0 })
  })

  it('reports a refused export with the server’s reason, without following its progress', async () => {
    harness.fetch.mockResolvedValue(
      Response.json({ error: 'Permission denied' }, { status: 403 })
    )

    await render().handleExport()

    expect(FakeEventSource.opened).toHaveLength(0)
    // Earlier builds said "Export failed with status: 403".
    expect(harness.toast).toHaveBeenCalledWith({
      title: 'Error',
      description: 'Permission denied',
      variant: 'destructive',
    })
    expect(render()).toMatchObject({ isExporting: false, progress: 0 })
  })

  it('says the export failed when the refusal gives no reason', async () => {
    harness.fetch.mockResolvedValue(
      new Response('<html>Bad gateway</html>', { status: 502 })
    )

    await render().handleExport()

    expect(harness.toast).toHaveBeenCalledWith({
      title: 'Error',
      description: 'Failed to export data',
      variant: 'destructive',
    })
  })
})
