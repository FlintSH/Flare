import { Play } from 'lucide-react'

import { cn } from '@/lib/utils'

/**
 * Marks a thumbnail as a frame from a video, with the play button Flare's
 * player starts with. It sits centered over the picture, which must be
 * positioned, and is hidden from assistive technology: the file's name and
 * type already say what it is.
 */
export function VideoBadge({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'pointer-events-none absolute inset-0 m-auto flex h-11 w-11 items-center justify-center rounded-full bg-black/55 text-white shadow-sm ring-1 ring-white/15 backdrop-blur-sm',
        className
      )}
    >
      <Play className="ml-0.5 h-5 w-5 fill-current" />
    </span>
  )
}
