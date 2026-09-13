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

import { cn } from '@/lib/utils'

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
  title = 'Configure Expiration',
  description = 'Set when this file should expire',
}: ExpiryModalProps) {
  const [expiresAt, setExpiresAt] = useState<Date | null>(initialDate || null)
  const [action, setAction] = useState<ExpiryAction>(initialAction)
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    if (isOpen) {
      setExpiresAt(initialDate || null)
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

  const setPresetExpiry = (
    duration: number,
    unit: 'hours' | 'days' | 'weeks' | 'months'
  ) => {
    const date = new Date()

    switch (unit) {
      case 'hours':
        date.setHours(date.getHours() + duration)
        break
      case 'days':
        date.setDate(date.getDate() + duration)
        date.setHours(23, 59, 59, 999)
        break
      case 'weeks':
        date.setDate(date.getDate() + duration * 7)
        date.setHours(23, 59, 59, 999)
        break
      case 'months':
        date.setMonth(date.getMonth() + duration)
        date.setHours(23, 59, 59, 999)
        break
    }

    setExpiresAt(date)
  }

  const clearExpiry = () => {
    setExpiresAt(null)
  }

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label className="text-sm font-medium">When file expires</Label>
            <div className="grid grid-cols-2 gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                aria-pressed={action === ExpiryAction.DELETE}
                onClick={() => setAction(ExpiryAction.DELETE)}
                className={cn(
                  action === ExpiryAction.DELETE &&
                    'bg-primary/10 border-primary'
                )}
              >
                Delete file
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                aria-pressed={action === ExpiryAction.SET_PRIVATE}
                onClick={() => setAction(ExpiryAction.SET_PRIVATE)}
                className={cn(
                  action === ExpiryAction.SET_PRIVATE &&
                    'bg-primary/10 border-primary'
                )}
              >
                Set to private
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-sm font-medium">Quick Options</Label>
            <div className="grid grid-cols-2 gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setPresetExpiry(1, 'hours')}
                className={cn(
                  expiresAt &&
                    Math.abs(
                      expiresAt.getTime() -
                        new Date(Date.now() + 60 * 60 * 1000).getTime()
                    ) <
                      60 * 1000 &&
                    'bg-primary/10 border-primary'
                )}
              >
                1 Hour
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setPresetExpiry(1, 'days')}
                className={cn(
                  expiresAt &&
                    expiresAt.getDate() ===
                      new Date(Date.now() + 24 * 60 * 60 * 1000).getDate() &&
                    expiresAt.getHours() === 23 &&
                    'bg-primary/10 border-primary'
                )}
              >
                1 Day
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setPresetExpiry(1, 'weeks')}
                className={cn(
                  expiresAt &&
                    Math.abs(
                      expiresAt.getTime() -
                        new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).getTime()
                    ) <
                      24 * 60 * 60 * 1000 &&
                    'bg-primary/10 border-primary'
                )}
              >
                1 Week
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setPresetExpiry(1, 'months')}
                className={cn(
                  expiresAt &&
                    expiresAt.getMonth() ===
                      new Date(
                        Date.now() + 30 * 24 * 60 * 60 * 1000
                      ).getMonth() &&
                    'bg-primary/10 border-primary'
                )}
              >
                1 Month
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-sm font-medium">Custom Date & Time</Label>
            <Popover modal={true}>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  className={cn(
                    'w-full justify-start text-left font-normal',
                    !expiresAt && 'text-muted-foreground'
                  )}
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {expiresAt
                    ? format(expiresAt, 'PPP p')
                    : 'Pick a date and time'}
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
                            expiresAt &&
                            expiresAt.toDateString() ===
                              new Date().toDateString()
                              ? new Date(Date.now() + 5 * 60 * 1000)
                                  .toTimeString()
                                  .slice(0, 5)
                              : undefined
                          }
                        />
                      </div>

                      {expiresAt &&
                        expiresAt.toDateString() ===
                          new Date().toDateString() &&
                        expiresAt <= new Date() && (
                          <div className="rounded-lg bg-destructive/5 p-2 text-xs text-destructive">
                            Time must be at least 5 minutes from now
                          </div>
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
              Remove Expiration
            </Button>
          )}

          {expiresAt && (
            <div className="rounded-xl border border-primary/20 bg-primary/5 p-3">
              <div className="flex items-center gap-2">
                <CalendarIcon className="h-4 w-4 shrink-0 text-primary" />
                <p className="text-sm font-medium">
                  {action === ExpiryAction.DELETE
                    ? 'Auto-delete scheduled'
                    : 'Auto-private scheduled'}
                </p>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                {action === ExpiryAction.DELETE
                  ? `File will be permanently deleted on ${format(expiresAt, 'PPPP p')}`
                  : `File will be set to private on ${format(expiresAt, 'PPPP p')}`}
              </p>
            </div>
          )}
        </div>

        <DialogFooter className="mt-6">
          <Button variant="outline" onClick={handleCancel} disabled={isLoading}>
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={isLoading}>
            {isLoading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {expiresAt ? 'Setting...' : 'Removing...'}
              </>
            ) : (
              <>{expiresAt ? 'Set Expiration' : 'Remove Expiration'}</>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
