'use client'

import { useState } from 'react'

import {
  Check,
  Loader2,
  Monitor,
  Moon,
  SlidersHorizontal,
  Sun,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'

import type { PersonalAppearance } from '@/lib/customization/schema'
import { cn } from '@/lib/utils'

import { useToast } from '@/hooks/use-toast'

export function PersonalAppearanceSettings({
  initialPreference,
}: {
  initialPreference: PersonalAppearance
}) {
  const { toast } = useToast()
  const [preference, setPreference] = useState(initialPreference)
  const [savedPreference, setSavedPreference] = useState(initialPreference)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function savePreference() {
    setBusy(true)
    setError('')
    try {
      const response = await fetch('/api/customization/preferences', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(preference),
      })
      const body = await response.json()
      if (!response.ok)
        throw new Error(body.error || 'Preferences could not be saved.')
      setSavedPreference(preference)
      window.dispatchEvent(new Event('flare:appearance-preference'))
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
          className="rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive"
        >
          {error}
        </p>
      )}
      <Card className="bg-background/60 backdrop-blur-xl" data-flare-surface>
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
                  'text-left rounded-xl border p-5 transition-colors hover:bg-muted/40',
                  preference.themeMode === item.value &&
                    'border-primary bg-primary/5 ring-1 ring-primary'
                )}
              >
                <item.icon className="h-5 w-5 mb-5 text-muted-foreground" />
                <span className="font-medium text-sm block">{item.title}</span>
                <span className="text-xs text-muted-foreground block mt-1">
                  {item.description}
                </span>
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <p className="text-sm text-muted-foreground max-w-xl">
              Public share pages keep the instance’s brand. Your preference
              changes your dashboard.
            </p>
            <Button
              disabled={
                busy || preference.themeMode === savedPreference.themeMode
              }
              onClick={savePreference}
            >
              {busy ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Check className="h-4 w-4 mr-2" />
              )}
              Save preference
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
