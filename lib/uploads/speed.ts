import { formatBytes } from '@/lib/utils/size'

/** Long enough to smooth out bursty progress events, short enough to follow a change. */
const WINDOW_MS = 3000
/** Below this, a few early events would give a wild first figure. */
const MIN_SPAN_MS = 500

/**
 * Upload speed in bytes per second over the last few seconds of progress, or
 * null until there is enough to measure. A new attempt starts a new meter.
 */
export function createSpeedMeter(now: () => number = () => performance.now()) {
  let samples: { at: number; bytes: number }[] = []
  return (bytes: number): number | null => {
    const at = now()
    // Bytes can go down when a part is retried; measure from there.
    if (samples.length && bytes < samples[samples.length - 1].bytes)
      samples = []
    samples.push({ at, bytes })
    while (samples.length > 2 && at - samples[1].at >= WINDOW_MS)
      samples.shift()
    const first = samples[0]
    const span = at - first.at
    if (span < MIN_SPAN_MS) return null
    return ((bytes - first.bytes) * 1000) / span
  }
}

/** `12.4 MB/s`. */
export function formatSpeed(bytesPerSecond: number) {
  return `${formatBytes(Math.max(0, Math.round(bytesPerSecond)), 1)}/s`
}

/**
 * Bytes sent of the total, with the speed while the file is still being sent:
 * `4.2 MB / 120 MB · 12.4 MB/s`. Once every byte is out the server is still
 * storing the file, so a speed there would be stale.
 */
export function formatTransfer(
  uploaded: number,
  size: number,
  speed: number | null
) {
  const sent = `${formatBytes(uploaded)} / ${formatBytes(size)}`
  return speed !== null && uploaded < size
    ? `${sent} · ${formatSpeed(speed)}`
    : sent
}
