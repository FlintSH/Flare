import { useState } from 'react'

import { useRouter } from 'next/navigation'

import { useToast } from './use-toast'

export interface PasswordProtectionOptions {
  fileId?: string
  onVerify?: (password: string) => void
  onError?: (error: string) => void
}

export function usePasswordProtection(options: PasswordProtectionOptions = {}) {
  const [password, setPassword] = useState('')
  const [isVerifying, setIsVerifying] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()
  const { toast } = useToast()

  const verifyPassword = async () => {
    if (!password) {
      setError('Please enter a password')
      return
    }

    setIsVerifying(true)
    setError(null)

    try {
      const response = await fetch(
        `/api/files/${options.fileId}/verify-password`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ password }),
        }
      )

      if (response.ok) {
        if (options.onVerify) {
          options.onVerify(password)
        }

        toast({
          title: 'Password verified',
          description: 'You now have access to this file',
        })
      } else {
        const data = await response.json()
        setError(data.error || 'Incorrect password')

        if (options.onError) {
          options.onError(data.error || 'Incorrect password')
        }
      }
    } catch (err) {
      setError('An error occurred while verifying the password')

      if (options.onError) {
        options.onError('An error occurred while verifying the password')
      }
    } finally {
      setIsVerifying(false)
    }
  }

  return {
    password,
    setPassword,
    isVerifying,
    error,
    verifyPassword,
  }
}
