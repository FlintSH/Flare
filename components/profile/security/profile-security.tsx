'use client'

import { useRef, useState } from 'react'

import { ProfileSecurityProps } from '@/types/components/profile'

import {
  PasswordFieldError,
  usePasswordFields,
} from '@/components/auth/password-field'
import { PasswordInput } from '@/components/auth/password-input'
import {
  hasRecentSecurityProof,
  recentSecurityProofName,
} from '@/components/auth/security-api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

import { RECOVERY_CODE_INPUT_LENGTH } from '@/lib/auth/security/policy'
import { updateProfile } from '@/lib/client/profile'
import {
  ACCOUNT_PASSWORD_HELP,
  ACCOUNT_PASSWORD_MIN_LENGTH,
} from '@/lib/users/account-policy'

import { useSecurityStatus } from '@/hooks/use-security-status'
import { useSignOut } from '@/hooks/use-sign-out'
import { useToast } from '@/hooks/use-toast'

import { PasskeyConfirmation } from './passkey-confirmation'
import { checkProfileProof } from './profile-proof'

export function ProfileSecurity({ onUpdate }: ProfileSecurityProps) {
  const [isLoading, setIsLoading] = useState(false)
  const [proofNotice, setProofNotice] = useState<string | null>(null)
  // Update password waits until the form has something in it, like every
  // save on these tabs.
  const [hasInput, setHasInput] = useState(false)
  const { toast } = useToast()
  const { data: security, refetch: refreshSecurity } = useSecurityStatus()
  const recentProof = security && hasRecentSecurityProof(security)

  const currentPasswordRef = useRef<HTMLInputElement>(null)
  const newPasswordRef = useRef<HTMLInputElement>(null)
  const confirmPasswordRef = useRef<HTMLInputElement>(null)
  const securityCodeRef = useRef<HTMLInputElement>(null)
  const passwords = usePasswordFields({
    passwordId: 'new-password',
    helpId: 'profile-password-help',
    confirmationId: 'confirm-password',
  })

  const changeFailed = (
    error: unknown,
    mutationStarted: boolean,
    message?: string
  ) => {
    if (mutationStarted) void refreshSecurity()
    toast({
      title: 'Error',
      description:
        message ??
        (error instanceof Error ? error.message : 'Failed to update password'),
      variant: 'destructive',
    })
  }
  const signOut = useSignOut({
    onError: (error, message) => changeFailed(error, true, message),
  })

  const handlePasswordChange = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (isLoading) return
    const newPassword = newPasswordRef.current?.value || ''
    if (
      !passwords.validate(
        newPassword,
        confirmPasswordRef.current?.value || '',
        e.currentTarget
      )
    )
      return

    setIsLoading(true)
    setProofNotice(null)
    let mutationStarted = false
    try {
      const proof = {
        currentPassword: currentPasswordRef.current?.value,
        securityCode: securityCodeRef.current?.value || undefined,
      }
      const requirement = await checkProfileProof(
        refreshSecurity,
        'password',
        proof
      )
      if (requirement) {
        setProofNotice(requirement)
        return
      }
      mutationStarted = true
      await updateProfile(
        { ...proof, newPassword },
        'Failed to update password'
      )

      onUpdate()

      toast({
        title: 'Success',
        description: security?.passkeyRequired
          ? 'Password updated. Sign in again with a passkey or a dedicated passkey recovery code.'
          : 'Password updated. Sign in again with your new password.',
      })

      if (currentPasswordRef.current) currentPasswordRef.current.value = ''
      if (newPasswordRef.current) newPasswordRef.current.value = ''
      if (confirmPasswordRef.current) confirmPasswordRef.current.value = ''
      if (securityCodeRef.current) securityCodeRef.current.value = ''
      setHasInput(false)
      await signOut()
    } catch (error) {
      changeFailed(error, mutationStarted)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      <form
        onSubmit={handlePasswordChange}
        onChange={() =>
          setHasInput(
            [currentPasswordRef, newPasswordRef, confirmPasswordRef].some(
              (field) => Boolean(field.current?.value)
            )
          )
        }
        className="space-y-4"
      >
        {proofNotice && (
          <p role="alert" className="rounded-xl border bg-muted/30 p-3 text-sm">
            {proofNotice}
          </p>
        )}
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="current-password">Current password</Label>
            <PasswordInput
              id="current-password"
              visibilityLabel="current password"
              ref={currentPasswordRef}
              placeholder="Enter your current password"
              autoComplete="current-password"
              required
              disabled={isLoading}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="new-password">New password</Label>
            <PasswordInput
              id="new-password"
              visibilityLabel="new password"
              ref={newPasswordRef}
              placeholder="Enter your new password"
              autoComplete="new-password"
              minLength={ACCOUNT_PASSWORD_MIN_LENGTH}
              {...passwords.passwordProps}
              required
              disabled={isLoading}
            />
            <p
              id="profile-password-help"
              className="text-sm text-muted-foreground"
            >
              {ACCOUNT_PASSWORD_HELP}
            </p>
            <PasswordFieldError
              id="new-password-error"
              message={passwords.errors.password}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="confirm-password">Confirm new password</Label>
            <PasswordInput
              id="confirm-password"
              visibilityLabel="new password confirmation"
              ref={confirmPasswordRef}
              placeholder="Confirm your new password"
              autoComplete="new-password"
              minLength={ACCOUNT_PASSWORD_MIN_LENGTH}
              required
              disabled={isLoading}
              {...passwords.confirmationProps}
            />
            <PasswordFieldError
              id="confirm-password-error"
              message={passwords.errors.confirmation}
            />
          </div>
          {(security?.twoFactorEnabled || security?.passkeyRequired) &&
            recentProof && (
              <p className="text-sm text-muted-foreground">
                Your recent {recentSecurityProofName(security)} sign-in confirms
                your second factor for this change.
              </p>
            )}
          {security?.passkeyRequired && !recentProof && (
            <PasskeyConfirmation
              busy={isLoading}
              onBusyChange={setIsLoading}
              onConfirmed={async () => {
                const result = await refreshSecurity()
                if (result.error) throw result.error
                setProofNotice(null)
              }}
            />
          )}
          {security?.twoFactorEnabled &&
            !security.passkeyRequired &&
            !recentProof && (
              <div className="space-y-2">
                <Label htmlFor="password-security-code">
                  Authenticator or recovery code
                </Label>
                <Input
                  id="password-security-code"
                  ref={securityCodeRef}
                  autoComplete="one-time-code"
                  autoCapitalize="none"
                  spellCheck={false}
                  maxLength={RECOVERY_CODE_INPUT_LENGTH}
                  placeholder="Enter an authenticator or recovery code"
                  required
                  disabled={isLoading}
                  data-sensitive="true"
                />
                <p className="text-xs text-muted-foreground">
                  Two-factor authentication also protects password changes.
                </p>
              </div>
            )}
        </div>

        <div className="flex justify-end">
          <Button
            type="submit"
            className="w-full sm:w-auto"
            disabled={isLoading || !hasInput}
          >
            {isLoading ? 'Updating…' : 'Update password'}
          </Button>
        </div>
      </form>
    </div>
  )
}
