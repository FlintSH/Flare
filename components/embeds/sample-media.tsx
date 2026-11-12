import type { CSSProperties } from 'react'

import { Play } from 'lucide-react'

import { cn } from '@/lib/utils'

/**
 * The picture the appearance and embed previews stand in for an upload with.
 * Drawn here, so a preview never loads anything from another server. Its
 * shapes are sized for a frame about 10rem tall.
 */
export function SamplePicture({
  className,
  style,
}: {
  className?: string
  style?: CSSProperties
}) {
  return (
    <div
      role="img"
      aria-label="Sample picture"
      className={cn(
        'relative overflow-hidden rounded-lg bg-gradient-to-br from-sky-200 via-indigo-300 to-violet-400',
        className
      )}
      style={style}
    >
      <div className="absolute rounded-full bg-amber-100 w-14 h-14 top-6 right-9 opacity-90" />
      <div className="absolute -bottom-24 -left-8 w-80 h-52 rounded-[45%] rotate-12 bg-indigo-900/65" />
      <div className="absolute -bottom-28 -right-16 w-80 h-56 rounded-[45%] -rotate-12 bg-violet-950/75" />
      <div className="absolute left-5 bottom-4 text-white text-xs font-medium">
        A space for your perspective.
      </div>
    </div>
  )
}

/** The same scene after dark, waiting to be played. */
export function SampleVideo({ className }: { className?: string }) {
  return (
    <div
      role="img"
      aria-label="Sample video"
      className={cn(
        'relative overflow-hidden rounded-lg bg-gradient-to-br from-indigo-500 via-indigo-800 to-violet-950',
        className
      )}
    >
      <div className="absolute -bottom-24 -left-8 h-52 w-80 rotate-12 rounded-[45%] bg-indigo-950/70" />
      <div className="absolute -bottom-28 -right-16 h-56 w-80 -rotate-12 rounded-[45%] bg-slate-950/70" />
      <span className="absolute inset-0 m-auto flex h-11 w-11 items-center justify-center rounded-full bg-black/60 text-white">
        <Play
          className="h-5 w-5 translate-x-px fill-current"
          aria-hidden="true"
        />
      </span>
    </div>
  )
}
