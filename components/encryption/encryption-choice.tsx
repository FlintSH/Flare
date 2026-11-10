'use client'

import { useId, useState } from 'react'

import { LockKeyhole, ShieldCheck, ShieldOff } from 'lucide-react'

import { UnlockDialog } from '@/components/encryption/unlock-dialog'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'

import { cn } from '@/lib/utils'

export type EncryptionMode = 'encrypted' | 'plain'

const OPTIONS = [
  { value: 'encrypted', label: 'Encrypted', icon: ShieldCheck },
  {
    value: 'plain',
    label: 'Plain',
    hint: '(can show a link preview)',
    icon: ShieldOff,
  },
] as const

/**
 * The one choice of an upload: encrypted, which is the default, or plain
 * (docs/e2ee-spec.md, sections 11.2 and 11.4). The line below says what the
 * choice costs, in both directions.
 */
export function EncryptionChoice({
  value,
  onChange,
  disabled,
  locked,
  noun = 'file',
}: {
  value: EncryptionMode
  onChange: (value: EncryptionMode) => void
  disabled?: boolean
  /** The keys of this browser are locked, so it cannot encrypt yet. */
  locked?: boolean
  noun?: 'file' | 'paste'
}) {
  const id = useId()
  const [unlocking, setUnlocking] = useState(false)
  return (
    <div className="space-y-2" data-encryption-choice={value}>
      <p id={`${id}-label`} className="text-sm font-medium leading-none">
        Encryption
      </p>
      <RadioGroup
        value={value}
        onValueChange={(next) => onChange(next as EncryptionMode)}
        disabled={disabled}
        aria-labelledby={`${id}-label`}
        aria-describedby={`${id}-help`}
        className="grid grid-cols-1 gap-2 sm:grid-cols-2"
      >
        {OPTIONS.map(({ value: option, label, icon: Icon, ...rest }) => (
          <label
            key={option}
            htmlFor={`${id}-${option}`}
            className={cn(
              'flex min-h-10 cursor-pointer items-center gap-2 rounded-lg border border-control px-3 py-2 text-sm transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring',
              value === option && 'border-primary bg-primary/5',
              disabled && 'cursor-not-allowed opacity-60'
            )}
          >
            <RadioGroupItem
              value={option}
              id={`${id}-${option}`}
              className="shrink-0"
            />
            <Icon
              className="h-4 w-4 shrink-0 text-muted-foreground"
              aria-hidden="true"
            />
            <span className="min-w-0 leading-tight">
              <span className="font-medium">{label}</span>
              {'hint' in rest && (
                <span className="text-muted-foreground"> {rest.hint}</span>
              )}
            </span>
          </label>
        ))}
      </RadioGroup>
      <p
        id={`${id}-help`}
        className="text-pretty text-xs leading-relaxed text-muted-foreground"
      >
        {value === 'encrypted'
          ? `Encrypted in this browser before upload. The server cannot read the ${noun} or its name, and its link shows only a generic preview on other sites.`
          : `Stored as it is. The server and its administrators can read the ${noun}, and its link can show the content in a preview on other sites.`}
      </p>
      {locked && value === 'encrypted' && (
        <div
          role="status"
          className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-border/60 bg-muted/40 px-3 py-2 text-xs"
        >
          <LockKeyhole
            className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
            aria-hidden="true"
          />
          <p className="min-w-0 flex-1 basis-48 leading-relaxed">
            Your encryption keys are locked in this browser. Unlock them to
            upload encrypted {noun}s.
          </p>
          <button
            type="button"
            className="rounded-sm font-medium underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => setUnlocking(true)}
          >
            Unlock
          </button>
          <UnlockDialog open={unlocking} onOpenChange={setUnlocking} />
        </div>
      )}
    </div>
  )
}
