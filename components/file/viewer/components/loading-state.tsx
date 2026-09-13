import { Loader2 } from 'lucide-react'

interface LoadingStateProps {
  message?: string
}

export function LoadingState({
  message = 'Loading preview…',
}: LoadingStateProps) {
  return (
    <div
      className="flex w-full items-center justify-center gap-3 p-8 text-center"
      role="status"
    >
      <Loader2
        className="h-4 w-4 shrink-0 animate-spin text-muted-foreground"
        aria-hidden="true"
      />
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  )
}
