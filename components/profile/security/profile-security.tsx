'use client'

import { useRef, useState } from 'react'

import { ProfileSecurityProps } from '@/types/components/profile'
import { useSession } from 'next-auth/react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

import { useToast } from '@/hooks/use-toast'

export function ProfileSecurity({ onUpdate }: ProfileSecurityProps) {
  const { update: updateSession } = useSession()
  const [isLoading, setIsLoading] = useState(false)
  const { toast } = useToast()

  const currentPasswordRef = useRef<HTMLInputElement>(null)
  const newPasswordRef = useRef<HTMLInputElement>(null)
  const confirmPasswordRef = useRef<HTMLInputElement>(null)

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
    try {
      const response = await fetch('/api/profile', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          currentPassword: currentPasswordRef.current?.value,
          newPassword: newPasswordRef.current?.value,
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to update password')
      }

      await updateSession()

      onUpdate()

      toast({
        title: 'Success',
        description: 'Password updated successfully',
      })

      if (currentPasswordRef.current) currentPasswordRef.current.value = ''
      if (newPasswordRef.current) newPasswordRef.current.value = ''
      if (confirmPasswordRef.current) confirmPasswordRef.current.value = ''
    } catch (error) {
      console.error('Password update error:', error)
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
