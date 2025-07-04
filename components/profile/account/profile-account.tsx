'use client'

import { useRef, useState } from 'react'

import { useRouter } from 'next/navigation'

import { ProfileAccountProps } from '@/types/components/profile'
import { useSession } from 'next-auth/react'

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'

import { useToast } from '@/hooks/use-toast'

export function ProfileAccount({ user, onUpdate }: ProfileAccountProps) {
  const { update: updateSession } = useSession()
  const [isLoading, setIsLoading] = useState(false)
  const { toast } = useToast()
  const router = useRouter()

  const nameRef = useRef<HTMLInputElement>(null)
  const emailRef = useRef<HTMLInputElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const triggerAvatarUpload = () => {
    fileInputRef.current?.click()
  }

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.length) return
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

      router.refresh()

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
    try {
      const response = await fetch('/api/profile', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: nameRef.current?.value,
          email: emailRef.current?.value,
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to update profile')
      }

      const data = await response.json()

      await updateSession({
        user: {
          ...user,
          name: data.name,
          email: data.email,
        },
      })

      router.refresh()

      onUpdate()

      toast({
        title: 'Success',
        description: 'Profile updated successfully',
      })
    } catch (error) {
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

  const handleRandomizeUrlsToggle = async (checked: boolean) => {
    setIsLoading(true)
    try {
      const response = await fetch('/api/profile', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          randomizeFileUrls: checked,
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to update settings')
      }

      router.refresh()

      onUpdate()

      toast({
        title: 'Success',
        description: 'File URL settings updated successfully',
      })
    } catch (error) {
      toast({
        title: 'Error',
        description:
          error instanceof Error ? error.message : 'Failed to update settings',
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
            size="sm"
            onClick={triggerAvatarUpload}
            disabled={isLoading}
            className="mt-4 w-full"
          >
            {isLoading ? 'Uploading...' : 'Change Avatar'}
          </Button>
          <Input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleAvatarUpload}
          />
        </div>

        <div className="flex-1">
          <form
            onSubmit={handleProfileUpdate}
            className="flex flex-col justify-center h-full space-y-4"
          >
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="username">Username</Label>
                <Input
                  id="username"
                  ref={nameRef}
                  defaultValue={user.name || ''}
                  placeholder="Your username"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  ref={emailRef}
                  defaultValue={user.email || ''}
                  placeholder="Your email"
                />
              </div>
            </div>

            <div className="flex justify-end">
              <Button type="submit" disabled={isLoading}>
                {isLoading ? 'Saving...' : 'Save Changes'}
              </Button>
            </div>
          </form>
        </div>
      </div>

      <div className="flex items-center justify-between rounded-lg border p-4 mt-6">
        <div className="space-y-0.5">
          <Label htmlFor="randomize-urls">Randomize File URLs</Label>
          <p className="text-sm text-muted-foreground">
            When enabled, all new uploads will have randomized URLs instead of
            using the original filename.
          </p>
        </div>
        <Switch
          id="randomize-urls"
          checked={user.randomizeFileUrls}
          onCheckedChange={handleRandomizeUrlsToggle}
          disabled={isLoading}
        />
      </div>
    </>
  )
}
