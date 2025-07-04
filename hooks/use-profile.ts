import { useCallback, useRef, useState } from 'react'

import { useRouter } from 'next/navigation'

import { useDataExport } from './use-data-export'
import { useFileDownload } from './use-file-download'
import { useToast } from './use-toast'

export interface ProfileFormData {
  name?: string
  email?: string
  currentPassword?: string
  newPassword?: string
  randomizeFileUrls?: boolean
}

export interface UseProfileOptions {
  onProfileUpdated?: () => void
  onAvatarUpdated?: (imageUrl: string) => void
  onAccountDeleted?: () => void
}

export function useProfile(options: UseProfileOptions = {}) {
  const [isLoading, setIsLoading] = useState(false)
  const router = useRouter()
  const { toast } = useToast()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const nameRef = useRef<HTMLInputElement>(null)
  const emailRef = useRef<HTMLInputElement>(null)
  const currentPasswordRef = useRef<HTMLInputElement>(null)
  const newPasswordRef = useRef<HTMLInputElement>(null)
  const {
    handleExport,
    isExporting,
    exportProgress,
    downloadProgress,
    status,
  } = useDataExport()
  const { downloadFile, isDownloading } = useFileDownload()

  const triggerAvatarUpload = useCallback(() => {
    fileInputRef.current?.click()
  }, [])

  const handleAvatarUpload = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (!file) return

      const allowedTypes = [
        'image/jpeg',
        'image/png',
        'image/gif',
        'image/webp',
      ]
      if (!allowedTypes.includes(file.type)) {
        toast({
          title: 'Invalid file type',
          description:
            'Please upload a valid image file (JPEG, PNG, GIF, WEBP)',
          variant: 'destructive',
        })
        return
      }

      if (file.size > 2 * 1024 * 1024) {
        toast({
          title: 'File too large',
          description: 'Avatar image must be less than 2MB',
          variant: 'destructive',
        })
        return
      }

      setIsLoading(true)
      const formData = new FormData()
      formData.append('avatar', file)

      try {
        const response = await fetch('/api/profile/avatar', {
          method: 'POST',
          body: formData,
        })

        if (!response.ok) {
          throw new Error('Failed to upload avatar')
        }

        const data = await response.json()

        if (options.onAvatarUpdated) {
          options.onAvatarUpdated(data.image)
        }

        toast({
          title: 'Avatar updated',
          description: 'Your profile picture has been updated successfully',
        })

        router.refresh()
      } catch (error) {
        console.error('Avatar upload error:', error)
        toast({
          title: 'Upload failed',
          description: 'Failed to upload avatar image',
          variant: 'destructive',
        })
      } finally {
        setIsLoading(false)
        if (fileInputRef.current) {
          fileInputRef.current.value = ''
        }
      }
    },
    [toast, router, options]
  )

  const updateProfile = useCallback(
    async (data: ProfileFormData) => {
      setIsLoading(true)
      try {
        const response = await fetch('/api/profile', {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(data),
        })

        if (!response.ok) {
          const errorData = await response.json()
          throw new Error(errorData.error || 'Failed to update profile')
        }

        toast({
          title: 'Profile updated',
          description: 'Your profile has been updated successfully',
        })

        if (options.onProfileUpdated) {
          options.onProfileUpdated()
        }

        router.refresh()
        return true
      } catch (error) {
        console.error('Profile update error:', error)
        toast({
          title: 'Update failed',
          description:
            error instanceof Error ? error.message : 'Failed to update profile',
          variant: 'destructive',
        })
        return false
      } finally {
        setIsLoading(false)
      }
    },
    [toast, router, options]
  )

  const handleProfileUpdate = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault()
      const data: ProfileFormData = {
        name: nameRef.current?.value,
        email: emailRef.current?.value,
      }
      return updateProfile(data)
    },
    [updateProfile]
  )

  const handlePasswordChange = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault()
      const currentPassword = currentPasswordRef.current?.value
      const newPassword = newPasswordRef.current?.value

      if (!currentPassword || !newPassword) {
        toast({
          title: 'Missing data',
          description: 'Please provide both current and new password',
          variant: 'destructive',
        })
        return
      }

      const data: ProfileFormData = {
        currentPassword,
        newPassword,
      }

      const success = await updateProfile(data)

      if (success) {
        if (currentPasswordRef.current) currentPasswordRef.current.value = ''
        if (newPasswordRef.current) newPasswordRef.current.value = ''
      }
    },
    [updateProfile, toast]
  )

  const updateRandomizeUrls = useCallback(
    async (randomize: boolean) => {
      return updateProfile({ randomizeFileUrls: randomize })
    },
    [updateProfile]
  )

  const deleteAccount = useCallback(async () => {
    setIsLoading(true)
    try {
      const response = await fetch('/api/profile', {
        method: 'DELETE',
      })

      if (!response.ok) {
        throw new Error('Failed to delete account')
      }

      toast({
        title: 'Account deleted',
        description: 'Your account has been deleted successfully',
      })

      if (options.onAccountDeleted) {
        options.onAccountDeleted()
      }

      router.push('/auth/login')
    } catch (error) {
      console.error('Account deletion error:', error)
      toast({
        title: 'Error',
        description: 'Failed to delete account',
        variant: 'destructive',
      })
    } finally {
      setIsLoading(false)
    }
  }, [toast, router, options])

  const exportProfileData = useCallback(() => {
    handleExport()
  }, [handleExport])

  const downloadShareXConfig = useCallback(() => {
    downloadFile('/api/profile/sharex')
  }, [downloadFile])

  const downloadBashScript = useCallback(() => {
    downloadFile('/api/profile/bash')
  }, [downloadFile])

  const downloadFlameshotScript = useCallback(
    (postUrl: string, token: string) => {
      downloadFile(
        `/api/profile/flameshot?postUrl=${encodeURIComponent(postUrl)}&token=${encodeURIComponent(token)}`
      )
    },
    [downloadFile]
  )

  return {
    isLoading,
    fileInputRef,
    nameRef,
    emailRef,
    currentPasswordRef,
    newPasswordRef,
    isExporting,
    exportProgress,
    downloadProgress,
    status,
    isDownloading,
    triggerAvatarUpload,
    handleAvatarUpload,
    handleProfileUpdate,
    handlePasswordChange,
    updateRandomizeUrls,
    deleteAccount,
    exportProfileData,
    downloadShareXConfig,
    downloadBashScript,
    downloadFlameshotScript,
  }
}
