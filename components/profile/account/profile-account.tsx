'use client'

import { useRef, useState } from 'react'

import { ProfileAccountProps } from '@/types/components/profile'
import { signIn, signOut, useSession } from 'next-auth/react'

import {
  hasRecentSecurityProof,
  recentSecurityProofName,
} from '@/components/auth/security-api'
import {
  AccountEmail,
  useAccountEmailStatus,
} from '@/components/email/account-email'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

import { AVATAR_ACCEPT, avatarProblem } from '@/lib/storage/avatar-policy'
import { ACCOUNT_NAME_MIN_LENGTH } from '@/lib/users/account-policy'

import { useSecurityStatus } from '@/hooks/use-security-status'
import { useToast } from '@/hooks/use-toast'

import { PasskeyConfirmation } from '../security/passkey-confirmation'
import { checkProfileProof } from '../security/profile-proof'

export function ProfileAccount({ user, onUpdate }: ProfileAccountProps) {
  const { update: updateSession } = useSession()
  const [isLoading, setIsLoading] = useState(false)
  const { toast } = useToast()
  const { status: emailStatus, refresh: refreshEmail } = useAccountEmailStatus()
  const { data: security, refetch: refreshSecurity } = useSecurityStatus()
  const recentProof = security && hasRecentSecurityProof(security)
  const [emailChanged, setEmailChanged] = useState(false)
  // Save changes waits for an edit, like every save on these tabs. The
  // saved name is the baseline until the refreshed profile arrives.
  const [savedName, setSavedName] = useState(user.name || '')
  const [nameChanged, setNameChanged] = useState(false)
  const [proofNotice, setProofNotice] = useState<string | null>(null)

  const nameRef = useRef<HTMLInputElement>(null)
  const emailRef = useRef<HTMLInputElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const emailPasswordRef = useRef<HTMLInputElement>(null)
  const emailSecurityCodeRef = useRef<HTMLInputElement>(null)

  const triggerAvatarUpload = () => {
    fileInputRef.current?.click()
  }

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.length) return
    const problem = avatarProblem(e.target.files[0])
    if (problem) {
      toast({
        title: problem.title,
        description: problem.message,
        variant: 'destructive',
      })
      e.target.value = ''
      return
    }
    setIsLoading(true)
    try {
      const file = e.target.files[0]
      const formData = new FormData()
      formData.append('file', file)

      const response = await fetch('/api/profile/avatar', {
        method: 'POST',
        body: formData,
      })

      if (!response.ok) {
        throw new Error('Failed to upload avatar')
      }

      const { url } = await response.json()

      await updateSession({
        user: {
          ...user,
          image: url,
        },
      })

      onUpdate()

      toast({
        title: 'Success',
        description: 'Avatar updated successfully',
      })
    } catch (error) {
      console.error('Avatar upload error:', error)
      toast({
        title: 'Upload failed',
        description:
          error instanceof Error ? error.message : 'Failed to update avatar',
        variant: 'destructive',
      })
    } finally {
      setIsLoading(false)
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    }
  }

  const handleProfileUpdate = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)
    setProofNotice(null)
    let mutationStarted = false
    try {
      const changesEmail = !emailStatus?.enabled && emailChanged
      const proof = {
        currentPassword: emailPasswordRef.current?.value || undefined,
        securityCode: emailSecurityCodeRef.current?.value || undefined,
      }
      if (changesEmail) {
        const requirement = await checkProfileProof(
          refreshSecurity,
          'email',
          proof
        )
        if (requirement) {
          setProofNotice(requirement)
          return
        }
      }
      mutationStarted = true
      const response = await fetch('/api/profile', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: nameRef.current?.value,
          ...(emailStatus?.enabled ? {} : { email: emailRef.current?.value }),
          ...(changesEmail ? proof : {}),
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to update profile')
      }

      const { data } = await response.json()

      if (!emailStatus?.enabled && emailChanged) {
        toast({
          title: 'Email updated',
          description: 'Sign in again with your new email address.',
        })
        await signOut({ callbackUrl: '/auth/login?local=1' })
        return
      }

      await updateSession({
        user: {
          ...user,
          name: data.name,
          email: data.email,
        },
      })

      onUpdate()

      setSavedName(data.name ?? '')
      setNameChanged(false)
      setEmailChanged(false)
      if (emailPasswordRef.current) emailPasswordRef.current.value = ''
      if (emailSecurityCodeRef.current) emailSecurityCodeRef.current.value = ''

      toast({
        title: 'Success',
        description: 'Profile updated successfully',
      })
    } catch (error) {
      if (mutationStarted) void refreshSecurity()
      toast({
        title: 'Error',
        description:
          error instanceof Error ? error.message : 'Failed to update profile',
        variant: 'destructive',
      })
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <>
      <div className="flex flex-col sm:flex-row gap-6">
        <div className="flex flex-col items-center">
          <Avatar className="h-24 w-24">
            <AvatarImage
              src={user.image || undefined}
              alt={user.name || 'User avatar'}
              className="object-cover"
            />
            <AvatarFallback>
              {user.name?.[0]?.toUpperCase() || 'U'}
            </AvatarFallback>
          </Avatar>
          <Button
            type="button"
            variant="outline"
            onClick={triggerAvatarUpload}
            disabled={isLoading}
            className="mt-4 w-full"
          >
            {isLoading ? 'Uploading…' : 'Change avatar'}
          </Button>
          <Input
            ref={fileInputRef}
            type="file"
            accept={AVATAR_ACCEPT}
            className="hidden"
            onChange={handleAvatarUpload}
          />
        </div>

        <div className="min-w-0 flex-1">
          <form
            onSubmit={handleProfileUpdate}
            className="flex flex-col justify-center h-full space-y-4"
          >
            {proofNotice && (
              <p
                role="alert"
                className="rounded-xl border bg-muted/30 p-3 text-sm"
              >
                {proofNotice}
              </p>
            )}
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="username">Username</Label>
                <Input
                  id="username"
                  ref={nameRef}
                  defaultValue={user.name || ''}
                  placeholder="Your username"
                  minLength={ACCOUNT_NAME_MIN_LENGTH}
                  autoComplete="username"
                  required
                  disabled={isLoading}
                  onChange={(event) =>
                    setNameChanged(event.target.value !== savedName)
                  }
                />
              </div>

              {!emailStatus?.enabled && (
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    ref={emailRef}
                    defaultValue={user.email || ''}
                    placeholder="Your email"
                    autoComplete="email"
                    required
                    disabled={isLoading}
                    onChange={(event) =>
                      setEmailChanged(event.target.value !== user.email)
                    }
                  />
                </div>
              )}
              {!emailStatus?.enabled &&
                emailChanged &&
                !recentProof &&
                !security?.passkeyRequired &&
                security?.hasPassword && (
                  <>
                    <div className="space-y-2">
                      <Label htmlFor="email-current-password">
                        Current password
                      </Label>
                      <Input
                        id="email-current-password"
                        ref={emailPasswordRef}
                        type="password"
                        placeholder="Enter your current password"
                        autoComplete="current-password"
                        required
                        disabled={isLoading}
                        data-sensitive="true"
                      />
                      <p className="text-xs text-muted-foreground">
                        Confirm your password to change your sign-in email
                        address.
                      </p>
                    </div>
                    {security.twoFactorEnabled && (
                      <div className="space-y-2">
                        <Label htmlFor="email-security-code">
                          Authenticator or recovery code
                        </Label>
                        <Input
                          id="email-security-code"
                          ref={emailSecurityCodeRef}
                          autoComplete="one-time-code"
                          autoCapitalize="none"
                          spellCheck={false}
                          maxLength={32}
                          placeholder="Enter an authenticator or recovery code"
                          required
                          disabled={isLoading}
                          data-sensitive="true"
                        />
                      </div>
                    )}
                  </>
                )}
              {!emailStatus?.enabled &&
                emailChanged &&
                security &&
                !security.passkeyRequired &&
                !security.hasPassword &&
                !recentProof &&
                !security.canUseRecentSso && (
                  <div className="space-y-3 rounded-xl border bg-muted/30 p-4">
                    <p className="text-sm text-muted-foreground">
                      Confirm your identity with a fresh SSO sign-in, then
                      return here to change your email.
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={isLoading}
                      onClick={() =>
                        signIn('oidc', { callbackUrl: '/dashboard/profile' })
                      }
                    >
                      Confirm with SSO
                    </Button>
                  </div>
                )}
              {!emailStatus?.enabled &&
                emailChanged &&
                security?.passkeyRequired &&
                !recentProof && (
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
              {!emailStatus?.enabled && emailChanged && recentProof && (
                <p className="text-sm text-muted-foreground">
                  Your recent {recentSecurityProofName(security)} sign-in
                  confirms your identity for this email change.
                </p>
              )}
            </div>

            <div className="flex justify-end">
              <Button
                type="submit"
                className="w-full sm:w-auto"
                disabled={isLoading || (!nameChanged && !emailChanged)}
              >
                {isLoading ? 'Saving…' : 'Save changes'}
              </Button>
            </div>
          </form>
        </div>
      </div>

      {emailStatus?.enabled && (
        <div className="mt-6">
          <AccountEmail
            status={emailStatus}
            email={user.email}
            refresh={refreshEmail}
          />
        </div>
      )}
    </>
  )
}
