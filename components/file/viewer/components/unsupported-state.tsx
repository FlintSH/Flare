interface UnsupportedStateProps {
  mimeType: string
}

export function UnsupportedState({ mimeType }: UnsupportedStateProps) {
  return (
    <div className="w-full flex flex-col items-center justify-center p-8 text-center">
      <p className="text-muted-foreground mb-2">
        Preview not available for this file type
      </p>
      <p className="text-sm text-muted-foreground">({mimeType})</p>
    </div>
  )
}
