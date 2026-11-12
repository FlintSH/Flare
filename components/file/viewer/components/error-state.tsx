import { FileWarning } from 'lucide-react'

import { PreviewPlaceholder } from './preview-placeholder'

interface ErrorStateProps {
  error: string
  fallbackMessage?: string
}

export function ErrorState({
  error,
  fallbackMessage = 'You can still download the original file.',
}: ErrorStateProps) {
  return (
    <div className="w-full p-4 sm:p-5">
      <PreviewPlaceholder
        role="alert"
        icon={FileWarning}
        title="Preview unavailable"
        titleAs="h2"
        description={error}
      >
        <p className="max-w-xs text-pretty text-xs leading-relaxed text-muted-foreground">
          {fallbackMessage}
        </p>
      </PreviewPlaceholder>
    </div>
  )
}
