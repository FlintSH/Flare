import { Loader2 } from 'lucide-react'

interface LoadingStateProps {
  message?: string
}

export function LoadingState({
  message = 'Loading preview…',
}: LoadingStateProps) {
  return (
    <div
      className="flex min-h-56 w-full flex-col items-center justify-center gap-4 px-6 py-12 text-center"
      role="status"
    >
      <span className="flex h-12 w-12 items-center justify-center rounded-full border border-border bg-muted/30">
        <Loader2
          className="h-5 w-5 animate-spin text-muted-foreground"
          aria-hidden="true"
        />
      </span>
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  )
}
