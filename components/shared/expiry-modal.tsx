'use client'

import { useEffect, useState } from 'react'

import { ExpiryAction } from '@/types/events'
import { format } from 'date-fns'
import { CalendarIcon, Loader2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'

import { EXPIRY_EFFECTS, allows } from '@/lib/permissions/actions'
import { cn } from '@/lib/utils'

import { usePermissions } from '@/hooks/use-permissions'

type Preset = 'hour' | 'day' | 'week' | 'month'

const PRESETS: { value: Preset; label: string }[] = [
  { value: 'hour', label: '1 hour' },
  { value: 'day', label: '1 day' },
  { value: 'week', label: '1 week' },
  { value: 'month', label: '1 month' },
]

// One selected look for the dialog's choices, matching other selected cards.
const selectedOption = 'border-primary bg-primary/5'

interface ExpiryModalProps {
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: (expiresAt: Date | null, action?: ExpiryAction) => Promise<void>
  initialDate?: Date | null
  initialAction?: ExpiryAction
  title?: string
  description?: string
}

export function ExpiryModal({
  isOpen,
  onOpenChange,
  onConfirm,
  initialDate,
  initialAction = ExpiryAction.DELETE,
  title = 'Configure expiration',
  description = 'Set when this file should expire.',
}: ExpiryModalProps) {
  const { user } = usePermissions()
  const permitted = (expiry: ExpiryAction) =>
    allows(user, EXPIRY_EFFECTS[expiry])
  const [expiresAt, setDate] = useState<Date | null>(initialDate || null)
  // When the date last changed or the dialog opened. Rendering compares the
  // date with this instead of reading the clock.
  const [checkedAt, setCheckedAt] = useState(() => Date.now())
  // The quick option that produced the current date, if any. Any other edit
  // clears it, so a highlighted option always matches the date shown.
  const [preset, setPreset] = useState<Preset | null>(null)
  const [action, setAction] = useState<ExpiryAction>(initialAction)
  const [isLoading, setIsLoading] = useState(false)
  const setExpiresAt = (date: Date | null) => {
    setPreset(null)
    setDate(date)
    setCheckedAt(Date.now())
  }

  useEffect(() => {
    if (isOpen) {
      setDate(initialDate || null)
      setCheckedAt(Date.now())
      setPreset(null)
      setAction(initialAction)
      setIsLoading(false)
    }
  }, [isOpen, initialDate, initialAction])

  const handleConfirm = async () => {
    setIsLoading(true)
    try {
      await onConfirm(expiresAt, action)
      onOpenChange(false)
    } catch {
    } finally {
      setIsLoading(false)
    }
  }

  const handleCancel = () => {
    setExpiresAt(initialDate || null)
    setAction(initialAction)
    onOpenChange(false)
  }

  const setPresetExpiry = (value: Preset) => {
    const date = new Date()
    setCheckedAt(date.getTime())

    switch (value) {
      case 'hour':
        date.setHours(date.getHours() + 1)
        break
      case 'day':
        date.setDate(date.getDate() + 1)
        date.setHours(23, 59, 59, 999)
        break
      case 'week':
        date.setDate(date.getDate() + 7)
        date.setHours(23, 59, 59, 999)
        break
      case 'month':
        date.setMonth(date.getMonth() + 1)
        date.setHours(23, 59, 59, 999)
        break
    }

    setDate(date)
    setPreset(value)
  }

  const clearExpiry = () => {
    setExpiresAt(null)
  }

  const today = new Date(checkedAt).toDateString()

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>

        <div className="space-y-4">
          <div
            role="group"
            aria-labelledby="expiry-action-label"
            className="space-y-2"
          >
            <p id="expiry-action-label" className="text-sm font-medium">
              When file expires
            </p>
            <div className="grid grid-cols-2 gap-2">
              <Button
                type="button"
                variant="outline"
                aria-pressed={action === ExpiryAction.DELETE}
                disabled={!permitted(ExpiryAction.DELETE)}
                onClick={() => setAction(ExpiryAction.DELETE)}
                className={cn(action === ExpiryAction.DELETE && selectedOption)}
              >
                Delete file
              </Button>
              <Button
                type="button"
                variant="outline"
                aria-pressed={action === ExpiryAction.SET_PRIVATE}
                disabled={!permitted(ExpiryAction.SET_PRIVATE)}
                onClick={() => setAction(ExpiryAction.SET_PRIVATE)}
                className={cn(
                  action === ExpiryAction.SET_PRIVATE && selectedOption
                )}
              >
                Set to private
              </Button>
            </div>
          </div>

          {(!permitted(ExpiryAction.DELETE) ||
            !permitted(ExpiryAction.SET_PRIVATE)) && (
            <p className="text-xs text-muted-foreground">
              Scheduling deletion requires Delete files. Making a file private
              requires Share files. You can remove expiration if an inherited
              action is no longer allowed.
            </p>
          )}
          <div
            role="group"
            aria-labelledby="expiry-quick-label"
            className="space-y-2"
          >
            <p id="expiry-quick-label" className="text-sm font-medium">
              Quick options
            </p>
            <div className="grid grid-cols-2 gap-2">
              {PRESETS.map((option) => (
                <Button
                  key={option.value}
                  type="button"
                  variant="outline"
                  aria-pressed={preset === option.value}
                  onClick={() => setPresetExpiry(option.value)}
                  className={cn(preset === option.value && selectedOption)}
                >
                  {option.label}
                </Button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label id="expiry-date-label" htmlFor="expiry-date">
              Custom date and time
            </Label>
            <Popover modal={true}>
              <PopoverTrigger asChild>
                <Button
                  id="expiry-date"
                  type="button"
                  aria-labelledby="expiry-date-label expiry-date-value"
                  variant="outline"
                  className={cn(
                    'w-full justify-start text-left font-normal',
                    !expiresAt && 'text-muted-foreground',
                    expiresAt && !preset && selectedOption
                  )}
                >
                  <CalendarIcon className="h-4 w-4" aria-hidden="true" />
                  <span id="expiry-date-value">
                    {expiresAt
                      ? format(expiresAt, 'PPP p')
                      : 'Pick a date and time'}
                  </span>
                </Button>
              </PopoverTrigger>
              <PopoverContent
                className="max-h-[min(70vh,var(--radix-popover-content-available-height))] w-auto max-w-[calc(100vw-2rem)] overflow-y-auto p-0"
                align="start"
                side="bottom"
                sideOffset={4}
                collisionPadding={16}
              >
                <div className="flex flex-col sm:flex-row">
                  <div className="p-3">
                    <Calendar
                      mode="single"
                      selected={expiresAt || undefined}
                      onSelect={(date) => {
                        if (date) {
                          const now = new Date()
                          const newDate = new Date(date)

                          if (newDate.toDateString() === now.toDateString()) {
                            newDate.setHours(
                              now.getHours() + 1,
                              now.getMinutes()
                            )
                          } else {
                            newDate.setHours(23, 59, 59, 999)
                          }

                          setExpiresAt(newDate)
                        }
                      }}
                      disabled={(date) => {
                        const today = new Date()
                        today.setHours(0, 0, 0, 0)
                        const targetDate = new Date(date)
                        targetDate.setHours(0, 0, 0, 0)
                        return targetDate < today
                      }}
                      initialFocus
                    />
                  </div>

                  {expiresAt && (
                    <div className="space-y-4 border-t p-4 sm:min-w-[200px] sm:border-l sm:border-t-0">
                      <div className="flex items-center justify-between">
                        <Label className="text-sm font-medium">Time</Label>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => setExpiresAt(null)}
                        >
                          Clear
                        </Button>
                      </div>

                      <div className="text-center">
                        <div className="font-mono text-2xl font-medium">
                          {String(expiresAt.getHours()).padStart(2, '0')}:
                          {String(expiresAt.getMinutes()).padStart(2, '0')}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {format(expiresAt, 'EEEE, MMMM d')}
                        </div>
                      </div>

                      <div className="space-y-2">
                        <Label className="text-xs text-muted-foreground">
                          Add time
                        </Label>
                        <div className="grid grid-cols-2 gap-1">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="text-xs"
                            onClick={() => {
                              const newDate = new Date(expiresAt)
                              newDate.setMinutes(newDate.getMinutes() + 30)
                              setExpiresAt(newDate)
                            }}
                          >
                            +30min
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="text-xs"
                            onClick={() => {
                              const newDate = new Date(expiresAt)
                              newDate.setHours(newDate.getHours() + 1)
                              setExpiresAt(newDate)
                            }}
                          >
                            +1hr
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="text-xs"
                            onClick={() => {
                              const newDate = new Date(expiresAt)
                              newDate.setHours(newDate.getHours() + 2)
                              setExpiresAt(newDate)
                            }}
                          >
                            +2hr
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="text-xs"
                            onClick={() => {
                              const newDate = new Date(expiresAt)
                              newDate.setHours(newDate.getHours() + 6)
                              setExpiresAt(newDate)
                            }}
                          >
                            +6hr
                          </Button>
                        </div>
                      </div>

                      <div className="space-y-2">
                        <Label
                          htmlFor="manual-time"
                          className="text-xs text-muted-foreground"
                        >
                          Or set manually
                        </Label>
                        <Input
                          id="manual-time"
                          type="time"
                          value={expiresAt.toTimeString().slice(0, 5)}
                          onChange={(e) => {
                            const [hours, minutes] = e.target.value.split(':')
                            const newDate = new Date(expiresAt)
                            const newHour = parseInt(hours)
                            const newMinute = parseInt(minutes)

                            if (
                              newHour < 0 ||
                              newHour > 23 ||
                              newMinute < 0 ||
                              newMinute > 59
                            ) {
                              return
                            }

                            newDate.setHours(newHour, newMinute)

                            const now = new Date()
                            if (
                              newDate.toDateString() === now.toDateString() &&
                              newDate <= now
                            ) {
                              const futureTime = new Date(
                                now.getTime() + 5 * 60 * 1000
                              )
                              newDate.setHours(
                                futureTime.getHours(),
                                futureTime.getMinutes()
                              )
                            }

                            setExpiresAt(newDate)
                          }}
                          className="text-center font-mono"
                          min={
                            expiresAt && expiresAt.toDateString() === today
                              ? new Date(checkedAt + 5 * 60 * 1000)
                                  .toTimeString()
                                  .slice(0, 5)
                              : undefined
                          }
                        />
                      </div>

                      {expiresAt &&
                        expiresAt.toDateString() === today &&
                        expiresAt.getTime() <= checkedAt && (
                          <p
                            role="alert"
                            className="rounded-lg border border-danger/30 bg-danger/10 p-2 text-xs text-foreground"
                          >
                            Time must be at least 5 minutes from now.
                          </p>
                        )}
                    </div>
                  )}
                </div>
              </PopoverContent>
            </Popover>
          </div>

          {expiresAt && (
            <Button
              type="button"
              variant="outline"
              onClick={clearExpiry}
              className="w-full"
            >
              Remove expiration
            </Button>
          )}

          {expiresAt && (
            <div className="rounded-xl border border-border bg-muted/30 p-3">
              <div className="flex items-center gap-2">
                <CalendarIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
                <p className="text-sm font-medium">
                  {action === ExpiryAction.DELETE
                    ? 'Auto-delete scheduled'
                    : 'Auto-private scheduled'}
                </p>
              </div>
              <p className="mt-1 text-pretty text-sm text-muted-foreground">
                {action === ExpiryAction.DELETE
                  ? 'File will be permanently deleted on '
                  : 'File will be set to private on '}
                {format(expiresAt, 'PPPP')}{' '}
                <span className="whitespace-nowrap">
                  {format(expiresAt, 'p')}
                </span>
              </p>
            </div>
          )}
        </div>

        <DialogFooter className="mt-6">
          <Button variant="outline" onClick={handleCancel} disabled={isLoading}>
            Cancel
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={isLoading || (Boolean(expiresAt) && !permitted(action))}
          >
            {isLoading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                {expiresAt ? 'Setting…' : 'Removing…'}
              </>
            ) : (
              <>{expiresAt ? 'Set expiration' : 'Remove expiration'}</>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
