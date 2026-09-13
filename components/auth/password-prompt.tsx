'use client'

import { useState } from 'react'

import { LockKeyhole } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

interface PasswordPromptProps {
  onSubmit: (password: string) => Promise<boolean>
  onSuccess: () => void
}

export function PasswordPrompt({ onSubmit, onSuccess }: PasswordPromptProps) {
  const [password, setPassword] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setIsLoading(true)
    setError('')
    try {
      if (await onSubmit(password)) {
        onSuccess()
      } else {
        setError(
          'That password didn’t match. Check with the sender and try again.'
        )
      }
    } catch {
      setError('We couldn’t check the password. Please try again.')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <section
      className="mx-auto w-full max-w-md space-y-5 p-6 sm:p-8"
      aria-labelledby="protected-file-title"
    >
      <span className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-border bg-muted/30">
        <LockKeyhole
          className="h-5 w-5 text-muted-foreground"
          aria-hidden="true"
        />
      </span>
      <div className="space-y-2">
        <h2
          id="protected-file-title"
          className="text-xl font-semibold tracking-tight"
        >
          Password protected file
        </h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Enter the password from the sender to open this file.
        </p>
      </div>
      <form onSubmit={handleSubmit} className="space-y-4" aria-busy={isLoading}>
        <div className="space-y-2">
          <Label htmlFor="protected-file-password">File password</Label>
          <Input
            id="protected-file-password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            disabled={isLoading}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? 'protected-file-error' : undefined}
            required
            autoFocus
          />
          {error && (
            <p
              id="protected-file-error"
              className="text-sm text-foreground"
              role="alert"
            >
              {error}
            </p>
          )}
        </div>
        <Button type="submit" className="w-full" disabled={isLoading}>
          {isLoading ? 'Checking password…' : 'Open file'}
        </Button>
      </form>
    </section>
  )
}
