import { AlertCircle, Clock } from 'lucide-react'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

import { type FileAccessDenied, retryAfterMinutes } from '@/lib/files/access'

/** Copy shared by every file password prompt. */
export const FILE_PASSWORD_TITLE = 'Password-protected file'
export const FILE_PASSWORD_DESCRIPTION =
  'Enter the password from the sender to open this file.'

export type FilePasswordProblem =
  { kind: 'invalid'; message: string } | { kind: 'limited'; message: string }

/** The one message for a refused password, or null for a first visit. */
export function filePasswordProblem(
  access: FileAccessDenied
): FilePasswordProblem | null {
  if (access.reason === 'password_rate_limited')
    return {
      kind: 'limited',
      message: `Too many incorrect passwords were entered for this file. Wait ${retryAfterMinutes(access)} min, then try again.`,
    }
  if (access.reason === 'password_invalid')
    return {
      kind: 'invalid',
      message:
        'That password didn’t match. Check with the sender and try again.',
    }
  return null
}

/**
 * The password form on a protected file's page. A wrong password or a paused
 * check is reported once, in a message tied to the field.
 */
export function FilePasswordForm({
  action,
  problem,
}: {
  action: string
  problem: FilePasswordProblem | null
}) {
  const invalid = problem?.kind === 'invalid'
  return (
    <form className="flex flex-col gap-4" action={action}>
      <div className="space-y-2">
        <Label htmlFor="share-password">File password</Label>
        <Input
          id="share-password"
          type="password"
          name="password"
          autoComplete="current-password"
          placeholder="Enter the file password"
          className="h-11"
          aria-invalid={invalid || undefined}
          aria-describedby={problem ? 'share-password-error' : undefined}
          required
          autoFocus
        />
      </div>
      {problem && (
        <Alert
          id="share-password-error"
          variant={invalid ? 'destructive' : 'warning'}
        >
          {invalid ? (
            <AlertCircle aria-hidden="true" />
          ) : (
            <Clock aria-hidden="true" />
          )}
          <AlertDescription>{problem.message}</AlertDescription>
        </Alert>
      )}
      <Button type="submit" className="mt-2 h-11 w-full">
        Access file
      </Button>
    </form>
  )
}
