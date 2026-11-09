import { useLayoutEffect, useRef } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

import { urlSafeFilename } from '@/lib/files/filename'
import {
  NAME_PLACEHOLDERS,
  NAME_TEMPLATE_MAX_LENGTH,
  nameTemplateProblem,
  sampleNameSources,
} from '@/lib/files/name-template'
import { cn } from '@/lib/utils'

/** The pattern a profile starts from when its naming changes to a pattern. */
export const STARTING_NAME_PATTERN = '{date}-{random}'

const EXAMPLE_UPLOAD = 'Team Photo.PNG'

export function NamePatternField({
  value,
  onChange,
}: {
  value: string
  onChange: (value: string) => void
}) {
  const input = useRef<HTMLInputElement>(null)
  // Where the caret belongs once an inserted placeholder is in the field.
  const caret = useRef<number | null>(null)
  const problem = nameTemplateProblem(value)

  useLayoutEffect(() => {
    if (caret.current === null) return
    input.current?.setSelectionRange(caret.current, caret.current)
    caret.current = null
  }, [value])

  function insert(placeholder: string) {
    const field = input.current
    const start = field?.selectionStart ?? value.length
    const end = field?.selectionEnd ?? value.length
    const next = value.slice(0, start) + placeholder + value.slice(end)
    if (next.length > NAME_TEMPLATE_MAX_LENGTH) return
    caret.current = start + placeholder.length
    onChange(next)
    field?.focus()
  }

  return (
    <div className="min-w-0 space-y-2 sm:col-span-2">
      <Label htmlFor="profile-name-pattern">Name pattern</Label>
      <Input
        id="profile-name-pattern"
        ref={input}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        maxLength={NAME_TEMPLATE_MAX_LENGTH}
        spellCheck={false}
        autoComplete="off"
        autoCapitalize="none"
        className="font-mono"
        aria-invalid={!!problem}
        aria-describedby="profile-name-pattern-result profile-name-pattern-help"
      />
      <p
        id="profile-name-pattern-result"
        aria-live="polite"
        className={cn(
          'text-xs',
          problem ? 'text-destructive' : 'text-muted-foreground'
        )}
      >
        {problem ?? (
          <>
            {EXAMPLE_UPLOAD} would upload as{' '}
            <span className="break-all font-mono text-foreground">
              {urlSafeFilename(
                EXAMPLE_UPLOAD,
                { template: value },
                sampleNameSources
              )}
            </span>
          </>
        )}
      </p>
      <div
        role="group"
        aria-label="Insert a placeholder"
        className="flex flex-wrap gap-1.5"
      >
        {NAME_PLACEHOLDERS.map((placeholder) => (
          <Button
            key={placeholder}
            type="button"
            variant="outline"
            size="sm"
            className="h-7 px-2 font-mono"
            onClick={() => insert(placeholder)}
          >
            {placeholder}
          </Button>
        ))}
      </div>
      <p
        id="profile-name-pattern-help"
        className="text-pretty text-xs text-muted-foreground"
      >
        Use letters, digits, hyphens and underscores around the placeholders.
        Dates and times are UTC, and the file’s extension is added for you. Try{' '}
        <span className="font-mono">{'{random:10}'}</span> or{' '}
        <span className="font-mono">{'{words:2}'}</span> to change a length.
      </p>
    </div>
  )
}
