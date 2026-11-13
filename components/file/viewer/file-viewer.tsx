'use client'

import { useEffect, useRef, useState } from 'react'

import { FileViewerContent } from './file-viewer-content'
import type { FileViewerFile } from './types'

interface FileViewerProps {
  file: FileViewerFile
  /** Sent with every request for the file's content. */
  password?: string
}

/** Smaller changes than this, in pixels, aren't worth easing. */
const SETTLE_THRESHOLD = 8

/**
 * Eases the preview to its new height when its content changes size: a
 * loading state giving way to a picture of another shape, or an archive's
 * file list arriving. The panel is centred on the page, so without this the
 * whole card would jump. Resizing the window changes the height at once.
 */
function useSettledHeight() {
  const frame = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const element = frame.current
    if (!element || typeof ResizeObserver === 'undefined') return
    let height = element.getBoundingClientRect().height
    let width = window.innerWidth
    const observer = new ResizeObserver(() => {
      const next = element.getBoundingClientRect().height
      const resized = window.innerWidth !== width
      const previous = height
      height = next
      width = window.innerWidth
      if (
        resized ||
        Math.abs(next - previous) < SETTLE_THRESHOLD ||
        typeof element.animate !== 'function' ||
        // Its own animation is what changed the height.
        element.getAnimations().length > 0 ||
        window.matchMedia('(prefers-reduced-motion: reduce)').matches
      )
        return
      element.animate(
        [
          { height: `${previous}px`, overflow: 'hidden' },
          { height: `${next}px`, overflow: 'hidden' },
        ],
        { duration: 220, easing: 'cubic-bezier(0.2, 0, 0, 1)' }
      )
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  return frame
}

export function FileViewer({ file, password }: FileViewerProps) {
  // PDFs and audio load once hydrated: whether a PDF shows inline depends on
  // the browser, and the audio player must be listening before its file
  // starts to load. An image doesn't wait; its viewer reads how it ended.
  const [hydrated, setHydrated] = useState(false)
  useEffect(() => setHydrated(true), [])
  const frame = useSettledHeight()

  return (
    <div ref={frame} className="flex min-w-0 items-center justify-center">
      <FileViewerContent file={file} password={password} hydrated={hydrated} />
    </div>
  )
}
