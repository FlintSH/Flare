interface ErrorStateProps {
  error: string
  fallbackMessage?: string
}

export function ErrorState({
  error,
  fallbackMessage = 'Use the download button above to view this file.',
}: ErrorStateProps) {
  return (
    <div className="w-full flex flex-col items-center justify-center p-8 text-center">
      <p className="text-muted-foreground mb-4">{error}</p>
      <p className="text-sm text-muted-foreground">{fallbackMessage}</p>
    </div>
  )
}
