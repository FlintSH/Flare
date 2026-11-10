'use client'

import { type ReactNode, useState } from 'react'

import { Check, Copy, Terminal } from 'lucide-react'

import { Button } from '@/components/ui/button'

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
    <div
      className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"
      data-tool={title}
    >
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

/** A value to paste into a tool's settings, with a button that copies it. */
export function CopyableValue({
  label,
  value,
}: {
  label: string
  value: string
}) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <div className="flex items-stretch gap-2">
        {/* One line that scrolls: a wrapped argument reads as two. */}
        <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap rounded-md border bg-muted/50 px-2 py-1.5 font-mono text-xs leading-relaxed">
          {value}
        </code>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-auto shrink-0"
          aria-label={`Copy ${label.toLowerCase()}`}
          onClick={() => {
            void navigator.clipboard
              .writeText(value)
              .then(() => setCopied(true))
              .catch(() => setCopied(false))
          }}
        >
          {copied ? <Check /> : <Copy />}
        </Button>
      </div>
    </div>
  )
}
