'use client'

import React, { useEffect, useState } from 'react'

import Link from 'next/link'

import { LockIcon } from 'lucide-react'
import { useSession } from 'next-auth/react'

import { PasswordPrompt } from '@/components/auth/password-prompt'
import { LoadingState } from '@/components/file/viewer/components/loading-state'
import { Button } from '@/components/ui/button'

import { sanitizeUrl } from '@/lib/utils/url'

interface AuthGuardProps {
  children: React.ReactNode | ((verifiedPassword?: string) => React.ReactNode)
  initialVerifiedPassword?: string
  file: {
    userId: string
    password: string | null
    visibility: 'PUBLIC' | 'PRIVATE'
    urlPath: string
  }
}

export function AuthGuard({
  children,
  file,
  initialVerifiedPassword,
}: AuthGuardProps) {
  const { data: session, status } = useSession()
  const [isVerified, setIsVerified] = useState(Boolean(initialVerifiedPassword))
  const [verifiedPassword, setVerifiedPassword] = useState(
    initialVerifiedPassword
  )

  const isOwner = session?.user?.id === file.userId
  const isPrivate = file.visibility === 'PRIVATE' && !session?.user

  useEffect(() => {
    if (!isOwner && file.password) {
      const searchParams = new URLSearchParams(window.location.search)
      const parentVerifiedPassword = searchParams.get('password')
      if (parentVerifiedPassword && !verifiedPassword) {
        setVerifiedPassword(parentVerifiedPassword)
        setIsVerified(true)
      }
    }
  }, [isOwner, file.password, verifiedPassword])

  if (status === 'loading' && file.visibility === 'PRIVATE') {
    return <LoadingState message="Checking access…" />
  }

  if (isPrivate) {
    return (
      <div className="flex flex-col items-center gap-4 p-8 text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-full border border-border bg-muted/30">
          <LockIcon
            className="h-5 w-5 text-muted-foreground"
            aria-hidden="true"
          />
        </span>
        <div className="space-y-2">
          <h2 className="text-xl font-semibold tracking-tight">
            This file is private
          </h2>
          <p className="text-sm text-muted-foreground">
            Sign in with an account that has access to view it.
          </p>
        </div>
        <Button asChild>
          <Link href="/auth/login">Sign in</Link>
        </Button>
      </div>
    )
  }

  if (file.password && !isOwner && !isVerified) {
    const verifyPassword = async (password: string) => {
      const response = await fetch(
        `/api/files${sanitizeUrl(file.urlPath)}?password=${encodeURIComponent(password)}`
      )
      if (response.ok) {
        setVerifiedPassword(password)
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

  if (typeof children === 'function') {
    return <>{children(verifiedPassword)}</>
  }

  return (
    <>
      {React.Children.map(children, (child) => {
        if (React.isValidElement(child)) {
          return React.cloneElement(child, {
            verifiedPassword,
          } as React.Attributes)
        }
        return child
      })}
    </>
  )
}
