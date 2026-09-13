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
      className="flex w-full flex-col items-center justify-center gap-3 p-8 text-center"
      role="alert"
    >
      <FileWarning
        className="h-5 w-5 text-muted-foreground"
        aria-hidden="true"
      />
      <h2 className="text-base font-medium">Preview unavailable</h2>
      <p className="max-w-sm text-sm leading-relaxed text-muted-foreground">
        {error}
      </p>
      <p className="max-w-sm text-xs leading-relaxed text-muted-foreground">
        {fallbackMessage}
      </p>
    </div>
  )
}
