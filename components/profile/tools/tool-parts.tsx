import type { ReactNode } from 'react'

import { Terminal } from 'lucide-react'

export interface UploaderToolProps {
  /** Select this upload profile instead of following account defaults. */
  profileId?: string
  profileName?: string
  /** Only a small button named after the tool, for a row of tools. */
  compact?: boolean
  disabled?: boolean
}

/** A tool in the Screenshot tools card: what it is, and its action. */
export function ToolRow({
  title,
  description,
  action,
}: {
  title: string
  description: ReactNode
  action: ReactNode
}) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 space-y-1">
        <h3 className="text-sm font-medium">{title}</h3>
        <p className="text-pretty text-sm text-muted-foreground">
          {description}
        </p>
      </div>
      {action}
    </div>
  )
}

/** The commands the generated script checks for. */
export function DependencyNotice({ commands }: { commands: string[] }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-info/30 bg-info/5 p-3">
      <Terminal
        className="mt-0.5 h-4 w-4 flex-shrink-0 text-info"
        aria-hidden="true"
      />
      <div className="space-y-1">
        <div className="text-sm text-muted-foreground">
          Make sure you have these installed:
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {commands.map((command) => (
              <span
                key={command}
                className="inline-flex items-center rounded-md bg-muted px-2 py-0.5 font-mono text-xs text-foreground"
              >
                {command}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
