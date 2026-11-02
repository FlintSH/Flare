import { Maximize2 } from 'lucide-react'

import { cn } from '@/lib/utils'

/**
 * Opens the full-screen viewer. Place it inside a relative box that wraps
 * just the image, so it sits on the picture's own corner. The disc is dark
 * with a light edge in both themes, so it reads on light and dark artwork.
 */
export function ExpandImageButton({
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      title="Expand image"
      aria-label="Expand image"
      className={cn(
        'absolute bottom-2 right-2 inline-flex h-8 w-8 items-center justify-center rounded-full border shadow-md transition-colors sm:bottom-3 sm:right-3 sm:h-9 sm:w-9',
        'border-background/30 bg-foreground/90 text-background hover:bg-foreground dark:border-foreground/25 dark:bg-background/90 dark:text-foreground dark:hover:bg-background',
        // A 44 px touch target around the smaller disc.
        'after:absolute after:-inset-1.5 after:content-[""]',
        // Over a photo the usual ring can match the pixels behind it, so it
        // sits between two page-coloured bands and reads on any image.
        'focus-visible:outline-none focus-visible:shadow-[0_0_0_2px_hsl(var(--background)),0_0_0_4px_hsl(var(--ring)),0_0_0_6px_hsl(var(--background))]',
        className
      )}
      {...props}
    >
      <Maximize2 className="h-4 w-4" aria-hidden="true" />
    </button>
  )
}
