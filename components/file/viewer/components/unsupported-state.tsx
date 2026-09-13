import { FileDown } from 'lucide-react'

interface UnsupportedStateProps {
  mimeType: string
}

export function UnsupportedState({ mimeType }: UnsupportedStateProps) {
  return (
    <div className="flex min-h-64 w-full flex-col items-center justify-center px-6 py-12 text-center">
      <span className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl border border-border bg-muted/30">
        <FileDown
          className="h-6 w-6 text-muted-foreground"
          aria-hidden="true"
        />
      </span>
      <h2 className="text-lg font-semibold tracking-tight">
        Ready to download
      </h2>
      <p className="mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">
        This file type doesn’t have a preview. Download it to open with an app
        on your device.
      </p>
      <p className="mt-4 max-w-full break-all rounded-md bg-muted/40 px-2 py-1 font-mono text-xs text-muted-foreground">
        {mimeType}
      </p>
    </div>
  )
}
