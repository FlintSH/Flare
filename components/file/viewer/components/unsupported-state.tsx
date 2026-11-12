/**
 * A file with no preview. Its card already shows its name, type and the
 * Download button, so this only says what to do with it.
 */
export function UnsupportedState({
  children = 'This file type can’t be previewed here. Download it to open it with an app on your device.',
}: {
  children?: React.ReactNode
}) {
  return (
    <p className="mx-auto max-w-xs text-pretty text-sm leading-relaxed text-muted-foreground">
      {children}
    </p>
  )
}
