import { FileDown } from 'lucide-react'

import { PreviewPlaceholder } from './preview-placeholder'

interface UnsupportedStateProps {
  mimeType: string
}

export function UnsupportedState({ mimeType }: UnsupportedStateProps) {
  return (
    <div className="w-full px-6">
      <PreviewPlaceholder
        icon={FileDown}
        title="Preview not available"
        titleAs="h2"
        description="Download this file to open it with an app on your device."
      >
        <code className="mt-1 max-w-full break-all rounded-md border border-border/60 bg-background/60 px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
          {mimeType}
        </code>
      </PreviewPlaceholder>
    </div>
  )
}
