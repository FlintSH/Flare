'use client'

import { type ChangeEvent, type ReactNode, useId, useState } from 'react'

import { Check } from 'lucide-react'

import { colorSwatchClassName } from '@/components/shared/form-styles'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

import {
  EMBED_LIMITS,
  EMBED_MODES,
  type EmbedCardTemplates,
  type EmbedMode,
} from '@/lib/embeds/schema'
import {
  EMBED_PLACEHOLDERS,
  EMBED_PLACEHOLDER_MESSAGE,
  isEmbedTemplate,
} from '@/lib/embeds/template'
import { cn } from '@/lib/utils'

export interface EmbedModeOption<T extends string> {
  value: T
  title: string
  description: string
  /** A small drawing of the choice, for the tile beside its name. */
  glyph: ReactNode
}

/** How each mode is named and explained wherever it is offered. */
export const EMBED_MODE_CHOICES: Record<
  EmbedMode,
  Omit<EmbedModeOption<EmbedMode>, 'value'>
> = {
  direct: {
    title: 'Direct media',
    description:
      'Images and videos appear on their own. Other files show the card.',
    glyph: <span className="h-6 w-7 rounded-sm bg-primary/20" />,
  },
  rich: {
    title: 'Rich embed',
    description: 'Every link shows the card, with the image or video inside.',
    glyph: (
      <span className="flex h-6 w-7 flex-col justify-between rounded-sm border-l-[3px] border-primary/40 bg-primary/10 p-1">
        <span className="h-0.5 w-3 rounded-full bg-primary/40" />
        <span className="h-2 rounded-[2px] bg-primary/25" />
      </span>
    ),
  },
}

export const EMBED_MODE_OPTIONS: readonly EmbedModeOption<EmbedMode>[] =
  EMBED_MODES.map((value) => ({ value, ...EMBED_MODE_CHOICES[value] }))

/** One choice of several, drawn like the studio's share style options. */
export function EmbedModePicker<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  /** Names the group for assistive technology. */
  label: string
  options: readonly EmbedModeOption<T>[]
  value: T
  onChange: (value: T) => void
}) {
  return (
    <div role="group" aria-label={label} className="space-y-3">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          className={cn(
            'w-full flex gap-4 items-center text-left rounded-xl border p-4 transition-colors',
            value === option.value
              ? 'border-primary bg-primary/5'
              : 'hover:border-primary/50'
          )}
          onClick={() => onChange(option.value)}
        >
          <span
            aria-hidden="true"
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border bg-muted/30"
          >
            {option.glyph}
          </span>
          <span className="min-w-0 flex-1">
            <span className="font-medium text-sm block">{option.title}</span>
            <span className="text-xs text-muted-foreground mt-1 block">
              {option.description}
            </span>
          </span>
          {value === option.value && (
            <Check className="h-4 w-4 shrink-0" aria-hidden="true" />
          )}
        </button>
      ))}
    </div>
  )
}

const LINES = {
  siteName: { label: 'Site name', empty: 'Left off the card' },
  author: { label: 'Author', empty: 'Left off the card' },
  // renderEmbedCard names the file when the title has nothing to show.
  title: { label: 'Title', empty: 'The file name' },
  description: { label: 'Description', empty: 'Left off the card' },
} as const satisfies Record<
  keyof typeof EMBED_LIMITS,
  { label: string; empty: string }
>
type Line = keyof typeof LINES
const LINE_KEYS = Object.keys(LINES) as Line[]

const errorClassName = 'text-[0.8rem] font-medium text-destructive'

const HEX_COLOR = /^#?[0-9a-fA-F]{6}$/
// What the swatch holds while no color is set; a color input can't be empty.
const UNSET_SWATCH = '#64748b'

