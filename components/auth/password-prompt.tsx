'use client'

import { useState } from 'react'

import { AlertCircle } from 'lucide-react'

import { Alert, AlertDescription } from '@/components/ui/alert'
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

// Matches the server-rendered prompt in components/auth/file-password-form.tsx.
export function PasswordPrompt({ onSubmit, onSuccess }: PasswordPromptProps) {
  const [password, setPassword] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<{
    message: string
    invalid: boolean
  } | null>(null)

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setIsLoading(true)
    setError(null)
    try {
      if (await onSubmit(password)) {
        onSuccess()
      } else {
        setError({
          message:
            'That password didn’t match. Check with the sender and try again.',
          invalid: true,
        })
      }
    } catch {
      setError({
        message: 'We couldn’t check the password. Please try again.',
        invalid: false,
      })
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
          <DialogTitle>Password-protected file</DialogTitle>
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
              placeholder="Enter the file password"
              className="h-11"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              disabled={isLoading}
              aria-invalid={error?.invalid || undefined}
              aria-describedby={error ? 'protected-file-error' : undefined}
              required
              autoFocus
            />
          </div>
          {error && (
            <Alert id="protected-file-error" variant="destructive">
              <AlertCircle aria-hidden="true" />
              <AlertDescription>{error.message}</AlertDescription>
            </Alert>
          )}
          <Button type="submit" className="h-11 w-full" disabled={isLoading}>
            {isLoading ? 'Checking password…' : 'Access file'}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}
