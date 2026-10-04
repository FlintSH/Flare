'use client'

import { useRef, useState } from 'react'

import { ProfileSecurityProps } from '@/types/components/profile'
import { signOut } from 'next-auth/react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

import { useSecurityStatus } from '@/hooks/use-security-status'
import { useToast } from '@/hooks/use-toast'

import { checkProfileProof } from './profile-proof'

export function ProfileSecurity({ onUpdate }: ProfileSecurityProps) {
  const [isLoading, setIsLoading] = useState(false)
  const [proofNotice, setProofNotice] = useState<string | null>(null)
  const { toast } = useToast()
  const { data: security, refetch: refreshSecurity } = useSecurityStatus()
  const recentProof =
    security?.canUseRecentPasskey || security?.canUseRecentRecovery

  const currentPasswordRef = useRef<HTMLInputElement>(null)
  const newPasswordRef = useRef<HTMLInputElement>(null)
  const confirmPasswordRef = useRef<HTMLInputElement>(null)
  const securityCodeRef = useRef<HTMLInputElement>(null)

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault()
    if (newPasswordRef.current?.value !== confirmPasswordRef.current?.value) {
      toast({
        title: 'Error',
        description: 'New passwords do not match',
        variant: 'destructive',
      })
      return
    }

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
      const response = await fetch('/api/profile', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ...proof,
          newPassword: newPasswordRef.current?.value,
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to update password')
      }

      onUpdate()

      toast({
        title: 'Success',
        description: 'Password updated. Sign in again with your new password.',
      })

      if (currentPasswordRef.current) currentPasswordRef.current.value = ''
      if (newPasswordRef.current) newPasswordRef.current.value = ''
      if (confirmPasswordRef.current) confirmPasswordRef.current.value = ''
      if (securityCodeRef.current) securityCodeRef.current.value = ''
      await signOut({ callbackUrl: '/auth/login?local=1' })
    } catch (error) {
      if (mutationStarted) void refreshSecurity()
      toast({
        title: 'Error',
        description:
          error instanceof Error ? error.message : 'Failed to update password',
        variant: 'destructive',
      })
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      <form onSubmit={handlePasswordChange} className="space-y-4">
        {proofNotice && (
          <p role="alert" className="rounded-xl border bg-muted/30 p-3 text-sm">
            {proofNotice}
          </p>
        )}
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="current-password">Current Password</Label>
            <Input
              id="current-password"
              type="password"
              ref={currentPasswordRef}
              placeholder="Enter your current password"
              autoComplete="current-password"
              required
              disabled={isLoading}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="new-password">New Password</Label>
            <Input
              id="new-password"
              type="password"
              ref={newPasswordRef}
              placeholder="Enter your new password"
              autoComplete="new-password"
              minLength={8}
              required
              disabled={isLoading}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="confirm-password">Confirm New Password</Label>
            <Input
              id="confirm-password"
              type="password"
              ref={confirmPasswordRef}
              placeholder="Confirm your new password"
              autoComplete="new-password"
              minLength={8}
              required
              disabled={isLoading}
            />
          </div>
          {security?.twoFactorEnabled && recentProof && (
            <p className="text-sm text-muted-foreground">
              Your recent{' '}
              {security.canUseRecentPasskey ? 'passkey' : 'recovery code'}{' '}
              sign-in confirms your second factor for this change.
            </p>
          )}
          {security?.twoFactorEnabled && !recentProof && (
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
                maxLength={32}
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
          <Button type="submit" disabled={isLoading}>
            {isLoading ? 'Updating...' : 'Update Password'}
          </Button>
        </div>
      </form>
    </div>
  )
}
