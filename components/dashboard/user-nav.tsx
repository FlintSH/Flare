'use client'

import Link from 'next/link'

import { useSession } from 'next-auth/react'

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'

export function UserNav() {
  const { data: session } = useSession()
  const initials = session?.user?.name
    ?.split(' ')
    .map((n) => n[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()

  return (
    <Button variant="ghost" className="relative h-9 w-9 rounded-full" asChild>
      <Link
        href="/dashboard/profile"
        aria-label="Open your profile and preferences"
      >
        <Avatar className="h-9 w-9">
          <AvatarImage
            src={session?.user?.image || undefined}
            alt={session?.user?.name || ''}
          />
          <AvatarFallback>{initials || 'F'}</AvatarFallback>
        </Avatar>
      </Link>
    </Button>
  )
}
