'use client'

import React, { useEffect, useState } from 'react'

import Link from 'next/link'

import DOMPurify from 'dompurify'
import { LockIcon } from 'lucide-react'
import { useSession } from 'next-auth/react'

import { PasswordPrompt } from '@/components/auth/password-prompt'
import { Button } from '@/components/ui/button'

import { sanitizeUrl } from '@/lib/utils/url'

interface AuthGuardProps {
  children: React.ReactNode | ((verifiedPassword?: string) => React.ReactNode)
  file: {
    userId: string
    password: string | null
    visibility: 'PUBLIC' | 'PRIVATE'
    urlPath: string
  }
}

export function AuthGuard({ children, file }: AuthGuardProps) {
  const { data: session } = useSession()
  const [isVerified, setIsVerified] = useState(false)
  const [verifiedPassword, setVerifiedPassword] = useState<string>()

  const isOwner = session?.user?.id === file.userId
  const isPrivate = file.visibility === 'PRIVATE' && !session?.user

  // Check URL parameters for password
  useEffect(() => {
    if (!isOwner && file.password) {
      const searchParams = new URLSearchParams(window.location.search)
      const parentVerifiedPassword = searchParams.get('password')
      if (parentVerifiedPassword && !verifiedPassword) {
        const sanitizedPassword = DOMPurify.sanitize(parentVerifiedPassword)
        setVerifiedPassword(sanitizedPassword)
        setIsVerified(true)
      }
    }
  }, [isOwner, file.password, verifiedPassword])

  if (isPrivate) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 p-6">
        <LockIcon className="h-12 w-12 text-muted-foreground" />
        <p className="text-center text-muted-foreground">
          This file is private. Please sign in to view it.
        </p>
        <Button asChild>
          <Link href={DOMPurify.sanitize('/auth/signin')}>Sign In</Link>
        </Button>
      </div>
    )
  }

  // Only show password prompt if not owner and password is required
  if (file.password && !isOwner && !isVerified) {
    const verifyPassword = async (password: string) => {
      const sanitizedPassword = DOMPurify.sanitize(password)
      const response = await fetch(
        `/api/files${sanitizeUrl(file.urlPath)}?password=${sanitizedPassword}`
      )
      if (response.ok) {
        setVerifiedPassword(sanitizedPassword)
      }
      return response.ok
    }

    return (
      <PasswordPrompt
        onSubmit={verifyPassword}
        onSuccess={() => setIsVerified(true)}
      />
    )
  }

  // Clone children with the verified password prop
  // We need to use React.Children.map to pass the verifiedPassword to children
  if (typeof children === 'function') {
    return <>{children(verifiedPassword)}</>
  }

  return (
    <>
      {React.Children.map(children, (child) => {
        // Check if child is a valid React element
        if (React.isValidElement(child)) {
          // Clone the element with additional props (original logic before the typeof child.type check)
          return React.cloneElement(child, {
            verifiedPassword,
          } as React.Attributes)
        }
        return child
      })}
    </>
  )
}
