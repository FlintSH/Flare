'use client'

import { useState } from 'react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
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
    <Dialog open>
      <DialogContent
        showCloseButton={false}
        onEscapeKeyDown={(event) => event.preventDefault()}
        onInteractOutside={(event) => event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Password Protected File</DialogTitle>
          <DialogDescription>
            Enter the password from the sender to open this file.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={handleSubmit}
          className="space-y-4"
          aria-busy={isLoading}
        >
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
      </DialogContent>
    </Dialog>
  )
}
