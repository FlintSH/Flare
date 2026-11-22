'use client'

import { NativeSelect } from '@/components/ui/native-select'

import { holdsAdminScope } from '@/lib/integrations/bearer-routes'

import {
  ADMIN_LIFETIME_REASON,
  TOKEN_LIFETIMES,
  allowedLifetime,
  lifetimeAllowed,
} from './shared'

/**
 * How long a new token lasts, for both token forms. While `scopes` holds an
 * administration scope the lifetimes the server would refuse cannot be
 * picked, and a longer one already chosen shows, and is sent, as the
 * longest allowed. Labelled by the caller's `Label` for `id`.
 */
export function TokenLifetime({
  id,
  value,
  onChange,
  scopes,
  disabled,
}: {
  id: string
  /** The lifetime chosen, as `TOKEN_LIFETIMES` lists it. */
  value: string
  onChange: (days: string) => void
  scopes: readonly string[]
  disabled?: boolean
}) {
  const admin = holdsAdminScope(scopes)
  return (
    <>
      <NativeSelect
        id={id}
        value={allowedLifetime(value, admin)}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        aria-describedby={admin ? `${id}-limit` : undefined}
      >
        {TOKEN_LIFETIMES.map(([days, label]) => (
          <option
            key={days}
            value={days}
            disabled={!lifetimeAllowed(days, admin)}
          >
            {label}
          </option>
        ))}
      </NativeSelect>
      {admin && (
        <p
          id={`${id}-limit`}
          className="text-pretty text-xs text-muted-foreground"
        >
          {ADMIN_LIFETIME_REASON}
        </p>
      )}
    </>
  )
}