function AccentColorField({
  value,
  onChange,
}: {
  value: string
  onChange: (color: string) => void
}) {
  const id = useId()
  // Text that is not a color yet. It is kept with the color it was typed
  // over, so it lapses if that changes some other way, such as a discard.
  const [typing, setTyping] = useState<{
    text: string
    over: string
    left: boolean
  } | null>(null)
  const draft = typing?.over === value ? typing : null
  const invalid = !!draft?.left

  const apply = (color: string) => {
    setTyping(null)
    onChange(color)
  }

  return (
    <div className="space-y-2">
      <Label htmlFor={id}>Accent color</Label>
      <div className="flex items-center gap-2">
        <Input
          type="color"
          aria-label="Pick an accent color"
          value={value || UNSET_SWATCH}
          onChange={(event) => apply(event.target.value)}
          className={cn(
            'h-9 w-12 shrink-0 cursor-pointer p-1.5',
            colorSwatchClassName
          )}
        />
        <Input
          id={id}
          value={draft?.text ?? value}
          maxLength={7}
          placeholder="None"
          autoComplete="off"
          spellCheck={false}
          aria-invalid={invalid || undefined}
          aria-describedby={invalid ? `${id}-error` : undefined}
          className="w-28 font-mono"
          onChange={(event) => {
            const text = event.target.value.trim()
            if (!text) apply('')
            else if (HEX_COLOR.test(text))
              apply(`#${text.replace('#', '').toLowerCase()}`)
            else
              setTyping({
                text: event.target.value,
                over: value,
                left: draft?.left ?? false,
              })
          }}
          onBlur={() => draft && setTyping({ ...draft, left: true })}
        />
        {(value || draft) && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label="Clear accent color"
            onClick={() => apply('')}
          >
            Clear
          </Button>
        )}
      </div>
      {invalid && (
        <p id={`${id}-error`} className={errorClassName}>
          Use a six-digit hex color, such as #3b82f6.
        </p>
      )}
    </div>
  )
}

/**
 * The card's lines and accent. Each line is a template, and the chips add a
 * placeholder to the line being written.
 */
export function EmbedCardFields({
  value,
  onChange,
}: {
  value: EmbedCardTemplates
  onChange: (key: keyof EmbedCardTemplates, value: string) => void
}) {
  const id = useId()
  // The line that last had focus, which the chips write to. None yet means
  // the title, and no caret to honor.
  const [focused, setFocused] = useState<Line | null>(null)
  const target = focused ?? 'title'

  function insert(placeholder: string) {
    const field = document.getElementById(`${id}-${target}`)
    if (!(
      field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement
    ))
      return
    const token = `{{${placeholder}}}`
    const { length } = field.value
    const start = focused ? (field.selectionStart ?? length) : length
    const end = focused ? (field.selectionEnd ?? start) : length
    if (length - (end - start) + token.length > EMBED_LIMITS[target]) return
    field.focus()
    // Written into the field itself, so the caret lands after the
    // placeholder. The input event hands the new text to the field's own
    // change handler, as if it had been typed.
    field.setRangeText(token, start, end, 'end')
    field.dispatchEvent(new Event('input', { bubbles: true }))
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        {LINE_KEYS.map((line) => {
          const fieldId = `${id}-${line}`
          const invalid = !isEmbedTemplate(value[line])
          const field = {
            id: fieldId,
            value: value[line],
            maxLength: EMBED_LIMITS[line],
            placeholder: LINES[line].empty,
            autoComplete: 'off',
            'aria-invalid': invalid || undefined,
            'aria-describedby': invalid ? `${fieldId}-error` : undefined,
            onFocus: () => setFocused(line),
            onChange: (
              event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
            ) => onChange(line, event.target.value),
          }
          const wide = line === 'title' || line === 'description'
          return (
            <div
              key={line}
              className={cn('space-y-2', wide && 'sm:col-span-2')}
            >
              <Label htmlFor={fieldId}>{LINES[line].label}</Label>
              {line === 'description' ? (
                <Textarea
                  {...field}
                  rows={3}
                  // The text size of the inputs beside it, phones included.
                  className={cn(
                    'resize-y text-base md:text-sm',
                    invalid && 'border-danger focus-visible:ring-danger'
                  )}
                />
              ) : (
                <Input {...field} />
              )}
              {invalid && (
                <p id={`${fieldId}-error`} className={errorClassName}>
                  {EMBED_PLACEHOLDER_MESSAGE}.
                </p>
              )}
            </div>
          )
        })}
      </div>
      <div className="space-y-2">
        <p id={`${id}-chips`} className="text-xs text-muted-foreground">
          Add to {LINES[target].label.toLowerCase()}
        </p>
        <div
          role="group"
          aria-labelledby={`${id}-chips`}
          className="flex flex-wrap gap-1.5"
        >
          {EMBED_PLACEHOLDERS.map(({ key, label }) => (
            <Button
              key={key}
              type="button"
              variant="outline"
              size="sm"
              title={label}
              className="h-7 px-2 font-mono text-[11px]"
              // The line being written keeps focus, and with it its caret
              // and the phone's keyboard.
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => insert(key)}
            >
              {`{{${key}}}`}
            </Button>
          ))}
        </div>
        <p className="text-pretty text-xs leading-relaxed text-muted-foreground">
          Leave a line empty to leave it off the card. Details this instance
          hides from share pages stay hidden here too.
        </p>
      </div>
      <AccentColorField
        value={value.color}
        onChange={(color) => onChange('color', color)}
      />
    </div>
  )
}
