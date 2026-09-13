import { FileDown } from 'lucide-react'

interface UnsupportedStateProps {
  mimeType: string
}

export function UnsupportedState({ mimeType }: UnsupportedStateProps) {
  return (
    <div className="flex w-full flex-col items-center justify-center gap-3 p-8 text-center">
      <FileDown className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
      <h2 className="text-base font-medium">Preview not available</h2>
      <p className="max-w-sm text-sm leading-relaxed text-muted-foreground">
        Download this file to open it with an app on your device.
      </p>
      <p className="max-w-full break-all text-xs text-muted-foreground">
        {mimeType}
      </p>
    </div>
  )
}
