'use client'

import { useState } from 'react'

import { Monitor, Moon, SlidersHorizontal, Sun } from 'lucide-react'

import { PERSONAL_APPEARANCE } from '@/components/customization/appearance-provider'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'

import { apiRequest } from '@/lib/client/request'
import type { PersonalAppearance } from '@/lib/customization/schema'
import { cn } from '@/lib/utils'

import { useAccountRefresh } from '@/hooks/use-account-query'
import { useToast } from '@/hooks/use-toast'

export function PersonalAppearanceSettings({
  initialPreference,
}: {
  initialPreference: PersonalAppearance
}) {
  const { toast } = useToast()
  const refreshAppearance = useAccountRefresh(PERSONAL_APPEARANCE)
  const [preference, setPreference] = useState(initialPreference)
  const [savedPreference, setSavedPreference] = useState(initialPreference)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function savePreference() {
    setBusy(true)
    setError('')
    try {
      await apiRequest('/api/customization/preferences', {
        method: 'PATCH',
        body: preference,
        fallback: 'Preferences could not be saved.',
      })
      setSavedPreference(preference)
      void refreshAppearance()
      toast({ title: 'Your workspace appearance is saved' })
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Preferences could not be saved.'
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      {error && (
        <p
          role="alert"
          className="rounded-xl border border-danger/30 bg-danger/10 p-4 text-sm text-destructive"
        >
          {error}
        </p>
      )}
      <Card>
        <CardHeader>
          <CardTitle>Your workspace, your preference</CardTitle>
          <CardDescription>
            Choose how Flare looks when you sign in. This follows your account
            across devices.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {(
              [
                {
                  value: 'inherit',
                  title: 'From instance',
                  icon: SlidersHorizontal,
                  description: 'Use the operator’s choice',
                },
                {
                  value: 'system',
                  title: 'System',
                  icon: Monitor,
                  description: 'Follow your device',
                },
                {
                  value: 'light',
                  title: 'Light',
                  icon: Sun,
                  description: 'A brighter workspace',
                },
                {
                  value: 'dark',
                  title: 'Dark',
                  icon: Moon,
                  description: 'Keep things comfortable',
                },
              ] as const
            ).map((item) => (
              <button
                key={item.value}
                type="button"
                aria-pressed={preference.themeMode === item.value}
                onClick={() => setPreference({ themeMode: item.value })}
                className={cn(
                  // Buttons centre their content; keep icons and titles on
                  // one line when a description wraps.
                  'flex flex-col justify-start text-left rounded-xl border p-5 transition-colors hover:bg-muted/40',
                  preference.themeMode === item.value &&
                    'border-primary bg-primary/5'
                )}
              >
                <item.icon className="h-5 w-5 mb-5 text-muted-foreground" />
                <span className="font-medium text-sm block">{item.title}</span>
                <span className="mt-1 block text-balance text-xs text-muted-foreground">
                  {item.description}
                </span>
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <p className="max-w-xl text-pretty text-sm text-muted-foreground">
              Public share pages keep the instance’s brand. Your preference
              changes your dashboard.
            </p>
            {/* Form actions sit at the end, full width on phones. Like every
                save on these tabs, it waits for a change and has no icon, so
                a disabled button never reads as "saved". */}
            <Button
              className="w-full sm:ml-auto sm:w-auto"
              disabled={
                busy || preference.themeMode === savedPreference.themeMode
              }
              onClick={savePreference}
            >
              {busy ? 'Saving…' : 'Save preference'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
