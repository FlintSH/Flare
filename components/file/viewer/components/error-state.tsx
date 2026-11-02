import { FileWarning } from 'lucide-react'

import { PreviewPlaceholder } from './preview-placeholder'

interface ErrorStateProps {
  error: string
  fallbackMessage?: string
}

export function ErrorState({
  error,
  fallbackMessage = 'You can still try downloading the original file below.',
}: ErrorStateProps) {
  return (
    <div className="w-full px-6">
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
