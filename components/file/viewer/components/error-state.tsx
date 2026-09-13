import { FileWarning } from 'lucide-react'

interface ErrorStateProps {
  error: string
  fallbackMessage?: string
}

export function ErrorState({
  error,
  fallbackMessage = 'You can still try downloading the original file below.',
}: ErrorStateProps) {
  return (
    <div
      className="flex min-h-56 w-full flex-col items-center justify-center px-6 py-12 text-center"
      role="alert"
    >
      <span className="mb-5 flex h-12 w-12 items-center justify-center rounded-full border border-border bg-muted/30">
        <FileWarning
          className="h-5 w-5 text-muted-foreground"
          aria-hidden="true"
        />
      </span>
      <h2 className="text-lg font-semibold tracking-tight">
        Preview unavailable
      </h2>
      <p className="mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">
        {error}
      </p>
      <p className="mt-3 max-w-sm text-xs leading-relaxed text-muted-foreground">
        {fallbackMessage}
      </p>
    </div>
  )
}
